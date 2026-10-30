import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import type { Money } from "@/server/escrow/money";
import { type JobEvent, type JobStatus, transition } from "@/server/escrow/state-machine";

/** Shared persistence helpers for the job services (create/fund/verify and settlement). */

export type Actor = (typeof schema.events.$inferInsert)["actor"];
export type Job = typeof schema.jobs.$inferSelect;

/** A user-facing failure (bad input, wrong state). Pages show its message as is. */
export class JobError extends Error {
  override name = "JobError";
}

export const jobMoney = (job: Pick<Job, "amountMinor" | "currency">): Money => ({
  currency: job.currency,
  minor: job.amountMinor,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadJob(jobId: string): Promise<Job> {
  // Postgres rejects a malformed uuid with a 500; treat it as "not found" instead.
  if (!UUID.test(jobId)) throw new JobError("Job not found.");
  const job = await db().query.jobs.findFirst({ where: eq(schema.jobs.id, jobId) });
  if (!job) throw new JobError("Job not found.");
  return job;
}

export async function logEvent(jobId: string, actor: Actor, type: string, data: Record<string, unknown> = {}) {
  await db().insert(schema.events).values({ jobId, actor, type, data });
}

/**
 * Apply a state-machine event and persist it. The update is conditional on the
 * status we read, so two concurrent requests can't both move the same job.
 */
export async function applyEvent(
  job: Job,
  event: JobEvent,
  patch: Partial<typeof schema.jobs.$inferInsert> = {},
): Promise<JobStatus> {
  const to = transition(job.status, event);
  const updated = await db()
    .update(schema.jobs)
    .set({ ...patch, status: to })
    .where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.status, job.status)))
    .returning({ id: schema.jobs.id });
  if (updated.length === 0) throw new JobError("This job was updated by someone else. Reload and try again.");
  return to;
}
