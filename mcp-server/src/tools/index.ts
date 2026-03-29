import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SamsaraClient } from "../samsara-client.js";
import { registerFleetTools } from "./fleet.js";
import { registerDriverTools } from "./drivers.js";
import { registerSafetyTools } from "./safety.js";
import { registerComplianceTools } from "./compliance.js";
import { registerRoutingTools } from "./routing.js";
import { registerAssetTools } from "./assets.js";
import { registerAddressTools } from "./addresses.js";
import { registerTagTools } from "./tags.js";
import { registerContactTools } from "./contacts.js";
import { registerMaintenanceTools } from "./maintenance.js";
import { registerAlertTools } from "./alerts.js";
import { registerWebhookTools } from "./webhooks.js";
import { registerOrganizationTools } from "./organization.js";

export function registerAllTools(server: McpServer, client: SamsaraClient) {
  registerFleetTools(server, client);
  registerDriverTools(server, client);
  registerSafetyTools(server, client);
  registerComplianceTools(server, client);
  registerRoutingTools(server, client);
  registerAssetTools(server, client);
  registerAddressTools(server, client);
  registerTagTools(server, client);
  registerContactTools(server, client);
  registerMaintenanceTools(server, client);
  registerAlertTools(server, client);
  registerWebhookTools(server, client);
  registerOrganizationTools(server, client);
}
