import { describe, expect, it } from "vitest";
import { formatMoney, parseMoney, percentOf, splitRelease, toPayPalAmount } from "@/server/escrow/money";

describe("parseMoney / formatMoney", () => {
  it("round-trips two-decimal currencies", () => {
    expect(parseMoney("12.5", "usd")).toEqual({ currency: "USD", minor: 1250 });
    expect(formatMoney(parseMoney("0.07", "EUR"))).toBe("0.07");
    expect(formatMoney(parseMoney("100", "USD"))).toBe("100.00");
  });

  it("handles zero-decimal currencies", () => {
    expect(parseMoney("1500", "JPY")).toEqual({ currency: "JPY", minor: 1500 });
    expect(formatMoney({ currency: "JPY", minor: 1500 })).toBe("1500");
    expect(() => parseMoney("15.5", "JPY")).toThrow();
  });

  it("rejects malformed amounts", () => {
    for (const bad of ["", "-1", "1.234", "abc", "1e3", " 1"]) {
      expect(() => parseMoney(bad, "USD")).toThrow();
    }
  });

  it("produces the PayPal v2 amount shape", () => {
    expect(toPayPalAmount({ currency: "USD", minor: 6000 })).toEqual({ currency_code: "USD", value: "60.00" });
  });
});

describe("splitRelease", () => {
  const held = parseMoney("100.00", "USD");

  it("splits a partial release without losing cents", () => {
    const { release, returnedToClient } = splitRelease(held, parseMoney("33.33", "USD"));
    expect(release.minor + returnedToClient.minor).toBe(held.minor);
    expect(formatMoney(returnedToClient)).toBe("66.67");
  });

  it("allows full and zero releases", () => {
    expect(splitRelease(held, held).returnedToClient.minor).toBe(0);
    expect(splitRelease(held, { currency: "USD", minor: 0 }).returnedToClient.minor).toBe(10000);
  });

  it("refuses to release more than is held or in another currency", () => {
    expect(() => splitRelease(held, parseMoney("100.01", "USD"))).toThrow();
    expect(() => splitRelease(held, parseMoney("10.00", "EUR"))).toThrow(/Currency mismatch/);
  });
});

describe("percentOf", () => {
  it("rounds down to the minor unit", () => {
    expect(percentOf(parseMoney("10.01", "USD"), 50).minor).toBe(500);
  });

  it("rejects out-of-range percentages", () => {
    expect(() => percentOf(parseMoney("10.00", "USD"), 101)).toThrow();
    expect(() => percentOf(parseMoney("10.00", "USD"), Number.NaN)).toThrow();
  });
});
