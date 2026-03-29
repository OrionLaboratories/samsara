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

export function registerAlertTools(server: McpServer, client: SamsaraClient) {
  server.tool(
    "alerts_list_incidents",
    "List alert incidents. Returns triggered alerts with details about which condition was met, the affected vehicle/driver, and timestamps.",
    {
      startTime: z.string().describe("Start time in RFC 3339 format"),
      endTime: z.string().describe("End time in RFC 3339 format"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/alerts/incidents", {
          startTime: params.startTime,
          endTime: params.endTime,
          after: params.after,
        });
        return jsonResult({ incidents: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );
}
