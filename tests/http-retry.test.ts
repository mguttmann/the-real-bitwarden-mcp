import { describe, it, expect } from "vitest";
import { BitwardenHttpClient, isOutcomeUnknown } from "../src/http/bitwarden-http-client.js";
import { BitwardenApiError } from "../src/http/errors.js";
import { asToolError } from "../src/tools/_error.js";
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

  for (const method of ["POST", "PUT", "DELETE", "PATCH"] as const) {
    it(`${method} network error carries the unknown-outcome hint, same error type as 5xx`, async () => {
      const { client, seen } = clientWith([networkError, ok()]);
      const err = await client.request(method, "/public/x", { body: {} }).catch((e) => e);
      expect(err).toBeInstanceOf(BitwardenApiError);
      expect(String(err)).toMatch(/fetch failed/);
      expect(String(err)).toMatch(/may or may not have been applied/);
      expect(isOutcomeUnknown(err)).toBe(true);
      expect(seen).toEqual([method]);
    });
  }

  it("a 5xx on a write is also flagged as outcome unknown; a 4xx is not", async () => {
    const five = await clientWith([status(503)])
      .client.request("PUT", "/public/x", { body: {} })
      .catch((e) => e);
    expect(isOutcomeUnknown(five)).toBe(true);
    const four = await clientWith([status(400)])
      .client.request("PUT", "/public/x", { body: {} })
      .catch((e) => e);
    expect(isOutcomeUnknown(four)).toBe(false);
  });

  it("network error text on a write is scrubbed in the tool error", async () => {
    const leaky = () => {
      throw new TypeError("connect failed client_secret=SUPERSECRET123");
    };
    const err = await clientWith([leaky])
      .client.request("POST", "/public/x", { body: {} })
      .catch((e) => e);
    const text = (asToolError(err).content[0] as { text: string }).text;
    expect(text).toMatch(/may or may not have been applied/);
    expect(text).not.toContain("SUPERSECRET123");
  });

  it("retries 429 for POST (the request was not processed)", async () => {
    const { client, seen } = clientWith([status(429, { "retry-after": "1" }), ok()]);
    const res = await client.request("POST", "/public/members", { body: {} });
    expect(res.status).toBe(200);
    expect(seen).toEqual(["POST", "POST"]);
  });
});

describe("network errors and timeouts", () => {
  it("does not retry a GET that timed out (one call stays near HTTP_TIMEOUT_MS)", async () => {
    let calls = 0;
    const hanging = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        calls++;
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    const client = new BitwardenHttpClient({
      apiBase: "https://h.example/api",
      tokenCache: tokenCache as unknown as OAuthTokenCache,
      fetch: hanging as typeof globalThis.fetch,
      sleep: async () => {},
      timeoutMs: 20,
    });
    await expect(client.request("GET", "/public/members")).rejects.toThrow(/request timeout/);
    expect(calls).toBe(1);
  });

  it("keeps the cause code of a network error (write and GET)", async () => {
    const refused = () => {
      const cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), {
        code: "ECONNREFUSED",
      });
      throw new TypeError("fetch failed", { cause });
    };
    const write = await clientWith([refused])
      .client.request("POST", "/public/x", { body: {} })
      .catch((e) => e);
    expect(String(write)).toMatch(/fetch failed \(ECONNREFUSED\)/);
    expect(isOutcomeUnknown(write)).toBe(true);
    const read = await clientWith([refused])
      .client.request("GET", "/public/x", { maxRetries: 0 })
      .catch((e) => e);
    expect(String(read)).toMatch(/fetch failed \(ECONNREFUSED\)/);
    expect(isOutcomeUnknown(read)).toBe(false);
  });

  it("a write that fails before anything is sent is not flagged as possibly applied", async () => {
    let called = false;
    const client = new BitwardenHttpClient({
      apiBase: "not a url",
      tokenCache: tokenCache as unknown as OAuthTokenCache,
      fetch: (async () => {
        called = true;
        return ok();
      }) as typeof globalThis.fetch,
    });
    const err = await client.request("POST", "/public/x", { body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(called).toBe(false);
    expect(isOutcomeUnknown(err)).toBe(false);
    expect(String(err)).not.toMatch(/may or may not have been applied/);
  });

  it("isOutcomeUnknown does not trust message text from upstream", async () => {
    const echo = new Response(
      "the request may or may not have been applied upstream; check the current state before repeating it",
      { status: 400 },
    );
    const err = await clientWith([echo])
      .client.request("PUT", "/public/x", { body: {} })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BitwardenApiError);
    expect(isOutcomeUnknown(err)).toBe(false);
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
