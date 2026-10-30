import { describe, expect, it } from "vitest";
import {
  InvalidTransitionError,
  type JobEvent,
  type JobStatus,
  canTransition,
  transition,
} from "@/server/escrow/state-machine";

function run(events: JobEvent[], from: JobStatus = "draft"): JobStatus {
  return events.reduce(transition, from);
}

describe("escrow state machine", () => {
  it("follows the happy path to a full release", () => {
    expect(
      run([
        { type: "FUND_REQUESTED" },
        { type: "AUTHORIZED" },
        { type: "WORK_SUBMITTED" },
        { type: "VERIFICATION_PASSED" },
        { type: "ADMIN_RELEASED", partial: false },
      ]),
    ).toBe("released");
  });

  it("lets a rejected freelancer resubmit", () => {
    expect(run([{ type: "VERIFICATION_FAILED" }, { type: "WORK_SUBMITTED" }], "submitted")).toBe("submitted");
  });

  it("supports appeal → partial release", () => {
    expect(run([{ type: "APPEAL_FILED" }, { type: "ADMIN_RELEASED", partial: true }], "rejected")).toBe(
      "partially_released",
    );
  });

  it("only opens PayPal disputes after money was captured", () => {
    expect(transition("released", { type: "DISPUTE_OPENED" })).toBe("disputed");
    expect(transition("partially_released", { type: "DISPUTE_OPENED" })).toBe("disputed");
    expect(canTransition("funded", { type: "DISPUTE_OPENED" })).toBe(false);
  });

  it("refunds or expires only while money is held", () => {
    expect(transition("appealed", { type: "ADMIN_REFUNDED" })).toBe("refunded");
    expect(transition("submitted", { type: "HOLD_EXPIRED" })).toBe("hold_expired");
    expect(canTransition("released", { type: "ADMIN_REFUNDED" })).toBe(false);
  });

  it("never releases money for unverified work", () => {
    for (const from of ["draft", "awaiting_payment", "funded", "submitted", "rejected"] as const) {
      expect(() => transition(from, { type: "ADMIN_RELEASED", partial: false })).toThrow(InvalidTransitionError);
    }
  });
});
