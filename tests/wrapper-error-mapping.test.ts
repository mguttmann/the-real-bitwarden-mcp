// What a wrapper tool returns when the upstream answers 4xx/5xx: the real
// HTTP client (mocked fetch) and the real error mapping, one tool per
// family (self-host Public API, cloud license API).
import { describe, it, expect, vi } from "vitest";
import { BitwardenHttpClient } from "../src/http/bitwarden-http-client.js";
import { OAuthTokenCache } from "../src/http/oauth-token-cache.js";
import { makeCollectionGetTool } from "../src/tools/wrappers/bw_collection.js";
import { makeGroupDeleteTool } from "../src/tools/wrappers/bw_group.js";
import { makeLicenseSubscriptionGetTool } from "../src/tools/wrappers/bw_license.js";
import { textOf } from "./helpers.js";

function clientAnswering(status: number, body: unknown) {
  const apiCalls: string[] = [];
  const fetchImpl = vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u);
    if (url.endsWith("/connect/token")) {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    apiCalls.push(`${init?.method} ${new URL(url).pathname}`);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": typeof body === "string" ? "text/plain" : "application/json" },
    });
  });
  const tokenCache = new OAuthTokenCache({
    tokenUrl: "https://vault.example.invalid/identity/connect/token",
    clientId: "organization.FAKE",
    clientSecret: "FAKE-SECRET-1",
    scope: "api.organization",
    fetch: fetchImpl as typeof fetch,
  });
  const client = new BitwardenHttpClient({
    apiBase: "https://vault.example.invalid/api",
    tokenCache,
    fetch: fetchImpl as typeof fetch,
    sleep: async () => {},
  });
  return { client, apiCalls };
}

describe("wrapper tools on upstream errors", () => {
  it("self-host 400 with validation errors: isError with status, message and field errors", async () => {
    const { client, apiCalls } = clientAnswering(400, {
      Message: "The model state is invalid.",
      ValidationErrors: { Id: ["The Id field is not a valid GUID."] },
    });
    const res = await makeCollectionGetTool(client).handler({ id: "not-a-guid" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe(
      "BitwardenApiError[400 validation_error]: The model state is invalid. " +
        "(Id: The Id field is not a valid GUID.)",
    );
    expect(apiCalls).toEqual(["GET /api/public/collections/not-a-guid"]);
  });

  it("self-host 404 without a body: isError with the status only", async () => {
    const { client } = clientAnswering(404, "");
    const res = await makeCollectionGetTool(client).handler({ id: "c1" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe("BitwardenApiError[404 upstream_error]: HTTP 404");
  });

  it("self-host 500 on a write: isError, sent once, says the outcome is unknown", async () => {
    const { client, apiCalls } = clientAnswering(500, "boom");
    const res = await makeGroupDeleteTool(client).handler({ id: "g1" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/^BitwardenApiError\[500 upstream_error\]: /);
    expect(textOf(res)).toMatch(/may or may not have been applied/);
    expect(apiCalls).toEqual(["DELETE /api/public/groups/g1"]);
  });

  it("cloud 503 on a read: retried, then isError with the upstream text", async () => {
    const { client, apiCalls } = clientAnswering(503, "Service Unavailable");
    const res = await makeLicenseSubscriptionGetTool(client).handler({});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe("BitwardenApiError[503 upstream_error]: Service Unavailable");
    expect(apiCalls.length).toBeGreaterThan(1);
  });
});
