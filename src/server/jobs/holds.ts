import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import {
  authorizedAtFromExpiry,
  daysUntilExpiry,
  EXPIRY_WARNING_DAYS,
  holdExpiresAt,
  holdPhase,
  type HoldTimes,
} from "@/server/escrow/hold";
import { canTransition, HELD_STATES } from "@/server/escrow/state-machine";
import { paypal } from "@/server/paypal";
import { getAuthorization, reauthorize } from "@/server/paypal/payments";
import { applyEvent, type Job, JobError, jobMoney, logEvent } from "./store";

/**
 * Keeping escrow holds alive. Two entry points:
 *  - authorizationForCapture: called right before a release. Renews the hold
 *    first if PayPal no longer guarantees the funds.
 *  - checkHolds: finds holds that expired and moves their jobs to hold_expired.
 */

/** The hold settlement should capture or void: the reauthorized one if there is one. */
export const activeAuthorizationId = (job: Job) => job.reauthorizationId ?? job.authorizationId;

function holdTimes(job: Job, createTime?: string): HoldTimes | null {
  const expiresAt = job.authorizationExpiresAt;
  const authorizedAt = createTime ? new Date(createTime) : expiresAt ? authorizedAtFromExpiry(expiresAt) : null;
  if (!authorizedAt) return null;
  return { authorizedAt, expiresAt, reauthorizedAt: job.reauthorizedAt };
}

async function markExpired(job: Job, reason: string): Promise<void> {
  if (!canTransition(job.status, { type: "HOLD_EXPIRED" })) return;
  await applyEvent(job, { type: "HOLD_EXPIRED" });
  await logEvent(job.id, "system", "hold.expired", { authorizationId: job.authorizationId, reason });
}

/**
 * Return the authorization id to capture. Past the 3-day honor period, renew
 * the hold first so the capture runs against freshly checked funds. If renewing
 * fails we still try the capture: an unguaranteed hold is often still good,
 * and the capture itself gives the definitive answer.
 */
export async function authorizationForCapture(job: Job, now = new Date()): Promise<string> {
  if (!job.authorizationId) throw new JobError("This job has no PayPal hold to capture.");
  const client = paypal();
  const original = await getAuthorization(client, job.authorizationId);
  const times = holdTimes(job, original.create_time);

  if (original.status === "EXPIRED" || original.status === "VOIDED" || (times && holdPhase(times, now) === "expired")) {
    await markExpired(job, `authorization ${original.status}`);
    throw new JobError("The PayPal hold has expired, so there is nothing to capture. The client needs to fund the job again.");
  }
  if (!times || holdPhase(times, now) === "honored") return activeAuthorizationId(job)!;

  try {
    // Always from the original: PayPal doesn't allow reauthorizing a reauthorization.
    // The key is per job, so a retried release reuses the same renewed hold.
    const renewed = await reauthorize(client, job.authorizationId, jobMoney(job), `reauthorize:${job.id}`);
    await db()
      .update(schema.jobs)
      .set({ reauthorizationId: renewed.id, reauthorizedAt: now })
      .where(eq(schema.jobs.id, job.id));
    await logEvent(job.id, "paypal", "hold.reauthorized", { authorizationId: job.authorizationId, reauthorizationId: renewed.id });
    return renewed.id;
  } catch (err) {
    await logEvent(job.id, "paypal", "hold.reauthorize_failed", {
      authorizationId: job.authorizationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return activeAuthorizationId(job)!;
  }
}

export interface HoldCheck {
  checked: number;
  expired: number;
}

/**
 * Move jobs whose hold has expired to hold_expired. Local dates decide which
 * holds to look at; PayPal's status is checked before anything changes.
 */
export async function checkHolds(now = new Date()): Promise<HoldCheck> {
  const jobs = await db().query.jobs.findMany({
    where: and(inArray(schema.jobs.status, [...HELD_STATES]), isNotNull(schema.jobs.authorizationId)),
  });
  const client = paypal();
  let checked = 0;
  let expired = 0;
  for (const job of jobs) {
    const times = holdTimes(job);
    if (!times || holdPhase(times, now) !== "expired") continue;
    checked++;
    try {
      const auth = await getAuthorization(client, job.authorizationId!);
      const gone = auth.status === "EXPIRED" || auth.status === "VOIDED";
      const pastExpiry = auth.expiration_time ? now >= new Date(auth.expiration_time) : true;
      if (gone || pastExpiry) {
        await markExpired(job, `authorization ${auth.status}`);
        expired++;
      }
    } catch (err) {
      console.warn(`Hold check failed for job ${job.id}`, err);
    }
  }
  return { checked, expired };
}

/** Held jobs whose hold ends within the warning window, for the admin queue. */
export function expiringSoon(jobs: Job[], now = new Date()): { job: Job; daysLeft: number; expiresAt: Date }[] {
  return jobs.flatMap((job) => {
    if (!HELD_STATES.has(job.status) || !job.authorizationId) return [];
    const times = holdTimes(job);
    if (!times) return [];
    const daysLeft = daysUntilExpiry(times, now);
    return daysLeft <= EXPIRY_WARNING_DAYS ? [{ job, daysLeft, expiresAt: holdExpiresAt(times) }] : [];
  });
}
