import { describe, it, expect, vi } from "vitest";
import {
  makeCollectionListTool,
  makeCollectionGetTool,
  makeCollectionUpdateTool,
  makeCollectionDeleteTool,
} from "../../src/tools/wrappers/bw_collection.js";

function stubClient(handler: (m: string, p: string, opts?: any) => any) {
  return { request: vi.fn(async (m: string, p: string, opts?: any) => handler(m, p, opts)) };
}
const limits = { maxItems: 100, maxPages: 5 };

describe("bw_collection_*", () => {
  it("list paginates", async () => {
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: { data: [{ id: "c1", externalId: null, groups: [], users: [] }] },
    }));
    const res = await makeCollectionListTool(client as any, limits).handler({});
    expect(res.content[0]!.text).toContain("c1");
  });

  it("slim default projection omits groups and users", async () => {
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: {
        data: [{ id: "c1", externalId: "ext-1", groups: [{ id: "g1" }], users: [{ id: "u1" }] }],
      },
    }));
    const res = await makeCollectionListTool(client as any, limits).handler({});
    const data = JSON.parse(res.content[0]!.text as string);
    expect(data.collections[0].id).toBe("c1");
    expect(data.collections[0].externalId).toBe("ext-1");
    expect(data.collections[0].groups).toBeUndefined();
    expect(data.collections[0].users).toBeUndefined();
  });

  it("include: ['groups','users'] restores nested fields", async () => {
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: {
        data: [{ id: "c1", externalId: null, groups: [{ id: "g1" }], users: [{ id: "u1" }] }],
      },
    }));
    const res = await makeCollectionListTool(client as any, limits).handler({
      include: ["groups", "users"],
    });
    const data = JSON.parse(res.content[0]!.text as string);
    expect(data.collections[0].groups).toBeDefined();
    expect(data.collections[0].users).toBeDefined();
  });

  it("get fetches by id", async () => {
    const client = stubClient((m, p) => {
      expect(m).toBe("GET");
      expect(p).toBe("/public/collections/c1");
      return { status: 200, headers: new Headers(), body: { id: "c1" } };
    });
    await makeCollectionGetTool(client as any).handler({ id: "c1" });
    expect(client.request).toHaveBeenCalled();
  });

  it("update PUTs groups/users access body", async () => {
    const client = stubClient((m, p, o) => {
      expect(m).toBe("PUT");
      expect(p).toBe("/public/collections/c1");
      expect(o.body).toEqual({
        externalId: "ext-1",
        groups: [{ id: "g1", readOnly: false, hidePasswords: false, manage: true }],
        users: [{ id: "u1", readOnly: true, hidePasswords: false, manage: false }],
      });
      return { status: 200, headers: new Headers(), body: {} };
    });
    await makeCollectionUpdateTool(client as any).handler({
      id: "c1",
      externalId: "ext-1",
      groups: [{ id: "g1", readOnly: false, hidePasswords: false, manage: true }],
      users: [{ id: "u1", readOnly: true, hidePasswords: false, manage: false }],
    });
    expect(client.request).toHaveBeenCalled();
  });

  it("delete DELETEs", async () => {
    const client = stubClient(() => ({ status: 200, headers: new Headers(), body: undefined }));
    const res = await makeCollectionDeleteTool(client as any).handler({ id: "c1" });
    expect(res.content[0]!.text).toContain("deleted");
  });
});
