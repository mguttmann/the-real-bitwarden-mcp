import { describe, it, expect, vi } from "vitest";
import {
  makeMemberListTool,
  makeMemberGetTool,
  makeMemberInviteTool,
  makeMemberUpdateTool,
  makeMemberRemoveTool,
  makeMemberReinviteTool,
  makeMemberGetGroupsTool,
  makeMemberSetGroupsTool,
  makeMemberGrantSmTool,
  makeMemberRevokeSmTool,
} from "../../src/tools/wrappers/bw_member.js";
import { withConfirmGuard } from "../../src/tools/confirm.js";
import { fakeApi, textOf } from "../helpers.js";

function stubClient(handler: (m: string, p: string, opts?: any) => any) {
  return { request: vi.fn(async (m: string, p: string, opts?: any) => handler(m, p, opts)) };
}

const limits = { maxItems: 100, maxPages: 5 };

// Helper: build a mock member with all fields Bitwarden returns
function makeMockMember(i: number) {
  return {
    id: `member-id-${i}`,
    email: `user${i}@example.com`,
    name: `User ${i}`,
    type: 2,
    status: 2,
    twoFactorEnabled: false,
    accessSecretsManager: false,
    userId: `user-uuid-${i}`,
    externalId: null,
    resetPasswordEnrolled: false,
    ssoExternalId: null,
    collections: Array.from({ length: 5 }, (_, j) => ({
      id: `col-${j}`,
      readOnly: false,
      hidePasswords: false,
      manage: false,
    })),
    groups: Array.from({ length: 3 }, (_, j) => ({ id: `grp-${j}` })),
  };
}

describe("bw_member_list", () => {
  it("auto-paginates and returns flat list", async () => {
    const pages = [{ data: [{ id: "a" }], continuationToken: "p2" }, { data: [{ id: "b" }] }];
    let i = 0;
    const client = stubClient(() => ({ status: 200, headers: new Headers(), body: pages[i++] }));
    const tool = makeMemberListTool(client as any, limits);
    const res = await tool.handler({});
    const data = JSON.parse(textOf(res));
    expect(data.members.map((m: any) => m.id)).toEqual(["a", "b"]);
    expect(client.request).toHaveBeenCalledTimes(2);
  });

  it("applies email_contains filter case-insensitively", async () => {
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: {
        data: [
          { id: "1", email: "Alice@Co" },
          { id: "2", email: "bob@co" },
        ],
      },
    }));
    const tool = makeMemberListTool(client as any, limits);
    const res = await tool.handler({ email_contains: "ALICE" });
    const data = JSON.parse(textOf(res));
    expect(data.members).toHaveLength(1);
    expect(data.members[0].email).toBe("Alice@Co");
  });

  it("slim default projection omits collections/groups/userId/externalId and keeps < 40 KB for 250 members", async () => {
    const bigLimits = { maxItems: 1000, maxPages: 5 };
    const allMembers = Array.from({ length: 250 }, (_, i) => makeMockMember(i));
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: { data: allMembers },
    }));
    const tool = makeMemberListTool(client as any, bigLimits);
    const res = await tool.handler({});
    const data = JSON.parse(textOf(res));

    expect(data.members).toHaveLength(250);
    // Nested fields must NOT be present in the slim projection
    expect(data.members[0].collections).toBeUndefined();
    expect(data.members[0].groups).toBeUndefined();
    expect(data.members[0].userId).toBeUndefined();
    expect(data.members[0].externalId).toBeUndefined();
    expect(data.members[0].resetPasswordEnrolled).toBeUndefined();
    // Slim fields must be present
    expect(data.members[0].id).toBeDefined();
    expect(data.members[0].email).toBeDefined();
    expect(data.members[0].name).toBeDefined();

    // The compact JSON payload (as an LLM token-budget would measure it) must be < 40 KB.
    // We measure the parsed data re-serialized compactly, not the pretty-printed wire format.
    const compactBytes = JSON.stringify(data).length;
    expect(compactBytes).toBeLessThan(40 * 1024);

    // Additionally verify that the slim response is at least 3× smaller than the full
    // (collections[5] + groups[3] + extra fields inflate the full by ~4-5x).
    const fullCompact = JSON.stringify({
      members: allMembers,
      truncated: false,
      continuationToken: null,
    }).length;
    expect(compactBytes * 3).toBeLessThan(fullCompact);
  });

  it("include: ['collections','groups'] restores nested fields", async () => {
    const allMembers = Array.from({ length: 5 }, (_, i) => makeMockMember(i));
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: { data: allMembers },
    }));
    const tool = makeMemberListTool(client as any, limits);
    const res = await tool.handler({ include: ["collections", "groups"] });
    const data = JSON.parse(textOf(res));

    expect(data.members[0].collections).toBeDefined();
    expect(data.members[0].groups).toBeDefined();
    expect(data.members[0].collections).toHaveLength(5);
    expect(data.members[0].groups).toHaveLength(3);
  });

  it("include: ['all'] returns unmodified full response", async () => {
    const allMembers = Array.from({ length: 3 }, (_, i) => makeMockMember(i));
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: { data: allMembers },
    }));
    const tool = makeMemberListTool(client as any, limits);
    const res = await tool.handler({ include: ["all"] });
    const data = JSON.parse(textOf(res));

    // Full projection includes everything
    expect(data.members[0].userId).toBeDefined();
    expect(data.members[0].externalId).toBeDefined();
    expect(data.members[0].collections).toBeDefined();
    expect(data.members[0].groups).toBeDefined();
  });

  it("sets note field when response exceeds maxResponseBytes threshold", async () => {
    // Use a very low limit to trigger the oversize note
    const tinyLimit = 100;
    const allMembers = Array.from({ length: 10 }, (_, i) => makeMockMember(i));
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: { data: allMembers },
    }));
    const tool = makeMemberListTool(client as any, limits, tinyLimit);
    const res = await tool.handler({});
    const data = JSON.parse(textOf(res));

    expect(data.note).toBeDefined();
    expect(typeof data.note).toBe("string");
    expect(data.note).toMatch(/KB/);
    // Members are still present - we never truncate silently
    expect(data.members).toHaveLength(10);
  });

  it("note message differs when explicit include triggers oversize", async () => {
    const tinyLimit = 100;
    const allMembers = Array.from({ length: 5 }, (_, i) => makeMockMember(i));
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: { data: allMembers },
    }));
    const tool = makeMemberListTool(client as any, limits, tinyLimit);
    const defaultRes = await tool.handler({});
    const includeRes = await tool.handler({ include: ["all"] });

    const defaultData = JSON.parse(textOf(defaultRes));
    const includeData = JSON.parse(textOf(includeRes));

    // Both should have a note, but the messages should differ
    expect(defaultData.note).toMatch(/slim default projection/);
    expect(includeData.note).toMatch(/explicit include was requested/);
  });
});

describe("bw_member_get", () => {
  it("GETs /public/members/{id}", async () => {
    const client = stubClient((_m, p) => {
      expect(p).toBe("/public/members/abc");
      return { status: 200, headers: new Headers(), body: { id: "abc", email: "x@y.z" } };
    });
    const tool = makeMemberGetTool(client as any);
    const res = await tool.handler({ id: "abc" });
    expect(textOf(res)).toContain("abc");
  });

  it("errors when id missing", async () => {
    const tool = makeMemberGetTool(stubClient(() => ({})) as any);
    const res = await tool.handler({});
    expect(res.isError).toBe(true);
  });
});

describe("bw_member_invite", () => {
  it("POSTs the expected body", async () => {
    const client = stubClient((m, p, o) => {
      expect(m).toBe("POST");
      expect(p).toBe("/public/members");
      expect(o.body).toEqual({
        email: "x@y.z",
        type: 2,
        externalId: null,
        collections: [],
        groups: [],
      });
      return { status: 200, headers: new Headers(), body: { id: "new" } };
    });
    const tool = makeMemberInviteTool(client as any);
    const res = await tool.handler({ email: "x@y.z", type: 2 });
    expect(textOf(res)).toContain("new");
  });

  it("marks tool destructive", () => {
    const tool = makeMemberInviteTool(stubClient(() => ({})) as any);
    expect(tool.annotations.destructiveHint).toBe(true);
  });
});

describe("bw_member_update / remove / reinvite", () => {
  it("update PUTs /public/members/{id}", async () => {
    const client = stubClient((m, p) => {
      expect(m).toBe("PUT");
      expect(p).toBe("/public/members/abc");
      return { status: 200, headers: new Headers(), body: { id: "abc" } };
    });
    const tool = makeMemberUpdateTool(client as any);
    await tool.handler({ id: "abc", type: 3, externalId: null, collections: [], groups: [] });
    expect(client.request).toHaveBeenCalled();
  });
  it("remove DELETEs", async () => {
    const client = stubClient((m, p) => {
      expect(m).toBe("DELETE");
      expect(p).toBe("/public/members/abc");
      return { status: 200, headers: new Headers(), body: undefined };
    });
    const tool = makeMemberRemoveTool(client as any);
    await tool.handler({ id: "abc" });
    expect(client.request).toHaveBeenCalled();
  });
  it("reinvite POSTs to /reinvite", async () => {
    const client = stubClient((m, p) => {
      expect(m).toBe("POST");
      expect(p).toBe("/public/members/abc/reinvite");
      return { status: 200, headers: new Headers(), body: undefined };
    });
    const tool = makeMemberReinviteTool(client as any);
    await tool.handler({ id: "abc" });
    expect(client.request).toHaveBeenCalled();
  });
});

describe("bw_member_get_groups / set_groups", () => {
  it("get_groups GETs the group-ids endpoint", async () => {
    const client = stubClient((m, p) => {
      expect(m).toBe("GET");
      expect(p).toBe("/public/members/abc/group-ids");
      return { status: 200, headers: new Headers(), body: ["g1", "g2"] };
    });
    const tool = makeMemberGetGroupsTool(client as any);
    const res = await tool.handler({ id: "abc" });
    expect(textOf(res)).toContain("g1");
  });
  it("set_groups PUTs an array body", async () => {
    const client = stubClient((m, p, o) => {
      expect(m).toBe("PUT");
      expect(p).toBe("/public/members/abc/group-ids");
      expect(o.body).toEqual({ groupIds: ["g1", "g2"] });
      return { status: 200, headers: new Headers(), body: undefined };
    });
    const tool = makeMemberSetGroupsTool(client as any);
    await tool.handler({ id: "abc", groupIds: ["g1", "g2"] });
    expect(client.request).toHaveBeenCalled();
  });
});

describe("bw_member_grant_sm / revoke_sm", () => {
  // The Public API neither returns nor applies accessSecretsManager, so these
  // tools must fail explicitly instead of reporting a change that never happens.
  for (const [name, make] of [
    ["bw_member_grant_sm", makeMemberGrantSmTool],
    ["bw_member_revoke_sm", makeMemberRevokeSmTool],
  ] as const) {
    it(`${name}: returns isError and sends no request`, async () => {
      const { client, calls } = fakeApi({
        "GET /public/members/abc": { id: "abc", type: 2, externalId: null, collections: [] },
        "GET /public/members/abc/group-ids": [],
        "PUT /public/members/abc": { id: "abc", type: 2 },
      });
      const res = await make(client).handler({ id: "abc" });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/not supported by the Bitwarden Public API/);
      expect(textOf(res)).toMatch(/web vault/);
      expect(calls).toEqual([]);
    });
  }

  it("both are destructive", () => {
    const stub = { request: vi.fn() };
    expect(makeMemberGrantSmTool(stub as any).annotations.destructiveHint).toBe(true);
    expect(makeMemberRevokeSmTool(stub as any).annotations.destructiveHint).toBe(true);
  });
});

describe("bw_member_invite accessSecretsManager", () => {
  it("rejects accessSecretsManager:true instead of inviting without it", async () => {
    const { client, calls } = fakeApi({ "POST /public/members": { id: "new" } });
    const res = await makeMemberInviteTool(client).handler({
      email: "x@y.z",
      type: 2,
      accessSecretsManager: true,
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/web vault/);
    expect(calls).toEqual([]);
  });
});

describe("bw_member_update keeps state for omitted fields", () => {
  const current = {
    id: "m1",
    type: 2,
    externalId: "ext-1",
    email: "x@y.z",
    collections: [{ id: "c1", readOnly: true, hidePasswords: false, manage: false }],
  };

  it("{id, type} only: carries externalId and collections from GET, omits groups", async () => {
    const { client, calls } = fakeApi({
      "GET /public/members/m1": current,
      "PUT /public/members/m1": { id: "m1", type: 1 },
    });
    const res = await makeMemberUpdateTool(client).handler({ id: "m1", type: 1 });
    expect(res.isError).toBeFalsy();
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({
      type: 1,
      externalId: "ext-1",
      collections: [{ id: "c1", readOnly: true, hidePasswords: false, manage: false }],
    });
  });

  it("sends groups, externalId and collections exactly as given, without a GET", async () => {
    const { client, calls } = fakeApi({ "PUT /public/members/m1": { id: "m1" } });
    await makeMemberUpdateTool(client).handler({
      id: "m1",
      type: 2,
      externalId: null,
      collections: [],
      groups: ["g1"],
    });
    expect(calls).toEqual([
      {
        method: "PUT",
        path: "/public/members/m1",
        body: { type: 2, externalId: null, collections: [], groups: ["g1"] },
      },
    ]);
  });

  it("Custom member: keeps current custom permissions", async () => {
    const permissions = { accessEventLogs: true, manageGroups: true };
    const { client, calls } = fakeApi({
      "GET /public/members/m1": { ...current, type: 4, permissions },
      "PUT /public/members/m1": { id: "m1" },
    });
    await makeMemberUpdateTool(client).handler({ id: "m1", type: 4 });
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toMatchObject({ type: 4, permissions });
  });

  it("role change away from Custom: does not send permissions (API rejects them)", async () => {
    const { client, calls } = fakeApi({
      "GET /public/members/m1": { ...current, type: 4, permissions: { manageGroups: true } },
      "PUT /public/members/m1": { id: "m1" },
    });
    await makeMemberUpdateTool(client).handler({ id: "m1", type: 1 });
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).not.toHaveProperty("permissions");
  });

  it("confirm preview shows the effective request and does not write", async () => {
    const { client, calls } = fakeApi({ "GET /public/members/m1": current });
    const guarded = withConfirmGuard(makeMemberUpdateTool(client), true);
    const res = await guarded.handler({ id: "m1", type: 1 });
    expect(res.isError).toBeFalsy();
    const text = textOf(res);
    expect(text).toContain("PUT /public/members/m1");
    expect(text).toContain('"externalId": "ext-1"');
    expect(text).toMatch(/groups.*not sent/i);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("schema no longer advertises [] / null defaults for the optional fields", () => {
    const props = (makeMemberUpdateTool(fakeApi({}).client).inputSchema as any).properties;
    for (const k of ["externalId", "collections", "groups"]) {
      expect(props[k]).not.toHaveProperty("default");
    }
  });
});

describe("bw_member type enum", () => {
  it("invite and update do not offer the removed member type 3", () => {
    for (const tool of [
      makeMemberInviteTool(stubClient(() => ({})) as any),
      makeMemberUpdateTool(stubClient(() => ({})) as any),
    ]) {
      const type = (tool.inputSchema.properties as Record<string, { enum: number[] }>).type!;
      expect(type.enum).toEqual([0, 1, 2, 4]);
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/3 Manager/);
    }
  });
});
