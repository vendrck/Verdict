import { describe, expect, it } from "vitest";
import { type DisputeDraft, EVIDENCE_NOTES_MAX, normalizeDisputeDraft } from "@/server/ai/dispute";
import { allowedActions } from "@/server/paypal/disputes";

const base: DisputeDraft = {
  action: "provide_evidence",
  evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", notes: "PR merged, CI passed." }],
  claimNote: "sorry",
  rationale: "Delivered.",
  risks: [],
};

describe("normalizeDisputeDraft", () => {
  it("drops evidence when accepting the claim", () => {
    const out = normalizeDisputeDraft({ ...base, action: "accept_claim" });
    expect(out.evidences).toEqual([]);
    expect(out.claimNote).toBe("sorry");
  });

  it("clears the buyer note when contesting", () => {
    expect(normalizeDisputeDraft(base).claimNote).toBe("");
  });

  it("caps evidence notes at PayPal's limit", () => {
    const long = { ...base, evidences: [{ evidence_type: "OTHER" as const, notes: "x".repeat(5000) }] };
    expect(normalizeDisputeDraft(long).evidences[0]!.notes).toHaveLength(EVIDENCE_NOTES_MAX);
  });

  it("falls back to accept_claim when a contest has no evidence", () => {
    const out = normalizeDisputeDraft({ ...base, evidences: [{ evidence_type: "OTHER", notes: "   " }] });
    expect(out.action).toBe("accept_claim");
    expect(out.risks.at(-1)).toMatch(/no evidence/);
  });
});

describe("allowedActions", () => {
  it("reads the seller actions from the dispute links", () => {
    const links = ["self", "accept_claim", "provide_evidence", "send_message"].map((rel) => ({ rel, href: "x" }));
    expect(allowedActions({ links })).toEqual(["provide_evidence", "accept_claim"]);
  });

  it("allows nothing when PayPal offers no seller action", () => {
    expect(allowedActions({ links: [{ rel: "self", href: "x" }] })).toEqual([]);
    expect(allowedActions({})).toEqual([]);
  });
});
