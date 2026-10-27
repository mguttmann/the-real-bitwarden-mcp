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
import { withConfirmGuard } from "../../src/tools/confirm.js";
import { fakeApi, textOf } from "../helpers.js";
import { BitwardenApiError } from "../../src/http/errors.js";

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
    expect(textOf(res)).toContain("Engineers");
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
    const data = JSON.parse(textOf(res));
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
    const data = JSON.parse(textOf(res));
    expect(data.groups[0].collections).toBeDefined();
    expect(data.groups[0].collections).toHaveLength(1);
  });

  it("create posts the full payload", async () => {
    const client = stubClient((m, p, o) => {
      expect(m).toBe("POST");
      expect(p).toBe("/public/groups");
      expect(o.body).toEqual({
        name: "Eng",
        externalId: null,
        collections: [],
      });
      return { status: 200, headers: new Headers(), body: { id: "new" } };
    });
    await makeGroupCreateTool(client as any).handler({ name: "Eng" });
    expect(client.request).toHaveBeenCalled();
  });

  it("delete DELETEs", async () => {
    const client = stubClient((m) => ({
      status: m === "DELETE" ? 200 : 0,
      headers: new Headers(),
      body: undefined,
    }));
    const res = await makeGroupDeleteTool(client as any).handler({ id: "g1" });
    expect(textOf(res)).toContain("deleted");
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
    expect(textOf(res)).toContain("g1");
  });
});

describe("bw_group_update keeps state for omitted fields", () => {
  const current = {
    id: "g1",
    name: "Eng",
    externalId: "ext-g",
    collections: [{ id: "c1", readOnly: false, hidePasswords: false, manage: true }],
  };

  it("rename only: keeps externalId from GET, omits collections and accessAll", async () => {
    const { client, calls } = fakeApi({
      "GET /public/groups/g1": current,
      "PUT /public/groups/g1": { id: "g1", name: "Renamed" },
    });
    const res = await makeGroupUpdateTool(client).handler({ id: "g1", name: "Renamed" });
    expect(res.isError).toBeFalsy();
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({ name: "Renamed", externalId: "ext-g" });
  });

  it("sends externalId and collections as given, without a GET", async () => {
    const { client, calls } = fakeApi({ "PUT /public/groups/g1": { id: "g1" } });
    await makeGroupUpdateTool(client).handler({
      id: "g1",
      name: "Eng",
      externalId: null,
      collections: [],
    });
    expect(calls).toEqual([
      {
        method: "PUT",
        path: "/public/groups/g1",
        body: { name: "Eng", externalId: null, collections: [] },
      },
    ]);
  });

  it("accessAll:true is rejected (removed upstream), nothing is sent", async () => {
    const { client, calls } = fakeApi({});
    const res = await makeGroupUpdateTool(client).handler({
      id: "g1",
      name: "Eng",
      accessAll: true,
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/accessAll/);
    expect(calls).toEqual([]);
  });

  it("bw_group_create rejects accessAll:true as well", async () => {
    const { client, calls } = fakeApi({});
    const res = await makeGroupCreateTool(client).handler({ name: "Eng", accessAll: true });
    expect(res.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it("confirm preview shows the effective request and does not write", async () => {
    const { client, calls } = fakeApi({ "GET /public/groups/g1": current });
    const res = await withConfirmGuard(makeGroupUpdateTool(client), true).handler({
      id: "g1",
      name: "Renamed",
    });
    const text = textOf(res);
    expect(text).toContain("PUT /public/groups/g1");
    expect(text).toContain('"externalId": "ext-g"');
    expect(text).toMatch(/collections.*not sent/i);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
  // Gateway test of 0.3.0: the pre-read 404 came back unlabelled.
  it("a failed pre-read in the preview is labelled as preview and nothing was written", async () => {
    const { client, calls } = fakeApi({
      "GET /public/groups/unknown-id": () => {
        throw new BitwardenApiError(404, "upstream_error", "Resource not found.");
      },
    });
    const res = await withConfirmGuard(makeGroupUpdateTool(client), true).handler({
      id: "unknown-id",
      name: "Renamed",
    });
    const text = textOf(res);
    expect(res.isError).toBe(true);
    expect(text).toMatch(/^PREVIEW - would execute bw_group_update/);
    expect(text).toContain("nothing was written");
    expect(text).toContain("BitwardenApiError[404 upstream_error]: Resource not found.");
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("with confirm YES a failed pre-read is not labelled as preview", async () => {
    const { client, calls } = fakeApi({
      "GET /public/groups/unknown-id": () => {
        throw new BitwardenApiError(404, "upstream_error", "Resource not found.");
      },
    });
    const res = await withConfirmGuard(makeGroupUpdateTool(client), true).handler({
      id: "unknown-id",
      name: "Renamed",
      confirm: "YES",
    });
    const text = textOf(res);
    expect(res.isError).toBe(true);
    expect(text).not.toContain("PREVIEW");
    expect(text).toContain("BitwardenApiError[404 upstream_error]: Resource not found.");
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });
});
