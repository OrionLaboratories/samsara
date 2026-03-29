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

export function registerTagTools(server: McpServer, client: SamsaraClient) {
  server.tool(
    "tags_list",
    "List all tags in the organization. Tags are used to group vehicles, drivers, and assets for filtering and reporting.",
    {
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/tags", {
          after: params.after,
        });
        return jsonResult({ tags: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "tags_create",
    "Create a new tag for organizing vehicles, drivers, and assets.",
    {
      name: z.string().describe("Name of the tag"),
      parentTagId: z.string().optional().describe("ID of the parent tag (for nested tags)"),
    },
    async (params) => {
      try {
        const data = await client.post("/tags", params);
        return jsonResult(data);
      } catch (e) { return errorResult(e); }
    },
  );
}
