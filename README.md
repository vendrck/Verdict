# ProofPay

**Escrow for freelance work. AI verifies the delivery; PayPal holds and releases the money.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (deadline Nov 12, 2026).

1. **Agree:** AI turns a job brief into acceptance criteria both sides can check.
2. **Fund:** the client pays with PayPal. The payment is *authorized* (held), not captured.
3. **Verify:** AI checks the delivered work (a GitHub PR) against every criterion and gives its reasons.
4. **Release:** an admin approves; PayPal captures the full amount or part of it, and the freelancer is paid out.
5. **Defend:** a **dispute copilot** drafts responses to platform appeals (before capture) and to PayPal disputes (after capture), using the evidence trail. Nothing is submitted until an admin approves.

> Status: **built locally, not yet deployed.** Tested in the sandbox: funding, AI verification, admin release and payout. Built but not yet clicked through: appeals and submitting a dispute response. See [PLAN.md](PLAN.md) for the schedule.

## How PayPal is used

| Capability | API | Where |
|---|---|---|
| Hold client funds | Orders v2 `intent=AUTHORIZE` → authorize | `src/server/paypal/payments.ts` |
| Full / partial release | Payments v2 capture with `final_capture` | `src/server/paypal/payments.ts` |
| Reject / cancel | Void authorization | `src/server/paypal/payments.ts` |
| Pay the freelancer | Payouts v1 | `src/server/paypal/payouts.ts` |
| Dispute response | Disputes v1 provide-evidence / accept-claim | `src/server/paypal/disputes.ts` |
| Real-time events | Webhooks + signature verification | `src/app/api/webhooks/paypal/route.ts` |
| Agent investigation | **PayPal MCP server** (read-only tools) | `src/server/paypal/mcp.ts` |

## How AI is used
- An LLM, called through the Vercel AI SDK, drafts acceptance criteria, verifies delivered work, and drafts appeal rulings and dispute evidence. **The provider is pluggable:** set `AI_PROVIDER=google` (Gemini, the default) or `AI_PROVIDER=anthropic` (Claude), and optionally `AI_MODEL`. See [ADR 0003](docs/decisions/0003-pluggable-ai-provider.md).
- The model never decides money on its own. CI results are judged in code, the overall verdict is computed in code, and anything uncertain or below the confidence floor goes to an admin.
- The dispute copilot is an agent that calls PayPal's official MCP server to look up orders, disputes, transactions and shipment tracking. **It cannot move money.** See [ADR 0002](docs/decisions/0002-paypal-mcp-for-agent-tools.md).
  - It drafts either an evidence package (what was agreed, the PR, CI and verification results, the release date from the audit trail) or an accept-claim note. The draft is checked in code: notes are capped at PayPal's 2000 characters, and an empty contest falls back to accepting.
  - The admin edits and submits it at `/admin/disputes`. The submit checks which actions PayPal currently allows on that dispute.
  - Disputes arrive by webhook, or by **Sync from PayPal** when no public URL exists (local dev). Drafting runs in the background because a slow model can take minutes. The MCP investigation has a 2-minute budget; without it, the draft uses platform records only.

## Project structure

```
.
├── PLAN.md                     # Hackathon plan and schedule
├── docs/
│   ├── architecture.md         # Components, flows, trust boundaries
│   ├── sandbox-setup.md        # PayPal sandbox accounts, webhook, spikes
│   └── decisions/              # Architecture decision records (ADRs)
├── scripts/
│   └── spikes/                 # Runnable sandbox experiments (day 1–2)
├── src/
│   ├── app/                    # Next.js App Router: pages + API route handlers
│   │   └── api/                # health, PayPal webhooks
│   ├── config/                 # Validated environment variables
│   └── server/                 # Server-only domain code
│       ├── ai/                 # Model selection, criteria generator, verifier
│       ├── db/                 # Drizzle schema + client
│       ├── escrow/             # Money math + job state machine (pure, unit-tested)
│       ├── github/             # Pull-request evidence snapshot
│       └── paypal/             # REST client, payments, payouts, disputes, webhooks, MCP
└── tests/
    └── unit/                   # Vitest unit tests
```

UI lives in `src/app/jobs/` (client and freelancer) and `src/app/admin/` (queue, settlement, disputes). Dispute handling is in `src/server/disputes/`.

## Getting started

Requirements: Node 20+, Docker (for Postgres), a PayPal developer account.

```bash
npm install
cp .env.example .env          # then fill in the values, see docs/sandbox-setup.md
docker compose up -d db       # local Postgres
npm run db:generate && npm run db:migrate

npm run spike:token           # check PayPal credentials
npm run spike:escrow          # authorize → partial capture → payout in the sandbox
npm run dev                   # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript, no emit |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle migrations |
| `npm run spike:token` | Check sandbox credentials + Disputes API access |
| `npm run spike:escrow [-- --void \| --full]` | Run the escrow money path end-to-end in the sandbox |

## Security
- Secrets come only from environment variables; `.env` is gitignored.
- Webhooks are verified with PayPal's signature API before anything is trusted, and each event id is processed once.
- Every money-moving call sends a stable `PayPal-Request-Id`, so retries are idempotent.
- The AI drafts, and an admin approves. Money-moving actions are never exposed to the model.
- Delivered work (PR content) and appeal text are treated as untrusted input to the model.
- `/admin` and every admin server action require `ADMIN_PASSWORD` (12+ characters). The session is an httpOnly cookie holding an HMAC with an 8-hour expiry, and every money decision needs an explicit confirmation.
- **Demo limitation:** clients and freelancers have no accounts. Anyone with a job link can fund it, submit work or appeal. Money still moves only through an admin decision.
