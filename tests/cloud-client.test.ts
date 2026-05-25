import { describe, it, expect, vi } from "vitest";
import { CloudHttpClient } from "../src/http/cloud-client.js";
import { OAuthTokenCache } from "../src/http/oauth-token-cache.js";

describe("CloudHttpClient", () => {
  it("hits api.bitwarden.com with bearer auth", async () => {
    const fetchImpl = vi.fn(async (u: any, init?: RequestInit) => {
      const req = new Request(u instanceof Request ? u : String(u), init);
      if (req.url.endsWith("/connect/token")) {
        return new Response(JSON.stringify({ access_token: "c1", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      expect(req.url).toBe("https://api.bitwarden.com/public/organization/subscription");
      expect(req.headers.get("authorization")).toBe("Bearer c1");
      return new Response(JSON.stringify({ plan: "Enterprise" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const cache = new OAuthTokenCache({
      tokenUrl: "https://identity.bitwarden.com/connect/token",
      clientId: "organization.c",
      clientSecret: "s",
      scope: "api.organization",
      fetch: fetchImpl,
    });
    const c = new CloudHttpClient({
      apiBase: "https://api.bitwarden.com",
      tokenCache: cache,
      fetch: fetchImpl,
      sleep: async () => {},
    });
    const res = await c.request("GET", "/public/organization/subscription");
    expect(res.status).toBe(200);
  });
});
