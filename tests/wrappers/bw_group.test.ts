import { describe, it, expect, vi } from "vitest";
import {
  makeGroupListTool,
  makeGroupGetTool,
  makeGroupCreateTool,
  makeGroupUpdateTool,
  makeGroupDeleteTool,
  makeGroupGetMembersTool,
  makeGroupSetMembersTool,
} from "../../src/tools/wrappers/bw_group.js";

function stubClient(handler: (m: string, p: string, opts?: any) => any) {
  return { request: vi.fn(async (m: string, p: string, opts?: any) => handler(m, p, opts)) };
}
const limits = { maxItems: 100, maxPages: 5 };

describe("bw_group_*", () => {
  it("list paginates", async () => {
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: { data: [{ id: "g1", name: "Engineers" }] },
    }));
    const res = await makeGroupListTool(client as any, limits).handler({});
    expect(res.content[0]!.text).toContain("Engineers");
  });

  it("slim default projection omits collections but keeps id/name/externalId", async () => {
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: {
        data: [
          {
            id: "g1",
            name: "Eng",
            externalId: "ext-g1",
            accessAll: false,
            collections: [{ id: "c1" }],
          },
        ],
      },
    }));
    const res = await makeGroupListTool(client as any, limits).handler({});
    const data = JSON.parse(res.content[0]!.text as string);
    expect(data.groups[0].id).toBe("g1");
    expect(data.groups[0].name).toBe("Eng");
    expect(data.groups[0].externalId).toBe("ext-g1");
    expect(data.groups[0].collections).toBeUndefined();
    expect(data.groups[0].accessAll).toBeUndefined();
  });

  it("include: ['collections'] restores nested collections", async () => {
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: { data: [{ id: "g1", name: "Eng", externalId: null, collections: [{ id: "c1" }] }] },
    }));
    const res = await makeGroupListTool(client as any, limits).handler({
      include: ["collections"],
    });
    const data = JSON.parse(res.content[0]!.text as string);
    expect(data.groups[0].collections).toBeDefined();
    expect(data.groups[0].collections).toHaveLength(1);
  });

  it("create posts the full payload", async () => {
    const client = stubClient((m, p, o) => {
      expect(m).toBe("POST");
      expect(p).toBe("/public/groups");
      expect(o.body).toEqual({
        name: "Eng",
        accessAll: false,
        externalId: null,
        collections: [],
      });
      return { status: 200, headers: new Headers(), body: { id: "new" } };
    });
    await makeGroupCreateTool(client as any).handler({ name: "Eng" });
    expect(client.request).toHaveBeenCalled();
  });

  it("update PUTs", async () => {
    const client = stubClient((m, p) => {
      expect(m).toBe("PUT");
      expect(p).toBe("/public/groups/g1");
      return { status: 200, headers: new Headers(), body: {} };
    });
    await makeGroupUpdateTool(client as any).handler({ id: "g1", name: "Eng2" });
    expect(client.request).toHaveBeenCalled();
  });

  it("delete DELETEs", async () => {
    const client = stubClient((m) => ({
      status: m === "DELETE" ? 200 : 0,
      headers: new Headers(),
      body: undefined,
    }));
    const res = await makeGroupDeleteTool(client as any).handler({ id: "g1" });
    expect(res.content[0]!.text).toContain("deleted");
  });

  it("get_members returns array, set_members PUTs memberIds", async () => {
    const getClient = stubClient((m, p) => {
      expect(m).toBe("GET");
      expect(p).toBe("/public/groups/g1/member-ids");
      return { status: 200, headers: new Headers(), body: ["m1"] };
    });
    await makeGroupGetMembersTool(getClient as any).handler({ id: "g1" });
    const setClient = stubClient((m, p, o) => {
      expect(m).toBe("PUT");
      expect(p).toBe("/public/groups/g1/member-ids");
      expect(o.body).toEqual({ memberIds: ["m1", "m2"] });
      return { status: 200, headers: new Headers(), body: undefined };
    });
    await makeGroupSetMembersTool(setClient as any).handler({ id: "g1", memberIds: ["m1", "m2"] });
  });

  it("get returns body", async () => {
    const client = stubClient(() => ({ status: 200, headers: new Headers(), body: { id: "g1" } }));
    const res = await makeGroupGetTool(client as any).handler({ id: "g1" });
    expect(res.content[0]!.text).toContain("g1");
  });
});
