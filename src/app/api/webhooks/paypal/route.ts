import { after, NextResponse } from "next/server";
import { paypalEnv } from "@/config/env";
import { db, schema } from "@/server/db/client";
import { draftMissing, recordDispute } from "@/server/disputes/service";
import { paypal, webhooks } from "@/server/paypal";
import type { PayPalDispute } from "@/server/paypal/disputes";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { PAYPAL_WEBHOOK_ID } = paypalEnv();
  if (!PAYPAL_WEBHOOK_ID) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  let event: webhooks.PayPalWebhookEvent;
  try {
    event = (await request.json()) as webhooks.PayPalWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const verified = await webhooks.verifyWebhookSignature(paypal(), PAYPAL_WEBHOOK_ID, request.headers, event);
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // PayPal retries deliveries; process each event id once.
  const inserted = await db()
    .insert(schema.processedWebhooks)
    .values({ eventId: event.id, eventType: event.event_type })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (event.event_type.startsWith("CUSTOMER.DISPUTE.")) {
    await handleDisputeEvent(event as webhooks.PayPalWebhookEvent<PayPalDispute>);
  } else {
    await db()
      .insert(schema.events)
      .values({ actor: "paypal", type: event.event_type, data: { eventId: event.id, summary: event.summary } });
  }

  return NextResponse.json({ ok: true });
}

async function handleDisputeEvent(event: webhooks.PayPalWebhookEvent<PayPalDispute>) {
  await recordDispute(event.resource, event.event_type);
  // Drafting calls the AI and can take a while; answer PayPal first so it doesn't retry.
  after(() => draftMissing().catch((err: unknown) => console.error("Dispute drafting failed", err)));
}
