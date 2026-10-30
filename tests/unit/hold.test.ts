import { describe, expect, it } from "vitest";
import { authorizedAtFromExpiry, daysUntilExpiry, holdExpiresAt, holdPhase } from "@/server/escrow/hold";

const DAY = 24 * 60 * 60 * 1000;
const t0 = new Date("2026-11-01T12:00:00Z");
const at = (days: number) => new Date(t0.getTime() + days * DAY);

describe("holdPhase", () => {
  it("is honored for the first 3 days", () => {
    expect(holdPhase({ authorizedAt: t0 }, at(0))).toBe("honored");
    expect(holdPhase({ authorizedAt: t0 }, at(2.9))).toBe("honored");
  });
  it("is unguaranteed from day 3 until expiry", () => {
    expect(holdPhase({ authorizedAt: t0 }, at(3))).toBe("unguaranteed");
    expect(holdPhase({ authorizedAt: t0 }, at(28.9))).toBe("unguaranteed");
  });
  it("expires at day 29, or at PayPal's expiration_time when given", () => {
    expect(holdPhase({ authorizedAt: t0 }, at(29))).toBe("expired");
    expect(holdPhase({ authorizedAt: t0, expiresAt: at(10) }, at(10))).toBe("expired");
  });
  it("starts a new honor period after a reauthorization, but keeps the original expiry", () => {
    const times = { authorizedAt: t0, reauthorizedAt: at(20) };
    expect(holdPhase(times, at(22))).toBe("honored");
    expect(holdPhase(times, at(23.5))).toBe("unguaranteed");
    expect(holdPhase({ authorizedAt: t0, reauthorizedAt: at(28) }, at(29))).toBe("expired");
  });
});

describe("expiry helpers", () => {
  it("derives the authorization time from a stored expiry", () => {
    expect(authorizedAtFromExpiry(at(29)).getTime()).toBe(t0.getTime());
  });
  it("counts whole days left and never goes negative", () => {
    expect(daysUntilExpiry({ authorizedAt: t0 }, at(24))).toBe(5);
    expect(daysUntilExpiry({ authorizedAt: t0 }, at(40))).toBe(0);
    expect(holdExpiresAt({ authorizedAt: t0 }).getTime()).toBe(at(29).getTime());
  });
});
