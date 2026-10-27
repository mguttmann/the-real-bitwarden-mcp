import type { ToolDef } from "../../types.js";
import { webVaultStubTool } from "./_web_vault_stub.js";

export function makeAccessTokenListTool(_client?: unknown): ToolDef {
  return webVaultStubTool(
    "bws_access_token_list",
    "List metadata for the access tokens of a machine account.",
    {
      type: "object",
      properties: { machineAccountId: { type: "string" } },
      required: ["machineAccountId"],
      additionalProperties: false,
    },
  );
}

export function makeAccessTokenCreateTool(_client?: unknown): ToolDef {
  return webVaultStubTool(
    "bws_access_token_create",
    "Create a new access token for a machine account.",
    {
      type: "object",
      properties: {
        machineAccountId: { type: "string" },
        name: { type: "string" },
        expireAt: {
          type: ["string", "null"],
          default: null,
          description: "ISO 8601 expiry, or null for no expiry.",
        },
      },
      required: ["machineAccountId", "name"],
      additionalProperties: false,
    },
  );
}

export function makeAccessTokenRevokeTool(_client?: unknown): ToolDef {
  return webVaultStubTool(
    "bws_access_token_revoke",
    "Revoke one or more access tokens of a machine account.",
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
