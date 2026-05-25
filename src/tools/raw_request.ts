import type { ToolDef, ToolResult, Instance } from "../types.js";
import type { BitwardenHttpClient, HttpMethod } from "../http/bitwarden-http-client.js";

const VALID: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const INSTANCES: Instance[] = ["selfhost", "cloud", "sm"];

export type RawRequestDeps = {
  selfhost: BitwardenHttpClient | undefined;
  cloud: BitwardenHttpClient | undefined;
  sm: BitwardenHttpClient | undefined;
  confirmWrites: boolean;
};

export function makeRawRequestTool(deps: RawRequestDeps): ToolDef {
  return {
    name: "bw_raw_request",
    description:
      "Escape hatch: issue an arbitrary request against a Bitwarden API. The `instance` parameter selects 'selfhost' or 'cloud' (Public API, scope api.organization) or 'sm' (Secrets Manager API, scope api.secrets). Default is 'selfhost'. OAuth and retries are applied, pagination is NOT. Use only when no dedicated tool fits.\n\nFor SM routes use org-scoped paths, e.g. /organizations/{orgId}/projects, /organizations/{orgId}/secrets, /organizations/{orgId}/service-accounts. Top-level paths like /projects or /secrets do not exist and return 404.",
    inputSchema: {
      type: "object",
      properties: {
        instance: { type: "string", enum: INSTANCES, default: "selfhost" },
        method: { type: "string", enum: VALID },
        path: {
          type: "string",
          pattern: "^/.+",
          description: "Path beginning with '/', e.g. '/public/members' or '/organizations/{orgId}/projects'.",
        },
        query: { type: "object", additionalProperties: true },
        body: { type: ["object", "array", "string", "number", "boolean", "null"] },
        confirm: {
          type: "string",
          enum: ["YES"],
          description:
            'Required when BITWARDEN_CONFIRM_WRITES=true and method is not GET. Without it the tool returns a preview only. Ignored for GET.',
        },
      },
      required: ["method", "path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    handler: async (input): Promise<ToolResult> => {
      const method = input.method as HttpMethod;
      const path = input.path;
      const instance = (input.instance ?? "selfhost") as Instance;

      if (!VALID.includes(method)) {
        return { content: [{ type: "text", text: `Unsupported method "${String(input.method)}". Allowed: ${VALID.join(", ")}.` }], isError: true };
      }
      if (typeof path !== "string" || !path.startsWith("/")) {
        return { content: [{ type: "text", text: `Path must start with "/", got: ${JSON.stringify(input.path)}.` }], isError: true };
      }
      if (!INSTANCES.includes(instance)) {
        return { content: [{ type: "text", text: `Unsupported instance "${String(input.instance)}". Allowed: ${INSTANCES.join(", ")}.` }], isError: true };
      }

      let client: BitwardenHttpClient | undefined;
      if (instance === "selfhost") client = deps.selfhost;
      else if (instance === "cloud") client = deps.cloud;
      else client = deps.sm;

      if (!client) {
        const hint =
          instance === "sm"
            ? "Set BWS_ACCESS_TOKEN (and BWS_API_BASE / BWS_IDENTITY_URL if not inherited from self-host) in .env, then restart."
            : `Set the corresponding BITWARDEN_${instance.toUpperCase()}_* env vars.`;
        return { content: [{ type: "text", text: `Instance "${instance}" is not configured. ${hint}` }], isError: true };
      }

      const isWrite = method !== "GET";
      if (isWrite && deps.confirmWrites && input.confirm !== "YES") {
        const { confirm: _drop, ...preview } = input;
        return { content: [{ type: "text", text: `PREVIEW — would execute bw_raw_request\nInput: ${JSON.stringify(preview, null, 2)}\nTo execute, retry the same call with confirm: "YES".` }] };
      }

      const res = await client.request(method, path, {
        query: input.query as Record<string, string | number | boolean | undefined | null> | undefined,
        body: input.body,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ status: res.status, body: res.body ?? null }, null, 2) }],
      };
    },
  };
}
