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
    const data = JSON.parse(res.content[0]!.text as string);
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
    const data = JSON.parse(res.content[0]!.text as string);
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
    const data = JSON.parse(res.content[0]!.text as string);

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
    // (collections[5] + groups[3] + extra fields inflate the full by ~4–5×).
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
    const data = JSON.parse(res.content[0]!.text as string);

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
    const data = JSON.parse(res.content[0]!.text as string);

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
    const data = JSON.parse(res.content[0]!.text as string);

    expect(data.note).toBeDefined();
    expect(typeof data.note).toBe("string");
    expect(data.note).toMatch(/KB/);
    // Members are still present — we never truncate silently
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

    const defaultData = JSON.parse(defaultRes.content[0]!.text as string);
    const includeData = JSON.parse(includeRes.content[0]!.text as string);

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
    expect(res.content[0]!.text).toContain("abc");
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
        accessSecretsManager: false,
      });
      return { status: 200, headers: new Headers(), body: { id: "new" } };
    });
    const tool = makeMemberInviteTool(client as any);
    const res = await tool.handler({ email: "x@y.z", type: 2 });
    expect(res.content[0]!.text).toContain("new");
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
    expect(res.content[0]!.text).toContain("g1");
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
  it("grant: GETs member + group-ids, then PUTs with accessSecretsManager:true", async () => {
    const calls: Array<{ m: string; p: string; body?: any }> = [];
    const client = {
      request: vi.fn(async (m: string, p: string, opts?: any) => {
        calls.push({ m, p, body: opts?.body });
        if (m === "GET" && p === "/public/members/abc") {
          return {
            status: 200,
            headers: new Headers(),
            body: {
              id: "abc",
              type: 2,
              externalId: null,
              collections: [],
              accessSecretsManager: false,
            },
          };
        }
        if (m === "GET" && p === "/public/members/abc/group-ids") {
          return { status: 200, headers: new Headers(), body: ["g1"] };
        }
        if (m === "PUT" && p === "/public/members/abc") {
          return {
            status: 200,
            headers: new Headers(),
            body: { id: "abc", accessSecretsManager: true },
          };
        }
        throw new Error(`unexpected ${m} ${p}`);
      }),
    };
    const res = await makeMemberGrantSmTool(client as any).handler({ id: "abc" });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(res.content[0]!.text as string);
    expect(data.previousAccessSecretsManager).toBe(false);
    expect(data.currentAccessSecretsManager).toBe(true);
    expect(data.changed).toBe(true);
    // PUT body should include accessSecretsManager:true and the preserved fields
    const putCall = calls.find((c) => c.m === "PUT");
    expect(putCall!.body.accessSecretsManager).toBe(true);
    expect(putCall!.body.type).toBe(2);
    expect(putCall!.body.groups).toEqual(["g1"]);
  });

  it("grant: idempotent — does not PUT when already granted", async () => {
    const client = {
      request: vi.fn(async (m: string, p: string) => {
        if (m === "GET" && p === "/public/members/abc") {
          return {
            status: 200,
            headers: new Headers(),
            body: { id: "abc", type: 2, accessSecretsManager: true },
          };
        }
        throw new Error(`should not be called: ${m} ${p}`);
      }),
    };
    const res = await makeMemberGrantSmTool(client as any).handler({ id: "abc" });
    const data = JSON.parse(res.content[0]!.text as string);
    expect(data.changed).toBe(false);
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("revoke: PUTs accessSecretsManager:false", async () => {
    const client = {
      request: vi.fn(async (m: string, p: string, opts?: any) => {
        if (m === "GET" && p === "/public/members/abc") {
          return {
            status: 200,
            headers: new Headers(),
            body: { id: "abc", type: 2, accessSecretsManager: true, collections: [] },
          };
        }
        if (m === "GET" && p === "/public/members/abc/group-ids") {
          return { status: 200, headers: new Headers(), body: [] };
        }
        if (m === "PUT" && p === "/public/members/abc") {
          expect(opts.body.accessSecretsManager).toBe(false);
          return {
            status: 200,
            headers: new Headers(),
            body: { id: "abc", accessSecretsManager: false },
          };
        }
        throw new Error("unexpected");
      }),
    };
    const res = await makeMemberRevokeSmTool(client as any).handler({ id: "abc" });
    expect(res.isError).toBeFalsy();
  });

  it("both are destructive", () => {
    const stub = { request: vi.fn() };
    expect(makeMemberGrantSmTool(stub as any).annotations.destructiveHint).toBe(true);
    expect(makeMemberRevokeSmTool(stub as any).annotations.destructiveHint).toBe(true);
  });
});
