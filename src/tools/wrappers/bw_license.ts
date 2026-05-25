import type { ToolDef } from "../../types.js";
import type { BitwardenHttpClient } from "../../http/bitwarden-http-client.js";
import { asToolError, jsonResult } from "../_error.js";
import { readOnly, destructive } from "./_helpers.js";

export function makeLicenseSubscriptionGetTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_license_subscription_get",
    description:
      "Get the cloud organization's subscription details (plan, billing period, seats used vs purchased, storage). Cloud-only.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: readOnly,
    handler: async () => {
      try {
        const res = await client.request("GET", "/public/organization/subscription");
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeLicenseSeatsUpdateTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_license_seats_update",
    description:
      "Adjust Password Manager seats on the cloud organization. Positive value adds, negative value removes. Uses the unified PUT /public/organization/subscription endpoint. Destructive — affects billing.",
    inputSchema: {
      type: "object",
      properties: {
        seatAdjustment: {
          type: "integer",
          description: "Delta to apply (positive to add seats, negative to remove).",
        },
      },
      required: ["seatAdjustment"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const res = await client.request("PUT", "/public/organization/subscription", {
          body: { passwordManager: { seatAdjustment: input.seatAdjustment } },
        });
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeLicenseStorageUpdateTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_license_storage_update",
    description:
      "Adjust the amount of purchased attachment storage (GB) on the cloud organization. Uses the unified PUT /public/organization/subscription endpoint. Destructive — affects billing.",
    inputSchema: {
      type: "object",
      properties: { storageGbAdjustment: { type: "integer", description: "Delta in GB." } },
      required: ["storageGbAdjustment"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const res = await client.request("PUT", "/public/organization/subscription", {
          body: { passwordManager: { storageGbAdjustment: input.storageGbAdjustment } },
        });
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeLicenseSmSeatsUpdateTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_license_sm_seats_update",
    description:
      "Adjust Secrets Manager seats on the cloud organization. Positive value adds, negative value removes. Wraps PUT /public/organization/subscription with body {secretsManager:{seatAdjustment:N}}. Destructive — affects billing.",
    inputSchema: {
      type: "object",
      properties: {
        seatAdjustment: {
          type: "integer",
          description: "Delta. +1 to add one seat, -1 to remove one.",
        },
      },
      required: ["seatAdjustment"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const res = await client.request("PUT", "/public/organization/subscription", {
          body: { secretsManager: { seatAdjustment: input.seatAdjustment } },
        });
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeLicenseSmServiceAccountsUpdateTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_license_sm_service_accounts_update",
    description:
      "Adjust Secrets Manager service-account slots on the cloud organization. Positive adds, negative removes. Wraps PUT /public/organization/subscription with body {secretsManager:{serviceAccountAdjustment:N}}. Destructive — affects billing.",
    inputSchema: {
      type: "object",
      properties: { serviceAccountAdjustment: { type: "integer", description: "Delta." } },
      required: ["serviceAccountAdjustment"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const res = await client.request("PUT", "/public/organization/subscription", {
          body: { secretsManager: { serviceAccountAdjustment: input.serviceAccountAdjustment } },
        });
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}
