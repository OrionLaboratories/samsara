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

export function registerFleetTools(server: McpServer, client: SamsaraClient) {
  server.tool(
    "fleet_list_vehicles",
    "List all vehicles in the Samsara fleet. Returns vehicle IDs, names, VINs, and metadata. Supports filtering by tag IDs.",
    {
      limit: z.number().optional().describe("Max number of vehicles to return (default 100, max 512)"),
      tagIds: z.string().optional().describe("Comma-separated list of tag IDs to filter by"),
      after: z.string().optional().describe("Pagination cursor from previous response"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/vehicles", {
          limit: params.limit?.toString(),
          tagIds: params.tagIds,
          after: params.after,
        });
        return jsonResult({ vehicles: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "fleet_get_vehicle",
    "Get detailed information about a specific vehicle by its Samsara ID.",
    {
      id: z.string().describe("The Samsara ID of the vehicle"),
    },
    async (params) => {
      try {
        const data = await client.get(`/fleet/vehicles/${params.id}`);
        return jsonResult(data);
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "fleet_update_vehicle",
    "Update a vehicle's properties such as name, notes, or tag assignments.",
    {
      id: z.string().describe("The Samsara ID of the vehicle"),
      name: z.string().optional().describe("New name for the vehicle"),
      notes: z.string().optional().describe("Notes about the vehicle"),
      externalIds: z.record(z.string()).optional().describe("External IDs to set on the vehicle"),
    },
    async (params) => {
      try {
        const { id, ...body } = params;
        const data = await client.patch(`/fleet/vehicles/${id}`, body);
        return jsonResult(data);
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "vehicle_locations_list",
    "Get the most recent location for all vehicles in the fleet. Returns GPS coordinates, speed, heading, and timestamps.",
    {
      after: z.string().optional().describe("Pagination cursor"),
      tagIds: z.string().optional().describe("Comma-separated tag IDs to filter by"),
      vehicleIds: z.string().optional().describe("Comma-separated vehicle IDs to filter by"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/vehicles/locations", {
          after: params.after,
          tagIds: params.tagIds,
          vehicleIds: params.vehicleIds,
        });
        return jsonResult({ locations: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "vehicle_locations_history",
    "Get historical location data for vehicles over a time range. Returns GPS trail with timestamps.",
    {
      startTime: z.string().describe("Start time in RFC 3339 format (e.g., 2024-01-01T00:00:00Z)"),
      endTime: z.string().describe("End time in RFC 3339 format (e.g., 2024-01-02T00:00:00Z)"),
      vehicleIds: z.string().optional().describe("Comma-separated vehicle IDs to filter by"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/vehicles/locations/history", {
          startTime: params.startTime,
          endTime: params.endTime,
          vehicleIds: params.vehicleIds,
          after: params.after,
        }, 5);
        return jsonResult({ locations: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "vehicle_stats_list",
    "Get the most recent stats for vehicles. Stat types include: engineState, fuelPercent, obdOdometerMeters, gps, ambientTemperature, barometricPressure, batteryVoltage, defLevel, ecuSpeedMph, engineCoolantTemperature, engineLoadPercent, engineOilPressure, engineRpm, faultCodes, intakeManifoldTemperature, nfcCardScan, obdEngineSeconds, syntheticEngineSeconds.",
    {
      types: z.string().describe("Comma-separated list of stat types to return (e.g., 'engineState,fuelPercent,gps')"),
      vehicleIds: z.string().optional().describe("Comma-separated vehicle IDs to filter by"),
      tagIds: z.string().optional().describe("Comma-separated tag IDs to filter by"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/vehicles/stats", {
          types: params.types,
          vehicleIds: params.vehicleIds,
          tagIds: params.tagIds,
          after: params.after,
        });
        return jsonResult({ stats: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "vehicle_stats_history",
    "Get historical stats for vehicles over a time range. Returns time-series data for the requested stat types.",
    {
      types: z.string().describe("Comma-separated list of stat types (e.g., 'engineState,fuelPercent')"),
      startTime: z.string().describe("Start time in RFC 3339 format"),
      endTime: z.string().describe("End time in RFC 3339 format"),
      vehicleIds: z.string().optional().describe("Comma-separated vehicle IDs"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/vehicles/stats/history", {
          types: params.types,
          startTime: params.startTime,
          endTime: params.endTime,
          vehicleIds: params.vehicleIds,
          after: params.after,
        }, 5);
        return jsonResult({ stats: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );
}
