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

export function registerRoutingTools(server: McpServer, client: SamsaraClient) {
  server.tool(
    "routes_list",
    "List dispatch routes. Filter by time range, driver, or vehicle. Returns route details including stops, assigned drivers/vehicles, and completion status.",
    {
      startTime: z.string().describe("Start time in RFC 3339 format"),
      endTime: z.string().describe("End time in RFC 3339 format"),
      driverId: z.string().optional().describe("Driver ID to filter by"),
      vehicleId: z.string().optional().describe("Vehicle ID to filter by"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/routes", {
          startTime: params.startTime,
          endTime: params.endTime,
          driverId: params.driverId,
          vehicleId: params.vehicleId,
          after: params.after,
        });
        return jsonResult({ routes: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "routes_get",
    "Get detailed information about a specific dispatch route by ID, including all stops and their status.",
    {
      id: z.string().describe("The Samsara route ID"),
    },
    async (params) => {
      try {
        const data = await client.get(`/fleet/routes/${params.id}`);
        return jsonResult(data);
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "trips_list",
    "Get trip data for a specific vehicle over a time range. Returns trip start/end times, locations, distances, and fuel consumption.",
    {
      vehicleId: z.string().describe("The Samsara vehicle ID"),
      startTime: z.string().describe("Start time in RFC 3339 format"),
      endTime: z.string().describe("End time in RFC 3339 format"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages(`/fleet/vehicles/${params.vehicleId}/trips`, {
          startTime: params.startTime,
          endTime: params.endTime,
          after: params.after,
        }, 5);
        return jsonResult({ trips: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );
}
