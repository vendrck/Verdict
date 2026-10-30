/**
 * Job lifecycle. Every status change in the app goes through `transition` so
 * an illegal move (e.g. releasing money for a job that was never verified)
 * fails loudly instead of silently corrupting escrow state.
 *
 *   draft ─FUND_REQUESTED→ awaiting_payment ─AUTHORIZED→ funded
 *   funded ─WORK_SUBMITTED→ submitted ─VERIFICATION_*→ verified | rejected | needs_review
 *   verified/rejected/needs_review ─APPEAL_FILED→ appealed
 *   (verified | needs_review | appealed) ─ADMIN_RELEASED→ released | partially_released
 *   (any held state) ─ADMIN_REFUNDED→ refunded
 *   rejected ─WORK_SUBMITTED→ submitted            (freelancer resubmits)
 *   funded/submitted/... ─HOLD_EXPIRED→ hold_expired
 *   released | partially_released ─DISPUTE_OPENED→ disputed ─DISPUTE_CLOSED→ dispute_closed
 */

export const JOB_STATUSES = [
  "draft",
  "awaiting_payment",
  "funded",
  "submitted",
  "verified",
  "rejected",
  "needs_review",
  "appealed",
  "released",
  "partially_released",
  "refunded",
  "hold_expired",
  "disputed",
  "dispute_closed",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type JobEvent =
  | { type: "FUND_REQUESTED" }
  | { type: "AUTHORIZED" }
  | { type: "WORK_SUBMITTED" }
  | { type: "VERIFICATION_PASSED" }
  | { type: "VERIFICATION_FAILED" }
  | { type: "VERIFICATION_UNCERTAIN" }
  | { type: "APPEAL_FILED" }
  | { type: "ADMIN_RELEASED"; partial: boolean }
  | { type: "ADMIN_REFUNDED" }
  | { type: "HOLD_EXPIRED" }
  | { type: "DISPUTE_OPENED" }
  | { type: "DISPUTE_CLOSED" };

/** States in which client money is held by an open authorization. */
export const HELD_STATES: ReadonlySet<JobStatus> = new Set([
  "funded",
  "submitted",
  "verified",
  "rejected",
  "needs_review",
  "appealed",
]);

const REVIEWABLE: ReadonlySet<JobStatus> = new Set(["verified", "rejected", "needs_review"]);
const RELEASABLE: ReadonlySet<JobStatus> = new Set(["verified", "needs_review", "appealed"]);
const DISPUTABLE: ReadonlySet<JobStatus> = new Set(["released", "partially_released"]);

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: JobStatus,
    readonly event: JobEvent["type"],
  ) {
    super(`Cannot apply ${event} to a job in status "${from}"`);
    this.name = "InvalidTransitionError";
  }
}

export function nextStatus(from: JobStatus, event: JobEvent): JobStatus | null {
  switch (event.type) {
    case "FUND_REQUESTED":
      return from === "draft" ? "awaiting_payment" : null;
    case "AUTHORIZED":
      return from === "awaiting_payment" ? "funded" : null;
    case "WORK_SUBMITTED":
      return from === "funded" || from === "rejected" ? "submitted" : null;
    case "VERIFICATION_PASSED":
      return from === "submitted" ? "verified" : null;
    case "VERIFICATION_FAILED":
      return from === "submitted" ? "rejected" : null;
    case "VERIFICATION_UNCERTAIN":
      return from === "submitted" ? "needs_review" : null;
    case "APPEAL_FILED":
      return REVIEWABLE.has(from) ? "appealed" : null;
    case "ADMIN_RELEASED":
      if (!RELEASABLE.has(from)) return null;
      return event.partial ? "partially_released" : "released";
    case "ADMIN_REFUNDED":
      return HELD_STATES.has(from) ? "refunded" : null;
    case "HOLD_EXPIRED":
      return HELD_STATES.has(from) ? "hold_expired" : null;
    case "DISPUTE_OPENED":
      return DISPUTABLE.has(from) ? "disputed" : null;
    case "DISPUTE_CLOSED":
      return from === "disputed" ? "dispute_closed" : null;
  }
}

export function transition(from: JobStatus, event: JobEvent): JobStatus {
  const to = nextStatus(from, event);
  if (to === null) throw new InvalidTransitionError(from, event.type);
  return to;
}

export function canTransition(from: JobStatus, event: JobEvent): boolean {
  return nextStatus(from, event) !== null;
}
