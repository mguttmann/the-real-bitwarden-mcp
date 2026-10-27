import { describe, it, expect } from "vitest";
import { buildRegistry, type Clients } from "../src/index.js";
import { BitwardenHttpClient } from "../src/http/bitwarden-http-client.js";
import { SmHttpClient } from "../src/http/sm-client.js";
import { OAuthTokenCache } from "../src/http/oauth-token-cache.js";
import type { Config } from "../src/config.js";
import type { SmSdkClient } from "../src/http/sm-sdk-client.js";
import { vi } from "vitest";
import { textOf } from "./helpers.js";

function emptyConfig(overrides: Partial<Config>): Config {
  return {
    selfhost: undefined,
    cloud: undefined,
    sm: undefined,
    confirmWrites: false,
    logLevel: "error",
    httpTimeoutMs: 30000,
    paginationMaxItems: 100,
    paginationMaxPages: 5,
    maxListResponseBytes: 60000,
    ...overrides,
  };
}

function stubSmSdk(): SmSdkClient {
  return {
    projectList: vi.fn(async () => []),
    projectGet: vi.fn(async () => ({ id: "p1", name: "proj", organizationId: "org-1" })),
    projectCreate: vi.fn(async () => ({ id: "p2", name: "proj", organizationId: "org-1" })),
    projectUpdate: vi.fn(async () => ({ id: "p1", name: "proj", organizationId: "org-1" })),
    projectDelete: vi.fn(async () => ({})),
    secretList: vi.fn(async () => []),
    secretGet: vi.fn(async () => ({
      id: "s1",
      key: "K",
      value: "V",
      note: "",
      organizationId: "org-1",
    })),
    secretCreate: vi.fn(async () => ({
      id: "s2",
      key: "K",
      value: "V",
      note: "",
      organizationId: "org-1",
    })),
    secretUpdate: vi.fn(async () => ({
      id: "s1",
      key: "K",
      value: "V2",
      note: "",
      organizationId: "org-1",
    })),
    secretDelete: vi.fn(async () => ({})),
  };
}

function fakeClients(opts: {
  selfhost: boolean;
  cloud: boolean;
  sm: boolean;
  smSdk?: SmSdkClient;
}): Clients {
  const dummyCache = new OAuthTokenCache({
    tokenUrl: "x",
    clientId: "x",
    clientSecret: "x",
    scope: "x",
    fetch: async () => new Response("{}", { status: 200 }),
  });
  return {
    selfhost: opts.selfhost
      ? new BitwardenHttpClient({ apiBase: "https://s/api", tokenCache: dummyCache })
      : undefined,
    cloud: opts.cloud
      ? new BitwardenHttpClient({ apiBase: "https://c", tokenCache: dummyCache })
      : undefined,
    sm: opts.sm
      ? new SmHttpClient({ apiBase: "https://s/api", tokenCache: dummyCache })
      : undefined,
    smSdk: opts.smSdk,
  };
}

const smConfig = {
  apiBase: "https://vault.example.com/api",
  identityUrl: "https://vault.example.com/identity",
  parsedToken: { accessTokenUuid: "uuid-1", clientSecret: "secret-1", encryptionKey: "key-1" },
  orgId: "org-1",
};

describe("buildRegistry", () => {
  it("self-host-only registers operational + raw_request + help (no license)", () => {
    const cfg = emptyConfig({
      selfhost: { apiBase: "x", identityUrl: "y", clientId: "z", clientSecret: "w" },
    });
    const reg = buildRegistry(cfg, fakeClients({ selfhost: true, cloud: false, sm: false }));
    expect(reg.getByName("bw_member_list")).toBeDefined();
    expect(reg.getByName("bw_raw_request")).toBeDefined();
    expect(reg.getByName("bw_help")).toBeDefined();
    expect(reg.getByName("bw_license_subscription_get")).toBeUndefined();
  });

  it("cloud-only registers only license + raw + help", () => {
    const cfg = emptyConfig({
      cloud: { apiBase: "x", identityUrl: "y", clientId: "z", clientSecret: "w" },
    });
    const reg = buildRegistry(cfg, fakeClients({ selfhost: false, cloud: true, sm: false }));
    expect(reg.getByName("bw_license_subscription_get")).toBeDefined();
    expect(reg.getByName("bw_member_list")).toBeUndefined();
  });

  it("registers SM tools but as 'not configured' stubs when token missing", async () => {
    const cfg = emptyConfig({
      selfhost: { apiBase: "x", identityUrl: "y", clientId: "z", clientSecret: "w" },
    });
    const reg = buildRegistry(cfg, fakeClients({ selfhost: true, cloud: false, sm: false }));
    const stub = reg.getByName("bws_project_list");
    expect(stub).toBeDefined();
    const res = await stub!.handler({});
    expect(res.isError).toBe(true);
    expect(textOf(res).toLowerCase()).toContain("not configured");
  });

  it("registers SM tools with working SDK when smSdk is provided", async () => {
    const cfg = emptyConfig({
      selfhost: { apiBase: "x", identityUrl: "y", clientId: "z", clientSecret: "w" },
      sm: smConfig,
    });
    const sdk = stubSmSdk();
    const reg = buildRegistry(
      cfg,
      fakeClients({ selfhost: true, cloud: false, sm: true, smSdk: sdk }),
    );

    // Project tools should be registered and functional
    const projectList = reg.getByName("bws_project_list");
    expect(projectList).toBeDefined();

    // MA tools should be stubs returning isError with web-vault message
    const maList = reg.getByName("bws_machine_account_list");
    expect(maList).toBeDefined();
    const maRes = await maList!.handler({});
    expect(maRes.isError).toBe(true);
    expect(textOf(maRes)).toMatch(/web vault/i);
  });

  it("registers SM tools as SDK-unavailable stubs when smSdk is undefined but sm is configured", async () => {
    const cfg = emptyConfig({
      selfhost: { apiBase: "x", identityUrl: "y", clientId: "z", clientSecret: "w" },
      sm: smConfig,
    });
    // smSdk: undefined simulates platform not supporting the native binary
    const reg = buildRegistry(
      cfg,
      fakeClients({ selfhost: true, cloud: false, sm: true, smSdk: undefined }),
    );

    const stub = reg.getByName("bws_project_list");
    expect(stub).toBeDefined();
    const res = await stub!.handler({ organizationId: "org-1" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/SDK not available/i);
  });
});
