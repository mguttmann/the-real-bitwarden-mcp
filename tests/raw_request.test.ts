import { describe, it, expect, vi } from "vitest";
import { makeRawRequestTool } from "../src/tools/raw_request.js";

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
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "/x", instance: "moon" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/instance/i);
  });

  it("rejects when targeted instance is not configured", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "/x", instance: "cloud" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/cloud.*not configured/i);
  });

  it("rejects when path does not start with /", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "public/members" });
    expect(res.isError).toBe(true);
  });

  it("returns a preview for non-GET when confirmWrites=true and confirm missing", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({ selfhost: sh as any, cloud: undefined, confirmWrites: true });
    const res = await tool.handler({
      method: "POST",
      path: "/public/members",
      body: { email: "x@y.z" },
    });
    expect(sh.request).not.toHaveBeenCalled();
    expect(res.content[0].text).toMatch(/PREVIEW/);
  });

  it("executes POST when confirm=YES", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({ selfhost: sh as any, cloud: undefined, confirmWrites: true });
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
    const tool = makeRawRequestTool({ selfhost: sh as any, cloud: undefined, confirmWrites: true });
    await tool.handler({ method: "GET", path: "/public/members" });
    expect(sh.request).toHaveBeenCalled();
  });

  it("rejects path with CR/LF (header-injection guard)", async () => {
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
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
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "http://evil.com/x" });
    expect(res.isError).toBe(true);
    expect(sh.request).not.toHaveBeenCalled();
  });

  it("allows /.. traversal — buildUrl normalises within configured host", async () => {
    // ".." cannot escape the configured base URL: the host stays locked.
    // This test pins that the tool forwards the request (the server may 404,
    // but the request never reaches a different host).
    const sh = stubClient();
    const tool = makeRawRequestTool({
      selfhost: sh as any,
      cloud: undefined,
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "/../../etc/passwd" });
    expect(res.isError).toBeUndefined();
    expect(sh.request).toHaveBeenCalledWith("GET", "/../../etc/passwd", expect.anything());
  });
});
