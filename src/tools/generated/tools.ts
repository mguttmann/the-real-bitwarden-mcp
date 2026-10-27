import type { JSONSchema, OperationDef, ParameterDef, ToolDef, ToolResult } from "../../types.js";
import type { BitwardenHttpClient } from "../../http/bitwarden-http-client.js";
import { fetchAllPages } from "../../http/pagination.js";
import { pathId } from "../../http/path-safety.js";
import { asToolError, jsonResult } from "../_error.js";

export type BuilderLimits = { maxItems: number; maxPages: number };

function inputSchemaFor(op: OperationDef): JSONSchema {
  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];
  for (const p of op.parameters) {
    properties[p.name] = {
      ...(p.schema as Record<string, unknown>),
      ...(p.description ? { description: p.description } : {}),
    };
    if (p.required) required.push(p.name);
  }
  if (op.requestBodySchema) {
    properties.body = op.requestBodySchema;
    if (op.requestBodyRequired) required.push("body");
  }
  if (isListEndpoint(op)) {
    properties.auto_paginate = {
      type: "boolean", default: true,
      description: "Auto-merge all continuationToken pages up to the soft cap.",
    };
  }
  return { type: "object", properties, required, additionalProperties: false };
}

function isListEndpoint(op: OperationDef): boolean {
  if (op.method !== "GET") return false;
  const segs = op.path.split("/").filter(Boolean);
  return !segs[segs.length - 1]!.startsWith("{");
}

function buildPath(path: string, params: Record<string, unknown>): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const v = params[name];
    if (v === undefined || v === null) throw new Error(`Missing path parameter "${name}" for ${path}`);
    return pathId(String(v));
  });
}

function splitInput(op: OperationDef, input: Record<string, unknown>) {
  const pathVars: Record<string, unknown> = {};
  const query: Record<string, string | number | boolean | undefined | null> = {};
  const paramByName = new Map<string, ParameterDef>(op.parameters.map((p) => [p.name, p]));
  for (const [k, v] of Object.entries(input)) {
    if (k === "body" || k === "auto_paginate") continue;
    const p = paramByName.get(k);
    if (!p) continue;
    if (p.in === "path") pathVars[k] = v;
    else if (p.in === "query") query[k] = v as string | number | boolean | undefined | null;
  }
  return { pathVars, query, body: input.body, autoPaginate: input.auto_paginate !== false };
}

export function buildGeneratedTools(
  client: BitwardenHttpClient,
  operations: readonly OperationDef[],
  limits: BuilderLimits,
): ToolDef[] {
  const tools: ToolDef[] = [];
  for (const op of operations) {
    const tool: ToolDef = {
      name: op.toolName,
      description: op.summary || op.description || `${op.method} ${op.path}`,
      inputSchema: inputSchemaFor(op),
      annotations: {
        readOnlyHint: !op.isDestructive,
        destructiveHint: op.isDestructive,
        openWorldHint: true,
      },
      handler: async (input): Promise<ToolResult> => {
        try {
          const { pathVars, query, body, autoPaginate } = splitInput(op, input);
          const path = buildPath(op.path, pathVars);
          if (op.method === "GET" && isListEndpoint(op) && autoPaginate) {
            const page = await fetchAllPages(
              client.request.bind(client), "GET", path, query, limits,
            );
            return jsonResult({ items: page.items, truncated: page.truncated, continuationToken: page.continuationToken ?? null });
          }
          const res = await client.request(op.method, path, {
            query,
            body,
          });
          return jsonResult({ status: res.status, body: res.body ?? null });
        } catch (err) { return asToolError(err); }
      },
    };
    tools.push(tool);
  }
  return tools;
}
