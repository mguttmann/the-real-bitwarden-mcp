/**
 * SmHttpClient is now a re-export of BitwardenHttpClient wired with an
 * OAuthTokenCache (scope "api.secrets").  These tests verify the OAuth flow
 * and retry behaviour through the combined stack.
 */
import { describe, it, expect, vi } from "vitest";
import { SmHttpClient } from "../src/http/sm-client.js";
import { OAuthTokenCache } from "../src/http/oauth-token-cache.js";

type FakeFetchHandler = (req: Request) => Promise<Response>;

function fakeFetch(handler: FakeFetchHandler) {
  return vi.fn(async (u: unknown, init?: RequestInit) => {
    const req = new Request(u instanceof Request ? u : String(u), init);
    return handler(req);
  });
}

function makeTokenResponse(token = "sm-bearer-token") {
  return new Response(
    JSON.stringify({ access_token: token, expires_in: 3600 }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("SmHttpClient (OAuth-backed, scope api.secrets)", () => {
  it("fetches a token with scope api.secrets before the first API request", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = fakeFetch(async (req) => {
      const body = await req.text();
      calls.push({ url: req.url, body });
      if (req.url.includes("/connect/token")) {
        return makeTokenResponse("sm-jwt");
      }
      return new Response(JSON.stringify({ id: "abc" }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });

    const tokenCache = new OAuthTokenCache({
      tokenUrl: "https://h/identity/connect/token",
      clientId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      clientSecret: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      scope: "api.secrets",
      fetch: fetchImpl,
    });
    const client = new SmHttpClient({
      apiBase: "https://h/api",
      tokenCache,
      fetch: fetchImpl,
      sleep: async () => {},
    });

    const res = await client.request("GET", "/secrets/abc");
    expect(res.status).toBe(200);

    // First call must be the token endpoint with scope=api.secrets
    expect(calls[0].url).toBe("https://h/identity/connect/token");
    expect(calls[0].body).toContain("scope=api.secrets");
    expect(calls[0].body).toContain("grant_type=client_credentials");
    expect(calls[0].body).toContain("client_id=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    // Second call must be the API request with the Bearer token
    expect(calls[1].url).toBe("https://h/api/secrets/abc");
  });

  it("sends the fetched Bearer token in the Authorization header", async () => {
    const fetchImpl = fakeFetch(async (req) => {
      if (req.url.includes("/connect/token")) return makeTokenResponse("the-sm-token");
      expect(req.headers.get("authorization")).toBe("Bearer the-sm-token");
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    });

    const tokenCache = new OAuthTokenCache({
      tokenUrl: "https://h/identity/connect/token",
      clientId: "uuid",
      clientSecret: "secret",
      scope: "api.secrets",
      fetch: fetchImpl,
    });
    const client = new SmHttpClient({
      apiBase: "https://h/api",
      tokenCache,
      fetch: fetchImpl,
      sleep: async () => {},
    });
    await client.request("GET", "/secrets/abc");
  });

  it("re-fetches the token on 401 and retries the request once", async () => {
    let tokenFetches = 0;
    let apiAttempts = 0;
    const fetchImpl = fakeFetch(async (req) => {
      if (req.url.includes("/connect/token")) {
        tokenFetches++;
        return makeTokenResponse(`token-${tokenFetches}`);
      }
      apiAttempts++;
      // Fail first API call with 401 to trigger token refresh
      if (apiAttempts === 1) return new Response("{}", { status: 401 });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    });

    const tokenCache = new OAuthTokenCache({
      tokenUrl: "https://h/identity/connect/token",
      clientId: "uuid",
      clientSecret: "secret",
      scope: "api.secrets",
      fetch: fetchImpl,
    });
    const client = new SmHttpClient({
      apiBase: "https://h/api",
      tokenCache,
      fetch: fetchImpl,
      sleep: async () => {},
    });
    const res = await client.request("GET", "/secrets/abc");
    expect(res.status).toBe(200);
    expect(tokenFetches).toBe(2); // initial + refresh after 401
    expect(apiAttempts).toBe(2); // failed + retry
  });

  it("does not use the encryption key portion as client_secret", async () => {
    // Simulate what buildClients does: parse the token and only pass uuid + clientSecret
    const rawToken = "0.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCCCCCCCCCCCC==";
    const colonIdx = rawToken.lastIndexOf(":");
    const oauthPart = rawToken.slice(0, colonIdx);
    const [, uuid, secret] = oauthPart.split(".");

    const sentBodies: string[] = [];
    const fetchImpl = fakeFetch(async (req) => {
      if (req.url.includes("/connect/token")) {
        const body = await req.text();
        sentBodies.push(body);
        return makeTokenResponse();
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });

    const tokenCache = new OAuthTokenCache({
      tokenUrl: "https://h/identity/connect/token",
      clientId: uuid,
      clientSecret: secret,
      scope: "api.secrets",
      fetch: fetchImpl,
    });
    const client = new SmHttpClient({
      apiBase: "https://h/api",
      tokenCache,
      fetch: fetchImpl,
      sleep: async () => {},
    });
    await client.request("GET", "/secrets/x");

    expect(sentBodies[0]).not.toContain("CCCCCCCCCCCCCCCCCCCCCC=="); // encryption key must not be sent
    expect(sentBodies[0]).toContain("client_id=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(sentBodies[0]).toContain("client_secret=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
  });

  it("retries on 5xx and throws a BitwardenApiError after exhausting retries", async () => {
    let apiAttempts = 0;
    const fetchImpl = fakeFetch(async (req) => {
      if (req.url.includes("/connect/token")) return makeTokenResponse();
      apiAttempts++;
      return new Response(JSON.stringify({ status: 500, message: "Internal Server Error" }), {
        status: 500, headers: { "content-type": "application/json" },
      });
    });

    const tokenCache = new OAuthTokenCache({
      tokenUrl: "https://h/identity/connect/token",
      clientId: "uuid",
      clientSecret: "secret",
      scope: "api.secrets",
      fetch: fetchImpl,
    });
    const client = new SmHttpClient({
      apiBase: "https://h/api",
      tokenCache,
      fetch: fetchImpl,
      sleep: async () => {},
      maxRetries: 2,
    });
    await expect(client.request("GET", "/x")).rejects.toThrow();
    // 1 initial + 2 retries = 3 total API calls
    expect(apiAttempts).toBe(3);
  });
});
