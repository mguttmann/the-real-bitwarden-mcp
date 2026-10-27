// Tool contract guard: the tools/list surface (names, required, property
// names) must match the production baseline in tests/fixtures/tool-contract.json.
// A removed or renamed tool, or a changed required list, fails here.
// The SM config runs without the native SDK (smSdk undefined), which is
// how the real bws_* tool definitions are registered when the binary is
// missing, so the test is deterministic on every platform.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildRegistry, type Clients } from "../src/index.js";
import { createMcpServer } from "../src/server.js";
import { createLogger } from "../src/logger.js";
import { BitwardenHttpClient } from "../src/http/bitwarden-http-client.js";
import { SmHttpClient } from "../src/http/sm-client.js";
import { OAuthTokenCache } from "../src/http/oauth-token-cache.js";
import type { Config } from "../src/config.js";

type ContractEntry = { name: string; required: string[]; properties: string[] };
type Contract = { selfhostCloud: ContractEntry[]; selfhostCloudBws: ContractEntry[] };

const contract = JSON.parse(
  readFileSync(new URL("./fixtures/tool-contract.json", import.meta.url), "utf8"),
) as Contract;

const instance = {
  apiBase: "https://vault.example.invalid/api",
  identityUrl: "https://vault.example.invalid/identity",
  clientId: "FAKE-CLIENT-ID",
  clientSecret: "FAKE-SECRET-1",
};

function config(withSm: boolean): Config {
  return {
    selfhost: instance,
    cloud: { ...instance, apiBase: "https://cloud.example.invalid" },
    sm: withSm
      ? {
          apiBase: "https://vault.example.invalid/api",
          identityUrl: "https://vault.example.invalid/identity",
          parsedToken: {
            accessTokenUuid: "FAKE-UUID-1",
            clientSecret: "FAKE-SECRET-2",
            encryptionKey: "FAKE-KEY-1",
          },
        }
      : undefined,
    confirmWrites: true,
    readOnly: false,
    logLevel: "error",
    httpTimeoutMs: 30_000,
    paginationMaxItems: 1000,
    paginationMaxPages: 20,
    maxListResponseBytes: 60_000,
  };
}

function clients(withSm: boolean): Clients {
  const tokenCache = new OAuthTokenCache({
    tokenUrl: "https://vault.example.invalid/identity/connect/token",
    clientId: "FAKE-CLIENT-ID",
    clientSecret: "FAKE-SECRET-1",
    scope: "api.organization",
    fetch: async () => {
      throw new Error("network disabled in tests");
    },
  });
  return {
    selfhost: new BitwardenHttpClient({ apiBase: instance.apiBase, tokenCache }),
    cloud: new BitwardenHttpClient({ apiBase: "https://cloud.example.invalid", tokenCache }),
    sm: withSm ? new SmHttpClient({ apiBase: instance.apiBase, tokenCache }) : undefined,
    smSdk: undefined,
  };
}

async function listContract(withSm: boolean): Promise<ContractEntry[]> {
  const server = createMcpServer(
    buildRegistry(config(withSm), clients(withSm)),
    createLogger("error"),
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "contract-test", version: "0" }, { capabilities: {} });
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    return tools
      .map((t) => ({
        name: t.name,
        required: (t.inputSchema.required as string[] | undefined) ?? [],
        properties: Object.keys(t.inputSchema.properties ?? {}).sort(),
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } finally {
    await client.close();
    await server.close();
  }
}

describe("tool contract", () => {
  for (const [label, withSm, expected] of [
    ["selfhost + cloud", false, contract.selfhostCloud],
    ["selfhost + cloud + BWS (no native SDK)", true, contract.selfhostCloudBws],
  ] as const) {
    it(`tools/list matches the pinned contract for ${label}`, async () => {
      const actual = await listContract(withSm);
      expect(actual.map((t) => t.name)).toEqual(expected.map((t) => t.name));
      expect(actual).toEqual(expected);
      expect(actual).toHaveLength(54);
    });
  }
});
