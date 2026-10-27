import type { PlannedRequest, ToolDef } from "../../types.js";
import type { BitwardenHttpClient } from "../../http/bitwarden-http-client.js";
import { fetchAllPages } from "../../http/pagination.js";
import { pathId } from "../../http/path-safety.js";
import { asToolError, jsonResult } from "../_error.js";
import {
  readOnly,
  destructive,
  requireString,
  pickFields,
  maybeNoteOversize,
  type Limits,
} from "./_helpers.js";

type Group = { id: string; name: string; [k: string]: unknown };

/**
 * Default response is slim because Bitwarden public API embeds the full
 * permission graph in each list item, which inflates the response by a
 * factor of 5–10x and overruns LLM tool-call token budgets at modest
 * org sizes (~200 members, ~60 collections).
 */
const SLIM_GROUP_FIELDS = ["id", "name", "externalId"] as const;

type GroupInclude = "collections" | "all";

const ACCESS_ALL_REMOVED =
  "accessAll is no longer supported by Bitwarden (removed from the Public API); " +
  "grant access per collection via the collections parameter instead. Nothing was changed.";
const accessAllSchema = {
  type: "boolean",
  default: false,
  description: "Removed upstream: true is rejected with an error; false is ignored.",
};

export function makeGroupListTool(
  client: BitwardenHttpClient,
  limits: Limits,
  maxResponseBytes: number = 60_000,
): ToolDef {
  return {
    name: "bw_group_list",
    description:
      "List organization groups (self-host). Returns slim projection by default " +
      "(id, name, externalId). For collection bindings of a group, use bw_group_get. " +
      "For group members, use bw_group_get_members. " +
      "Pass include: ['collections','all'] for the full nested response (may be very large). " +
      "Auto-paginates with continuationToken; supports optional case-insensitive substring filter on name.",
    inputSchema: {
      type: "object",
      properties: {
        name_contains: { type: "string" },
        include: {
          type: "array",
          items: { type: "string", enum: ["collections", "all"] },
          description: "Opt in to nested fields. ['all'] returns the full Bitwarden response.",
        },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
    handler: async (input) => {
      try {
        const page = await fetchAllPages<Group>(
          client.request.bind(client),
          "GET",
          "/public/groups",
          {},
          limits,
        );
        let groups = page.items;
        if (typeof input.name_contains === "string" && input.name_contains.length > 0) {
          const needle = input.name_contains.toLowerCase();
          groups = groups.filter((g) => g.name.toLowerCase().includes(needle));
        }

        const includeSet = new Set<GroupInclude>(
          (input.include as GroupInclude[] | undefined) ?? [],
        );
        const includeAll = includeSet.has("all");
        const explicitInclude = includeSet.size > 0;

        let projected: unknown[];
        if (includeAll) {
          projected = groups;
        } else {
          const extraFields: string[] = [];
          if (includeSet.has("collections")) extraFields.push("collections");

          const fields = [...SLIM_GROUP_FIELDS, ...extraFields];
          projected = groups.map((g) => pickFields(g, fields));
        }

        const payload = {
          groups: projected,
          truncated: page.truncated,
          continuationToken: page.continuationToken ?? null,
        };

        return jsonResult({
          ...payload,
          ...maybeNoteOversize(payload, maxResponseBytes, explicitInclude),
        });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeGroupGetTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_group_get",
    description: "Get a single group by id (self-host).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: readOnly,
    handler: async (input) => {
      try {
        const id = requireString(input, "id");
        const res = await client.request("GET", `/public/groups/${pathId(id)}`);
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeGroupCreateTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_group_create",
    description: "Create a new group (self-host). Destructive.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        accessAll: accessAllSchema,
        externalId: { type: ["string", "null"], default: null },
        collections: { type: "array", default: [], items: { type: "object" } },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        if (input.accessAll === true) throw new Error(ACCESS_ALL_REMOVED);
        const res = await client.request("POST", "/public/groups", {
          body: {
            name: requireString(input, "name"),
            externalId: input.externalId ?? null,
            collections: input.collections ?? [],
          },
        });
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

/**
 * PUT /public/groups/{id} writes name and externalId from the body and keeps
 * the collection assignments when `collections` is absent. So: omit
 * collections unless given, and keep externalId from the current group (GET).
 */
async function planGroupUpdate(
  client: BitwardenHttpClient,
  input: Record<string, unknown>,
): Promise<PlannedRequest> {
  const id = requireString(input, "id");
  const name = requireString(input, "name");
  if (input.accessAll === true) throw new Error(ACCESS_ALL_REMOVED);
  const path = `/public/groups/${pathId(id)}`;
  const notes: string[] = [];
  let externalId = input.externalId;
  if (!("externalId" in input)) {
    const current = (await client.request<Record<string, unknown>>("GET", path)).body ?? {};
    externalId = current.externalId ?? null;
    notes.push("externalId kept from the current group.");
  }
  const body: Record<string, unknown> = { name, externalId };
  if ("collections" in input) body.collections = input.collections;
  else notes.push("collections not sent, so the group's collection access stays unchanged.");
  return { method: "PUT", path, body, notes };
}

export function makeGroupUpdateTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_group_update",
    description:
      "Update a group's name, externalId and collection access (self-host). Omitted optional " +
      "fields keep their current value; passing collections replaces the group's whole " +
      "collection list. accessAll is no longer supported by Bitwarden (true is rejected). Destructive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        accessAll: accessAllSchema,
        externalId: { type: ["string", "null"] },
        collections: { type: "array", items: { type: "object" } },
      },
      required: ["id", "name"],
      additionalProperties: false,
    },
    annotations: destructive,
    plan: (input) => planGroupUpdate(client, input),
    handler: async (input) => {
      try {
        const plan = await planGroupUpdate(client, input);
        const res = await client.request(plan.method, plan.path, { body: plan.body });
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeGroupDeleteTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_group_delete",
    description: "Delete a group (self-host). Highly destructive.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const id = requireString(input, "id");
        const res = await client.request("DELETE", `/public/groups/${pathId(id)}`);
        return jsonResult({ status: res.status, deleted: id });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeGroupGetMembersTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_group_get_members",
    description: "List the member ids in a group (self-host).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: readOnly,
    handler: async (input) => {
      try {
        const id = requireString(input, "id");
        const res = await client.request("GET", `/public/groups/${pathId(id)}/member-ids`);
        return jsonResult(res.body ?? []);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeGroupSetMembersTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_group_set_members",
    description: "Replace the set of members in a group (self-host). Destructive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        memberIds: { type: "array", items: { type: "string" } },
      },
      required: ["id", "memberIds"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const id = requireString(input, "id");
        const memberIds = input.memberIds as string[];
        const res = await client.request("PUT", `/public/groups/${pathId(id)}/member-ids`, {
          body: { memberIds },
        });
        return jsonResult({ status: res.status, id, memberIds });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}
