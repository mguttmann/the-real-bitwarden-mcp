import { describe, it, expect } from "vitest";
import { BitwardenHttpClient } from "../src/http/bitwarden-http-client.js";
import type { OAuthTokenCache } from "../src/http/oauth-token-cache.js";

const tokenCache = { getToken: async () => "FAKE-TOKEN-1", invalidate: () => {} };

/** Client whose fetch answers from `responses` in order (a function throws a network error). */
function clientWith(responses: Array<Response | (() => never)>) {
  const seen: string[] = [];
  const sleeps: number[] = [];
  let i = 0;
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    seen.push(String(init?.method));
    const next = responses[Math.min(i++, responses.length - 1)]!;
    if (typeof next === "function") next();
    return (next as Response).clone();
  };
  const client = new BitwardenHttpClient({
    apiBase: "https://h.example/api",
    tokenCache: tokenCache as unknown as OAuthTokenCache,
    fetch: fetchImpl as typeof globalThis.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, seen, sleeps };
}

const ok = () => new Response("{}", { status: 200 });
const status = (s: number, headers?: Record<string, string>) =>
  new Response("{}", { status: s, headers });
const networkError = () => {
  throw new TypeError("fetch failed");
};

describe("retry policy", () => {
  it("retries GET on 5xx", async () => {
    const { client, seen } = clientWith([status(502), ok()]);
    const res = await client.request("GET", "/public/members");
    expect(res.status).toBe(200);
    expect(seen).toEqual(["GET", "GET"]);
  });

  for (const method of ["POST", "PUT", "DELETE", "PATCH"] as const) {
    it(`does not repeat ${method} on 5xx and says the outcome is unknown`, async () => {
      const { client, seen } = clientWith([status(504), ok()]);
      const err = await client.request(method, "/public/x", { body: {} }).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(String(err)).toMatch(/504/);
      expect(String(err)).toMatch(/may or may not have been applied/);
      expect(seen).toEqual([method]);
    });
  }

  it("retries GET on a network error", async () => {
    const { client, seen } = clientWith([networkError, ok()]);
    const res = await client.request("GET", "/public/members");
    expect(res.status).toBe(200);
    expect(seen).toEqual(["GET", "GET"]);
  });

  it("does not repeat POST on a network error", async () => {
    const { client, seen } = clientWith([networkError, ok()]);
    await expect(client.request("POST", "/public/members", { body: {} })).rejects.toThrow(
      /fetch failed/,
    );
    expect(seen).toEqual(["POST"]);
  });

  it("retries 429 for POST (the request was not processed)", async () => {
    const { client, seen } = clientWith([status(429, { "retry-after": "1" }), ok()]);
    const res = await client.request("POST", "/public/members", { body: {} });
    expect(res.status).toBe(200);
    expect(seen).toEqual(["POST", "POST"]);
  });
});

describe("Retry-After", () => {
  it("caps a large delta-seconds value at 30 s", async () => {
    const { client, sleeps } = clientWith([status(429, { "retry-after": "3600" }), ok()]);
    await client.request("GET", "/public/members");
    expect(sleeps).toEqual([30_000]);
  });

  it("honours an HTTP-date value", async () => {
    const date = new Date(Date.now() + 20_000).toUTCString();
    const { client, sleeps } = clientWith([status(429, { "retry-after": date }), ok()]);
    await client.request("GET", "/public/members");
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(15_000);
    expect(sleeps[0]).toBeLessThanOrEqual(20_000);
  });

  it("falls back to backoff for an unparseable or past value", async () => {
    for (const v of ["soon", new Date(Date.now() - 60_000).toUTCString()]) {
      const { client, sleeps } = clientWith([status(429, { "retry-after": v }), ok()]);
      await client.request("GET", "/public/members");
      expect(sleeps).toEqual([1000]);
    }
  });
});
