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
 * large factor and overruns LLM tool-call token budgets even for
 * organizations of modest size.
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
        const res = await client.request("GET", `/public/collections/${pathId(id)}`);
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

const USERS_NOT_SUPPORTED =
  "users is not supported: the Bitwarden Public API has no per-user collection access; a collection update only " +
  "takes externalId and groups. Give a member direct access with bw_member_update " +
  "(collections), or use groups. Nothing was changed.";

/**
 * PUT /public/collections/{id} writes externalId from the body and keeps the
 * group access when `groups` is absent. So: omit groups unless given, and
 * keep externalId from the current collection (GET).
 */
async function planCollectionUpdate(
  client: BitwardenHttpClient,
  input: Record<string, unknown>,
): Promise<PlannedRequest> {
  const id = requireString(input, "id");
  if (Array.isArray(input.users) && input.users.length > 0) throw new Error(USERS_NOT_SUPPORTED);
  const path = `/public/collections/${pathId(id)}`;
  const notes: string[] = [];
  let externalId = input.externalId;
  if (!("externalId" in input)) {
    const current = (await client.request<Record<string, unknown>>("GET", path)).body ?? {};
    externalId = current.externalId ?? null;
    notes.push("externalId kept from the current collection.");
  }
  const body: Record<string, unknown> = { externalId };
  if ("groups" in input) body.groups = input.groups;
  else notes.push("groups not sent, so the collection's group access stays unchanged.");
  return { method: "PUT", path, body, notes };
}

export function makeCollectionUpdateTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_collection_update",
    description:
      "Update a collection's externalId and group access (readOnly / hidePasswords / manage per " +
      "group) (self-host). Omitted optional fields keep their current value; passing groups " +
      "replaces the whole group list. The Public API has no per-user collection access: a " +
      "non-empty users list is rejected (use bw_member_update collections). Destructive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        externalId: { type: ["string", "null"] },
        groups: { type: "array", items: accessEntrySchema },
        users: {
          type: "array",
          items: accessEntrySchema,
          description: "Not supported by the Public API: a non-empty list is rejected.",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: destructive,
    plan: (input) => planCollectionUpdate(client, input),
    handler: async (input) => {
      try {
        const plan = await planCollectionUpdate(client, input);
        const res = await client.request(plan.method, plan.path, { body: plan.body });
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
      "Delete a collection (self-host). Highly destructive - items in this collection lose access.",
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
        const res = await client.request("DELETE", `/public/collections/${pathId(id)}`);
        return jsonResult({ status: res.status, deleted: id });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}
