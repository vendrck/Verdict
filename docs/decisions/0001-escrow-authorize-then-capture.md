# ADR 0001: Escrow with authorize-then-capture

- **Status:** accepted (2026-10-28)

## Context
The client's money must be held while the freelancer delivers and the AI verifies the work. PayPal offers three ways to do this in the sandbox.

## Options
| | How | Pros | Cons |
|---|---|---|---|
| **A. Authorize → capture** | Orders `intent=AUTHORIZE`; capture or void later | Real hold enforced by PayPal; partial capture = partial release; void = clean reject | ~3-day honor period, 29-day expiry, one reauthorization |
| B. Capture → Payouts | Charge immediately, pay out on approval | No expiry, simplest | "Held" is only a database flag; reject = refund; platform holds others' money (licensing) |
| C. Multiparty delayed disbursement | Seller onboarding + disbursement API | Proper marketplace model, platform fees | Needs partner features in sandbox; disputes land on the seller's account; more build time |

## Decision
**A.** The hold is visible in PayPal, which makes the demo clear. Partial capture with `final_capture=true` maps directly onto the "partial release" ruling, and void maps onto "refund before capture".

## Consequences
- Jobs past about 3 days need `reauthorize` (allowed once, day 4–29). If that fails, the job goes to `hold_expired` and the client must re-fund.
- After capture, the platform pays the freelancer with Payouts, so PayPal disputes are raised against the platform account, where the dispute copilot can respond.
- For production, C (or a licensed escrow partner) would replace A. The state machine and copilot are unaffected.
