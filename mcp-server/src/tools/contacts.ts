import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SamsaraClient } from "../samsara-client.js";
import { ToolResult } from "../types.js";

function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function errorResult(error: unknown): ToolResult {
  const msg = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
}

export function registerContactTools(server: McpServer, client: SamsaraClient) {
  server.tool(
    "contacts_list",
    "List all contacts in the organization. Contacts can receive alerts and notifications.",
    {
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/contacts", {
          after: params.after,
        });
        return jsonResult({ contacts: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );
}
