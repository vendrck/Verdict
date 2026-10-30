import type { PayPalClient } from "./client";

/**
 * Disputes API v1. The PayPal MCP server can read disputes and accept claims,
 * but has no tool to submit evidence, so the copilot's approved response goes
 * out through `provideEvidence` here.
 */

export interface PayPalDispute {
  dispute_id: string;
  reason: string;
  status: string;
  dispute_state?: string;
  dispute_life_cycle_stage?: string;
  dispute_amount?: { currency_code: string; value: string };
  seller_response_due_date?: string;
  disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string; custom?: string }[];
  messages?: { posted_by: string; time_posted: string; content: string }[];
  links?: { href: string; rel: string; method?: string }[];
}

/** Evidence types relevant to digital/freelance work. PayPal accepts more. */
export type EvidenceType =
  | "PROOF_OF_FULFILLMENT"
  | "COPY_OF_CONTRACT"
  | "ITEM_DESCRIPTION"
  | "PROOF_OF_REFUND"
  | "OTHER";

export interface Evidence {
  evidence_type: EvidenceType;
  /** Free text shown to the PayPal agent reviewing the case. */
  notes: string;
}

export interface EvidenceDocument {
  filename: string;
  contentType: "application/pdf" | "image/png" | "image/jpeg" | "image/gif";
  data: Uint8Array<ArrayBuffer>;
}

export type DisputeAction = "provide_evidence" | "accept_claim";

/** What PayPal currently lets the seller do, read from the dispute's HATEOAS links. */
export function allowedActions(dispute: Pick<PayPalDispute, "links">): DisputeAction[] {
  const rels = new Set((dispute.links ?? []).map((l) => l.rel));
  return (["provide_evidence", "accept_claim"] as const).filter((a) => rels.has(a));
}

export function getDispute(client: PayPalClient, disputeId: string): Promise<PayPalDispute> {
  return client.request<PayPalDispute>(`/v1/customer/disputes/${encodeURIComponent(disputeId)}`);
}

export function listDisputes(
  client: PayPalClient,
  params: { disputeState?: string; pageSize?: number; startTime?: Date } = {},
): Promise<{ items?: PayPalDispute[] }> {
  const query = new URLSearchParams();
  if (params.disputeState) query.set("dispute_state", params.disputeState);
  if (params.startTime) query.set("start_time", params.startTime.toISOString());
  query.set("page_size", String(params.pageSize ?? 20));
  return client.request(`/v1/customer/disputes?${query.toString()}`);
}

/** Submit the admin-approved evidence package (multipart: JSON `input` + optional files). */
export async function provideEvidence(
  client: PayPalClient,
  disputeId: string,
  evidences: Evidence[],
  documents: EvidenceDocument[] = [],
  idempotencyKey?: string,
): Promise<void> {
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify({ evidences })], { type: "application/json" }));
  for (const doc of documents) {
    form.append("file", new Blob([doc.data], { type: doc.contentType }), doc.filename);
  }
  await client.request<unknown>(`/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, {
    method: "POST",
    body: form,
    idempotencyKey,
  });
}

/** Concede the dispute; PayPal refunds the buyer. */
export async function acceptClaim(
  client: PayPalClient,
  disputeId: string,
  note: string,
  idempotencyKey?: string,
): Promise<void> {
  await client.request<unknown>(`/v1/customer/disputes/${encodeURIComponent(disputeId)}/accept-claim`, {
    method: "POST",
    body: { note: note.slice(0, 2000) },
    idempotencyKey,
  });
}

/* ---- Sandbox-only helpers, used for the demo and the spike scripts ---- */

/** Sandbox: move the dispute to the stage where PayPal asks the seller for evidence. */
export async function sandboxRequireEvidence(client: PayPalClient, disputeId: string): Promise<void> {
  await client.request<unknown>(`/v1/customer/disputes/${encodeURIComponent(disputeId)}/require-evidence`, {
    method: "POST",
    body: { action: "SELLER_EVIDENCE" },
  });
}

/** Sandbox: resolve a dispute as if PayPal had decided it. */
export async function sandboxAdjudicate(
  client: PayPalClient,
  disputeId: string,
  outcome: "SELLER_FAVOR" | "BUYER_FAVOR",
): Promise<void> {
  await client.request<unknown>(`/v1/customer/disputes/${encodeURIComponent(disputeId)}/adjudicate`, {
    method: "POST",
    body: { adjudication_outcome: outcome },
  });
}
