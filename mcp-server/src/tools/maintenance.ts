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

export function registerMaintenanceTools(server: McpServer, client: SamsaraClient) {
  server.tool(
    "work_orders_list",
    "List work orders for vehicle maintenance. Returns work order status, assigned vehicle, description, and due dates.",
    {
      status: z.enum(["open", "inProgress", "done", "canceled"]).optional().describe("Filter by work order status"),
      vehicleIds: z.string().optional().describe("Comma-separated vehicle IDs to filter by"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/work-orders", {
          status: params.status,
          vehicleIds: params.vehicleIds,
          after: params.after,
        });
        return jsonResult({ workOrders: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );
}
