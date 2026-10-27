import { describe, it, expect, vi } from "vitest";
import { tryLoadSmSdk } from "../src/http/sm-sdk-client.js";

// A fake @bitwarden/sdk-napi module. No native binary, no network.
type FakeOpts = {
  login?: () => Promise<void>;
  projectList?: () => Promise<unknown>;
  projectDelete?: () => Promise<unknown>;
  secretDelete?: () => Promise<unknown>;
};

function fakeModule(opts: FakeOpts = {}) {
  const constructed: unknown[] = [];
  const login = vi.fn(opts.login ?? (async () => {}));
  class BitwardenClient {
    constructor(settings: unknown) {
      constructed.push(settings);
    }
    auth() {
      return { loginAccessToken: login };
    }
    projects() {
      return {
        list: opts.projectList ?? (async () => ({ data: [] })),
        delete: opts.projectDelete ?? (async () => ({ data: [] })),
      };
    }
    secrets() {
      return { delete: opts.secretDelete ?? (async () => ({ data: [] })) };
    }
  }
  return { mod: { BitwardenClient }, login, constructed };
}

const init = {
  accessToken: "0.FAKE-UUID-1.FAKE-SECRET-1:FAKE-KEY-1",
  apiUrl: "https://vault.example.invalid/api",
  identityUrl: "https://vault.example.invalid/identity",
  timeoutMs: 50,
};

const never = () => new Promise<never>(() => {});

async function load(fake: ReturnType<typeof fakeModule>) {
  const loaded = await tryLoadSmSdk(init, async () => fake.mod);
  if (!loaded.ok) throw new Error(`load failed: ${loaded.error.message}`);
  return loaded.client;
}

describe("tryLoadSmSdk", () => {
  // Audit case sm-sdk-login-blocks-startup: the login ran inside startup,
  // before the stdio transport connected.
  it("does not log in at load time, so startup never waits for the identity server", async () => {
    const fake = fakeModule({ login: never });
    const loaded = await tryLoadSmSdk(init, async () => fake.mod);
    expect(loaded.ok).toBe(true);
    expect(fake.login).not.toHaveBeenCalled();
  });

  it("reports a missing module as a load error", async () => {
    const loaded = await tryLoadSmSdk(init, async () => {
      throw new Error("Cannot find module '@bitwarden/sdk-napi-linux-arm64-gnu'");
    });
    expect(loaded).toMatchObject({ ok: false, error: { kind: "module_not_found" } });
  });

  // Audit case sdk-calls-no-timeout.
  it("times out a login that does not answer", async () => {
    const client = await load(fakeModule({ login: never }));
    await expect(client.projectList("org-1")).rejects.toThrow(/login timed out after 50 ms/);
  });

  it("times out an SDK call that does not answer; a write says the outcome is unknown", async () => {
    const client = await load(fakeModule({ projectList: never, secretDelete: never }));
    await expect(client.projectList("org-1")).rejects.toThrow(/call timed out after 50 ms/);
    await expect(client.secretDelete("s1")).rejects.toThrow(/may or may not have been applied/);
  });

  // Audit case sdk-init-failed-misreported: a failed login looked like a
  // missing platform binary and needed a restart.
  it("reports a failed login as a login error and retries the login on the next call", async () => {
    let attempt = 0;
    const fake = fakeModule({
      login: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("invalid_client");
      },
    });
    const client = await load(fake);
    await expect(client.projectList("org-1")).rejects.toThrow(
      /Secrets Manager SDK login failed: invalid_client/,
    );
    await expect(client.projectList("org-1")).resolves.toEqual([]);
    expect(fake.login).toHaveBeenCalledTimes(2);
    // Logged in once: later calls reuse the session.
    await client.projectList("org-1");
    expect(fake.login).toHaveBeenCalledTimes(2);
  });

  // Audit case sm-delete-per-item-error-hidden.
  it("turns a per-item delete error into an error naming the id", async () => {
    const client = await load(
      fakeModule({
        projectDelete: async () => ({ data: [{ id: "p1", error: "Project not found." }] }),
        secretDelete: async () => ({ data: [{ id: "s1", error: "Secret not found." }] }),
      }),
    );
    await expect(client.projectDelete("p1")).rejects.toThrow(/p1: Project not found\./);
    await expect(client.secretDelete("s1")).rejects.toThrow(/s1: Secret not found\./);
  });

  it("returns a delete result without per-item errors unchanged", async () => {
    const result = { data: [{ id: "s1", error: null }] };
    const client = await load(fakeModule({ secretDelete: async () => result }));
    await expect(client.secretDelete("s1")).resolves.toEqual(result);
  });
});
