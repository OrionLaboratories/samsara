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

export function registerSafetyTools(server: McpServer, client: SamsaraClient) {
  server.tool(
    "safety_list_events",
    "List safety events (harsh braking, acceleration, cornering, collisions, etc.) for the fleet. Filter by time range, vehicle, or event type.",
    {
      startTime: z.string().describe("Start time in RFC 3339 format"),
      endTime: z.string().describe("End time in RFC 3339 format"),
      vehicleIds: z.string().optional().describe("Comma-separated vehicle IDs"),
      tagIds: z.string().optional().describe("Comma-separated tag IDs"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/vehicles/safety-events", {
          startTime: params.startTime,
          endTime: params.endTime,
          vehicleIds: params.vehicleIds,
          tagIds: params.tagIds,
          after: params.after,
        }, 5);
        return jsonResult({ events: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "safety_get_vehicle_score",
    "Get the safety score for a specific vehicle over a time period. Returns overall score and breakdown by event type.",
    {
      vehicleId: z.string().describe("The Samsara vehicle ID"),
      startTime: z.string().describe("Start time in RFC 3339 format"),
      endTime: z.string().describe("End time in RFC 3339 format"),
    },
    async (params) => {
      try {
        const data = await client.get(`/fleet/vehicles/${params.vehicleId}/safety-score`, {
          startTime: params.startTime,
          endTime: params.endTime,
        });
        return jsonResult(data);
      } catch (e) { return errorResult(e); }
    },
  );
}
