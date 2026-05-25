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

type Member = {
  id: string;
  email: string;
  name?: string;
  type: number;
  status?: number;
  [k: string]: unknown;
};

/**
 * Default response is slim because Bitwarden public API embeds the full
 * permission graph in each list item, which inflates the response by a
 * factor of 5–10x and overruns LLM tool-call token budgets at modest
 * org sizes (~200 members, ~60 collections).
 *
 * Note: `accessSecretsManager` is intentionally NOT in this list. Bitwarden's
 * Public API exposes the field as write-only — it is accepted by POST/PUT
 * /public/members but is never present in GET responses (verified live
 * against 2026.4.x self-host). Reading SM-access status per user is not
 * possible via the Public API.
 */
const SLIM_MEMBER_FIELDS = ["id", "email", "name", "type", "status", "twoFactorEnabled"] as const;

type MemberInclude = "collections" | "groups" | "permissions" | "all";

export function makeMemberListTool(
  client: BitwardenHttpClient,
  limits: Limits,
  maxResponseBytes: number = 60_000,
): ToolDef {
  return {
    name: "bw_member_list",
    description:
      "List organization members (self-host). Returns slim projection by default " +
      "(id, email, name, type, status, twoFactorEnabled). " +
      "Note: accessSecretsManager is write-only in Bitwarden's Public API and " +
      "cannot be read back per user — set it via bw_member_grant_sm / bw_member_revoke_sm. " +
      "For collections/groups of a member, use bw_member_get / bw_member_get_groups. " +
      "Pass include: ['collections','groups','all'] for the full nested response " +
      "(may be very large). Auto-paginates with continuationToken; supports optional " +
      "case-insensitive substring filter on email or name.",
    inputSchema: {
      type: "object",
      properties: {
        email_contains: { type: "string" },
        name_contains: { type: "string" },
        include: {
          type: "array",
          items: { type: "string", enum: ["collections", "groups", "permissions", "all"] },
          description: "Opt in to nested fields. ['all'] returns the full Bitwarden response.",
        },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
    handler: async (input) => {
      try {
        const page = await fetchAllPages<Member>(
          client.request.bind(client),
          "GET",
          "/public/members",
          {},
          limits,
        );
        let members = page.items;
        if (typeof input.email_contains === "string" && input.email_contains.length > 0) {
          const needle = input.email_contains.toLowerCase();
          members = members.filter((m) => m.email.toLowerCase().includes(needle));
        }
        if (typeof input.name_contains === "string" && input.name_contains.length > 0) {
          const needle = input.name_contains.toLowerCase();
          members = members.filter(
            (m) => typeof m.name === "string" && m.name.toLowerCase().includes(needle),
          );
        }

        const includeSet = new Set<MemberInclude>(
          (input.include as MemberInclude[] | undefined) ?? [],
        );
        const includeAll = includeSet.has("all");
        const explicitInclude = includeSet.size > 0;

        let projected: unknown[];
        if (includeAll) {
          projected = members;
        } else {
          // Build the set of extra fields to merge in beyond the slim base
          const extraFields: string[] = [];
          if (includeSet.has("collections")) extraFields.push("collections");
          if (includeSet.has("groups")) extraFields.push("groups");
          if (includeSet.has("permissions"))
            extraFields.push("permissions", "resetPasswordEnrolled");

          const fields = [...SLIM_MEMBER_FIELDS, ...extraFields];
          projected = members.map((m) => pickFields(m, fields));
        }

        const payload = {
          members: projected,
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

export function makeMemberGetTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_member_get",
    description: "Get a single organization member by id (self-host).",
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
        const res = await client.request("GET", `/public/members/${encodeURIComponent(id)}`);
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeMemberInviteTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_member_invite",
    description:
      "Invite a new organization member (self-host). Sends an invitation email and creates an Invited member record. Destructive.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", format: "email" },
        type: {
          type: "integer",
          enum: [0, 1, 2, 3, 4],
          description: "0 Owner, 1 Admin, 2 User, 3 Manager, 4 Custom.",
        },
        externalId: { type: ["string", "null"], default: null },
        collections: { type: "array", default: [], items: { type: "object" } },
        groups: { type: "array", default: [], items: { type: "string" } },
        accessSecretsManager: { type: "boolean", default: false },
      },
      required: ["email", "type"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const res = await client.request("POST", "/public/members", {
          body: {
            email: requireString(input, "email"),
            type: input.type,
            externalId: input.externalId ?? null,
            collections: input.collections ?? [],
            groups: input.groups ?? [],
            accessSecretsManager: input.accessSecretsManager ?? false,
          },
        });
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeMemberUpdateTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_member_update",
    description: "Update an organization member's role and access (self-host). Destructive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        type: { type: "integer", enum: [0, 1, 2, 3, 4] },
        externalId: { type: ["string", "null"], default: null },
        collections: { type: "array", default: [], items: { type: "object" } },
        groups: { type: "array", default: [], items: { type: "string" } },
      },
      required: ["id", "type"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const id = requireString(input, "id");
        const res = await client.request("PUT", `/public/members/${encodeURIComponent(id)}`, {
          body: {
            type: input.type,
            externalId: input.externalId ?? null,
            collections: input.collections ?? [],
            groups: input.groups ?? [],
          },
        });
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeMemberRemoveTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_member_remove",
    description:
      "Remove a member from the organization (self-host). Highly destructive — the member loses access immediately.",
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
        const res = await client.request("DELETE", `/public/members/${encodeURIComponent(id)}`);
        return jsonResult({ status: res.status, deleted: id });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeMemberReinviteTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_member_reinvite",
    description:
      "Re-send an invitation email to a member whose invite has not been accepted (self-host). Destructive (sends an email).",
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
        const res = await client.request(
          "POST",
          `/public/members/${encodeURIComponent(id)}/reinvite`,
        );
        return jsonResult({ status: res.status, reinvited: id });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeMemberGetGroupsTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_member_get_groups",
    description: "List the group ids a member belongs to (self-host).",
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
        const res = await client.request(
          "GET",
          `/public/members/${encodeURIComponent(id)}/group-ids`,
        );
        return jsonResult(res.body ?? []);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeMemberSetGroupsTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_member_set_groups",
    description: "Replace the set of groups a member belongs to (self-host). Destructive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        groupIds: { type: "array", items: { type: "string" } },
      },
      required: ["id", "groupIds"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const id = requireString(input, "id");
        const groupIds = input.groupIds as string[];
        const res = await client.request(
          "PUT",
          `/public/members/${encodeURIComponent(id)}/group-ids`,
          { body: { groupIds } },
        );
        return jsonResult({ status: res.status, id, groupIds });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

// Helper: shape used by the PUT body — derived from the current member state
function buildUpdateBody(
  current: Record<string, unknown>,
  groupIds: string[],
  accessSecretsManager: boolean,
): Record<string, unknown> {
  return {
    type: current.type,
    externalId: current.externalId ?? null,
    collections: (current.collections as unknown[]) ?? [],
    groups: groupIds,
    accessSecretsManager,
    // Preserve any permissions / resetPasswordEnrolled flags that came back from GET
    ...(current.permissions !== undefined ? { permissions: current.permissions } : {}),
    ...(current.resetPasswordEnrolled !== undefined
      ? { resetPasswordEnrolled: current.resetPasswordEnrolled }
      : {}),
  };
}

async function setMemberSm(
  client: BitwardenHttpClient,
  id: string,
  enabled: boolean,
): Promise<{
  previous: boolean | undefined;
  current: boolean;
  member: unknown;
}> {
  const get = await client.request<Record<string, unknown>>(
    "GET",
    `/public/members/${encodeURIComponent(id)}`,
  );
  const current = get.body ?? {};
  const previousAccess = current.accessSecretsManager === true;
  if (previousAccess === enabled) {
    return { previous: previousAccess, current: enabled, member: current };
  }
  // Fetch current group ids since GET /public/members/{id} does NOT include them
  const groupsRes = await client.request<string[]>(
    "GET",
    `/public/members/${encodeURIComponent(id)}/group-ids`,
  );
  const groupIds = groupsRes.body ?? [];
  const put = await client.request("PUT", `/public/members/${encodeURIComponent(id)}`, {
    body: buildUpdateBody(current, groupIds, enabled),
  });
  return { previous: previousAccess, current: enabled, member: put.body };
}

export function makeMemberGrantSmTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_member_grant_sm",
    description:
      "Grant a member access to Secrets Manager (self-host). Wraps PUT /public/members/{id} with accessSecretsManager:true. Idempotent: if already granted, returns immediately without writing. Bitwarden will return a 400 if no SM seats are available — check bw_license_subscription_get first.",
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
        const result = await setMemberSm(client, id, true);
        return jsonResult({
          id,
          previousAccessSecretsManager: result.previous,
          currentAccessSecretsManager: result.current,
          changed: result.previous !== result.current,
          member: result.member,
        });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

export function makeMemberRevokeSmTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_member_revoke_sm",
    description:
      "Revoke a member's Secrets Manager access (self-host). Wraps PUT /public/members/{id} with accessSecretsManager:false. Idempotent: if already revoked, returns immediately without writing.",
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
        const result = await setMemberSm(client, id, false);
        return jsonResult({
          id,
          previousAccessSecretsManager: result.previous,
          currentAccessSecretsManager: result.current,
          changed: result.previous !== result.current,
          member: result.member,
        });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}
