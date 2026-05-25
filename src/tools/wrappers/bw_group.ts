import type { ToolDef } from "../../types.js";
import type { BitwardenHttpClient } from "../../http/bitwarden-http-client.js";
import { fetchAllPages } from "../../http/pagination.js";
import { asToolError, jsonResult } from "../_error.js";
import { readOnly, destructive, requireString, pickFields, maybeNoteOversize, type Limits } from "./_helpers.js";

type Group = { id: string; name: string; [k: string]: unknown };

/**
 * Default response is slim because Bitwarden public API embeds the full
 * permission graph in each list item, which inflates the response by a
 * factor of 5–10x and overruns LLM tool-call token budgets at modest
 * org sizes (~200 members, ~60 collections).
 */
const SLIM_GROUP_FIELDS = ["id", "name", "externalId"] as const;

type GroupInclude = "collections" | "all";

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
          client.request.bind(client), "GET", "/public/groups", {}, limits,
        );
        let groups = page.items;
        if (typeof input.name_contains === "string" && input.name_contains.length > 0) {
          const needle = input.name_contains.toLowerCase();
          groups = groups.filter((g) => g.name.toLowerCase().includes(needle));
        }

        const includeSet = new Set<GroupInclude>((input.include as GroupInclude[] | undefined) ?? []);
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
      } catch (err) { return asToolError(err); }
    },
  };
}

export function makeGroupGetTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_group_get",
    description: "Get a single group by id (self-host).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    annotations: readOnly,
    handler: async (input) => {
      try {
        const id = requireString(input, "id");
        const res = await client.request("GET", `/public/groups/${encodeURIComponent(id)}`);
        return jsonResult(res.body ?? null);
      } catch (err) { return asToolError(err); }
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
        accessAll: { type: "boolean", default: false },
        externalId: { type: ["string", "null"], default: null },
        collections: { type: "array", default: [], items: { type: "object" } },
      },
      required: ["name"], additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const res = await client.request("POST", "/public/groups", {
          body: {
            name: requireString(input, "name"),
            accessAll: input.accessAll ?? false,
            externalId: input.externalId ?? null,
            collections: input.collections ?? [],
          },
        });
        return jsonResult(res.body ?? null);
      } catch (err) { return asToolError(err); }
    },
  };
}

export function makeGroupUpdateTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_group_update",
    description: "Update a group's name / access / collections (self-host). Destructive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        accessAll: { type: "boolean", default: false },
        externalId: { type: ["string", "null"], default: null },
        collections: { type: "array", default: [], items: { type: "object" } },
      },
      required: ["id", "name"], additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const id = requireString(input, "id");
        const res = await client.request("PUT", `/public/groups/${encodeURIComponent(id)}`, {
          body: {
            name: requireString(input, "name"),
            accessAll: input.accessAll ?? false,
            externalId: input.externalId ?? null,
            collections: input.collections ?? [],
          },
        });
        return jsonResult(res.body ?? null);
      } catch (err) { return asToolError(err); }
    },
  };
}

export function makeGroupDeleteTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_group_delete",
    description: "Delete a group (self-host). Highly destructive.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    annotations: destructive,
    handler: async (input) => {
      try {
        const id = requireString(input, "id");
        const res = await client.request("DELETE", `/public/groups/${encodeURIComponent(id)}`);
        return jsonResult({ status: res.status, deleted: id });
      } catch (err) { return asToolError(err); }
    },
  };
}

export function makeGroupGetMembersTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_group_get_members",
    description: "List the member ids in a group (self-host).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    annotations: readOnly,
    handler: async (input) => {
      try {
        const id = requireString(input, "id");
        const res = await client.request("GET", `/public/groups/${encodeURIComponent(id)}/member-ids`);
        return jsonResult(res.body ?? []);
      } catch (err) { return asToolError(err); }
    },
  };
}

export function makeGroupSetMembersTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_group_set_members",
    description: "Replace the set of members in a group (self-host). Destructive.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, memberIds: { type: "array", items: { type: "string" } } },
      required: ["id", "memberIds"], additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const id = requireString(input, "id");
        const memberIds = input.memberIds as string[];
        const res = await client.request("PUT", `/public/groups/${encodeURIComponent(id)}/member-ids`, { body: { memberIds } });
        return jsonResult({ status: res.status, id, memberIds });
      } catch (err) { return asToolError(err); }
    },
  };
}
