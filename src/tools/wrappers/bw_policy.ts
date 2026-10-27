import type { PlannedRequest, ToolDef } from "../../types.js";
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

/**
 * PUT /public/policies/{type} stores `data` as sent, so a missing or null
 * value clears the policy settings. Keep the current data (GET) unless the
 * caller passes `data`.
 */
async function planPolicySet(
  client: BitwardenHttpClient,
  input: Record<string, unknown>,
): Promise<PlannedRequest> {
  const type = requireInt(input, "type");
  const path = `/public/policies/${type}`;
  const notes: string[] = [];
  let data = input.data;
  if (!("data" in input)) {
    const current = (await client.request<Record<string, unknown>>("GET", path)).body ?? {};
    data = current.data ?? null;
    notes.push("data kept from the current policy.");
  }
  return { method: "PUT", path, body: { enabled: input.enabled, data }, notes };
}

export function makePolicySetTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_policy_set",
    description:
      "Enable / disable a policy and update its data payload (self-host). Without data, the " +
      "current policy data is kept; data: null clears it. Destructive - changes affect all " +
      "members immediately.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "integer", minimum: 0 },
        enabled: { type: "boolean" },
        data: { type: ["object", "null"] },
      },
      required: ["type", "enabled"],
      additionalProperties: false,
    },
    annotations: destructive,
    plan: (input) => planPolicySet(client, input),
    handler: async (input) => {
      try {
        const plan = await planPolicySet(client, input);
        const res = await client.request(plan.method, plan.path, { body: plan.body });
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}
