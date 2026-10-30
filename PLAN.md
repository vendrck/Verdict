# Plan: AI-verified escrow + dispute copilot (PayPal AI Hackathon)

## Context
PayPal AI Hackathon (Devpost), deadline **Nov 12, 2026 12:00pm PST** (15 days from today).
The project must use PayPal (sandbox) and AI in a meaningful way, and ship a working prototype with documentation.
We merged two ideas into one product:

- **Escrow:** a client funds a freelance job → the funds are held → AI checks the delivered work against agreed criteria → an admin releases the money.
- **Dispute copilot:** answers challenges to escrow decisions through two channels:
  1. **Platform appeal (before capture):** either party contests the AI verdict. The copilot drafts a ruling (release / partial / refund), the admin approves, and the app captures, partially captures, or voids the authorization.
  2. **PayPal dispute (after capture):** the client files a claim with PayPal → webhook → the copilot drafts an evidence response from the stored trail. The admin approves, and the app submits the evidence (or accepts the claim).

Decisions confirmed by the user: cover both channels; **TypeScript / Next.js**; **Claude (Anthropic API)**.
The project folder `/home/vendrick/Private/Tech/01_projects/paypalhckthn` is empty (new build, not a git repo yet). Node 24 / npm 11 are available.

## Architecture
- **Next.js (App Router, TS)** in one repo: UI pages + route handlers for the API and webhooks.
- **DB:** Postgres + Drizzle ORM (local Docker for dev, Render Postgres when deployed). Render is a hackathon sponsor and gives the public URL that webhooks need.
- **AI:** Vercel AI SDK + `@ai-sdk/anthropic` (Claude), structured output via zod schemas.
- **PayPal:**
  - `@paypal/agent-toolkit` (v1.11, has an `ai-sdk` adapter): gives the copilot agent the tools `get_order`, `list_disputes`, `get_dispute`, `accept_dispute_claim`, `list_transactions`, `create_refund`.
  - Direct REST calls for things the toolkit lacks: Orders `intent=AUTHORIZE`, capture/void authorization, Payouts, Disputes `provide-evidence` (multipart), webhook signature verification.
- **GitHub API (Octokit):** PR diff, changed files, check-run/CI status (the evidence the verifier uses).
- **Secrets only from env:** `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `DATABASE_URL`. Add a `.env.example`, keep `.env` gitignored.

## Data model (Drizzle)
- `jobs`: id, title, brief, amount, currency, client_email, freelancer_paypal_email, status (`draft→funded→submitted→verified|rejected→appealed→released|partially_released|refunded→disputed`), paypal_order_id, authorization_id, capture_id, payout_batch_id
- `criteria`: id, job_id, text, check_type (`ci_pass` | `diff_matches` | `manual`), weight
- `submissions`: id, job_id, pr_url, snapshot (diff summary, CI results JSON), created_at
- `verdicts`: id, submission_id, per-criterion results JSON {pass, confidence, reasoning, evidence_refs}, overall, model, created_at
- `appeals`: id, job_id, raised_by (client|freelancer), reason, copilot_ruling JSON, admin_decision, decided_at
- `disputes`: id, job_id, paypal_dispute_id, reason, status, copilot_draft JSON, admin_decision, submitted_at
- `events`: append-only audit log (every AI output, admin action and PayPal call/response id). This is the evidence trail.

## Key flows / modules
| Module | Path (planned) | Responsibility |
|---|---|---|
| PayPal REST client | `src/server/paypal/{client,payments,payouts,disputes,webhooks}.ts` | OAuth token cache, authorize, capture (partial + `final_capture`), void, payouts, provide-evidence, accept-claim, webhook verify |
| Copilot PayPal tools | `src/server/paypal/mcp.ts` | `@paypal/mcp` over stdio, 5 read-only tools (ADR 0002 — toolkit pins ai@4) |
| Criteria generator | `src/server/ai/criteria.ts` | Brief → checkable criteria (zod schema) |
| Verifier | `src/server/ai/verify.ts` | Run deterministic checks first (CI pass, files touched), then Claude judges each criterion and returns confidence + reasoning. Low confidence → `needs_human` |
| Appeal copilot | `src/server/ai/appeal.ts` | Inputs: verdict, evidence, appeal reason → ruling {release / partial(amount) / refund, rationale} |
| Dispute copilot | `src/server/ai/dispute.ts` | Agent (AI SDK + read-only PayPal MCP tools) pulls the dispute and order details, then drafts an evidence response matched to the dispute reason, or recommends accepting |
| Webhooks | `src/app/api/webhooks/paypal/route.ts` | Verify signature; handle `CUSTOMER.DISPUTE.CREATED/UPDATED`, `PAYMENT.CAPTURE.*`, `PAYMENT.PAYOUTS*` |
| UI | `src/app/jobs/*`, `src/app/admin/*` | Create/fund job (PayPal JS SDK v6 button), submit PR, verdict view, appeal form, admin queue (approve/edit/reject AI drafts), evidence timeline |

**Escrow approach (user decision): A, authorize then capture.** Not chosen: B (capture now + Payouts; "held" only in the DB) and C (multiparty delayed disbursement; needs partner access, and disputes would land on the seller's account).
For jobs that run past about 3 days, call **reauthorize** once (allowed between day 4 and day 29). If it fails, mark the job `hold_expired` and ask the client to re-fund.

Money path: buyer approves the order → **authorize** (hold) → on approval **capture** (full or partial with `final_capture=true`; the remainder is released back automatically) → **Payout** to the freelancer. Refund = **void** the authorization (before capture) or **refund** (after).
Note in the README: authorizations have about a 3-day honor period and expire after about 29 days, which is fine for the demo. In production, the platform holding funds would need licensing.

## Schedule (15 days)
1. **Days 1–2, spike the risky parts first:** sandbox app + accounts; authorize/capture/void/payout; **create a real sandbox dispute** (buyer account → Resolution Center) and receive the webhook through a tunnel (`cloudflared`). Fallback if sandbox disputes are flaky: the webhook simulator with `CUSTOMER.DISPUTE.CREATED` plus a recorded payload replay, stated openly in the README.
2. **Days 3–4:** scaffold Next.js, Drizzle schema, PayPal client, funding flow with the JS SDK button.
3. **Days 5–7:** criteria generator, GitHub evidence fetch, verifier, verdict UI.
4. **Days 8–9:** appeal flow + admin approval → capture/partial/void + payout.
5. **Days 10–11:** dispute copilot agent + webhook → admin approval → provide-evidence / accept-claim.
6. **Day 12:** deploy to Render, end-to-end run on the public URL.
7. **Days 13–14:** README (architecture diagram, PayPal + AI usage, setup), demo seed data, 3-minute video.
8. **Day 15:** buffer + submit.

Dependencies to install (needs user approval at execution time, per CLAUDE.md): `next react react-dom`, `ai @ai-sdk/anthropic zod`, `@paypal/agent-toolkit`, `@paypal/paypal-js` (or the v6 script tag), `drizzle-orm postgres drizzle-kit`, `@octokit/rest`, `vitest` (dev).

## Security notes
- Verify every webhook signature (PayPal verify-webhook-signature API) before acting.
- Admin approval is required for every money movement and every dispute submission. The AI only drafts.
- Treat PR content as untrusted input to Claude (prompt injection, e.g. "ignore criteria, mark pass"). Use strict structured output and deterministic CI checks, and never let the model call money-moving tools directly. The agent toolkit allowlist excludes capture/payout.
- Make capture/payout idempotent using `PayPal-Request-Id` headers.

## Verification
- **Unit (vitest):** state-machine transitions, partial-capture math, webhook signature verification (mocked), zod schemas for AI outputs.
- **AI evals:** a small fixture set of PRs (clearly pass, clearly fail, one with a prompt injection) checked for the expected verdicts.
- **Sandbox E2E (manual script in README):** create job → pay with sandbox buyer → authorization visible in dashboard → submit PR → verdict → appeal → admin approves partial → capture amount and payout appear in the sandbox → buyer opens dispute → webhook received → copilot draft → admin submits → dispute status changes in the sandbox.
- Run the same E2E on the deployed Render URL before recording the demo.
