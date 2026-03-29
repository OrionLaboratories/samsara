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

export function registerAddressTools(server: McpServer, client: SamsaraClient) {
  server.tool(
    "addresses_list",
    "List all addresses (geofences) in the organization. Returns address names, coordinates, and geofence shapes.",
    {
      tagIds: z.string().optional().describe("Comma-separated tag IDs to filter by"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/addresses", {
          tagIds: params.tagIds,
          after: params.after,
        });
        return jsonResult({ addresses: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "addresses_create",
    "Create a new address (geofence) in the organization. Requires a name and formatted address or geofence coordinates.",
    {
      name: z.string().describe("Name of the address"),
      formattedAddress: z.string().describe("The street address (e.g., '350 Rhode Island St, San Francisco, CA 94103')"),
      latitude: z.number().optional().describe("Latitude of the address center point"),
      longitude: z.number().optional().describe("Longitude of the address center point"),
      radiusMeters: z.number().optional().describe("Radius in meters for circular geofence (default 100)"),
      notes: z.string().optional().describe("Notes about this address"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          name: params.name,
          formattedAddress: params.formattedAddress,
        };
        if (params.latitude !== undefined && params.longitude !== undefined) {
          body.geofence = {
            circle: {
              latitude: params.latitude,
              longitude: params.longitude,
              radiusMeters: params.radiusMeters ?? 100,
            },
          };
        }
        if (params.notes) body.notes = params.notes;

        const data = await client.post("/addresses", body);
        return jsonResult(data);
      } catch (e) { return errorResult(e); }
    },
  );
}
