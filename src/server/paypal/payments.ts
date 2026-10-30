import type { Money } from "@/server/escrow/money";
import { toPayPalAmount } from "@/server/escrow/money";
import type { PayPalClient } from "./client";

/**
 * Escrow money movement on PayPal Orders v2 / Payments v2:
 * create (intent AUTHORIZE) → buyer approves → authorize (hold) →
 * capture (full or partial, final) | void | reauthorize.
 */

interface Link {
  href: string;
  rel: string;
  method?: string;
}

export interface PayPalOrder {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | "PAYER_ACTION_REQUIRED";
  links?: Link[];
  purchase_units?: {
    reference_id?: string;
    custom_id?: string;
    amount?: { currency_code: string; value: string };
    payments?: { authorizations?: PayPalAuthorization[]; captures?: PayPalCapture[] };
  }[];
}

export interface PayPalAuthorization {
  id: string;
  status: "CREATED" | "CAPTURED" | "DENIED" | "PARTIALLY_CAPTURED" | "VOIDED" | "PENDING" | "EXPIRED";
  amount: { currency_code: string; value: string };
  expiration_time?: string;
  create_time?: string;
}

export interface PayPalCapture {
  id: string;
  status: "COMPLETED" | "DECLINED" | "PARTIALLY_REFUNDED" | "PENDING" | "REFUNDED" | "FAILED";
  amount: { currency_code: string; value: string };
  final_capture?: boolean;
}

export interface PayPalRefund {
  id: string;
  status: "CANCELLED" | "FAILED" | "PENDING" | "COMPLETED";
  amount?: { currency_code: string; value: string };
}

export interface CreateEscrowOrderInput {
  jobId: string;
  description: string;
  amount: Money;
  returnUrl: string;
  cancelUrl: string;
  brandName?: string;
}

/** Create an order that only authorizes (holds) the client's funds. */
export function createEscrowOrder(client: PayPalClient, input: CreateEscrowOrderInput): Promise<PayPalOrder> {
  return client.request<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    idempotencyKey: `order:${input.jobId}`,
    preferRepresentation: true,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: input.jobId,
          custom_id: input.jobId,
          description: input.description.slice(0, 127),
          amount: toPayPalAmount(input.amount),
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: input.brandName ?? "ProofPay Escrow",
            user_action: "PAY_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    },
  });
}

/** URL the client opens to approve the payment (redirect flow). */
export function approvalUrl(order: PayPalOrder): string | undefined {
  return order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
}

export function getOrder(client: PayPalClient, orderId: string): Promise<PayPalOrder> {
  return client.request<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

/** Place the hold after the buyer approved. Returns the order with the authorization attached. */
export function authorizeOrder(client: PayPalClient, orderId: string): Promise<PayPalOrder> {
  return client.request<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
    method: "POST",
    idempotencyKey: `authorize:${orderId}`,
    preferRepresentation: true,
    body: {},
  });
}

export function authorizationFrom(order: PayPalOrder): PayPalAuthorization | undefined {
  return order.purchase_units?.[0]?.payments?.authorizations?.[0];
}

export function getAuthorization(client: PayPalClient, authorizationId: string): Promise<PayPalAuthorization> {
  return client.request<PayPalAuthorization>(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`);
}

/**
 * Release money to the platform. With finalCapture=true, whatever is not
 * captured is returned to the client — this is how partial release works.
 */
export function captureAuthorization(
  client: PayPalClient,
  authorizationId: string,
  amount: Money,
  opts: { idempotencyKey: string; noteToPayer?: string; invoiceId?: string; finalCapture?: boolean },
): Promise<PayPalCapture> {
  return client.request<PayPalCapture>(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, {
    method: "POST",
    idempotencyKey: opts.idempotencyKey,
    preferRepresentation: true,
    body: {
      amount: toPayPalAmount(amount),
      final_capture: opts.finalCapture ?? true,
      ...(opts.invoiceId ? { invoice_id: opts.invoiceId } : {}),
      ...(opts.noteToPayer ? { note_to_payer: opts.noteToPayer.slice(0, 255) } : {}),
    },
  });
}

/** Cancel the hold entirely; the client is never charged. */
export async function voidAuthorization(
  client: PayPalClient,
  authorizationId: string,
  idempotencyKey: string,
): Promise<void> {
  await client.request<unknown>(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, {
    method: "POST",
    idempotencyKey,
  });
}

/**
 * Renew a hold past the ~3-day honor period. PayPal allows this once,
 * between day 4 and day 29 of the original authorization.
 */
export function reauthorize(
  client: PayPalClient,
  authorizationId: string,
  amount: Money,
  idempotencyKey: string,
): Promise<PayPalAuthorization> {
  return client.request<PayPalAuthorization>(
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/reauthorize`,
    { method: "POST", idempotencyKey, preferRepresentation: true, body: { amount: toPayPalAmount(amount) } },
  );
}

/** Refund after capture (used when a dispute or late appeal is conceded). Omit amount for a full refund. */
export function refundCapture(
  client: PayPalClient,
  captureId: string,
  opts: { idempotencyKey: string; amount?: Money; noteToPayer?: string },
): Promise<PayPalRefund> {
  return client.request<PayPalRefund>(`/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    method: "POST",
    idempotencyKey: opts.idempotencyKey,
    preferRepresentation: true,
    body: {
      ...(opts.amount ? { amount: toPayPalAmount(opts.amount) } : {}),
      ...(opts.noteToPayer ? { note_to_payer: opts.noteToPayer.slice(0, 255) } : {}),
    },
  });
}
