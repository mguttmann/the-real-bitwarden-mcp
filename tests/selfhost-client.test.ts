import { describe, it, expect, vi } from "vitest";
import { SelfhostHttpClient } from "../src/http/selfhost-client.js";
import { OAuthTokenCache } from "../src/http/oauth-token-cache.js";

function tokenResponse(token: string) {
  return new Response(JSON.stringify({ access_token: token, expires_in: 3600 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeFetch(handler: (req: Request) => Promise<Response>) {
  return vi.fn(async (u: any, init?: RequestInit) => {
    const req = new Request(u instanceof Request ? u : String(u), init);
    return handler(req);
  });
}

function client(fetchImpl: any) {
  const cache = new OAuthTokenCache({
    tokenUrl: "https://id.example/connect/token",
    clientId: "organization.x",
    clientSecret: "s",
    scope: "api.organization",
    fetch: fetchImpl,
  });
  return new SelfhostHttpClient({
    apiBase: "https://h.example/api",
    tokenCache: cache,
    fetch: fetchImpl,
    sleep: async () => {},
  });
}

describe("SelfhostHttpClient", () => {
  it("attaches Bearer token from the OAuth cache", async () => {
    const fetchImpl = makeFetch(async (req) => {
      if (req.url.endsWith("/connect/token")) return tokenResponse("tok-1");
      expect(req.headers.get("authorization")).toBe("Bearer tok-1");
      expect(req.url).toBe("https://h.example/api/public/members");
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const c = client(fetchImpl);
    const res = await c.request("GET", "/public/members");
    expect(res.status).toBe(200);
  });

  it("refreshes token and retries once on 401", async () => {
    let tokenCalls = 0;
    let memberCalls = 0;
    const fetchImpl = makeFetch(async (req) => {
      if (req.url.endsWith("/connect/token")) {
        tokenCalls++;
        return tokenResponse(`tok-${tokenCalls}`);
      }
      memberCalls++;
      if (memberCalls === 1) return new Response("{}", { status: 401 });
      expect(req.headers.get("authorization")).toBe("Bearer tok-2");
      return new Response(JSON.stringify({ data: ["m"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const c = client(fetchImpl);
    const res = await c.request("GET", "/public/members");
    expect(res.status).toBe(200);
    expect(memberCalls).toBe(2);
    expect(tokenCalls).toBe(2);
  });

  it("a second 401 after the token refresh is an error, with no further refresh", async () => {
    let tokenCalls = 0;
    let memberCalls = 0;
    const fetchImpl = makeFetch(async (req) => {
      if (req.url.endsWith("/connect/token")) {
        tokenCalls++;
        return tokenResponse(`tok-${tokenCalls}`);
      }
      memberCalls++;
      return new Response("{}", { status: 401 });
    });
    const c = client(fetchImpl);
    await expect(c.request("GET", "/public/members")).rejects.toThrow(/BitwardenApiError|HTTP 401/);
    expect(memberCalls).toBe(2);
    expect(tokenCalls).toBe(2);
  });

  it("retries on 429 honouring Retry-After", async () => {
    const sleeps: number[] = [];
    const fetchImpl = makeFetch(async (req) => {
      if (req.url.endsWith("/connect/token")) return tokenResponse("t");
      const calls = (fetchImpl as any).mock.calls.length;
      if (calls === 2) {
        return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
      }
      return new Response("{}", { status: 200 });
    });
    const cache = new OAuthTokenCache({
      tokenUrl: "https://id.example/connect/token",
      clientId: "x",
      clientSecret: "y",
      scope: "api.organization",
      fetch: fetchImpl,
    });
    const c = new SelfhostHttpClient({
      apiBase: "https://h.example/api",
      tokenCache: cache,
      fetch: fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const res = await c.request("GET", "/public/groups");
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([1000]);
  });

  it("serialises body as JSON on POST", async () => {
    const fetchImpl = makeFetch(async (req) => {
      if (req.url.endsWith("/connect/token")) return tokenResponse("t");
      expect(req.method).toBe("POST");
      expect(await req.json()).toEqual({ email: "x@y.z", type: 2 });
      return new Response("{}", { status: 200 });
    });
    const c = client(fetchImpl);
    await c.request("POST", "/public/members", { body: { email: "x@y.z", type: 2 } });
  });

  it("encodes query parameters", async () => {
    const fetchImpl = makeFetch(async (req) => {
      if (req.url.endsWith("/connect/token")) return tokenResponse("t");
      const u = new URL(req.url);
      expect(u.searchParams.get("start")).toBe("2026-01-01");
      return new Response("{}", { status: 200 });
    });
    const c = client(fetchImpl);
    await c.request("GET", "/public/events", { query: { start: "2026-01-01" } });
  });

  it("buildUrl locks the host: protocol-relative and traversal paths stay on apiBase host", async () => {
    const seen: string[] = [];
    const fetchImpl = makeFetch(async (req) => {
      if (req.url.endsWith("/connect/token")) return tokenResponse("t");
      seen.push(req.url);
      return new Response("{}", { status: 200 });
    });
    const c = client(fetchImpl);
    await c.request("GET", "//evil.com/foo");
    await c.request("GET", "/../../etc/passwd");
    for (const url of seen) {
      // Host must always be the configured api base, never evil.com.
      expect(new URL(url).host).toBe("h.example");
    }
  });

  it("throws BitwardenApiError on 4xx after retries exhausted", async () => {
    const fetchImpl = makeFetch(async (req) => {
      if (req.url.endsWith("/connect/token")) return tokenResponse("t");
      return new Response(JSON.stringify({ Message: "Bad request" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    });
    const c = client(fetchImpl);
    await expect(c.request("GET", "/public/members")).rejects.toThrow(/Bad request|400|HTTP/);
  });
});
