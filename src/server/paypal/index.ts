import { paypalEnv } from "@/config/env";
import { getPayPalClient } from "./client";

export { PayPalApiError, PayPalClient } from "./client";
export * as disputes from "./disputes";
export * as payments from "./payments";
export * as payouts from "./payouts";
export * as webhooks from "./webhooks";

/** Shared, env-configured client for server code (route handlers, jobs). */
export function paypal() {
  return getPayPalClient(paypalEnv());
}
