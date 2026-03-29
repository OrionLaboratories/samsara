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

export function registerComplianceTools(server: McpServer, client: SamsaraClient) {
  server.tool(
    "hos_get_clocks",
    "Get the current Hours of Service (HOS) clocks for drivers. Shows remaining drive time, on-duty time, and cycle time.",
    {
      driverIds: z.string().optional().describe("Comma-separated driver IDs"),
      tagIds: z.string().optional().describe("Comma-separated tag IDs"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/hos/clocks", {
          driverIds: params.driverIds,
          tagIds: params.tagIds,
          after: params.after,
        });
        return jsonResult({ clocks: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "hos_get_daily_logs",
    "Get HOS daily logs for drivers over a date range. Shows duty status changes and total hours by category.",
    {
      startDate: z.string().describe("Start date in YYYY-MM-DD format"),
      endDate: z.string().describe("End date in YYYY-MM-DD format"),
      driverIds: z.string().optional().describe("Comma-separated driver IDs"),
      tagIds: z.string().optional().describe("Comma-separated tag IDs"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/hos/daily-logs", {
          startDate: params.startDate,
          endDate: params.endDate,
          driverIds: params.driverIds,
          tagIds: params.tagIds,
          after: params.after,
        });
        return jsonResult({ dailyLogs: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "hos_get_violations",
    "Get HOS violations for drivers. Shows violation types (e.g., 11-hour driving limit, 14-hour on-duty limit, 30-minute break).",
    {
      startTime: z.string().describe("Start time in RFC 3339 format"),
      endTime: z.string().describe("End time in RFC 3339 format"),
      driverIds: z.string().optional().describe("Comma-separated driver IDs"),
      tagIds: z.string().optional().describe("Comma-separated tag IDs"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/hos/violations", {
          startTime: params.startTime,
          endTime: params.endTime,
          driverIds: params.driverIds,
          tagIds: params.tagIds,
          after: params.after,
        });
        return jsonResult({ violations: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );
}
