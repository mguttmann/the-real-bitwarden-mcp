import type { ToolDef } from "../../types.js";
import type { SmSdkClient } from "../../http/sm-sdk-client.js";
import { asToolError, jsonResult } from "../_error.js";
import { readOnly, destructive, requireString, requireOrgId } from "./_helpers.js";

const SDK_UNAVAILABLE_MSG =
  "Secrets Manager SDK not available on this platform. See README → Platform support.";

export function makeSecretListTool(sdk: SmSdkClient | undefined, orgId: string | undefined): ToolDef {
  return {
    name: "bws_secret_list",
    description:
      "List Secrets Manager secrets in the organization. Returns METADATA ONLY (id, key, organizationId) — no value field. Use bws_secret_get_value(id) to read a single value.",
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
        const secrets = await sdk.secretList(org);
        return jsonResult({ secrets });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeSecretGetValueTool(sdk: SmSdkClient | undefined): ToolDef {
  // Intentionally readOnlyHint:true — confirm gate would add friction without value.
  // Defence-in-depth lives elsewhere: bulk listing returns identifiers only, logger redacts the field.
  return {
    name: "bws_secret_get_value",
    description:
      "Fetch a single Secrets Manager secret by id, including its decrypted value. Use sparingly — the value is returned in the response. Never log the response output.",
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
        const secret = await sdk.secretGet(id);
        return jsonResult(secret);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeSecretCreateTool(sdk: SmSdkClient | undefined, orgId: string | undefined): ToolDef {
  return {
    name: "bws_secret_create",
    description: "Create a new Secrets Manager secret. Destructive.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { type: "string" },
        note: { type: "string", default: "" },
        projectIds: { type: "array", items: { type: "string" }, default: [] },
        organizationId: { type: "string" },
      },
      required: ["key", "value"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      if (!sdk) return asToolError(new Error(SDK_UNAVAILABLE_MSG));
      try {
        const org = (input.organizationId as string | undefined) ?? requireOrgId(orgId);
        const secret = await sdk.secretCreate(
          org,
          requireString(input, "key"),
          requireString(input, "value"),
          typeof input.note === "string" ? input.note : "",
          (input.projectIds as string[] | undefined) ?? [],
        );
        return jsonResult(secret);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeSecretUpdateTool(sdk: SmSdkClient | undefined): ToolDef {
  return {
    name: "bws_secret_update",
    description: "Update a Secrets Manager secret (key/value/note/projects). Destructive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        key: { type: "string" },
        value: { type: "string" },
        note: { type: "string", default: "" },
        projectIds: { type: "array", items: { type: "string" }, default: [] },
        organizationId: { type: "string" },
      },
      required: ["id", "key", "value"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      if (!sdk) return asToolError(new Error(SDK_UNAVAILABLE_MSG));
      try {
        const id = requireString(input, "id");
        const orgId = input.organizationId as string | undefined;
        if (!orgId) return asToolError(new Error("organizationId required for secret update."));
        const secret = await sdk.secretUpdate(
          orgId,
          id,
          requireString(input, "key"),
          requireString(input, "value"),
          typeof input.note === "string" ? input.note : "",
          (input.projectIds as string[] | undefined) ?? [],
        );
        return jsonResult(secret);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeSecretDeleteTool(sdk: SmSdkClient | undefined): ToolDef {
  return {
    name: "bws_secret_delete",
    description: "Delete a Secrets Manager secret. Destructive.",
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
        const result = await sdk.secretDelete(id);
        return jsonResult(result);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}
