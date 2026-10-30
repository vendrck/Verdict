import type { PayPalClient } from "./client";

export interface PayPalWebhookEvent<T = unknown> {
  id: string;
  event_type: string;
  create_time: string;
  resource_type?: string;
  summary?: string;
  resource: T;
}

/** Event types the app acts on. Subscribe to these when creating the webhook. */
export const HANDLED_EVENT_TYPES = [
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED",
] as const;

const SIGNATURE_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

/**
 * Ask PayPal to verify the webhook signature. Nothing in the webhook body is
 * trusted (and no money moves) unless this returns true.
 */
export async function verifyWebhookSignature(
  client: PayPalClient,
  webhookId: string,
  headers: Headers,
  event: PayPalWebhookEvent,
): Promise<boolean> {
  const signature: Record<string, string> = {};
  for (const [field, header] of Object.entries(SIGNATURE_HEADERS)) {
    const value = headers.get(header);
    if (!value) return false;
    signature[field] = value;
  }
  const result = await client.request<{ verification_status: "SUCCESS" | "FAILURE" }>(
    "/v1/notifications/verify-webhook-signature",
    { method: "POST", body: { ...signature, webhook_id: webhookId, webhook_event: event } },
  );
  return result.verification_status === "SUCCESS";
}
