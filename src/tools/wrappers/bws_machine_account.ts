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

export function makeMachineAccountListTool(_client?: unknown, _orgId?: string): ToolDef {
  return unsupportedTool(
    "bws_machine_account_list",
    "List Secrets Manager machine accounts in the organization. NOTE: Not supported via API — use the web vault.",
    {
      type: "object",
      properties: { organizationId: { type: "string" } },
      additionalProperties: false,
    },
  );
}

export function makeMachineAccountGetTool(_client?: unknown): ToolDef {
  return unsupportedTool(
    "bws_machine_account_get",
    "Get a single machine account by id. NOTE: Not supported via API — use the web vault.",
    {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  );
}

export function makeMachineAccountCreateTool(_client?: unknown, _orgId?: string): ToolDef {
  return unsupportedTool(
    "bws_machine_account_create",
    "Create a new machine account. NOTE: Not supported via API — use the web vault.",
    {
      type: "object",
      properties: { name: { type: "string" }, organizationId: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  );
}

export function makeMachineAccountUpdateTool(_client?: unknown): ToolDef {
  return unsupportedTool(
    "bws_machine_account_update",
    "Rename a machine account. NOTE: Not supported via API — use the web vault.",
    {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" } },
      required: ["id", "name"],
      additionalProperties: false,
    },
  );
}

export function makeMachineAccountDeleteTool(_client?: unknown): ToolDef {
  return unsupportedTool(
    "bws_machine_account_delete",
    "Delete a machine account. NOTE: Not supported via API — use the web vault.",
    {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  );
}

export function makeMachineAccountProjectsTool(_client?: unknown): ToolDef {
  return unsupportedTool(
    "bws_machine_account_projects",
    "List the projects a machine account has access to. NOTE: Not supported via API — use the web vault.",
    {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  );
}

export function makeMachineAccountGrantProjectTool(_client?: unknown): ToolDef {
  return unsupportedTool(
    "bws_machine_account_grant_project",
    "Grant a machine account access to a project. NOTE: Not supported via API — use the web vault.",
    {
      type: "object",
      properties: {
        id: { type: "string" },
        projectId: { type: "string" },
        read: { type: "boolean", default: true },
        write: { type: "boolean", default: false },
      },
      required: ["id", "projectId"],
      additionalProperties: false,
    },
  );
}

export function makeMachineAccountRevokeProjectTool(_client?: unknown): ToolDef {
  return unsupportedTool(
    "bws_machine_account_revoke_project",
    "Revoke a machine account's access to a project. NOTE: Not supported via API — use the web vault.",
    {
      type: "object",
      properties: { id: { type: "string" }, projectId: { type: "string" } },
      required: ["id", "projectId"],
      additionalProperties: false,
    },
  );
}
