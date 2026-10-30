# ADR 0002: Give the copilot PayPal tools through the official MCP server

- **Status:** accepted (2026-10-28)

## Context
The dispute copilot needs to look things up in PayPal (orders, disputes, transactions, tracking) on its own. PayPal offers:
- `@paypal/agent-toolkit` with an AI SDK adapter, but v1.11 pins `ai@^4` and our app uses `ai@7`. The tool objects are not compatible across those versions.
- `@paypal/mcp`, PayPal's MCP server built on the same toolkit, with a `--tools=` allowlist.

## Decision
Spawn `@paypal/mcp` over stdio and connect with `@ai-sdk/mcp`. Only these tools are enabled: `orders.get, disputes.list, disputes.get, shipment.get, transactions.list`. As a second layer, `src/server/paypal/mcp.ts` filters the returned tool set by name.

## Consequences
- The model can investigate but cannot capture, refund, pay out, submit evidence or accept claims. Those run through `src/server/paypal/*` after admin approval.
- No version coupling between the toolkit's internal AI SDK and ours.
- The MCP server receives a short-lived OAuth access token, never the client secret.
- `npm audit` reports advisories in the toolkit's transitive dependencies (`mathjs`, `openai`, `uuid`, old `zod`). They run only inside the read-only MCP child process and are tracked here. Our own code uses `zod@4.6+`.
