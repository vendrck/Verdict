import { sql } from "drizzle-orm";
import { bigint, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { JOB_STATUSES } from "@/server/escrow/state-machine";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const jobStatus = pgEnum("job_status", JOB_STATUSES);
export const criterionCheck = pgEnum("criterion_check", ["ci_pass", "diff_matches", "manual"]);
export const partyRole = pgEnum("party_role", ["client", "freelancer"]);
export const adminDecision = pgEnum("admin_decision", ["pending", "approved", "edited", "rejected"]);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    title: text("title").notNull(),
    brief: text("brief").notNull(),
    currency: text("currency").notNull(),
    /** Integer minor units (see escrow/money.ts). */
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    clientEmail: text("client_email").notNull(),
    freelancerPaypalEmail: text("freelancer_paypal_email").notNull(),
    repoUrl: text("repo_url"),
    status: jobStatus("status").notNull().default("draft"),
    paypalOrderId: text("paypal_order_id"),
    authorizationId: text("authorization_id"),
    authorizationExpiresAt: timestamp("authorization_expires_at", { withTimezone: true }),
    reauthorizedAt: timestamp("reauthorized_at", { withTimezone: true }),
    /** The hold PayPal issued on reauthorize; capture and void use it instead of authorizationId. */
    reauthorizationId: text("reauthorization_id"),
    captureId: text("capture_id"),
    releasedMinor: bigint("released_minor", { mode: "number" }),
    payoutBatchId: text("payout_batch_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => sql`now()`),
  },
  (t) => [index("jobs_status_idx").on(t.status), index("jobs_capture_idx").on(t.captureId)],
);

export const criteria = pgTable("criteria", {
  id: id(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  text: text("text").notNull(),
  check: criterionCheck("check").notNull(),
  weight: integer("weight").notNull().default(1),
});

export const submissions = pgTable("submissions", {
  id: id(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  prUrl: text("pr_url").notNull(),
  /** Frozen evidence at submission time: diff summary, changed files, CI results. */
  snapshot: jsonb("snapshot").notNull(),
  createdAt: createdAt(),
});

export const verdicts = pgTable("verdicts", {
  id: id(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  /** Per-criterion { criterionId, pass, confidence, reasoning, evidenceRefs }. */
  results: jsonb("results").notNull(),
  overall: text("overall", { enum: ["pass", "fail", "uncertain"] }).notNull(),
  model: text("model").notNull(),
  createdAt: createdAt(),
});

export const appeals = pgTable("appeals", {
  id: id(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  raisedBy: partyRole("raised_by").notNull(),
  reason: text("reason").notNull(),
  /** Copilot draft: { outcome: release|partial|refund, releaseMinor, rationale }. */
  copilotRuling: jsonb("copilot_ruling"),
  decision: adminDecision("decision").notNull().default("pending"),
  /** What the admin actually approved (may differ from the draft). */
  finalRuling: jsonb("final_ruling"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const disputes = pgTable("disputes", {
  id: id(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  paypalDisputeId: text("paypal_dispute_id").notNull().unique(),
  reason: text("reason"),
  status: text("status"),
  responseDueAt: timestamp("response_due_at", { withTimezone: true }),
  /** Copilot draft: { action: provide_evidence|accept_claim, evidences[], rationale }. */
  copilotDraft: jsonb("copilot_draft"),
  decision: adminDecision("decision").notNull().default("pending"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Append-only audit trail. This is the evidence a dispute response is built from. */
export const events = pgTable(
  "events",
  {
    id: id(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    actor: text("actor", { enum: ["system", "ai", "admin", "client", "freelancer", "paypal"] }).notNull(),
    type: text("type").notNull(),
    data: jsonb("data").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("events_job_idx").on(t.jobId, t.createdAt)],
);

/** Webhook deliveries already processed, so PayPal retries are no-ops. */
export const processedWebhooks = pgTable("processed_webhooks", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  receivedAt: createdAt(),
});
