import path from "node:path";
import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { PayPalClient } from "./client";

/**
 * Read-only PayPal tools for the dispute copilot, served by PayPal's official
 * MCP server (@paypal/mcp) over stdio.
 *
 * The copilot investigates; it never moves money. Capture, payout, refund,
 * evidence submission and claim acceptance are deliberately NOT exposed here —
 * they run through our REST client only after an admin approves.
 */

/** Product.action identifiers understood by `@paypal/mcp --tools=`. */
const MCP_SERVER_TOOLS = ["orders.get", "disputes.list", "disputes.get", "shipment.get", "transactions.list"] as const;

/** Tool names the server exposes for the identifiers above. Anything else is dropped. */
export const COPILOT_TOOL_NAMES = [
  "get_order",
  "list_disputes",
  "get_dispute",
  "get_shipment_tracking",
  "list_transactions",
] as const;

const PAYPAL_MCP_ENTRY = path.join(process.cwd(), "node_modules", "@paypal", "mcp", "dist", "index.js");

export async function openCopilotPayPalTools(client: PayPalClient, environment: "sandbox" | "live") {
  const accessToken = await client.getAccessToken();

  const mcp = await createMCPClient({
    clientName: "proofpay-dispute-copilot",
    // @paypal/mcp is built on an older MCP SDK that expects `initialize` first.
    protocolVersionDiscovery: false,
    transport: new Experimental_StdioMCPTransport({
      command: process.execPath,
      args: [PAYPAL_MCP_ENTRY, `--tools=${MCP_SERVER_TOOLS.join(",")}`],
      env: {
        PATH: process.env.PATH ?? "",
        PAYPAL_ACCESS_TOKEN: accessToken,
        PAYPAL_ENVIRONMENT: environment === "live" ? "PRODUCTION" : "SANDBOX",
      },
    }),
  });

  const allTools = await mcp.tools();
  const allowed = new Set<string>(COPILOT_TOOL_NAMES);
  // Defense in depth: even if the server exposes more, the model only sees the allowlist.
  const tools = Object.fromEntries(Object.entries(allTools).filter(([name]) => allowed.has(name)));

  return { tools, close: () => mcp.close() };
}
