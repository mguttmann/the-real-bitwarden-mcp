import { describe, it, expect, vi } from "vitest";
import {
  makePolicyListTool, makePolicyGetTool, makePolicySetTool,
} from "../../src/tools/wrappers/bw_policy.js";

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
    expect(res.content[0]!.text).toContain("type");
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
      expect(m).toBe("PUT"); expect(p).toBe("/public/policies/3");
      expect(o.body).toEqual({ enabled: true, data: { minComplexity: 4 } });
      return { status: 200, headers: new Headers(), body: {} };
    });
    await makePolicySetTool(client as any).handler({ type: 3, enabled: true, data: { minComplexity: 4 } });
    expect(client.request).toHaveBeenCalled();
  });
});
