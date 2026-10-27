import type { PlannedRequest, ToolDef } from "../../types.js";
import { isOutcomeUnknown, type BitwardenHttpClient } from "../../http/bitwarden-http-client.js";
import { asToolError, jsonResult } from "../_error.js";
import { scrubClientText } from "../../redact.js";
import { BitwardenApiError } from "../../http/errors.js";
import { readOnly, destructive, requireInt } from "./_helpers.js";

export function makeLicenseSubscriptionGetTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_license_subscription_get",
    description:
      "Get the cloud organization's subscription totals: Password Manager seats, max autoscale " +
      "seats and storage (GB); Secrets Manager seats, max autoscale seats, service accounts and " +
      "max autoscale service accounts. Cloud-only.",
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

const SUBSCRIPTION_PATH = "/public/organization/subscription";

type Product = "passwordManager" | "secretsManager";
type Subscription = Partial<Record<Product, Record<string, unknown>>>;

/**
 * PUT /public/organization/subscription takes absolute totals
 * (passwordManager.seats / .storage, secretsManager.seats / .serviceAccounts)
 * and silently drops unknown fields. The tools keep their delta inputs: the
 * plan reads the current total and sends current + delta.
 */
type LicenseField = {
  toolName: string;
  param: string;
  product: Product;
  field: string;
  label: string;
};

type LicensePlan = PlannedRequest & { before: number; target: number };

async function readTotal(client: BitwardenHttpClient, f: LicenseField): Promise<unknown> {
  const sub = (await client.request<Subscription>("GET", SUBSCRIPTION_PATH)).body ?? {};
  return sub[f.product]?.[f.field];
}

async function planLicenseUpdate(
  client: BitwardenHttpClient,
  f: LicenseField,
  input: Record<string, unknown>,
): Promise<LicensePlan> {
  const delta = requireInt(input, f.param);
  if (delta === 0) throw new Error(`${f.param} must not be 0.`);
  const before = await readTotal(client, f);
  if (typeof before !== "number") {
    throw new Error(
      `The subscription has no current ${f.label} (${f.product}.${f.field}); nothing was changed.`,
    );
  }
  const target = before + delta;
  if (target < 1) {
    throw new Error(
      `${f.label} would drop to ${target} (current ${before}, ${f.param} ${delta}); ` +
        "the API only accepts a total of at least 1. Nothing was changed.",
    );
  }
  return {
    method: "PUT",
    path: SUBSCRIPTION_PATH,
    body: { [f.product]: { [f.field]: target } },
    notes: [`${f.label}: ${before} -> ${target} (absolute total sent, not the delta).`],
    before,
    target,
  };
}

/**
 * The update is read-modify-write and the API has no conditional update, so
 * concurrent calls on one client run one after the other; otherwise two
 * deltas read the same total and one of them is lost. Separate processes
 * can still race.
 */
const updateQueues = new WeakMap<BitwardenHttpClient, Promise<unknown>>();

function serialized<T>(client: BitwardenHttpClient, fn: () => Promise<T>): Promise<T> {
  const run = (updateQueues.get(client) ?? Promise.resolve()).then(fn, fn);
  updateQueues.set(
    client,
    run.catch(() => undefined),
  );
  return run;
}

function makeLicenseUpdateTool(
  client: BitwardenHttpClient,
  f: LicenseField,
  description: string,
  paramDescription: string,
): ToolDef {
  return {
    name: f.toolName,
    description,
    inputSchema: {
      type: "object",
      properties: { [f.param]: { type: "integer", description: paramDescription } },
      required: [f.param],
      additionalProperties: false,
    },
    annotations: destructive,
    plan: (input) => planLicenseUpdate(client, f, input),
    handler: (input) =>
      serialized(client, async () => {
        try {
          const plan = await planLicenseUpdate(client, f, input);
          let res;
          try {
            res = await client.request(plan.method, plan.path, { body: plan.body });
          } catch (err) {
            if (!isOutcomeUnknown(err)) throw err;
            return errorText(
              `${errorMessage(err)}\nThe ${f.label} update (${plan.before} -> ${plan.target}) may ` +
                "already be applied. This tool takes a delta: check the current total with " +
                "bw_license_subscription_get before retrying, or the delta may be applied twice.",
            );
          }
          // The endpoint answers 200 even when it applies nothing, so read the total back.
          let after: unknown;
          try {
            after = await readTotal(client, f);
          } catch (err) {
            // No automatic retry: the PUT was accepted, repeating the delta would apply it twice.
            return errorText(
              `The PUT ${plan.path} (${f.label}: ${plan.before} -> ${plan.target}) was answered ` +
                `successfully, but the read-back of the new total failed: ${errorMessage(err)}\n` +
                "The change has probably been applied. Check with bw_license_subscription_get " +
                "before retrying; do not repeat the update blindly (it takes a delta).",
            );
          }
          const result = {
            field: `${f.product}.${f.field}`,
            before: plan.before,
            requested: plan.target,
            after,
            response: res.body ?? null,
          };
          if (after !== plan.target) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    `${f.label} unchanged or different from the requested total after the update. ` +
                    "Check the current total with bw_license_subscription_get before adjusting " +
                    "again (the tool takes a delta): " +
                    JSON.stringify(result, null, 2),
                },
              ],
              isError: true,
            };
          }
          return jsonResult(result);
        } catch (err) {
          return asToolError(err);
        }
      }),
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof BitwardenApiError) return err.toString();
  return err instanceof Error ? err.message : String(err);
}

function errorText(text: string) {
  return { content: [{ type: "text" as const, text: scrubClientText(text) }], isError: true };
}

const BILLING_NOTE =
  "Reads the current total, sends current + delta as the new absolute total via " +
  "PUT /public/organization/subscription, then reads it back; fails if the total did not " +
  "change. Cloud-only. Destructive - affects billing.";

export function makeLicenseSeatsUpdateTool(client: BitwardenHttpClient): ToolDef {
  return makeLicenseUpdateTool(
    client,
    {
      toolName: "bw_license_seats_update",
      param: "seatAdjustment",
      product: "passwordManager",
      field: "seats",
      label: "Password Manager seats",
    },
    "Adjust Password Manager seats on the cloud organization by a delta (positive adds, " +
      "negative removes; the total must stay at least 1). " +
      BILLING_NOTE,
    "Delta to apply (positive to add seats, negative to remove).",
  );
}

export function makeLicenseStorageUpdateTool(client: BitwardenHttpClient): ToolDef {
  return makeLicenseUpdateTool(
    client,
    {
      toolName: "bw_license_storage_update",
      param: "storageGbAdjustment",
      product: "passwordManager",
      field: "storage",
      label: "Password Manager storage (GB)",
    },
    "Adjust the purchased attachment storage (GB) on the cloud organization by a delta (the " +
      "total must stay at least 1). " +
      BILLING_NOTE,
    "Delta in GB.",
  );
}

export function makeLicenseSmSeatsUpdateTool(client: BitwardenHttpClient): ToolDef {
  return makeLicenseUpdateTool(
    client,
    {
      toolName: "bw_license_sm_seats_update",
      param: "seatAdjustment",
      product: "secretsManager",
      field: "seats",
      label: "Secrets Manager seats",
    },
    "Adjust Secrets Manager seats on the cloud organization by a delta (positive adds, " +
      "negative removes; the total must stay at least 1). " +
      BILLING_NOTE,
    "Delta. +1 to add one seat, -1 to remove one.",
  );
}

export function makeLicenseSmServiceAccountsUpdateTool(client: BitwardenHttpClient): ToolDef {
  return makeLicenseUpdateTool(
    client,
    {
      toolName: "bw_license_sm_service_accounts_update",
      param: "serviceAccountAdjustment",
      product: "secretsManager",
      field: "serviceAccounts",
      label: "Secrets Manager service accounts",
    },
    "Adjust Secrets Manager service-account slots on the cloud organization by a delta " +
      "(positive adds, negative removes; the total must stay at least 1). " +
      BILLING_NOTE,
    "Delta.",
  );
}
