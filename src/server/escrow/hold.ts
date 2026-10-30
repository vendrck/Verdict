/**
 * Lifetime of a PayPal authorization (the escrow hold).
 *
 *   day 0–3   honor period: PayPal guarantees the funds; capture as is.
 *   day 3–29  still capturable, but not guaranteed. Reauthorize first (allowed
 *             several times in this window, always from the ORIGINAL
 *             authorization) to re-check the funds and get a fresh 3-day honor period.
 *   day 29+   expired: nothing can be captured; the client has to fund again.
 *
 * Pure functions only; the PayPal calls live in jobs/holds.ts.
 */

export const HONOR_PERIOD_DAYS = 3;
export const AUTHORIZATION_VALID_DAYS = 29;
/** Warn admins this many days before a hold expires. */
export const EXPIRY_WARNING_DAYS = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export type HoldPhase = "honored" | "unguaranteed" | "expired";

export interface HoldTimes {
  /** When the original authorization was created. */
  authorizedAt: Date;
  /** PayPal's expiration_time if we have it; otherwise derived from authorizedAt. */
  expiresAt?: Date | null;
  /** When the hold was last reauthorized (starts a new honor period). */
  reauthorizedAt?: Date | null;
}

export function holdExpiresAt(t: HoldTimes): Date {
  return t.expiresAt ?? new Date(t.authorizedAt.getTime() + AUTHORIZATION_VALID_DAYS * DAY_MS);
}

export function holdPhase(t: HoldTimes, now: Date): HoldPhase {
  if (now >= holdExpiresAt(t)) return "expired";
  const honorStart = t.reauthorizedAt ?? t.authorizedAt;
  return now.getTime() - honorStart.getTime() < HONOR_PERIOD_DAYS * DAY_MS ? "honored" : "unguaranteed";
}

/** Whole days until the hold expires (0 when expired or expiring today). */
export function daysUntilExpiry(t: HoldTimes, now: Date): number {
  return Math.max(0, Math.floor((holdExpiresAt(t).getTime() - now.getTime()) / DAY_MS));
}

/** Back out the original authorization time when only the expiry is stored. */
export function authorizedAtFromExpiry(expiresAt: Date): Date {
  return new Date(expiresAt.getTime() - AUTHORIZATION_VALID_DAYS * DAY_MS);
}
