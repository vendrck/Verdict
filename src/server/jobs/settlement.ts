import { and, asc, desc, eq } from "drizzle-orm";
import { type AppealRuling, draftAppealRuling } from "@/server/ai/appeal";
import { aiModel } from "@/server/ai/model";
import type { Verification } from "@/server/ai/verify";
import { db, schema } from "@/server/db/client";
import { formatMoney, type Money, percentOf, splitRelease } from "@/server/escrow/money";
import { canTransition, HELD_STATES } from "@/server/escrow/state-machine";
import { paypal } from "@/server/paypal";
import { captureAuthorization, voidAuthorization } from "@/server/paypal/payments";
import { payFreelancer } from "@/server/paypal/payouts";
import { activeAuthorizationId, authorizationForCapture, checkHolds, expiringSoon } from "./holds";
import { applyEvent, type Job, JobError, jobMoney, loadJob, logEvent } from "./store";

/**
 * Settlement: everything that moves held money. Only admins reach these functions
 * (the server actions call requireAdmin first). Every PayPal call carries a stable
 * idempotency key, so a double click or a retry can't capture or pay twice.
 */

export interface SettlementPlan {
  kind: "release" | "partial" | "refund";
  release: Money;
  returnedToClient: Money;
}

/** Pure: what a release percentage means in money. 0% is a refund; 100% a full release. */
export function planSettlement(held: Money, releasePercent: number): SettlementPlan {
  const { release, returnedToClient } = splitRelease(held, percentOf(held, releasePercent));
  const kind = release.minor === 0 ? "refund" : returnedToClient.minor === 0 ? "release" : "partial";
  return { kind, release, returnedToClient };
}

/** Release `releasePercent` of the hold to the freelancer (0 = refund). */
export async function settleJob(jobId: string, releasePercent: number, reason: string): Promise<SettlementPlan> {
  const job = await loadJob(jobId);
  const plan = planSettlement(jobMoney(job), releasePercent);
  if (plan.kind === "refund") {
    await refundJob(job, reason);
    return plan;
  }

  if (!canTransition(job.status, { type: "ADMIN_RELEASED", partial: plan.kind === "partial" })) {
    throw new JobError(`Funds can't be released from status "${job.status}".`);
  }
  // Renews the hold first when PayPal no longer guarantees it (after day 3).
  const authorizationId = await authorizationForCapture(job);

  // final_capture=true: PayPal returns the uncaptured remainder to the client.
  const capture = await captureAuthorization(paypal(), authorizationId, plan.release, {
    idempotencyKey: `capture:${job.id}`,
    invoiceId: job.id,
    noteToPayer:
      plan.kind === "partial"
        ? `Partial release: ${formatMoney(plan.release)} ${job.currency}; ${formatMoney(plan.returnedToClient)} returned to you.`
        : "Released after verified delivery.",
  });
  await applyEvent(
    await loadJob(job.id), // reload: renewing the hold updated the row
    { type: "ADMIN_RELEASED", partial: plan.kind === "partial" },
    { captureId: capture.id, releasedMinor: plan.release.minor },
  );
  await logEvent(job.id, "admin", "funds.released", {
    captureId: capture.id,
    releasedMinor: plan.release.minor,
    returnedMinor: plan.returnedToClient.minor,
    reason,
  });

  await payOut(await loadJob(job.id));
  return plan;
}

async function refundJob(job: Job, reason: string): Promise<void> {
  if (!HELD_STATES.has(job.status)) throw new JobError(`Nothing is held for this job (status: ${job.status}).`);
  const authorizationId = activeAuthorizationId(job);
  if (!authorizationId) throw new JobError("This job has no PayPal hold to void.");
  await voidAuthorization(paypal(), authorizationId, `void:${authorizationId}`);
  if (job.reauthorizationId && job.authorizationId) {
    // Release the original hold too; PayPal may already have closed it, which is fine.
    await voidAuthorization(paypal(), job.authorizationId, `void:${job.authorizationId}`).catch(() => undefined);
  }
  await applyEvent(job, { type: "ADMIN_REFUNDED" });
  await logEvent(job.id, "admin", "funds.refunded", { authorizationId, reason });
}

/**
 * Pay the freelancer what was captured. Separate from the capture so a payout
 * failure (e.g. a bad receiver email) can be retried without touching the capture.
 */
export async function payOut(job: Job): Promise<void> {
  if (job.payoutBatchId) return;
  if (!job.releasedMinor || !job.captureId) throw new JobError("Nothing has been captured for this job yet.");
  try {
    const batch = await payFreelancer(paypal(), {
      jobId: job.id,
      receiverEmail: job.freelancerPaypalEmail,
      amount: { currency: job.currency, minor: job.releasedMinor },
      note: `Payment for "${job.title}" via ProofPay`,
    });
    await db()
      .update(schema.jobs)
      .set({ payoutBatchId: batch.batch_header.payout_batch_id })
      .where(eq(schema.jobs.id, job.id));
    await logEvent(job.id, "paypal", "payout.sent", {
      payoutBatchId: batch.batch_header.payout_batch_id,
      status: batch.batch_header.batch_status,
    });
  } catch (err) {
    await logEvent(job.id, "paypal", "payout.failed", { error: err instanceof Error ? err.message : String(err) });
    throw new JobError("Funds were captured, but the payout to the freelancer failed. Use “Retry payout”.");
  }
}

export async function retryPayout(jobId: string): Promise<void> {
  await payOut(await loadJob(jobId));
}

// ── Appeals ───────────────────────────────────────────────────────────────

/** A party contests the verdict. The AI drafts a ruling; an admin decides. */
export async function fileAppeal(jobId: string, raisedBy: "client" | "freelancer", reason: string): Promise<void> {
  const job = await loadJob(jobId);
  if (!canTransition(job.status, { type: "APPEAL_FILED" })) {
    throw new JobError(`This job can't be appealed now (status: ${job.status}).`);
  }
  const [appeal] = await db()
    .insert(schema.appeals)
    .values({ jobId, raisedBy, reason })
    .returning({ id: schema.appeals.id });
  if (!appeal) throw new Error("Insert returned no row");
  await applyEvent(job, { type: "APPEAL_FILED" });
  await logEvent(jobId, raisedBy, "appeal.filed", { appealId: appeal.id });

  await draftRuling(appeal.id);
}

/** Ask the AI for a draft ruling. On failure the admin simply decides without one. */
export async function draftRuling(appealId: string): Promise<void> {
  const appeal = await db().query.appeals.findFirst({ where: eq(schema.appeals.id, appealId) });
  if (!appeal) throw new JobError("Appeal not found.");
  const job = await loadJob(appeal.jobId);

  const criteria = await db().query.criteria.findMany({
    where: eq(schema.criteria.jobId, job.id),
    orderBy: asc(schema.criteria.position),
  });
  const latest = await db()
    .select({ results: schema.verdicts.results })
    .from(schema.verdicts)
    .innerJoin(schema.submissions, eq(schema.verdicts.submissionId, schema.submissions.id))
    .where(eq(schema.submissions.jobId, job.id))
    .orderBy(desc(schema.verdicts.createdAt))
    .limit(1);

  const { id: modelId, model } = aiModel();
  try {
    const ruling = await draftAppealRuling(model, {
      brief: job.brief,
      criteria: criteria.map((c) => ({ id: c.id, text: c.text, weight: c.weight })),
      verification: latest[0]?.results as Verification | undefined,
      raisedBy: appeal.raisedBy,
      reason: appeal.reason,
      heldAmount: `${formatMoney(jobMoney(job))} ${job.currency}`,
    });
    await db()
      .update(schema.appeals)
      .set({ copilotRuling: { ...ruling, model: modelId } })
      .where(eq(schema.appeals.id, appealId));
    await logEvent(job.id, "ai", "appeal.ruling_drafted", {
      appealId,
      model: modelId,
      outcome: ruling.outcome,
      releasePercent: ruling.releasePercent,
    });
  } catch (err) {
    await logEvent(job.id, "ai", "appeal.ruling_failed", { appealId, error: err instanceof Error ? err.message : String(err) });
  }
}

/** Admin decision on an appeal: settle at `releasePercent`, recording whether the draft was followed. */
export async function decideAppeal(appealId: string, releasePercent: number, note: string): Promise<void> {
  const appeal = await db().query.appeals.findFirst({
    where: and(eq(schema.appeals.id, appealId), eq(schema.appeals.decision, "pending")),
  });
  if (!appeal) throw new JobError("This appeal was already decided.");
  const draft = appeal.copilotRuling as AppealRuling | null;
  const followedDraft = draft !== null && draft.releasePercent === releasePercent;

  const plan = await settleJob(appeal.jobId, releasePercent, note || "Appeal decision");
  await db()
    .update(schema.appeals)
    .set({
      decision: followedDraft ? "approved" : "edited",
      finalRuling: { outcome: plan.kind, releasePercent, note },
      decidedAt: new Date(),
    })
    .where(eq(schema.appeals.id, appealId));
  await logEvent(appeal.jobId, "admin", "appeal.decided", { appealId, releasePercent, followedDraft });
}

export async function pendingAppeal(jobId: string) {
  return db().query.appeals.findFirst({
    where: and(eq(schema.appeals.jobId, jobId), eq(schema.appeals.decision, "pending")),
    orderBy: desc(schema.appeals.createdAt),
  });
}

/** Jobs an admin has to act on, oldest first, plus held jobs whose hold is about to expire. */
export async function adminQueue() {
  const jobs = await db().query.jobs.findMany({ orderBy: asc(schema.jobs.updatedAt) });
  const actionable = jobs.filter(
    (j) =>
      j.status === "needs_review" ||
      j.status === "verified" ||
      j.status === "appealed" ||
      ((j.status === "released" || j.status === "partially_released") && !j.payoutBatchId),
  );
  return { actionable, expiring: expiringSoon(jobs) };
}

export { checkHolds };
