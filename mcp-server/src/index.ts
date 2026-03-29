#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SamsaraClient } from "./samsara-client.js";
import { registerAllTools } from "./tools/index.js";

const SAMSARA_API_TOKEN = process.env.SAMSARA_API_TOKEN;

if (!SAMSARA_API_TOKEN) {
  console.error("Error: SAMSARA_API_TOKEN environment variable is required.");
  console.error("Set it in your MCP server configuration or export it before running.");
  process.exit(1);
}

const server = new McpServer({
  name: "samsara",
  version: "1.0.0",
  description: "Samsara fleet management API connector. Provides tools for managing vehicles, drivers, safety, compliance (HOS), routing, assets, addresses, tags, alerts, webhooks, and more.",
});

const client = new SamsaraClient(SAMSARA_API_TOKEN);

registerAllTools(server, client);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Failed to start Samsara MCP server:", error);
  process.exit(1);
});
