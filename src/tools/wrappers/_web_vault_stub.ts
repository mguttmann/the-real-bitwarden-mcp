import type { JSONSchema, ToolDef } from "../../types.js";
import { readOnly } from "./_helpers.js";

/**
 * Machine accounts and their access tokens are managed through Bitwarden's
 * internal Secrets Manager API, which authorizes only a logged-in user
 * (organization owner or admin, or a member with access). Neither the
 * organization API key nor a machine account token can use it, and writes
 * need the organization key on the client. So these tools stay registered
 * (tool contract) but always point to the web vault.
 */
const WEB_VAULT_REASON =
  "Not available to the credentials this server uses; only a logged-in user in the web vault can manage machine accounts and access tokens.";

const WEB_VAULT_MSG =
  `${WEB_VAULT_REASON} ` + "Use the web vault: https://<your-host>/#/sm/{orgId}/machine-accounts";

/** Tool description: what the tool would do, then the reason it cannot. */
function stubDescription(action: string): string {
  return `${action} NOTE: ${WEB_VAULT_REASON}`;
}

export function webVaultStubTool(name: string, action: string, schema: JSONSchema): ToolDef {
  return {
    name,
    description: stubDescription(action),
    inputSchema: schema,
    annotations: readOnly,
    handler: async () => ({
      content: [{ type: "text" as const, text: WEB_VAULT_MSG }],
      isError: true,
    }),
  };
}
