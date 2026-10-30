import { and, asc, desc, eq } from "drizzle-orm";
import { appEnv } from "@/config/env";
import { draftCriteria } from "@/server/ai/criteria";
import { aiModel } from "@/server/ai/model";
import { type Criterion, verifySubmission } from "@/server/ai/verify";
import { db, schema } from "@/server/db/client";
import { parseMoney } from "@/server/escrow/money";
import type { JobEvent } from "@/server/escrow/state-machine";
import { fetchPrSnapshot, type PrSnapshot, parsePrUrl } from "@/server/github/pull-request";
import { paypal } from "@/server/paypal";
import { approvalUrl, authorizationFrom, authorizeOrder, createEscrowOrder, getOrder } from "@/server/paypal/payments";
import { applyEvent, JobError, jobMoney, loadJob, logEvent } from "./store";

export { type Job, JobError, jobMoney } from "./store";

// ── Create ────────────────────────────────────────────────────────────────

export interface NewJobInput {
  title: string;
  brief: string;
  amount: string;
  currency: string;
  clientEmail: string;
  freelancerPaypalEmail: string;
  repoUrl?: string;
}

/** Create a draft job and let the AI propose acceptance criteria from the brief. */
export async function createJob(input: NewJobInput): Promise<string> {
  const amount = parseMoney(input.amount, input.currency);
  if (amount.minor <= 0) throw new JobError("Amount must be greater than zero.");

  const { id: modelId, model } = aiModel();
  const drafts = await draftCriteria(model, input.brief);

  return db().transaction(async (tx) => {
    const [job] = await tx
      .insert(schema.jobs)
      .values({
        title: input.title,
        brief: input.brief,
        currency: amount.currency,
        amountMinor: amount.minor,
        clientEmail: input.clientEmail,
        freelancerPaypalEmail: input.freelancerPaypalEmail,
        repoUrl: input.repoUrl || null,
      })
      .returning({ id: schema.jobs.id });
    if (!job) throw new Error("Insert returned no row");

    await tx.insert(schema.criteria).values(
      drafts.map((d, position) => ({ jobId: job.id, position, text: d.text, check: d.check, weight: d.weight })),
    );
    await tx.insert(schema.events).values([
      { jobId: job.id, actor: "client", type: "job.created", data: { amountMinor: amount.minor, currency: amount.currency } },
      { jobId: job.id, actor: "ai", type: "criteria.drafted", data: { model: modelId, count: drafts.length } },
    ]);
    return job.id;
  });
}

/** The client removes a criterion before funding (the agreement is frozen once money is held). */
export async function removeCriterion(jobId: string, criterionId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (job.status !== "draft") throw new JobError("Criteria can only change before the job is funded.");
  const remaining = await db().query.criteria.findMany({ where: eq(schema.criteria.jobId, jobId) });
  if (remaining.length <= 1) throw new JobError("A job needs at least one criterion.");
  await db()
    .delete(schema.criteria)
    .where(and(eq(schema.criteria.id, criterionId), eq(schema.criteria.jobId, jobId)));
  await logEvent(jobId, "client", "criterion.removed", { criterionId });
}

// ── Fund (PayPal authorize = hold) ────────────────────────────────────────

/** Create (or reuse) the PayPal AUTHORIZE order and return the link the client approves. */
export async function startFunding(jobId: string): Promise<string> {
  const job = await loadJob(jobId);

  // Retry after the client closed the PayPal window: reuse the open order.
  if (job.status === "awaiting_payment" && job.paypalOrderId) {
    const url = approvalUrl(await getOrder(paypal(), job.paypalOrderId));
    if (url) return url;
  }
  if (job.status !== "draft") throw new JobError(`This job can't be funded (status: ${job.status}).`);

  const base = appEnv().APP_BASE_URL;
  const order = await createEscrowOrder(paypal(), {
    jobId: job.id,
    description: `Escrow for: ${job.title}`.slice(0, 127),
    amount: jobMoney(job),
    returnUrl: `${base}/jobs/${job.id}/funded`,
    cancelUrl: `${base}/jobs/${job.id}?funding=cancelled`,
    brandName: "ProofPay",
  });
  const url = approvalUrl(order);
  if (!url) throw new Error(`PayPal returned no approval link for order ${order.id}`);

  await applyEvent(job, { type: "FUND_REQUESTED" }, { paypalOrderId: order.id });
  await logEvent(job.id, "paypal", "order.created", { orderId: order.id });
  return url;
}

/**
 * The client returned from PayPal. Authorize the order (the hold). `token` is the
 * order id PayPal appends to the return URL; it must match the job's order.
 */
export async function completeFunding(jobId: string, token: string | null): Promise<void> {
  const job = await loadJob(jobId);
  if (job.status === "funded") return; // page reload after success
  if (job.status !== "awaiting_payment" || !job.paypalOrderId) {
    throw new JobError(`This job isn't waiting for payment (status: ${job.status}).`);
  }
  if (token !== job.paypalOrderId) throw new JobError("This PayPal approval belongs to a different order.");

  const order = await getOrder(paypal(), job.paypalOrderId);
  if (order.status !== "APPROVED") {
    throw new JobError(`PayPal hasn't approved the payment yet (status: ${order.status}).`);
  }
  const auth = authorizationFrom(await authorizeOrder(paypal(), order.id));
  if (!auth) throw new Error(`Order ${order.id} authorized but returned no authorization`);

  await applyEvent(
    job,
    { type: "AUTHORIZED" },
    {
      authorizationId: auth.id,
      authorizationExpiresAt: auth.expiration_time ? new Date(auth.expiration_time) : null,
    },
  );
  await logEvent(job.id, "paypal", "payment.authorized", {
    authorizationId: auth.id,
    expiresAt: auth.expiration_time,
  });
}

// ── Submit + verify ───────────────────────────────────────────────────────

export async function submitWork(jobId: string, prUrl: string): Promise<void> {
  parsePrUrl(prUrl); // validate before any side effect
  const job = await loadJob(jobId);
  if (job.status !== "funded" && job.status !== "rejected") {
    throw new JobError(`Work can't be submitted now (status: ${job.status}).`);
  }

  const snapshot = await fetchPrSnapshot(prUrl, appEnv().GITHUB_TOKEN || undefined);
  const [submission] = await db()
    .insert(schema.submissions)
    .values({ jobId, prUrl, snapshot })
    .returning({ id: schema.submissions.id });
  if (!submission) throw new Error("Insert returned no row");

  await applyEvent(job, { type: "WORK_SUBMITTED" });
  await logEvent(jobId, "freelancer", "work.submitted", {
    prUrl,
    headSha: snapshot.headSha,
    files: snapshot.files.length,
    ci: snapshot.ci.state,
  });

  await runVerification(jobId);
}

/** Verify the latest submission. Safe to retry if the AI call failed. */
export async function runVerification(jobId: string): Promise<void> {
  const job = await loadJob(jobId);
  if (job.status !== "submitted") throw new JobError(`Nothing to verify (status: ${job.status}).`);

  const submission = await db().query.submissions.findFirst({
    where: eq(schema.submissions.jobId, jobId),
    orderBy: desc(schema.submissions.createdAt),
  });
  if (!submission) throw new JobError("No submission found.");
  const rows = await db().query.criteria.findMany({
    where: eq(schema.criteria.jobId, jobId),
    orderBy: asc(schema.criteria.position),
  });
  const criteria: Criterion[] = rows.map((c) => ({ id: c.id, text: c.text, check: c.check, weight: c.weight }));

  const { id: modelId, model } = aiModel();
  let verification;
  try {
    verification = await verifySubmission(model, criteria, submission.snapshot as PrSnapshot);
  } catch (err) {
    await logEvent(jobId, "ai", "verification.failed", { error: err instanceof Error ? err.message : String(err) });
    throw new JobError("The AI verifier is unavailable right now. The submission is saved; retry verification shortly.");
  }

  await db().insert(schema.verdicts).values({
    submissionId: submission.id,
    results: verification,
    overall: verification.overall,
    model: modelId,
  });
  const event: JobEvent =
    verification.overall === "pass"
      ? { type: "VERIFICATION_PASSED" }
      : verification.overall === "fail"
        ? { type: "VERIFICATION_FAILED" }
        : { type: "VERIFICATION_UNCERTAIN" };
  const to = await applyEvent(job, event);
  await logEvent(jobId, "ai", "verification.completed", { model: modelId, overall: verification.overall, status: to });
}

// ── Read models for the pages ─────────────────────────────────────────────

export async function listJobs() {
  return db().query.jobs.findMany({ orderBy: desc(schema.jobs.createdAt), limit: 50 });
}

export async function getJobView(jobId: string) {
  const job = await loadJob(jobId);
  const [criteria, submissions, events] = await Promise.all([
    db().query.criteria.findMany({ where: eq(schema.criteria.jobId, jobId), orderBy: asc(schema.criteria.position) }),
    db().query.submissions.findMany({ where: eq(schema.submissions.jobId, jobId), orderBy: desc(schema.submissions.createdAt) }),
    db().query.events.findMany({ where: eq(schema.events.jobId, jobId), orderBy: asc(schema.events.createdAt) }),
  ]);
  const latest = submissions[0];
  const verdict = latest
    ? await db().query.verdicts.findFirst({
        where: eq(schema.verdicts.submissionId, latest.id),
        orderBy: desc(schema.verdicts.createdAt),
      })
    : undefined;
  return { job, criteria, latestSubmission: latest, verdict, events };
}
