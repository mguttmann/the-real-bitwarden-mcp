import type { ToolDef } from "../../types.js";
import type { JSONSchema } from "../../types.js";
import { readOnly } from "./_helpers.js";

const WEB_VAULT_MSG =
  "Not supported via API. Bitwarden's Public API + SDK does not expose Machine-Account or Access-Token management endpoints with the required crypto layer. " +
  "Use the web vault: https://<your-host>/#/sm/{orgId}/machine-accounts";

function unsupportedTool(name: string, description: string, schema: JSONSchema): ToolDef {
  return {
    name,
    description,
    inputSchema: schema,
    annotations: readOnly,
    handler: async () => ({
      content: [{ type: "text" as const, text: WEB_VAULT_MSG }],
      isError: true,
    }),
  };
}

export function makeAccessTokenListTool(_client?: unknown): ToolDef {
  return unsupportedTool(
    "bws_access_token_list",
    "List metadata for the access tokens of a machine account. NOTE: Not supported via API — use the web vault.",
    {
      type: "object",
      properties: { machineAccountId: { type: "string" } },
      required: ["machineAccountId"],
      additionalProperties: false,
    },
  );
}

export function makeAccessTokenCreateTool(_client?: unknown): ToolDef {
  return unsupportedTool(
    "bws_access_token_create",
    "Create a new access token for a machine account. NOTE: Not supported via API — use the web vault.",
    {
      type: "object",
      properties: {
        machineAccountId: { type: "string" },
        name: { type: "string" },
        expireAt: { type: ["string", "null"], default: null, description: "ISO 8601 expiry, or null for no expiry." },
      },
      required: ["machineAccountId", "name"],
      additionalProperties: false,
    },
  );
}

export function makeAccessTokenRevokeTool(_client?: unknown): ToolDef {
  return unsupportedTool(
    "bws_access_token_revoke",
    "Revoke one or more access tokens of a machine account. NOTE: Not supported via API — use the web vault.",
    {
      type: "object",
      properties: {
        machineAccountId: { type: "string" },
        tokenIds: { type: "array", items: { type: "string" } },
      },
      required: ["machineAccountId", "tokenIds"],
      additionalProperties: false,
    },
  );
}
