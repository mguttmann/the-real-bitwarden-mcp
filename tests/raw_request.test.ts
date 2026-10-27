import { describe, it, expect, vi } from "vitest";
import { makeRawRequestTool } from "../src/tools/raw_request.js";
import { textOf } from "./helpers.js";

function stubClient() {
  return {
    request: vi.fn(async (_m: string, _p: string, _o: any) => ({
      status: 200,
      headers: new Headers(),
      body: { ok: true },
    })),
  };
}

describe("bw_raw_request", () => {
  it("defaults to selfhost when instance not given", async () => {
    const sh = stubClient();
    const cl = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: cl as any,
      sm: undefined,
      confirmWrites: false,
    });
    await tool.handler({ method: "GET", path: "/public/members" });
    expect(sh.request).toHaveBeenCalledWith("GET", "/public/members", {
      query: undefined,
      body: undefined,
    });
    expect(cl.request).not.toHaveBeenCalled();
  });

  it("routes to cloud when instance=cloud", async () => {
    const sh = stubClient();
    const cl = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: cl as any,
      sm: undefined,
      confirmWrites: false,
    });
    await tool.handler({
      method: "GET",
      path: "/public/organization/subscription",
      instance: "cloud",
    });
    expect(cl.request).toHaveBeenCalled();
    expect(sh.request).not.toHaveBeenCalled();
  });

  it("rejects unknown instance", async () => {
    const sh = stubClient();
    const cl = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: cl as any,
      sm: undefined,
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "/x", instance: "moon" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/instance/i);
  });

  it("rejects when targeted instance is not configured", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
      sm: undefined,
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "/x", instance: "cloud" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/cloud.*not configured/i);
  });

  it("rejects when path does not start with /", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
      sm: undefined,
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "public/members" });
    expect(res.isError).toBe(true);
  });

  it("returns a preview for non-GET when confirmWrites=true and confirm missing", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
      sm: undefined,
      confirmWrites: true,
    });
    const res = await tool.handler({
      method: "POST",
      path: "/public/members",
      body: { email: "x@y.z" },
    });
    expect(sh.request).not.toHaveBeenCalled();
    expect(textOf(res)).toMatch(/PREVIEW/);
  });

  it("executes POST when confirm=YES", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
      sm: undefined,
      confirmWrites: true,
    });
    await tool.handler({
      method: "POST",
      path: "/public/members",
      body: { email: "x@y.z" },
      confirm: "YES",
    });
    expect(sh.request).toHaveBeenCalled();
  });

  it("lets GET through even when confirmWrites=true", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
      sm: undefined,
      confirmWrites: true,
    });
    await tool.handler({ method: "GET", path: "/public/members" });
    expect(sh.request).toHaveBeenCalled();
  });

  it("rejects path with CR/LF (header-injection guard)", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
      sm: undefined,
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "/foo\r\nHost: evil.com" });
    expect(res.isError).toBe(true);
    expect(sh.request).not.toHaveBeenCalled();
  });

  it("rejects path with backslash (URL-normalisation guard)", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
      sm: undefined,
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "/\\evil.com/foo" });
    expect(res.isError).toBe(true);
    expect(sh.request).not.toHaveBeenCalled();
  });

  it("rejects path with NUL byte", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
      sm: undefined,
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "/foo\x00bar" });
    expect(res.isError).toBe(true);
    expect(sh.request).not.toHaveBeenCalled();
  });

  it("rejects protocol-prefixed path (http:// / https://)", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
      sm: undefined,
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "http://evil.com/x" });
    expect(res.isError).toBe(true);
    expect(sh.request).not.toHaveBeenCalled();
  });

  // Audit cases raw-path-prefix-escape and raw-request-dot-segment-escape:
  // dot segments (also percent-encoded) and encoded separators would let the
  // path leave the API base prefix after URL normalisation.
  const ESCAPING_PATHS = [
    "/../../etc/passwd",
    "/public/members/..",
    "/public/./members",
    "/%2e%2e/admin/users",
    "/%2E%2E/admin",
    "/.%2e/admin",
    "/%2e./admin",
    "/public/%2e/members",
    "/public/members/%2E",
    "/public%2f..%2fadmin",
    "/public%2F..%2Fadmin",
    "/public%5c..%5cadmin",
    "/public/members/x%5Cy",
  ];
  for (const path of ESCAPING_PATHS) {
    it(`rejects ${JSON.stringify(path)} without sending a request`, async () => {
      const sh = stubClient();
      const tool = makeRawRequestTool({
        selfhost: sh as any,
        cloud: undefined,
        sm: undefined,
        confirmWrites: true,
      });
      for (const method of ["GET", "DELETE"]) {
        const res = await tool.handler({ method, path });
        expect(res.isError).toBe(true);
        expect(textOf(res)).toMatch(/dot segment|encoded separator/);
      }
      expect(sh.request).not.toHaveBeenCalled();
    });
  }

  it("still allows dots inside a segment and in the query string", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
      sm: undefined,
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "/public/a..b/.well-known?x=../y" });
    expect(res.isError).toBeUndefined();
    expect(sh.request).toHaveBeenCalled();
  });

  // Audit case preview-echoes-secret-value (raw request bodies).
  it("masks secret values in the write preview body", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: undefined,
      cloud: undefined,
      sm: sh as any,
      confirmWrites: true,
    });
    const res = await tool.handler({
      instance: "sm",
      method: "POST",
      path: "/organizations/org-1/secrets",
      body: { key: "DB_PASS", value: "FAKE-SECRET-1", clientSecret: "FAKE-SECRET-2" },
    });
    const text = textOf(res);
    expect(text).toMatch(/PREVIEW/);
    expect(text).not.toContain("FAKE-SECRET-1");
    expect(text).not.toContain("FAKE-SECRET-2");
    expect(text).toContain('"value": "<redacted, 13 chars>"');
    expect(text).toContain('"key": "DB_PASS"');
    expect(sh.request).not.toHaveBeenCalled();
  });
});
