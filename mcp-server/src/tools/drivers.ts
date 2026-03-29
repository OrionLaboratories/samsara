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

export function registerDriverTools(server: McpServer, client: SamsaraClient) {
  server.tool(
    "drivers_list",
    "List all drivers in the organization. Returns driver names, IDs, phone numbers, license info, and tag assignments.",
    {
      tagIds: z.string().optional().describe("Comma-separated tag IDs to filter by"),
      driverActivationStatus: z.enum(["active", "deactivated"]).optional().describe("Filter by activation status"),
      after: z.string().optional().describe("Pagination cursor"),
    },
    async (params) => {
      try {
        const data = await client.getAllPages("/fleet/drivers", {
          tagIds: params.tagIds,
          driverActivationStatus: params.driverActivationStatus,
          after: params.after,
        });
        return jsonResult({ drivers: data, count: data.length });
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "drivers_get",
    "Get detailed information about a specific driver by their Samsara ID.",
    {
      id: z.string().describe("The Samsara ID of the driver"),
    },
    async (params) => {
      try {
        const data = await client.get(`/fleet/drivers/${params.id}`);
        return jsonResult(data);
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "drivers_create",
    "Create a new driver in the organization.",
    {
      name: z.string().describe("The driver's full name"),
      username: z.string().optional().describe("Username for the driver"),
      password: z.string().optional().describe("Password for the driver"),
      phone: z.string().optional().describe("Phone number for the driver"),
      licenseNumber: z.string().optional().describe("Driver's license number"),
      licenseState: z.string().optional().describe("State that issued the driver's license"),
    },
    async (params) => {
      try {
        const data = await client.post("/fleet/drivers", params);
        return jsonResult(data);
      } catch (e) { return errorResult(e); }
    },
  );

  server.tool(
    "drivers_update",
    "Update an existing driver's information.",
    {
      id: z.string().describe("The Samsara ID of the driver"),
      name: z.string().optional().describe("Updated name"),
      phone: z.string().optional().describe("Updated phone number"),
      licenseNumber: z.string().optional().describe("Updated license number"),
      licenseState: z.string().optional().describe("Updated license state"),
      notes: z.string().optional().describe("Notes about the driver"),
    },
    async (params) => {
      try {
        const { id, ...body } = params;
        const data = await client.patch(`/fleet/drivers/${id}`, body);
        return jsonResult(data);
      } catch (e) { return errorResult(e); }
    },
  );
}
