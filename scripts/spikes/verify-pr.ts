/**
 * Spike 2: run the AI verifier end to end on a real pull request. Calls the configured
 * AI provider (AI_PROVIDER; free tier or a few cents) and the GitHub API (read-only).
 * Touches no money and no DB.
 *
 *   npm run spike:verify -- <github PR url> "<job brief>"
 *
 * Public repos work without GITHUB_TOKEN (rate-limited to 60 requests/hour).
 */
import { draftCriteria } from "@/server/ai/criteria";
import { aiModel } from "@/server/ai/model";
import { verifySubmission } from "@/server/ai/verify";
import { fetchPrSnapshot } from "@/server/github/pull-request";

async function main() {
  const [prUrl, brief] = process.argv.slice(2);
  if (!prUrl || !brief) {
    console.error('Usage: npm run spike:verify -- <github PR url> "<job brief>"');
    process.exit(2);
  }
  const { id, model } = aiModel();

  console.log(`\n[1/3] Drafting acceptance criteria with ${id}`);
  const drafts = await draftCriteria(model, brief);
  const criteria = drafts.map((d, i) => ({ ...d, id: `c${i + 1}` }));
  for (const c of criteria) console.log(`      ${c.id} [${c.check}, w${c.weight}] ${c.text}`);

  console.log(`\n[2/3] Fetching ${prUrl}`);
  const snapshot = await fetchPrSnapshot(prUrl, process.env.GITHUB_TOKEN || undefined);
  console.log(
    `      ${snapshot.files.length} file(s), CI ${snapshot.ci.state}${snapshot.truncated ? ", diff truncated" : ""}`,
  );

  console.log("\n[3/3] Verifying");
  const v = await verifySubmission(model, criteria, snapshot);
  for (const r of v.results) {
    console.log(`      ${r.criterionId} ${r.verdict.toUpperCase()} (${r.confidence.toFixed(2)}, ${r.decidedBy}) ${r.reasoning}`);
  }
  console.log(`\nOverall: ${v.overall.toUpperCase()}`);
  for (const reason of v.reviewReasons) console.log(`  • ${reason}`);
}

main().catch((err: unknown) => {
  console.error("\n✗", err instanceof Error ? err.message : err);
  process.exit(1);
});
