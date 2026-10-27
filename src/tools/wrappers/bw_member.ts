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
 * large factor and overruns LLM tool-call token budgets even for
 * organizations of modest size.
 *
 * Note: `accessSecretsManager` is intentionally NOT in this list. Bitwarden's
 * Public API neither returns it in GET responses nor applies it on POST/PUT
 * /public/members (the server keeps the stored value). Secrets Manager access
 * per user can only be read and changed in the web vault.
 */
const SLIM_MEMBER_FIELDS = ["id", "email", "name", "type", "status", "twoFactorEnabled"] as const;

const SM_NOT_SUPPORTED =
  "Secrets Manager access per member is not supported by the Bitwarden Public API: " +
  "accessSecretsManager is neither returned nor applied by /public/members. " +
  "Change it in the web vault / admin console (Members > member > Secrets Manager). Nothing was changed.";

type MemberInclude = "collections" | "groups" | "permissions" | "all";

/**
 * Custom role permission flags of the Public API (PermissionsModel in
 * bitwarden/server). Flags not given default to false on the server.
 * Further boolean flags are passed through for newer servers.
 */
const PERMISSION_FLAGS = [
  "accessEventLogs",
  "accessImportExport",
  "accessReports",
  "createNewCollections",
  "editAnyCollection",
  "deleteAnyCollection",
  "manageGroups",
  "managePolicies",
  "manageSso",
  "manageUsers",
  "manageResetPassword",
  "manageScim",
  "manageAccessRules",
  "manageRotation",
] as const;

const PERMISSIONS_SCHEMA = {
  type: "object",
  description:
    "Custom role permissions (type 4 only; the API rejects them for other roles). " +
    "Flags not given are false.",
  properties: Object.fromEntries(PERMISSION_FLAGS.map((f) => [f, { type: "boolean" }])),
  additionalProperties: { type: "boolean" },
};

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
      "Note: Secrets Manager access per member is not exposed by Bitwarden's Public API " +
      "(neither readable nor writable); use the web vault for it. " +
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
        const res = await client.request("GET", `/public/members/${pathId(id)}`);
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
      "Invite a new organization member (self-host). Sends an invitation email and creates an Invited member record. " +
      "For a Custom member (type 4) pass permissions. Destructive.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", format: "email" },
        type: {
          type: "integer",
          enum: [0, 1, 2, 4],
          description: "0 Owner, 1 Admin, 2 User, 4 Custom.",
        },
        externalId: { type: ["string", "null"], default: null },
        collections: { type: "array", default: [], items: { type: "object" } },
        groups: { type: "array", default: [], items: { type: "string" } },
        accessSecretsManager: {
          type: "boolean",
          default: false,
          description:
            "Not supported by the Bitwarden Public API: true is rejected. Grant Secrets Manager access in the web vault.",
        },
        permissions: PERMISSIONS_SCHEMA,
      },
      required: ["email", "type"],
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        if (input.accessSecretsManager === true) throw new Error(SM_NOT_SUPPORTED);
        const res = await client.request("POST", "/public/members", {
          body: {
            email: requireString(input, "email"),
            type: input.type,
            externalId: input.externalId ?? null,
            collections: input.collections ?? [],
            groups: input.groups ?? [],
            ...("permissions" in input ? { permissions: input.permissions } : {}),
          },
        });
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

const MEMBER_CUSTOM_TYPE = 4;

function collectionAccess(entries: unknown): unknown[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((c: Record<string, unknown>) => ({
    id: c.id,
    readOnly: c.readOnly,
    hidePasswords: c.hidePasswords,
    manage: c.manage,
  }));
}

/**
 * PUT /public/members/{id} resets externalId, direct collection access and
 * custom permissions to whatever the body carries, but keeps group
 * memberships when `groups` is absent. So: omit groups unless given, and
 * fill the other omitted fields from the current member (GET) instead of
 * sending null / [].
 */
async function planMemberUpdate(
  client: BitwardenHttpClient,
  input: Record<string, unknown>,
): Promise<PlannedRequest> {
  const id = requireString(input, "id");
  const path = `/public/members/${pathId(id)}`;
  const type = input.type;
  const needsCurrent =
    !("externalId" in input) || !("collections" in input) || type === MEMBER_CUSTOM_TYPE;
  const current = needsCurrent
    ? ((await client.request<Record<string, unknown>>("GET", path)).body ?? {})
    : {};
  const body: Record<string, unknown> = {
    type,
    externalId: "externalId" in input ? input.externalId : (current.externalId ?? null),
    collections: "collections" in input ? input.collections : collectionAccess(current.collections),
  };
  const notes: string[] = [];
  if (!("externalId" in input)) notes.push("externalId kept from the current member.");
  if (!("collections" in input)) notes.push("collections kept from the current member.");
  if (type === MEMBER_CUSTOM_TYPE && current.type === MEMBER_CUSTOM_TYPE && current.permissions) {
    body.permissions = current.permissions;
    notes.push("custom permissions kept from the current member.");
  }
  if ("groups" in input) body.groups = input.groups;
  else notes.push("groups not sent, so group memberships stay unchanged.");
  if ("email" in input) body.email = input.email;
  if ("name" in input) body.name = input.name;
  return { method: "PUT", path, body, notes };
}

export function makeMemberUpdateTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_member_update",
    description:
      "Update an organization member's role and access (self-host). Omitted optional fields keep " +
      "their current value (externalId and collections are read from the member first; groups are " +
      "left unchanged; email and name are only sent when given). Passing collections or groups " +
      "replaces that whole list. Destructive.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        type: {
          type: "integer",
          enum: [0, 1, 2, 4],
          description: "0 Owner, 1 Admin, 2 User, 4 Custom.",
        },
        externalId: { type: ["string", "null"] },
        collections: { type: "array", items: { type: "object" } },
        groups: { type: "array", items: { type: "string" } },
        email: {
          type: "string",
          format: "email",
          description:
            "New email address. The API only accepts it for a claimed member without a master " +
            "password, on a domain the organization has verified. Omitted: unchanged.",
        },
        name: {
          type: "string",
          description:
            "New name. The API only accepts it for a claimed member. Omitted: unchanged.",
        },
      },
      required: ["id", "type"],
      additionalProperties: false,
    },
    annotations: destructive,
    plan: (input) => planMemberUpdate(client, input),
    handler: async (input) => {
      try {
        const plan = await planMemberUpdate(client, input);
        const res = await client.request(plan.method, plan.path, { body: plan.body });
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
      "Remove a member from the organization (self-host). Highly destructive - the member loses access immediately.",
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
        const res = await client.request("DELETE", `/public/members/${pathId(id)}`);
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
        const res = await client.request("POST", `/public/members/${pathId(id)}/reinvite`);
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
        const res = await client.request("GET", `/public/members/${pathId(id)}/group-ids`);
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
        const res = await client.request("PUT", `/public/members/${pathId(id)}/group-ids`, {
          body: { groupIds },
        });
        return jsonResult({ status: res.status, id, groupIds });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}

function smUnsupportedTool(name: string, description: string): ToolDef {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: destructive,
    plan: async () => {
      throw new Error(SM_NOT_SUPPORTED);
    },
    handler: async () => asToolError(new Error(SM_NOT_SUPPORTED)),
  };
}

export function makeMemberGrantSmTool(_client: BitwardenHttpClient): ToolDef {
  return smUnsupportedTool(
    "bw_member_grant_sm",
    "Not supported: always returns an error. Bitwarden's Public API cannot grant Secrets Manager " +
      "access to a member; use the web vault / admin console. Kept registered for compatibility.",
  );
}

export function makeMemberRevokeSmTool(_client: BitwardenHttpClient): ToolDef {
  return smUnsupportedTool(
    "bw_member_revoke_sm",
    "Not supported: always returns an error. Bitwarden's Public API cannot revoke Secrets Manager " +
      "access of a member; use the web vault / admin console. Kept registered for compatibility.",
  );
}
