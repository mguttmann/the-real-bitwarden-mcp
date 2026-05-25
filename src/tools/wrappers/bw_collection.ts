import type { ToolDef } from "../../types.js";
import type { BitwardenHttpClient } from "../../http/bitwarden-http-client.js";
import { fetchAllPages } from "../../http/pagination.js";
import { asToolError, jsonResult } from "../_error.js";
import {
  readOnly,
  destructive,
  requireString,
  pickFields,
  maybeNoteOversize,
  type Limits,
} from "./_helpers.js";

type Collection = { id: string; externalId: string | null; [k: string]: unknown };

const accessEntrySchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    readOnly: { type: "boolean" },
    hidePasswords: { type: "boolean" },
    manage: { type: "boolean" },
  },
  required: ["id"],
  additionalProperties: false,
} as const;

/**
 * Default response is slim because Bitwarden public API embeds the full
 * permission graph in each list item, which inflates the response by a
 * factor of 5–10x and overruns LLM tool-call token budgets at modest
 * org sizes (~200 members, ~60 collections).
 */
const SLIM_COLLECTION_FIELDS = ["id", "externalId"] as const;

type CollectionInclude = "groups" | "users" | "all";

export function makeCollectionListTool(
  client: BitwardenHttpClient,
  limits: Limits,
  maxResponseBytes: number = 60_000,
): ToolDef {
  return {
    name: "bw_collection_list",
    description:
      "List organization collections (self-host). Returns slim projection by default " +
      "(id, externalId). For group/user bindings of a collection, use bw_collection_get. " +
      "Pass include: ['groups','users','all'] for the full nested response (may be very large). " +
      "Auto-paginates with continuationToken.",
    inputSchema: {
      type: "object",
      properties: {
        include: {
          type: "array",
          items: { type: "string", enum: ["groups", "users", "all"] },
          description: "Opt in to nested fields. ['all'] returns the full Bitwarden response.",
        },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
    handler: async (input) => {
      try {
        const page = await fetchAllPages<Collection>(
          client.request.bind(client),
          "GET",
          "/public/collections",
          {},
          limits,
        );

        const includeSet = new Set<CollectionInclude>(
          (input.include as CollectionInclude[] | undefined) ?? [],
        );
        const includeAll = includeSet.has("all");
        const explicitInclude = includeSet.size > 0;

        let projected: unknown[];
        if (includeAll) {
          projected = page.items;
        } else {
          const extraFields: string[] = [];
          if (includeSet.has("groups")) extraFields.push("groups");
          if (includeSet.has("users")) extraFields.push("users");

          const fields = [...SLIM_COLLECTION_FIELDS, ...extraFields];
          projected = page.items.map((c) => pickFields(c, fields));
        }

        const payload = {
          collections: projected,
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

export function makeCollectionGetTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_collection_get",
    description: "Get a single collection (self-host).",
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
        const res = await client.request("GET", `/public/collections/${encodeURIComponent(id)}`);
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeCollectionUpdateTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_collection_update",
    description:
      "Update a collection's access — groups and users with readOnly / hidePasswords / manage flags (self-host). Destructive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        externalId: { type: ["string", "null"], default: null },
        groups: { type: "array", items: accessEntrySchema, default: [] },
        users: { type: "array", items: accessEntrySchema, default: [] },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const id = requireString(input, "id");
        const res = await client.request("PUT", `/public/collections/${encodeURIComponent(id)}`, {
          body: {
            externalId: input.externalId ?? null,
            groups: input.groups ?? [],
            users: input.users ?? [],
          },
        });
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeCollectionDeleteTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_collection_delete",
    description:
      "Delete a collection (self-host). Highly destructive — items in this collection lose access.",
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
        const res = await client.request("DELETE", `/public/collections/${encodeURIComponent(id)}`);
        return jsonResult({ status: res.status, deleted: id });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}
