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

export function registerWebhookTools(server: McpServer, client: SamsaraClient) {
  server.tool(
    "webhooks_list",
    "List all configured webhooks in the organization.",
    {
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/webhooks", {
          after: params.after,
        });
        return jsonResult({ webhooks: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "webhooks_create",
    "Create a new webhook to receive event notifications. Supported event types: AlertIncident, DvirSubmitted, SevereSpeedingEnded, SevereSpeedingStarted, AddressCreated, AddressDeleted, AddressUpdated, DocumentSubmitted, DriverCreated, DriverUpdated, EngineFaultOff, EngineFaultOn, FormSubmitted, FormUpdated, GatewayUnplugged, GeofenceEntry, GeofenceExit, IssueCreated, RouteStopArrival, RouteStopDeparture, SpeedingEventEnded, SpeedingEventStarted, VehicleCreated, VehicleUpdated.",
    {
      name: z.string().describe("Name for the webhook"),
      url: z.string().describe("HTTPS URL that will receive webhook POST requests"),
      eventTypes: z.array(z.string()).describe("Array of event type strings to subscribe to (e.g., ['GeofenceEntry', 'GeofenceExit'])"),
      version: z.enum(["1.0", "2.0"]).optional().describe("Webhook version (default '2.0', recommended)"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          name: params.name,
          url: params.url,
          eventTypes: params.eventTypes,
        };
        if (params.version) body.version = params.version;
        const data = await client.post("/webhooks", body);
        return jsonResult(data);
      } catch (e) { return errorResult(e); }
    },
  );
}
