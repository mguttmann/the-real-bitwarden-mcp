import type { ToolDef } from "../../types.js";
import type { BitwardenHttpClient } from "../../http/bitwarden-http-client.js";
import { asToolError, jsonResult } from "../_error.js";
import { readOnly, destructive, requireInt } from "./_helpers.js";

export function makePolicyListTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_policy_list",
    description:
      "List all organization policies and their current enabled/disabled state (self-host).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnly,
    handler: async () => {
      try {
        const res = await client.request("GET", "/public/policies");
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makePolicyGetTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_policy_get",
    description: "Get a single policy by numeric type (self-host).",
    inputSchema: {
      type: "object",
      properties: { type: { type: "integer", minimum: 0 } },
      required: ["type"],
      additionalProperties: false,
    },
    annotations: readOnly,
    handler: async (input) => {
      try {
        const type = requireInt(input, "type");
        const res = await client.request("GET", `/public/policies/${type}`);
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makePolicySetTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_policy_set",
    description:
      "Enable / disable a policy and update its data payload (self-host). Destructive — changes affect all members immediately.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "integer", minimum: 0 },
        enabled: { type: "boolean" },
        data: { type: ["object", "null"], default: null },
      },
      required: ["type", "enabled"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const type = requireInt(input, "type");
        const res = await client.request("PUT", `/public/policies/${type}`, {
          body: { enabled: input.enabled, data: input.data ?? null },
        });
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}
