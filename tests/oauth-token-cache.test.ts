import { describe, it, expect, vi } from "vitest";
import { OAuthTokenCache } from "../src/http/oauth-token-cache.js";

function makeFetch(responses: Response[]) {
  const queue = [...responses];
  return vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("fetch sequence exhausted");
    return next;
  });
}

describe("OAuthTokenCache", () => {
  it("fetches a token with client_credentials grant", async () => {
    const fetchImpl = makeFetch([
      new Response(JSON.stringify({ access_token: "tok1", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const cache = new OAuthTokenCache({
      tokenUrl: "https://id.example/connect/token",
      clientId: "organization.x",
      clientSecret: "shh",
      scope: "api.organization",
      fetch: fetchImpl,
    });
    const token = await cache.getToken();
    expect(token).toBe("tok1");
    const call = fetchImpl.mock.calls[0]!;
    expect(call[0]).toBe("https://id.example/connect/token");
    const body = call[1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("organization.x");
    expect(body.get("client_secret")).toBe("shh");
    expect(body.get("scope")).toBe("api.organization");
  });

  it("reuses cached token while valid", async () => {
    const fetchImpl = makeFetch([
      new Response(JSON.stringify({ access_token: "tok1", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const cache = new OAuthTokenCache({
      tokenUrl: "https://id/connect/token",
      clientId: "x",
      clientSecret: "y",
      scope: "api.organization",
      fetch: fetchImpl,
    });
    await cache.getToken();
    await cache.getToken();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refetches near expiry (within 60s buffer)", async () => {
    const fetchImpl = makeFetch([
      new Response(JSON.stringify({ access_token: "t1", expires_in: 30 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response(JSON.stringify({ access_token: "t2", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const cache = new OAuthTokenCache({
      tokenUrl: "https://id/connect/token",
      clientId: "x",
      clientSecret: "y",
      scope: "api.organization",
      fetch: fetchImpl,
    });
    expect(await cache.getToken()).toBe("t1");
    expect(await cache.getToken()).toBe("t2");
  });

  it("forces refresh on invalidate()", async () => {
    const fetchImpl = makeFetch([
      new Response(JSON.stringify({ access_token: "a", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response(JSON.stringify({ access_token: "b", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const cache = new OAuthTokenCache({
      tokenUrl: "https://id/connect/token",
      clientId: "x",
      clientSecret: "y",
      scope: "api.organization",
      fetch: fetchImpl,
    });
    expect(await cache.getToken()).toBe("a");
    cache.invalidate();
    expect(await cache.getToken()).toBe("b");
  });

  it("throws on non-2xx token response", async () => {
    const fetchImpl = makeFetch([
      new Response("nope", { status: 401 }),
    ]);
    const cache = new OAuthTokenCache({
      tokenUrl: "https://id/connect/token",
      clientId: "x",
      clientSecret: "y",
      scope: "api.organization",
      fetch: fetchImpl,
    });
    await expect(cache.getToken()).rejects.toThrow(/401|token/i);
  });
});
