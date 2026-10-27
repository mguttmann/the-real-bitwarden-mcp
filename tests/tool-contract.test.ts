// Tool contract guard: the tools/list surface (names, required, property
// names) against the production baseline in tests/fixtures/tool-contract.json.
// Names and required lists must be identical; property names must be a
// superset of the baseline, and every added property must be recorded in
// tests/fixtures/tool-contract-added.json (rule: scripts/tool-contract.mjs).
// A removed or renamed tool or property, or a changed required list, fails.
// The SM config runs without the native SDK (smSdk undefined), which is
// how the real bws_* tool definitions are registered when the binary is
// missing, so the test is deterministic on every platform.
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { buildRegistry, type Clients } from "../src/index.js";
import { createMcpServer } from "../src/server.js";
import { createLogger } from "../src/logger.js";
import { BitwardenHttpClient } from "../src/http/bitwarden-http-client.js";
import { SmHttpClient } from "../src/http/sm-client.js";
import { OAuthTokenCache } from "../src/http/oauth-token-cache.js";
import type { Config } from "../src/config.js";

import {
  contractViolations,
  expectedContract,
  loadContractFixtures,
  type ContractEntry,
} from "../scripts/tool-contract.mjs";

const { baseline, added } = loadContractFixtures(fileURLToPath(new URL("..", import.meta.url)));

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
  for (const [label, withSm, cfg] of [
    ["selfhost + cloud", false, "selfhostCloud"],
    ["selfhost + cloud + BWS (no native SDK)", true, "selfhostCloudBws"],
  ] as const) {
    it(`tools/list keeps the baseline contract for ${label}`, async () => {
      const actual = await listContract(withSm);
      expect(contractViolations(actual, baseline[cfg], added[cfg])).toEqual([]);
      expect(actual).toEqual(expectedContract(baseline[cfg], added[cfg]));
      expect(actual).toHaveLength(54);
    });
  }
});

describe("contract rule", () => {
  const base: ContractEntry[] = [
    { name: "bw_a", required: ["id"], properties: ["confirm", "id"] },
    { name: "bw_b", required: [], properties: [] },
  ];
  const withProp = (name: string, extra: string[]) =>
    base.map((t) =>
      t.name === name ? { ...t, properties: [...t.properties, ...extra].sort() } : t,
    );

  it("the baseline itself passes", () => {
    expect(contractViolations(base, base, {})).toEqual([]);
  });

  it("removing a baseline property fails", () => {
    const actual = base.map((t) => (t.name === "bw_a" ? { ...t, properties: ["id"] } : t));
    expect(contractViolations(actual, base, {})).toEqual([
      "bw_a: baseline property removed: confirm",
    ]);
  });

  it("removing a baseline property still fails when the added list names others", () => {
    const actual = base.map((t) => (t.name === "bw_a" ? { ...t, properties: ["id", "x"] } : t));
    expect(contractViolations(actual, base, { bw_a: ["x"] })).toEqual([
      "bw_a: baseline property removed: confirm",
    ]);
  });

  it("a recorded optional property passes", () => {
    expect(contractViolations(withProp("bw_a", ["note"]), base, { bw_a: ["note"] })).toEqual([]);
  });

  it("an unrecorded added property fails", () => {
    expect(contractViolations(withProp("bw_a", ["note"]), base, {})).toEqual([
      "bw_a: property not recorded in tool-contract-added.json: note",
    ]);
  });

  it("a recorded property that the tool does not list fails", () => {
    expect(contractViolations(base, base, { bw_a: ["note"] })).toEqual([
      "bw_a: recorded added property missing: note",
    ]);
  });

  it("a new property that is also required fails", () => {
    const actual = base.map((t) =>
      t.name === "bw_a"
        ? { ...t, required: ["id", "note"], properties: ["confirm", "id", "note"] }
        : t,
    );
    expect(contractViolations(actual, base, { bw_a: ["note"] })).toEqual([
      "bw_a: required changed from [id] to [id,note]",
    ]);
  });

  it("a removed, renamed or added tool fails", () => {
    const renamed = [base[0]!, { ...base[1]!, name: "bw_c" }];
    expect(contractViolations(renamed, base, {})).toEqual([
      "tool not in the baseline: bw_c",
      "tool missing: bw_b",
    ]);
  });

  it("the added fixture records no property that is already in the baseline", () => {
    for (const cfg of ["selfhostCloud", "selfhostCloudBws"] as const) {
      for (const [tool, props] of Object.entries(added[cfg])) {
        const entry = baseline[cfg].find((t) => t.name === tool);
        expect(entry, `${cfg} ${tool}`).toBeDefined();
        for (const p of props) expect(entry!.properties, `${cfg} ${tool}`).not.toContain(p);
      }
    }
  });
});
