import type { ToolDef } from "../../types.js";
import type { BitwardenHttpClient } from "../../http/bitwarden-http-client.js";
import { asToolError, jsonResult } from "../_error.js";
import { destructive } from "./_helpers.js";

export function makeOrgImportTool(client: BitwardenHttpClient): ToolDef {
  return {
    name: "bw_org_import",
    description:
      "Bulk import groups and members into the organization (self-host). HIGHLY destructive - overwriteExisting may remove members not present in the payload. Always preview first.",
    inputSchema: {
      type: "object",
      properties: {
        groups: {
          type: "array",
          default: [],
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              externalId: { type: "string" },
              memberExternalIds: { type: "array", items: { type: "string" }, default: [] },
            },
            required: ["name", "externalId"],
            additionalProperties: false,
          },
        },
        members: {
          type: "array",
          default: [],
          items: {
            type: "object",
            properties: {
              email: {
                type: "string",
                format: "email",
                description: "Required unless deleted is true.",
              },
              externalId: { type: "string" },
              deleted: { type: "boolean", default: false },
            },
            required: ["externalId"],
            additionalProperties: false,
          },
        },
        overwriteExisting: { type: "boolean", default: false },
        largeImport: { type: "boolean", default: false },
        inviteUsersAfterProvisioning: {
          type: "boolean",
          description:
            "false: new members are created as Staged without an invitation email. " +
            "Omitted: the API default (invite).",
        },
      },
      additionalProperties: false,
    },
    annotations: destructive,
    handler: async (input) => {
      try {
        const res = await client.request("POST", "/public/organization/import", {
          body: {
            groups: input.groups ?? [],
            members: input.members ?? [],
            overwriteExisting: input.overwriteExisting ?? false,
            largeImport: input.largeImport ?? false,
            ...("inviteUsersAfterProvisioning" in input
              ? { inviteUsersAfterProvisioning: input.inviteUsersAfterProvisioning }
              : {}),
          },
        });
        return jsonResult(res.body ?? null);
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}
