/**
 * Spike 0: confirm the sandbox credentials work and the Disputes API is reachable.
 *   npm run spike:token
 */
import { paypalEnv } from "@/config/env";
import { PayPalClient } from "@/server/paypal/client";
import { listDisputes } from "@/server/paypal/disputes";

async function main() {
  const env = paypalEnv();
  const client = new PayPalClient(env);

  const token = await client.getAccessToken();
  console.log(`✓ OAuth token received from ${client.baseUrl} (${token.length} chars, not printed)`);

  const result = await listDisputes(client, { pageSize: 5 });
  console.log(`✓ Disputes API reachable — ${result.items?.length ?? 0} dispute(s) on this sandbox account`);
  for (const d of result.items ?? []) {
    console.log(`  - ${d.dispute_id}  ${d.reason}  ${d.status}`);
  }

  console.log(env.PAYPAL_WEBHOOK_ID ? "✓ PAYPAL_WEBHOOK_ID is set" : "• PAYPAL_WEBHOOK_ID not set yet (needed for webhooks)");
}

main().catch((err: unknown) => {
  console.error("✗", err instanceof Error ? err.message : err);
  process.exit(1);
});
