import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PayPal MCP server is spawned as a child process; keep it out of the bundle.
  serverExternalPackages: ["@paypal/mcp"],
};

export default nextConfig;
