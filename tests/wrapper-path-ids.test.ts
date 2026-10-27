import { describe, it, expect, vi } from "vitest";
import {
  makeMemberGetTool,
  makeMemberUpdateTool,
  makeMemberRemoveTool,
  makeMemberReinviteTool,
  makeMemberGetGroupsTool,
  makeMemberSetGroupsTool,
} from "../src/tools/wrappers/bw_member.js";
import {
  makeGroupGetTool,
  makeGroupUpdateTool,
  makeGroupDeleteTool,
  makeGroupGetMembersTool,
  makeGroupSetMembersTool,
} from "../src/tools/wrappers/bw_group.js";
import {
  makeCollectionGetTool,
  makeCollectionUpdateTool,
  makeCollectionDeleteTool,
} from "../src/tools/wrappers/bw_collection.js";
import { buildGeneratedTools } from "../src/tools/generated/tools.js";
import type { OperationDef, ToolDef } from "../src/types.js";
import { fakeApi, textOf } from "./helpers.js";

// Audit case dot-segment-ids: encodeURIComponent leaves "." and "..", so an
// id like ".." retargeted e.g. GET /public/members/{id} to /public/.
const BAD_IDS = [".", "..", "%2e", "%2E%2e", ".%2E", "a/b", "a%2fb", "a%2Fb", "a\\b", "a%5cb"];

const FACTORIES: [string, (c: never) => ToolDef][] = [
  ["bw_member_get", makeMemberGetTool],
  ["bw_member_update", makeMemberUpdateTool],
  ["bw_member_remove", makeMemberRemoveTool],
  ["bw_member_reinvite", makeMemberReinviteTool],
  ["bw_member_get_groups", makeMemberGetGroupsTool],
  ["bw_member_set_groups", makeMemberSetGroupsTool],
  ["bw_group_get", makeGroupGetTool],
  ["bw_group_update", makeGroupUpdateTool],
  ["bw_group_delete", makeGroupDeleteTool],
  ["bw_group_get_members", makeGroupGetMembersTool],
  ["bw_group_set_members", makeGroupSetMembersTool],
  ["bw_collection_get", makeCollectionGetTool],
  ["bw_collection_update", makeCollectionUpdateTool],
  ["bw_collection_delete", makeCollectionDeleteTool],
];

const OTHER_INPUT = { type: 2, name: "n", groupIds: [], memberIds: [] };

describe("ids interpolated into wrapper paths", () => {
  for (const [name, make] of FACTORIES) {
    it(`${name} rejects dot-segment and separator ids without a request`, async () => {
      for (const id of BAD_IDS) {
        const { client, calls } = fakeApi({});
        const tool = make(client);
        const res = await tool.handler({ ...OTHER_INPUT, id });
        expect(res.isError, `${name} id=${id}`).toBe(true);
        expect(textOf(res)).toMatch(/dot segment|separator/);
        if (tool.plan) await expect(tool.plan({ ...OTHER_INPUT, id })).rejects.toThrow();
        expect(calls, `${name} id=${id}`).toEqual([]);
      }
    });
  }

  it("keeps ordinary ids working", async () => {
    const { client, calls } = fakeApi({
      "GET /public/members/0b2c7c5e-0000-4000-8000-000000000001": { id: "x" },
    });
    const res = await makeMemberGetTool(client).handler({
      id: "0b2c7c5e-0000-4000-8000-000000000001",
    });
    expect(res.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("generated tools reject dot-segment path parameters", async () => {
    const op: OperationDef = {
      operationId: "members_get",
      toolName: "bw_member_get_raw",
      method: "GET",
      path: "/public/members/{id}",
      summary: "Get member",
      description: "",
      tags: [],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      isDestructive: false,
    };
    const request = vi.fn();
    const [tool] = buildGeneratedTools({ request } as never, [op], { maxItems: 10, maxPages: 5 });
    for (const id of BAD_IDS) {
      const res = await tool!.handler({ id });
      expect(res.isError).toBe(true);
    }
    expect(request).not.toHaveBeenCalled();
  });
});
