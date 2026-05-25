import type { ToolDef } from "../../types.js";
import type { SmSdkClient } from "../../http/sm-sdk-client.js";
import { asToolError, jsonResult } from "../_error.js";
import { readOnly, destructive, requireString, requireOrgId } from "./_helpers.js";

const SDK_UNAVAILABLE_MSG =
  "Secrets Manager SDK not available on this platform. See README → Platform support.";

export function makeProjectListTool(sdk: SmSdkClient | undefined, orgId: string | undefined): ToolDef {
  return {
    name: "bws_project_list",
    description:
      "List Secrets Manager projects visible to the configured Machine Account. Uses the official @bitwarden/sdk-napi (Bitwarden Crypto). Returns cleartext project names.",
    inputSchema: {
      type: "object",
      properties: { organizationId: { type: "string" } },
      additionalProperties: false,
    },
    annotations: readOnly,
    handler: async (input) => {
      if (!sdk) return asToolError(new Error(SDK_UNAVAILABLE_MSG));
      try {
        const org = (input.organizationId as string | undefined) ?? requireOrgId(orgId);
        const projects = await sdk.projectList(org);
        if (projects.length === 0) {
          return jsonResult({
            projects: [],
            note: "Service account authenticated successfully but has no project assignments. Assign projects in the web vault under /#/sm/{orgId}/machine-accounts/{serviceAccountId}/projects.",
          });
        }
        return jsonResult({ projects });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeProjectGetTool(sdk: SmSdkClient | undefined): ToolDef {
  return {
    name: "bws_project_get",
    description: "Get a single Secrets Manager project by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: readOnly,
    handler: async (input) => {
      if (!sdk) return asToolError(new Error(SDK_UNAVAILABLE_MSG));
      try {
        const id = requireString(input, "id");
        const project = await sdk.projectGet(id);
        return jsonResult(project);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeProjectCreateTool(sdk: SmSdkClient | undefined, orgId: string | undefined): ToolDef {
  return {
    name: "bws_project_create",
    description: "Create a new Secrets Manager project. Destructive.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, organizationId: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      if (!sdk) return asToolError(new Error(SDK_UNAVAILABLE_MSG));
      try {
        const org = (input.organizationId as string | undefined) ?? requireOrgId(orgId);
        const project = await sdk.projectCreate(org, requireString(input, "name"));
        return jsonResult(project);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeProjectUpdateTool(sdk: SmSdkClient | undefined): ToolDef {
  return {
    name: "bws_project_update",
    description: "Rename a Secrets Manager project. Destructive.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" }, organizationId: { type: "string" } },
      required: ["id", "name"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      if (!sdk) return asToolError(new Error(SDK_UNAVAILABLE_MSG));
      try {
        const id = requireString(input, "id");
        const name = requireString(input, "name");
        // organizationId is required by SDK update but may come from input
        const orgId = input.organizationId as string | undefined;
        if (!orgId) return asToolError(new Error("organizationId required for project update."));
        const project = await sdk.projectUpdate(orgId, id, name);
        return jsonResult(project);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeProjectDeleteTool(sdk: SmSdkClient | undefined): ToolDef {
  return {
    name: "bws_project_delete",
    description:
      "Delete a Secrets Manager project. HIGHLY destructive — secrets in the project are also deleted.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      if (!sdk) return asToolError(new Error(SDK_UNAVAILABLE_MSG));
      try {
        const id = requireString(input, "id");
        const result = await sdk.projectDelete(id);
        return jsonResult(result);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}
