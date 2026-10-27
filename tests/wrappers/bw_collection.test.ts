import { describe, it, expect, vi } from "vitest";
import {
  makeCollectionListTool,
  makeCollectionGetTool,
  makeCollectionUpdateTool,
  makeCollectionDeleteTool,
} from "../../src/tools/wrappers/bw_collection.js";
import { withConfirmGuard } from "../../src/tools/confirm.js";
import { fakeApi, textOf } from "../helpers.js";

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
    expect(textOf(res)).toContain("c1");
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
    const data = JSON.parse(textOf(res));
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
    const data = JSON.parse(textOf(res));
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

  it("update PUTs the groups access body", async () => {
    const { client, calls } = fakeApi({ "PUT /public/collections/c1": {} });
    await makeCollectionUpdateTool(client).handler({
      id: "c1",
      externalId: "ext-1",
      groups: [{ id: "g1", readOnly: false, hidePasswords: false, manage: true }],
    });
    expect(calls).toEqual([
      {
        method: "PUT",
        path: "/public/collections/c1",
        body: {
          externalId: "ext-1",
          groups: [{ id: "g1", readOnly: false, hidePasswords: false, manage: true }],
        },
      },
    ]);
  });

  it("delete DELETEs", async () => {
    const client = stubClient(() => ({ status: 200, headers: new Headers(), body: undefined }));
    const res = await makeCollectionDeleteTool(client as any).handler({ id: "c1" });
    expect(textOf(res)).toContain("deleted");
  });
});

describe("bw_collection_update keeps state for omitted fields", () => {
  const current = {
    id: "c1",
    externalId: "ext-c",
    groups: [{ id: "g1", readOnly: false, hidePasswords: false, manage: true }],
  };

  it("{id} only: keeps externalId from GET and does not send groups", async () => {
    const { client, calls } = fakeApi({
      "GET /public/collections/c1": current,
      "PUT /public/collections/c1": current,
    });
    const res = await makeCollectionUpdateTool(client).handler({ id: "c1" });
    expect(res.isError).toBeFalsy();
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({ externalId: "ext-c" });
  });

  it("non-empty users is rejected (no per-user access in the Public API), nothing is sent", async () => {
    const { client, calls } = fakeApi({});
    const res = await makeCollectionUpdateTool(client).handler({
      id: "c1",
      users: [{ id: "m1", readOnly: true }],
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/users/);
    expect(textOf(res)).toMatch(/bw_member_update/);
    expect(calls).toEqual([]);
  });

  it("an empty users list is accepted and not sent", async () => {
    const { client, calls } = fakeApi({ "PUT /public/collections/c1": {} });
    await makeCollectionUpdateTool(client).handler({ id: "c1", externalId: null, users: [] });
    expect(calls).toEqual([
      { method: "PUT", path: "/public/collections/c1", body: { externalId: null } },
    ]);
  });

  it("description no longer promises per-user access", () => {
    const tool = makeCollectionUpdateTool(fakeApi({}).client);
    expect(tool.description).not.toMatch(/groups and users/);
  });

  it("confirm preview shows the effective request and does not write", async () => {
    const { client, calls } = fakeApi({ "GET /public/collections/c1": current });
    const res = await withConfirmGuard(makeCollectionUpdateTool(client), true).handler({
      id: "c1",
    });
    const text = textOf(res);
    expect(text).toContain("PUT /public/collections/c1");
    expect(text).toContain('"externalId": "ext-c"');
    expect(text).toMatch(/groups.*not sent/i);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});
