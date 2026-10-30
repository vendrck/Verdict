import { describe, expect, it } from "vitest";
import { normalizeRuling } from "@/server/ai/appeal";
import { passwordMatches, signSession, verifySession } from "@/server/admin/auth";
import { planSettlement } from "@/server/jobs/settlement";

const usd = (minor: number) => ({ currency: "USD", minor });

describe("planSettlement", () => {
  it("maps 100% to a full release", () => {
    expect(planSettlement(usd(10_000), 100)).toEqual({ kind: "release", release: usd(10_000), returnedToClient: usd(0) });
  });
  it("maps 0% to a refund", () => {
    expect(planSettlement(usd(10_000), 0)).toEqual({ kind: "refund", release: usd(0), returnedToClient: usd(10_000) });
  });
  it("splits a partial release without losing a cent", () => {
    const plan = planSettlement(usd(9_999), 33);
    expect(plan.kind).toBe("partial");
    expect(plan.release.minor + plan.returnedToClient.minor).toBe(9_999);
    expect(plan.release.minor).toBe(3_299); // rounds down in the client's favour
  });
  it("treats a percentage that rounds to zero as a refund", () => {
    expect(planSettlement(usd(50), 1).kind).toBe("refund");
  });
  it("rejects out-of-range percentages", () => {
    expect(() => planSettlement(usd(100), 101)).toThrow();
    expect(() => planSettlement(usd(100), -1)).toThrow();
  });
});

describe("normalizeRuling", () => {
  const base = { rationale: "", considerations: [] };
  it("forces percentages that agree with the outcome", () => {
    expect(normalizeRuling({ ...base, outcome: "release", releasePercent: 40 }).releasePercent).toBe(100);
    expect(normalizeRuling({ ...base, outcome: "refund", releasePercent: 40 }).releasePercent).toBe(0);
    expect(normalizeRuling({ ...base, outcome: "partial", releasePercent: 100 }).releasePercent).toBe(99);
    expect(normalizeRuling({ ...base, outcome: "partial", releasePercent: 0 }).releasePercent).toBe(1);
    expect(normalizeRuling({ ...base, outcome: "partial", releasePercent: 60 }).releasePercent).toBe(60);
  });
});

describe("admin session", () => {
  const password = "correct horse battery staple";
  const now = 1_800_000_000_000;

  it("accepts a valid, unexpired session", () => {
    expect(verifySession(password, signSession(password, now + 1000), now)).toBe(true);
  });
  it("rejects expired, tampered or foreign sessions", () => {
    expect(verifySession(password, signSession(password, now - 1), now)).toBe(false);
    const token = signSession(password, now + 1000);
    expect(verifySession(password, token.replace(/^\d+/, String(now + 9_999_999)), now)).toBe(false);
    expect(verifySession(password, signSession("another password!!", now + 1000), now)).toBe(false);
    expect(verifySession(password, "garbage", now)).toBe(false);
    expect(verifySession(undefined, token, now)).toBe(false);
  });
  it("checks the password", () => {
    expect(passwordMatches(password, password)).toBe(true);
    expect(passwordMatches(password, "wrong")).toBe(false);
    expect(passwordMatches(undefined, "")).toBe(false);
  });
});
