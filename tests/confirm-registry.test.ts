// Registry-wide confirm gate: with BITWARDEN_CONFIRM_WRITES=true, every tool
// that can change state (by annotation or by name) carries the confirm
// parameter and, called without it, sends no write upstream and makes no
// SDK write. The gate keys on annotations only, so a write tool annotated
// read-only would slip through; the name check catches that.
import { describe, it, expect, vi } from "vitest";
import { buildRegistry, type Clients } from "../src/index.js";
import { BitwardenHttpClient } from "../src/http/bitwarden-http-client.js";
import { SmHttpClient } from "../src/http/sm-client.js";
import { OAuthTokenCache } from "../src/http/oauth-token-cache.js";
import type { Config } from "../src/config.js";
import type { SmSdkClient } from "../src/http/sm-sdk-client.js";
import type { ToolDef } from "../src/types.js";
import { textOf } from "./helpers.js";

const WRITE_NAME =
  /_(create|update|delete|remove|set|set_members|set_groups|invite|reinvite|import|grant|grant_sm|grant_project|revoke|revoke_sm|revoke_project)$|^bw_raw_request$/;

// Web-vault stubs: named like writes, annotated read-only, never call anything.
const INERT_STUBS = new Set([
  "bws_machine_account_create",
  "bws_machine_account_update",
  "bws_machine_account_delete",
  "bws_machine_account_grant_project",
  "bws_machine_account_revoke_project",
  "bws_access_token_create",
  "bws_access_token_revoke",
]);

const instance = {
  apiBase: "https://vault.example.invalid/api",
  identityUrl: "https://vault.example.invalid/identity",
  clientId: "organization.FAKE",
  clientSecret: "FAKE-SECRET-1",
};

function setup() {
  const sent: string[] = [];
  const fetchImpl = vi.fn(async (u: unknown, init?: RequestInit) => {
    const url = String(u);
    if (url.endsWith("/connect/token")) {
      return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    sent.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const tokenCache = new OAuthTokenCache({
    tokenUrl: `${instance.identityUrl}/connect/token`,
    clientId: instance.clientId,
    clientSecret: instance.clientSecret,
    scope: "api.organization",
    fetch: fetchImpl,
  });
  const http = (apiBase: string) =>
    new BitwardenHttpClient({ apiBase, tokenCache, fetch: fetchImpl });
  const meta = { id: "s1", key: "K", value: "V", note: "", organizationId: "org-1" };
  const project = { id: "p1", name: "proj", organizationId: "org-1" };
  const sdk: SmSdkClient = {
    projectList: vi.fn(async () => []),
    projectGet: vi.fn(async () => project),
    projectCreate: vi.fn(async () => project),
    projectUpdate: vi.fn(async () => project),
    projectDelete: vi.fn(async () => ({})),
    secretList: vi.fn(async () => []),
    secretGet: vi.fn(async () => meta),
    secretCreate: vi.fn(async () => meta),
    secretUpdate: vi.fn(async () => meta),
    secretDelete: vi.fn(async () => ({})),
  };
  const clients: Clients = {
    selfhost: http(instance.apiBase),
    cloud: http("https://cloud.example.invalid"),
    sm: new SmHttpClient({ apiBase: instance.apiBase, tokenCache, fetch: fetchImpl }),
    smSdk: sdk,
  };
  const config: Config = {
    selfhost: instance,
    cloud: { ...instance, apiBase: "https://cloud.example.invalid" },
    sm: {
      apiBase: instance.apiBase,
      identityUrl: instance.identityUrl,
      parsedToken: {
        accessTokenUuid: "FAKE-UUID-1",
        clientSecret: "FAKE-SECRET-2",
        encryptionKey: "FAKE-KEY-1",
      },
      orgId: "org-1",
    },
    confirmWrites: true,
    readOnly: false,
    logLevel: "error",
    httpTimeoutMs: 30_000,
    paginationMaxItems: 100,
    paginationMaxPages: 5,
    maxListResponseBytes: 60_000,
    maxResponseBytes: 1_048_576,
  };
  return { registry: buildRegistry(config, clients), sent, sdk };
}

type Prop = { type?: string | string[]; enum?: unknown[] };

/** Minimal input that fills every required parameter with a plausible value. */
function minimalInput(tool: ToolDef): Record<string, unknown> {
  const schema = tool.inputSchema as { properties?: Record<string, Prop>; required?: string[] };
  const input: Record<string, unknown> = {};
  for (const name of schema.required ?? []) {
    const p = schema.properties?.[name] ?? {};
    const type = Array.isArray(p.type) ? p.type[0] : p.type;
    if (p.enum) input[name] = name === "method" ? "DELETE" : p.enum[0];
    else if (type === "integer" || type === "number") input[name] = 1;
    else if (type === "boolean") input[name] = true;
    else if (type === "array") input[name] = [];
    else if (type === "object") input[name] = {};
    else input[name] = name === "path" ? "/public/members/m1" : "x1";
  }
  return input;
}

const isWrite = (t: ToolDef) => t.annotations.destructiveHint || !t.annotations.readOnlyHint;
const hasConfirm = (t: ToolDef) =>
  "confirm" in ((t.inputSchema as { properties?: object }).properties ?? {});

describe("confirm gate over the whole registry (BITWARDEN_CONFIRM_WRITES=true)", () => {
  it("every tool named like a write is gated, except the known inert web-vault stubs", () => {
    const { registry } = setup();
    const ungated = registry
      .getAll()
      .filter((t) => (isWrite(t) || WRITE_NAME.test(t.name)) && !hasConfirm(t))
      .map((t) => t.name);
    expect(ungated.sort()).toEqual([...INERT_STUBS].sort());
  });

  it("no gated tool sends a write or calls an SDK write without confirm", async () => {
    const { registry, sent, sdk } = setup();
    const gated = registry.getAll().filter(hasConfirm);
    expect(gated.length).toBeGreaterThan(0);
    for (const tool of gated) {
      await tool.handler(minimalInput(tool));
    }
    expect(sent.filter((r) => !r.startsWith("GET "))).toEqual([]);
    for (const m of [
      "projectCreate",
      "projectUpdate",
      "projectDelete",
      "secretCreate",
      "secretUpdate",
      "secretDelete",
    ] as const) {
      expect(sdk[m], m).not.toHaveBeenCalled();
    }
  });

  it("the inert stubs return the web-vault error and call nothing", async () => {
    const { registry, sent, sdk } = setup();
    for (const name of INERT_STUBS) {
      const tool = registry.getByName(name)!;
      const res = await tool.handler(minimalInput(tool));
      expect(res.isError, name).toBe(true);
      expect(textOf(res), name).toMatch(/web vault/i);
    }
    expect(sent).toEqual([]);
    for (const fn of Object.values(sdk)) expect(fn).not.toHaveBeenCalled();
  });
});
