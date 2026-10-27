import { describe, it, expect, vi } from "vitest";
import {
  makePolicyListTool,
  makePolicyGetTool,
  makePolicySetTool,
} from "../../src/tools/wrappers/bw_policy.js";
import { withConfirmGuard } from "../../src/tools/confirm.js";
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
});
