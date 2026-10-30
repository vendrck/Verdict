# Architecture

## Components

```
                ┌──────────────────────── Next.js app ────────────────────────┐
 Client  ──────▶│ pages (jobs, admin)          API routes                     │
 Freelancer ───▶│                               ├─ /api/webhooks/paypal ◀─────┼──── PayPal webhooks
 Admin  ───────▶│                               └─ /api/... (jobs, appeals)   │
                │                                                             │
                │ server/escrow   state machine + money math (pure)           │
                │ server/paypal   REST client ───────────────────────────────┼──▶ PayPal REST (sandbox)
                │                 mcp.ts ── stdio ── @paypal/mcp ────────────┼──▶ PayPal REST (read-only)
                │ server/ai       criteria + verifier (AI SDK) ──────────────┼──▶ Gemini or Claude API
                │ server/github   PR evidence snapshot         ──────────────┼──▶ GitHub API
                │ server/db       Drizzle ──────────────────────────────────┼──▶ Postgres
                └─────────────────────────────────────────────────────────────┘
```

## Job lifecycle

Defined in `src/server/escrow/state-machine.ts`. Every status change goes through `transition()`.

```
draft → awaiting_payment → funded → submitted → verified | rejected | needs_review
                                         ▲                    │
                                         └──── resubmit ──────┘ (rejected)
verified | rejected | needs_review → appealed
verified | needs_review | appealed → released | partially_released   (admin approves)
any held state → refunded (void) | hold_expired
released | partially_released → disputed → dispute_closed
```

## Money path (ADR 0001)

| Decision | PayPal call | Effect for the client |
|---|---|---|
| Fund | create order (AUTHORIZE) → buyer approves → authorize | Funds held, not charged |
| Full release | capture full amount, `final_capture=true` | Charged in full |
| Partial release | capture part, `final_capture=true` | Charged that part; the rest is released |
| Reject / refund | void authorization | Never charged |
| Long job | reauthorize once (day 4–29) | Hold renewed |
| Conceded dispute | refund capture / accept claim | Refunded |

After a capture, the platform pays the freelancer with **Payouts**.

## Two dispute channels

| | Platform appeal | PayPal dispute |
|---|---|---|
| When | Before capture (money still held) | After capture |
| Who | Client or freelancer | Client only (the payer) |
| Trigger | Appeal form in the app | `CUSTOMER.DISPUTE.CREATED` webhook |
| Copilot output | Ruling: release / partial / refund + rationale | Evidence package or "accept claim" |
| Executed by | Capture / partial capture / void | Disputes API provide-evidence / accept-claim |
| Gate | Admin approval | Admin approval |

## Trust boundaries
- **Webhooks:** signature-verified via PayPal before parsing anything into state. Deduplicated by event id (`processed_webhooks`).
- **The model:** can read through 5 allowlisted MCP tools (`get_order`, `list_disputes`, `get_dispute`, `get_shipment_tracking`, `list_transactions`). It has no write tools. All writes go through `src/server/paypal/*` after an admin decision.
- **Delivered work:** PR diffs and descriptions are untrusted text. The verifier gets structured output schemas and deterministic CI results; "the model said pass" is never enough on its own.
- **Idempotency:** stable `PayPal-Request-Id` per job and action (`capture:<jobId>`, `payout:<jobId>` …).
