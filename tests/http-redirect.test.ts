import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BitwardenHttpClient } from "../src/http/bitwarden-http-client.js";
import { OAuthTokenCache } from "../src/http/oauth-token-cache.js";

// Audit case redirect-follow-resends-body: fetch followed redirects, and a
// 307/308 re-sent the token POST body (client_secret) and API write bodies to
// the redirect target. Two real local servers: "upstream" redirects
// everything to "target"; "target" must never see a request.

type Seen = { method: string; url: string; body: string };

function listen(handler: Parameters<typeof createServer>[1]): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    // Port 0: the OS picks a free ephemeral (high) port; loopback only.
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function baseUrl(server: Server): string {
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("redirects are never followed", () => {
  const targetSeen: Seen[] = [];
  let target: Server;
  let upstream: Server;
  let redirectStatus = 307;

  beforeAll(async () => {
    target = await listen((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        targetSeen.push({ method: req.method ?? "", url: req.url ?? "", body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ access_token: "FAKE-TOKEN-2", expires_in: 3600 }));
      });
    });
    upstream = await listen((req, res) => {
      req.resume();
      req.on("end", () => {
        if (req.url === "/identity/connect/token-ok") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ access_token: "FAKE-TOKEN-1", expires_in: 3600 }));
          return;
        }
        res.writeHead(redirectStatus, { location: `${baseUrl(target)}/steal${req.url}` });
        res.end();
      });
    });
  });

  afterAll(async () => {
    await new Promise((r) => upstream.close(r));
    await new Promise((r) => target.close(r));
  });

  for (const status of [301, 302, 307, 308]) {
    it(`token request: ${status} is an error and the client_secret is not re-sent`, async () => {
      redirectStatus = status;
      targetSeen.length = 0;
      const cache = new OAuthTokenCache({
        tokenUrl: `${baseUrl(upstream)}/identity/connect/token`,
        clientId: "organization.fake",
        clientSecret: "FAKE-SECRET-1",
        scope: "api.organization",
      });
      await expect(cache.getToken()).rejects.toThrow(
        new RegExp(`OAuth token request failed: ${status} \\(redirect not followed\\)`),
      );
      expect(targetSeen).toEqual([]);
    });

    it(`API write: ${status} is an error, not retried, and the body is not re-sent`, async () => {
      redirectStatus = status;
      targetSeen.length = 0;
      let sleeps = 0;
      const client = new BitwardenHttpClient({
        apiBase: `${baseUrl(upstream)}/api`,
        tokenCache: new OAuthTokenCache({
          tokenUrl: `${baseUrl(upstream)}/identity/connect/token-ok`,
          clientId: "organization.fake",
          clientSecret: "FAKE-SECRET-1",
          scope: "api.organization",
        }),
        sleep: async () => {
          sleeps++;
        },
      });
      const err = await client
        .request("PUT", "/public/members/x", { body: { pw: "FAKE-SECRET-3" } })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(new RegExp(`HTTP ${status} redirect not followed`));
      expect((err as { status?: number }).status).toBe(status);
      await expect(client.request("GET", "/public/members")).rejects.toThrow(/redirect/);
      expect(sleeps).toBe(0);
      expect(targetSeen).toEqual([]);
    });
  }
});
