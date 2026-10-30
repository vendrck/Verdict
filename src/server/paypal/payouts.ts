import type { Money } from "@/server/escrow/money";
import { formatMoney } from "@/server/escrow/money";
import type { PayPalClient } from "./client";

export interface PayoutBatch {
  batch_header: {
    payout_batch_id: string;
    batch_status: "DENIED" | "PENDING" | "PROCESSING" | "SUCCESS" | "CANCELED";
    sender_batch_header?: { sender_batch_id?: string };
  };
  items?: {
    payout_item_id: string;
    transaction_status?: string;
    payout_item?: { receiver: string; amount: { currency: string; value: string } };
    errors?: { name?: string; message?: string };
  }[];
}

export interface PayFreelancerInput {
  jobId: string;
  /** PayPal account email of the freelancer. */
  receiverEmail: string;
  amount: Money;
  note: string;
}

/**
 * Pay the freelancer from the platform balance after a capture.
 * `sender_batch_id` is unique per job, so PayPal rejects an accidental second payout.
 */
export function payFreelancer(client: PayPalClient, input: PayFreelancerInput): Promise<PayoutBatch> {
  return client.request<PayoutBatch>("/v1/payments/payouts", {
    method: "POST",
    idempotencyKey: `payout:${input.jobId}`,
    body: {
      sender_batch_header: {
        sender_batch_id: `job-${input.jobId}`,
        email_subject: "You've been paid for your work",
        email_message: input.note.slice(0, 1000),
      },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: input.receiverEmail,
          // Payouts uses `currency`, not `currency_code` like Orders v2.
          amount: { currency: input.amount.currency, value: formatMoney(input.amount) },
          note: input.note.slice(0, 4000),
          sender_item_id: input.jobId,
        },
      ],
    },
  });
}

export function getPayoutBatch(client: PayPalClient, payoutBatchId: string): Promise<PayoutBatch> {
  return client.request<PayoutBatch>(`/v1/payments/payouts/${encodeURIComponent(payoutBatchId)}`);
}
