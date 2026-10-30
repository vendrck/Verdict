import { asc, desc, eq, isNull, and } from "drizzle-orm";
import { paypalEnv } from "@/config/env";
import {
  type DisputeContext,
  type DisputeDraft,
  disputeDraftSchema,
  draftDisputeResponse,
  EVIDENCE_NOTES_MAX,
  investigateDispute,
} from "@/server/ai/dispute";
import { aiModel } from "@/server/ai/model";
import type { Verification } from "@/server/ai/verify";
import { db, schema } from "@/server/db/client";
import { formatMoney } from "@/server/escrow/money";
import { canTransition, transition } from "@/server/escrow/state-machine";
import type { PrSnapshot } from "@/server/github/pull-request";
import { paypal } from "@/server/paypal";
import {
  acceptClaim,
  allowedActions,
  type DisputeAction,
  getDispute,
  listDisputes,
  type PayPalDispute,
  provideEvidence,
} from "@/server/paypal/disputes";
import { openCopilotPayPalTools } from "@/server/paypal/mcp";
import { JobError, jobMoney } from "@/server/jobs/store";

/**
 * Disputes filed with PayPal after money was captured. PayPal tells us through
 * the webhook, or an admin pulls them with "Sync from PayPal" (no tunnel needed
 * locally). The copilot drafts a response; only an admin submits it.
 */

export type DisputeRow = typeof schema.disputes.$inferSelect;
export type StoredDraft = DisputeDraft & { model: string; investigated: boolean; draftedAt: string };

const evidenceType = disputeDraftSchema.shape.evidences.element.shape.evidence_type;

const OPEN_STATUSES = new Set(["OPEN", "WAITING_FOR_SELLER_RESPONSE", "WAITING_FOR_BUYER_RESPONSE", "UNDER_REVIEW"]);

/**
 * Store or refresh a dispute and link it to the job whose capture is disputed.
 * `eventType` names the audit event: the webhook's event type, or "dispute.synced".
 */
export async function recordDispute(dispute: PayPalDispute, eventType: string): Promise<DisputeRow> {
  const captureId = dispute.disputed_transactions?.[0]?.seller_transaction_id;
  const job = captureId ? await db().query.jobs.findFirst({ where: eq(schema.jobs.captureId, captureId) }) : undefined;

  const [row] = await db()
    .insert(schema.disputes)
    .values({
      jobId: job?.id,
      paypalDisputeId: dispute.dispute_id,
      reason: dispute.reason,
      status: dispute.status,
      responseDueAt: dispute.seller_response_due_date ? new Date(dispute.seller_response_due_date) : undefined,
    })
    .onConflictDoUpdate({
      target: schema.disputes.paypalDisputeId,
      set: {
        status: dispute.status,
        reason: dispute.reason,
        responseDueAt: dispute.seller_response_due_date ? new Date(dispute.seller_response_due_date) : undefined,
      },
    })
    .returning();

  if (job) {
    const event = OPEN_STATUSES.has(dispute.status) ? ({ type: "DISPUTE_OPENED" } as const) : ({ type: "DISPUTE_CLOSED" } as const);
    if (canTransition(job.status, event)) {
      await db()
        .update(schema.jobs)
        .set({ status: transition(job.status, event) })
        .where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.status, job.status)));
    }
  }
  await db()
    .insert(schema.events)
    .values({
      jobId: job?.id,
      actor: "paypal",
      type: eventType,
      data: { disputeId: dispute.dispute_id, reason: dispute.reason, status: dispute.status },
    });
  return row!;
}

/** Pull recent disputes from PayPal. Returns how many were recorded. */
export async function syncDisputes(): Promise<number> {
  const client = paypal();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const { items = [] } = await listDisputes(client, { startTime: since, pageSize: 50 });
  for (const summary of items) {
    // The list view omits transactions and links; fetch the full record.
    await recordDispute(await getDispute(client, summary.dispute_id), "dispute.synced");
  }
  return items.length;
}

async function loadDispute(id: string): Promise<DisputeRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new JobError("Dispute not found.");
  const row = await db().query.disputes.findFirst({ where: eq(schema.disputes.id, id) });
  if (!row) throw new JobError("Dispute not found.");
  return row;
}

async function jobContext(jobId: string): Promise<DisputeContext["job"]> {
  const job = await db().query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
  if (!job) return undefined;
  const [criteria, submission, events] = await Promise.all([
    db().query.criteria.findMany({ where: eq(schema.criteria.jobId, jobId), orderBy: asc(schema.criteria.position) }),
    db().query.submissions.findFirst({ where: eq(schema.submissions.jobId, jobId), orderBy: desc(schema.submissions.createdAt) }),
    db().query.events.findMany({ where: eq(schema.events.jobId, jobId), orderBy: asc(schema.events.createdAt) }),
  ]);
  const verdict = submission
    ? await db().query.verdicts.findFirst({
        where: eq(schema.verdicts.submissionId, submission.id),
        orderBy: desc(schema.verdicts.createdAt),
      })
    : undefined;
  const verification = verdict?.results as Verification | undefined;
  const byId = new Map((verification?.results ?? []).map((r) => [r.criterionId, r]));
  const snapshot = submission?.snapshot as PrSnapshot | undefined;

  return {
    title: job.title,
    brief: job.brief,
    amount: `${formatMoney(jobMoney(job))} ${job.currency}`,
    released: `${formatMoney({ currency: job.currency, minor: job.releasedMinor ?? 0 })} ${job.currency}`,
    criteria: criteria.map((c) => {
      const r = byId.get(c.id);
      return { text: c.text, verdict: r ? `${r.verdict}: ${r.reasoning}` : undefined };
    }),
    verificationOverall: verdict?.overall,
    prUrl: snapshot?.url ?? submission?.prUrl,
    ciState: snapshot?.ci.state,
    timeline: events.map((e) => ({ at: e.createdAt, actor: e.actor, type: e.type })),
  };
}

/** Run the copilot for one dispute and store its draft. Safe to re-run while the dispute is pending. */
export async function draftForDispute(id: string): Promise<StoredDraft> {
  const row = await loadDispute(id);
  if (row.decision !== "pending") throw new JobError("This dispute was already answered.");

  const client = paypal();
  const dispute = await getDispute(client, row.paypalDisputeId);
  const ai = aiModel();

  let investigation: string | null = null;
  try {
    const mcp = await openCopilotPayPalTools(client, paypalEnv().PAYPAL_ENV);
    try {
      investigation = await investigateDispute(ai.model, mcp.tools, row.paypalDisputeId);
    } finally {
      await mcp.close();
    }
  } catch (err) {
    console.warn("PayPal MCP tools unavailable; drafting without investigation.", err);
  }

  let draft: DisputeDraft;
  try {
    draft = await draftDisputeResponse(
      ai.model,
      { dispute, job: row.jobId ? await jobContext(row.jobId) : undefined },
      investigation,
    );
  } catch (err) {
    console.error(err);
    await db()
      .insert(schema.events)
      .values({ jobId: row.jobId, actor: "ai", type: "dispute.draft_failed", data: { disputeId: row.paypalDisputeId } });
    throw new JobError("The copilot couldn't draft a response. Try again, or answer the dispute in PayPal.");
  }

  const stored: StoredDraft = { ...draft, model: ai.id, investigated: investigation !== null, draftedAt: new Date().toISOString() };
  await db()
    .update(schema.disputes)
    .set({ copilotDraft: stored, status: dispute.status })
    .where(eq(schema.disputes.id, row.id));
  await db()
    .insert(schema.events)
    .values({
      jobId: row.jobId,
      actor: "ai",
      type: "dispute.drafted",
      data: { disputeId: row.paypalDisputeId, action: draft.action, model: ai.id },
    });
  return stored;
}

/** Draft every pending dispute that has no draft yet (after a sync or webhook). */
export async function draftMissing(limit = 3): Promise<void> {
  const rows = await db().query.disputes.findMany({
    where: and(eq(schema.disputes.decision, "pending"), isNull(schema.disputes.copilotDraft)),
    limit,
  });
  for (const row of rows) {
    await draftForDispute(row.id).catch((err: unknown) => console.warn(`Draft failed for ${row.paypalDisputeId}`, err));
  }
}

export interface DisputeSubmission {
  action: DisputeAction;
  /** Evidence as submitted by the admin form (provide_evidence). Types are re-validated here. */
  evidences: { type: string; notes: string }[];
  /** Note to the buyer (accept_claim). */
  claimNote: string;
}

/** Admin-approved submission to PayPal. The only path that answers a dispute. */
export async function respondToDispute(id: string, input: DisputeSubmission): Promise<void> {
  const row = await loadDispute(id);
  if (row.decision !== "pending") throw new JobError("This dispute was already answered.");
  const draft = row.copilotDraft as StoredDraft | null;

  const client = paypal();
  const live = await getDispute(client, row.paypalDisputeId);
  if (!allowedActions(live).includes(input.action)) {
    throw new JobError(`PayPal doesn't allow ${input.action.replace("_", " ")} on this dispute right now (status ${live.status}).`);
  }

  // One key per dispute and action: a double submit is a no-op at PayPal.
  const idempotencyKey = `dispute:${row.paypalDisputeId}:${input.action}`;
  let edited = !draft || draft.action !== input.action;
  if (input.action === "provide_evidence") {
    const evidences = input.evidences
      .map((e) => ({ evidence_type: evidenceType.catch("OTHER").parse(e.type), notes: e.notes.trim() }))
      .filter((e) => e.notes.length > 0);
    if (evidences.length === 0) throw new JobError("Add at least one evidence note.");
    if (evidences.some((e) => e.notes.length > EVIDENCE_NOTES_MAX)) {
      throw new JobError(`Each evidence note must be under ${EVIDENCE_NOTES_MAX} characters.`);
    }
    edited ||= evidences.some((e, i) => e.notes !== draft?.evidences[i]?.notes.trim());
    await provideEvidence(client, row.paypalDisputeId, evidences, [], idempotencyKey);
  } else {
    const note = input.claimNote.trim();
    if (!note) throw new JobError("Add a note to the buyer.");
    edited ||= note !== draft?.claimNote.trim();
    await acceptClaim(client, row.paypalDisputeId, note, idempotencyKey);
  }

  const after = await getDispute(client, row.paypalDisputeId).catch(() => live);
  await db()
    .update(schema.disputes)
    .set({ decision: edited ? "edited" : "approved", submittedAt: new Date(), status: after.status })
    .where(and(eq(schema.disputes.id, row.id), eq(schema.disputes.decision, "pending")));
  await db()
    .insert(schema.events)
    .values({
      jobId: row.jobId,
      actor: "admin",
      type: input.action === "provide_evidence" ? "dispute.evidence_submitted" : "dispute.claim_accepted",
      data: { disputeId: row.paypalDisputeId, followedDraft: !edited, status: after.status },
    });
}

export function listDisputeRows() {
  return db().query.disputes.findMany({ orderBy: desc(schema.disputes.createdAt) });
}

export async function getDisputeView(id: string) {
  const row = await loadDispute(id);
  const [live, job] = await Promise.all([
    getDispute(paypal(), row.paypalDisputeId).catch(() => undefined),
    row.jobId ? db().query.jobs.findFirst({ where: eq(schema.jobs.id, row.jobId) }) : undefined,
  ]);
  // PayPal resolves disputes on its own schedule; keep the list in step without waiting for a webhook.
  if (live && live.status !== row.status) {
    await db().update(schema.disputes).set({ status: live.status }).where(eq(schema.disputes.id, row.id));
  }
  return { row, draft: row.copilotDraft as StoredDraft | null, live, job, allowed: live ? allowedActions(live) : [] };
}
