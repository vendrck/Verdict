/**
 * Read-only diagnostics for the sandbox spikes. Moves no money.
 *   npm run spike:inspect                       # disputes from the last 30 days
 *   npm run spike:inspect -- <payoutBatchId>    # also explain a payout batch (e.g. why it was DENIED)
 */
import { paypalEnv } from "@/config/env";
import { PayPalApiError, PayPalClient } from "@/server/paypal/client";
import { listDisputes } from "@/server/paypal/disputes";
import { getPayoutBatch } from "@/server/paypal/payouts";

async function main() {
  const client = new PayPalClient(paypalEnv());
  const batchId = process.argv[2];

  if (batchId) {
    const batch = await getPayoutBatch(client, batchId);
    console.log(`Payout batch ${batchId}: ${batch.batch_header.batch_status}`);
    for (const item of batch.items ?? []) {
      const error = item.errors ? ` — ${item.errors.name}: ${item.errors.message}` : "";
      console.log(`  - to ${item.payout_item?.receiver}: ${item.transaction_status ?? "?"}${error}`);
    }
    if (!batch.items?.length) console.log("  (no items returned)");
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const disputes = await listDisputes(client, { startTime: since, pageSize: 20 });
  console.log(`\nDisputes since ${since.toISOString().slice(0, 10)}: ${disputes.items?.length ?? 0}`);
  for (const d of disputes.items ?? []) {
    console.log(`  - ${d.dispute_id}  ${d.reason}  ${d.status}`);
  }
}

main().catch((err: unknown) => {
  if (err instanceof PayPalApiError) {
    console.error(`✗ ${err.message}`);
    console.error(JSON.stringify(err.body, null, 2));
  } else {
    console.error("✗", err instanceof Error ? err.message : err);
  }
  process.exit(1);
});
