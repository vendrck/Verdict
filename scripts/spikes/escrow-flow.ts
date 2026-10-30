/**
 * Spike 1: run the whole escrow money path against the PayPal sandbox.
 *
 *   npm run spike:escrow                 # authorize → partial capture (60%) → payout
 *   npm run spike:escrow -- --void       # authorize → void (client never charged)
 *   npm run spike:escrow -- --full       # authorize → full capture → payout
 *
 * You approve the payment in a browser as the sandbox *personal* (buyer) account.
 * Payout needs SPIKE_FREELANCER_EMAIL (a second sandbox personal account).
 */
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { paypalEnv } from "@/config/env";
import { formatMoney, parseMoney, percentOf, splitRelease } from "@/server/escrow/money";
import { PayPalApiError, PayPalClient } from "@/server/paypal/client";
import {
  approvalUrl,
  authorizationFrom,
  authorizeOrder,
  captureAuthorization,
  createEscrowOrder,
  getAuthorization,
  getOrder,
  voidAuthorization,
} from "@/server/paypal/payments";
import { payFreelancer } from "@/server/paypal/payouts";

const mode = process.argv.includes("--void") ? "void" : process.argv.includes("--full") ? "full" : "partial";

async function main() {
  const client = new PayPalClient(paypalEnv());
  const jobId = `spike-${randomUUID().slice(0, 8)}`;
  const held = parseMoney("100.00", "USD");

  console.log(`\n[1/4] Creating AUTHORIZE order for job ${jobId} (${formatMoney(held)} ${held.currency})`);
  const order = await createEscrowOrder(client, {
    jobId,
    description: "Spike: escrow for a sample freelance job",
    amount: held,
    returnUrl: "https://example.com/return",
    cancelUrl: "https://example.com/cancel",
  });
  const url = approvalUrl(order);
  if (!url) throw new Error(`No approval link on order ${order.id}`);

  console.log(`      Order ${order.id} — open this link and approve as the sandbox buyer:\n\n      ${url}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question("      Press Enter after approving (you'll land on example.com, that's expected)… ");
  // Don't trust the Enter key: authorizing an unapproved order fails with ORDER_NOT_APPROVED.
  for (;;) {
    const { status } = await getOrder(client, order.id);
    if (status === "APPROVED") break;
    await rl.question(
      `      Order status is ${status}, not APPROVED yet. Finish "Continue/Pay" as the sandbox buyer, then press Enter… `,
    );
  }
  rl.close();

  console.log("\n[2/4] Authorizing (placing the hold)");
  const authorizedOrder = await authorizeOrder(client, order.id);
  const auth = authorizationFrom(authorizedOrder);
  if (!auth) throw new Error("Order authorized but no authorization returned");
  console.log(`      Authorization ${auth.id} status=${auth.status} expires=${auth.expiration_time ?? "n/a"}`);

  if (mode === "void") {
    console.log("\n[3/4] Voiding the hold");
    await voidAuthorization(client, auth.id, `void:${jobId}`);
    const after = await getAuthorization(client, auth.id);
    console.log(`      Authorization status is now ${after.status}. Client was never charged. Done.`);
    return;
  }

  const { release, returnedToClient } = splitRelease(held, mode === "full" ? held : percentOf(held, 60));
  console.log(
    `\n[3/4] Capturing ${formatMoney(release)} (final) — ${formatMoney(returnedToClient)} goes back to the client`,
  );
  const capture = await captureAuthorization(client, auth.id, release, {
    idempotencyKey: `capture:${jobId}`,
    noteToPayer: "Released after verified delivery",
    invoiceId: jobId,
  });
  console.log(`      Capture ${capture.id} status=${capture.status}`);

  const freelancer = process.env.SPIKE_FREELANCER_EMAIL;
  if (!freelancer) {
    console.log("\n[4/4] Skipping payout — set SPIKE_FREELANCER_EMAIL to test it.");
    return;
  }
  console.log(`\n[4/4] Paying out ${formatMoney(release)} to ${freelancer}`);
  const batch = await payFreelancer(client, {
    jobId,
    receiverEmail: freelancer,
    amount: release,
    note: `Payment for job ${jobId}`,
  });
  console.log(`      Payout batch ${batch.batch_header.payout_batch_id} status=${batch.batch_header.batch_status}`);
  console.log("\nDone. Check both sandbox accounts at https://www.sandbox.paypal.com to see the money move.");
}

main().catch((err: unknown) => {
  if (err instanceof PayPalApiError) {
    console.error(`\n✗ ${err.message}`);
    console.error(JSON.stringify(err.body, null, 2));
  } else {
    console.error("\n✗", err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
