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

export function registerAssetTools(server: McpServer, client: SamsaraClient) {
  server.tool(
    "assets_list",
    "List all assets (trailers, containers, generators, etc.) in the organization.",
    {
      tagIds: z.string().optional().describe("Comma-separated tag IDs to filter by"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/assets", {
          tagIds: params.tagIds,
          after: params.after,
        });
        return jsonResult({ assets: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "assets_get",
    "Get detailed information about a specific asset by its Samsara ID.",
    {
      id: z.string().describe("The Samsara asset ID"),
    },
    async (params) => {
      try {
        const data = await client.get(`/fleet/assets/${params.id}`);
        return jsonResult(data);
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "equipment_list",
    "List all equipment (powered and unpowered assets tracked by Samsara gateways). Returns equipment name, type, and associated gateway info.",
    {
      tagIds: z.string().optional().describe("Comma-separated tag IDs to filter by"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/equipment", {
          tagIds: params.tagIds,
          after: params.after,
        });
        return jsonResult({ equipment: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );
}
