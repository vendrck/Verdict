# PayPal sandbox setup

## 1. App credentials
1. Sign in at <https://developer.paypal.com/dashboard/> and switch to **Sandbox**.
2. **Apps & Credentials → Create App** (type: Merchant). This app acts as the **platform** (merchant of record).
3. Copy the **Client ID** and **Secret** into `.env` (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`).
4. In the app's features, make sure **Payouts** is enabled. Disputes is available by default.

## 2. Sandbox accounts
Create every account under **Testing Tools → Sandbox Accounts → Create account** (country United States). Accounts made with "Sign Up" on sandbox.paypal.com never get a confirmed email, and payouts to them stay **Unclaimed**. You need:

| Role | Type | Used for |
|---|---|---|
| Platform | Business (default one linked to your app) | Receives captures, sends payouts |
| Client | Personal | Approves payments, opens disputes |
| Freelancer | Personal (create a second one) | Receives payouts → `SPIKE_FREELANCER_EMAIL` |

Payouts are always sent from the app's own Business account. If `SPIKE_FREELANCER_EMAIL` is that same account, PayPal returns **Denied** (it can't pay itself). If the receiver's account is in another country or currency, the payout can show **Unclaimed** until the receiver logs in and accepts it.

Log in as any of them at <https://www.sandbox.paypal.com>.

## 3. Check credentials
```bash
npm run spike:token
```

## 4. Escrow money path
```bash
npm run spike:escrow            # authorize $100 → capture $60 (final) → payout $60
npm run spike:escrow -- --void  # authorize → void
npm run spike:escrow -- --full  # authorize → capture $100 → payout
```
Open the printed link, log in as the **client** account and approve. You'll be sent to example.com; that's expected. Then press Enter in the terminal.

What you should see: the client is charged $60, not $100; the platform receives $60; and the freelancer receives a $60 payout.

## 5. Webhooks (needs a public URL)
1. Expose the dev server: `cloudflared tunnel --url http://localhost:3000` (or ngrok).
2. In your sandbox app → **Webhooks → Add Webhook**: `https://<tunnel>/api/webhooks/paypal`. Subscribe to the event types listed in `HANDLED_EVENT_TYPES` (`src/server/paypal/webhooks.ts`).
3. Copy the webhook **ID** into `PAYPAL_WEBHOOK_ID`.
4. Test: **Webhooks simulator** sends signed sample events. Real events come from the spike runs.

## 6. Disputes (riskiest part: test early)
1. Run `spike:escrow -- --full` so there is a completed capture.
2. Log in to <https://www.sandbox.paypal.com> as the **client**, open the transaction and **report a problem** (e.g. "item not as described").
3. Confirm the `CUSTOMER.DISPUTE.CREATED` webhook arrives and `npm run spike:inspect` lists the dispute. In testing, the dispute took a while to appear in the API, so check again later if it isn't there yet.
4. Sandbox-only helpers in `src/server/paypal/disputes.ts`: `sandboxRequireEvidence` moves the case to the evidence stage, and `sandboxAdjudicate` decides it.

**Fallback** if sandbox disputes are unreliable: replay a recorded `CUSTOMER.DISPUTE.CREATED` payload against a real dispute ID, and say so in the README.
