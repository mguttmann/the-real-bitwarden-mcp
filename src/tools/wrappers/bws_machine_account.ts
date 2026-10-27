import type { ToolDef } from "../../types.js";
import { webVaultStubTool } from "./_web_vault_stub.js";

export function makeMachineAccountListTool(_client?: unknown, _orgId?: string): ToolDef {
  return webVaultStubTool(
    "bws_machine_account_list",
    "List Secrets Manager machine accounts in the organization.",
    {
      type: "object",
      properties: { organizationId: { type: "string" } },
      additionalProperties: false,
    },
  );
}

export function makeMachineAccountGetTool(_client?: unknown): ToolDef {
  return webVaultStubTool("bws_machine_account_get", "Get a single machine account by id.", {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  });
}

export function makeMachineAccountCreateTool(_client?: unknown, _orgId?: string): ToolDef {
  return webVaultStubTool("bws_machine_account_create", "Create a new machine account.", {
    type: "object",
    properties: { name: { type: "string" }, organizationId: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  });
}

export function makeMachineAccountUpdateTool(_client?: unknown): ToolDef {
  return webVaultStubTool("bws_machine_account_update", "Rename a machine account.", {
    type: "object",
    properties: { id: { type: "string" }, name: { type: "string" } },
    required: ["id", "name"],
    additionalProperties: false,
  });
}

export function makeMachineAccountDeleteTool(_client?: unknown): ToolDef {
  return webVaultStubTool("bws_machine_account_delete", "Delete a machine account.", {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
    additionalProperties: false,
  });
}

export function makeMachineAccountProjectsTool(_client?: unknown): ToolDef {
  return webVaultStubTool(
    "bws_machine_account_projects",
    "List the projects a machine account has access to.",
    {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  );
}

export function makeMachineAccountGrantProjectTool(_client?: unknown): ToolDef {
  return webVaultStubTool(
    "bws_machine_account_grant_project",
    "Grant a machine account access to a project.",
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
  return webVaultStubTool(
    "bws_machine_account_revoke_project",
    "Revoke a machine account's access to a project.",
    {
      type: "object",
      properties: { id: { type: "string" }, projectId: { type: "string" } },
      required: ["id", "projectId"],
      additionalProperties: false,
    },
  );
}
