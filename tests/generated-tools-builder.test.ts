import { describe, it, expect, vi } from "vitest";
import { buildGeneratedTools } from "../src/tools/generated/tools.js";
import type { OperationDef } from "../src/types.js";
import { textOf } from "./helpers.js";

const memberList: OperationDef = {
  operationId: "members_list",
  toolName: "bw_member_list_raw",
  method: "GET",
  path: "/public/members",
  summary: "List members",
  description: "",
  tags: [],
  parameters: [],
  isDestructive: false,
};
const memberGet: OperationDef = {
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

function client(handler: (m: string, p: string, opts?: any) => any) {
  return { request: vi.fn(async (m: string, p: string, opts?: any) => handler(m, p, opts)) };
}

describe("buildGeneratedTools", () => {
  it("creates one tool per operation", () => {
    const tools = buildGeneratedTools(client(() => ({})) as any, [memberList, memberGet], {
      maxItems: 10,
      maxPages: 5,
    });
    expect(tools.map((t) => t.name)).toEqual(["bw_member_list_raw", "bw_member_get_raw"]);
  });

  it("interpolates path parameters", async () => {
    const c = client((_m, p) => {
      expect(p).toBe("/public/members/abc");
      return { status: 200, headers: new Headers(), body: { id: "abc" } };
    });
    const tools = buildGeneratedTools(c as any, [memberGet], { maxItems: 10, maxPages: 5 });
    await tools[0]!.handler({ id: "abc" });
  });

  it("auto-paginates list endpoints", async () => {
    const pages = [{ data: [{ id: "1" }], continuationToken: "p2" }, { data: [{ id: "2" }] }];
    let i = 0;
    const c = client(() => ({ status: 200, headers: new Headers(), body: pages[i++] }));
    const tools = buildGeneratedTools(c as any, [memberList], { maxItems: 10, maxPages: 5 });
    const res = await tools[0]!.handler({});
    expect(textOf(res)).toContain('"items"');
    expect(c.request).toHaveBeenCalledTimes(2);
  });

  it("marks destructive operations with destructiveHint", () => {
    const op: OperationDef = {
      ...memberGet,
      method: "DELETE",
      isDestructive: true,
      toolName: "bw_member_delete_raw",
    };
    const tools = buildGeneratedTools(client(() => ({})) as any, [op], {
      maxItems: 10,
      maxPages: 5,
    });
    expect(tools[0]!.annotations.destructiveHint).toBe(true);
  });
});
