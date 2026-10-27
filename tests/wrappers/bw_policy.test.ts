import { describe, it, expect, vi } from "vitest";
import {
  makePolicyListTool,
  makePolicyGetTool,
  makePolicySetTool,
} from "../../src/tools/wrappers/bw_policy.js";
import { withConfirmGuard } from "../../src/tools/confirm.js";
import { BitwardenApiError } from "../../src/http/errors.js";
import { fakeApi, textOf } from "../helpers.js";

function stubClient(handler: (m: string, p: string, opts?: any) => any) {
  return { request: vi.fn(async (m: string, p: string, opts?: any) => handler(m, p, opts)) };
}

describe("bw_policy_*", () => {
  it("list GETs /public/policies", async () => {
    const client = stubClient((_m, p) => {
      expect(p).toBe("/public/policies");
      return { status: 200, headers: new Headers(), body: { data: [{ type: 0, enabled: true }] } };
    });
    const res = await makePolicyListTool(client as any).handler({});
    expect(textOf(res)).toContain("type");
  });

  it("get fetches by type", async () => {
    const client = stubClient((_m, p) => {
      expect(p).toBe("/public/policies/3");
      return { status: 200, headers: new Headers(), body: { type: 3, enabled: false } };
    });
    await makePolicyGetTool(client as any).handler({ type: 3 });
    expect(client.request).toHaveBeenCalled();
  });

  it("set PUTs the enabled+data payload", async () => {
    const client = stubClient((m, p, o) => {
      expect(m).toBe("PUT");
      expect(p).toBe("/public/policies/3");
      expect(o.body).toEqual({ enabled: true, data: { minComplexity: 4 } });
      return { status: 200, headers: new Headers(), body: {} };
    });
    await makePolicySetTool(client as any).handler({
      type: 3,
      enabled: true,
      data: { minComplexity: 4 },
    });
    expect(client.request).toHaveBeenCalled();
  });
});

describe("bw_policy_set keeps state for omitted fields", () => {
  it("enabled only: keeps the current policy data (GET) instead of sending data:null", async () => {
    const { client, calls } = fakeApi({
      "GET /public/policies/1": { type: 1, enabled: false, data: { minLength: 14 } },
      "PUT /public/policies/1": { type: 1, enabled: true },
    });
    const res = await makePolicySetTool(client).handler({ type: 1, enabled: true });
    expect(res.isError).toBeFalsy();
    const put = calls.find((c) => c.method === "PUT");
    expect(put?.body).toEqual({ enabled: true, data: { minLength: 14 } });
  });

  it("explicit data:null is sent as given, without a GET", async () => {
    const { client, calls } = fakeApi({ "PUT /public/policies/1": {} });
    await makePolicySetTool(client).handler({ type: 1, enabled: false, data: null });
    expect(calls).toEqual([
      { method: "PUT", path: "/public/policies/1", body: { enabled: false, data: null } },
    ]);
  });

  it("confirm preview shows the effective request and does not write", async () => {
    const { client, calls } = fakeApi({
      "GET /public/policies/1": { type: 1, enabled: false, data: { minLength: 14 } },
    });
    const res = await withConfirmGuard(makePolicySetTool(client), true).handler({
      type: 1,
      enabled: true,
    });
    expect(textOf(res)).toContain("PUT /public/policies/1");
    expect(textOf(res)).toContain('"minLength": 14');
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });

  it("first save of a policy type (GET 404): PUTs data:null instead of failing", async () => {
    const client = stubClient((m, _p, o) => {
      if (m === "GET") throw new BitwardenApiError(404, "upstream_error", "HTTP 404");
      expect(o.body).toEqual({ enabled: true, data: null });
      return { status: 200, headers: new Headers(), body: { type: 0, enabled: true } };
    });
    const res = await makePolicySetTool(client as any).handler({ type: 0, enabled: true });
    expect(res.isError).toBeFalsy();
    expect(client.request).toHaveBeenCalledWith("PUT", "/public/policies/0", {
      body: { enabled: true, data: null },
    });
  });

  it("first save of a policy type (GET 404): preview shows the PUT and does not error", async () => {
    const client = stubClient((m) => {
      if (m === "GET") throw new BitwardenApiError(404, "upstream_error", "HTTP 404");
      throw new Error("no write expected in preview");
    });
    const res = await withConfirmGuard(makePolicySetTool(client as any), true).handler({
      type: 0,
      enabled: true,
    });
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).toContain("PUT /public/policies/0");
    expect(textOf(res)).toContain("no stored policy yet");
    expect(client.request.mock.calls.every((c) => c[0] === "GET")).toBe(true);
  });

  it("other GET errors still fail and write nothing", async () => {
    const client = stubClient((m) => {
      if (m === "GET") throw new BitwardenApiError(403, "upstream_error", "HTTP 403");
      throw new Error("no write expected");
    });
    const res = await makePolicySetTool(client as any).handler({ type: 0, enabled: true });
    expect(res.isError).toBe(true);
    expect(client.request.mock.calls.every((c) => c[0] === "GET")).toBe(true);
  });
});

describe("bw_policy_set metadata (added in 0.3.0)", () => {
  it("metadata is sent in the PUT body when given", async () => {
    const { client, calls } = fakeApi({ "PUT /public/policies/5": {} });
    const metadata = { defaultUserCollectionName: "FAKE-COLLECTION" };
    await makePolicySetTool(client).handler({ type: 5, enabled: true, data: null, metadata });
    expect(calls).toEqual([
      {
        method: "PUT",
        path: "/public/policies/5",
        body: { enabled: true, data: null, metadata },
      },
    ]);
  });

  it("metadata omitted: not sent", async () => {
    const { client, calls } = fakeApi({ "PUT /public/policies/5": {} });
    await makePolicySetTool(client).handler({ type: 5, enabled: true, data: null });
    expect(calls[0]?.body).not.toHaveProperty("metadata");
  });

  it("metadata is optional in the schema", () => {
    const schema = makePolicySetTool(fakeApi({}).client).inputSchema as any;
    expect(schema.required).toEqual(["type", "enabled"]);
    expect(schema.properties.metadata).toMatchObject({ type: ["object", "null"] });
  });
});
