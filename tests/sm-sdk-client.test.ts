import { describe, it, expect, vi } from "vitest";
import { tryLoadSmSdk } from "../src/http/sm-sdk-client.js";
import {
  SM_LOGIN_REUSE_TIMEOUTS,
  TOKEN_BACKOFF_FAILURES,
  TOKEN_BACKOFF_MS,
} from "../src/limits.js";

// A fake @bitwarden/sdk-napi module. No native binary, no network.
type FakeOpts = {
  login?: () => Promise<void>;
  projectList?: () => Promise<unknown>;
  projectDelete?: () => Promise<unknown>;
  secretDelete?: () => Promise<unknown>;
  secretGet?: () => Promise<unknown>;
  secretUpdate?: (...args: unknown[]) => Promise<unknown>;
};

function fakeModule(opts: FakeOpts = {}) {
  const constructed: unknown[] = [];
  const login = vi.fn(opts.login ?? (async () => {}));
  const secretGet = vi.fn(opts.secretGet ?? (async () => currentSecret));
  const secretUpdate = vi.fn(opts.secretUpdate ?? (async () => currentSecret));
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
      return {
        delete: opts.secretDelete ?? (async () => ({ data: [] })),
        get: secretGet,
        update: secretUpdate,
      };
    }
  }
  return { mod: { BitwardenClient }, login, constructed, secretGet, secretUpdate };
}

const init = {
  accessToken: "0.FAKE-UUID-1.FAKE-SECRET-1:FAKE-KEY-1",
  apiUrl: "https://vault.example.invalid/api",
  identityUrl: "https://vault.example.invalid/identity",
  timeoutMs: 50,
};

const never = () => new Promise<never>(() => {});
const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const currentSecret = {
  id: "s1",
  key: "K",
  value: "FAKE-SECRET-1",
  note: "keep me",
  organizationId: "org-1",
  projectId: "p9",
};

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

  it("pauses SDK logins after repeated failures; a success after the pause resets", async () => {
    let t = 5_000_000;
    let fail = true;
    const fake = fakeModule({
      login: async () => {
        if (fail) throw new Error("invalid_client");
      },
    });
    const loaded = await tryLoadSmSdk({ ...init, now: () => t }, async () => fake.mod);
    if (!loaded.ok) throw new Error("load failed");
    const client = loaded.client;
    for (let i = 0; i < TOKEN_BACKOFF_FAILURES; i++) {
      await expect(client.projectList("org-1")).rejects.toThrow(/SDK login failed/);
    }
    await expect(client.projectList("org-1")).rejects.toThrow(
      new RegExp(`identity backoff: .*retry after ${TOKEN_BACKOFF_MS / 1000} s`),
    );
    expect(fake.login).toHaveBeenCalledTimes(TOKEN_BACKOFF_FAILURES);
    t += TOKEN_BACKOFF_MS;
    fail = false;
    await expect(client.projectList("org-1")).resolves.toEqual([]);
    expect(fake.login).toHaveBeenCalledTimes(TOKEN_BACKOFF_FAILURES + 1);
  });

  it("counts a timed-out SDK login as a failure once it is given up", async () => {
    let t = 7_000_000;
    const fake = fakeModule({ login: never });
    const loaded = await tryLoadSmSdk({ ...init, now: () => t }, async () => fake.mod);
    if (!loaded.ok) throw new Error("load failed");
    const client = loaded.client;
    for (let i = 0; i < TOKEN_BACKOFF_FAILURES; i++) {
      await expect(client.projectList("org-1")).rejects.toThrow(/login timed out/);
      // Past the reuse window: the next call gives this login up.
      t += SM_LOGIN_REUSE_TIMEOUTS * init.timeoutMs;
    }
    await expect(client.projectList("org-1")).rejects.toThrow(/identity backoff/);
    expect(fake.login).toHaveBeenCalledTimes(TOKEN_BACKOFF_FAILURES);
  });

  // Backlog sm-call-total-duration: login and call had a deadline each.
  it("one deadline covers the login and the SDK call", async () => {
    const client = await load(
      fakeModule({
        login: () => after(30),
        projectList: async () => {
          await after(30);
          return { data: [] };
        },
      }),
    );
    await expect(client.projectList("org-1")).rejects.toThrow(/timed out after 50 ms/);
  });

  it("an update that keeps note and project reads and writes within one deadline", async () => {
    const fake = fakeModule({
      secretGet: async () => {
        await after(30);
        return currentSecret;
      },
      secretUpdate: async () => {
        await after(30);
        return currentSecret;
      },
    });
    const client = await load(fake);
    await expect(
      client.secretUpdate("org-1", "s1", "K", "V2", undefined, undefined),
    ).rejects.toThrow(/timed out after 50 ms; .*may or may not have been applied/);
  });

  it("an update fills an omitted note or projectIds from the current secret", async () => {
    const fake = fakeModule();
    const client = await load(fake);
    await client.secretUpdate("org-1", "s1", "K", "V2", undefined, undefined);
    expect(fake.secretGet).toHaveBeenCalledWith("s1");
    expect(fake.secretUpdate).toHaveBeenLastCalledWith("org-1", "s1", "K", "V2", "keep me", ["p9"]);
    await client.secretUpdate("org-1", "s1", "K", "V2", undefined, ["p2"]);
    expect(fake.secretUpdate).toHaveBeenLastCalledWith("org-1", "s1", "K", "V2", "keep me", ["p2"]);
    await client.secretUpdate("org-1", "s1", "K", "V2", "", undefined);
    expect(fake.secretUpdate).toHaveBeenLastCalledWith("org-1", "s1", "K", "V2", "", ["p9"]);
    fake.secretGet.mockClear();
    await client.secretUpdate("org-1", "s1", "K", "V2", "n", []);
    expect(fake.secretGet).not.toHaveBeenCalled();
    expect(fake.secretUpdate).toHaveBeenLastCalledWith("org-1", "s1", "K", "V2", "n", []);
  });

  it("an update does not write when reading the current secret fails", async () => {
    const fake = fakeModule({
      secretGet: async () => {
        throw new Error("Secret not found.");
      },
    });
    const client = await load(fake);
    await expect(
      client.secretUpdate("org-1", "s1", "K", "V", undefined, undefined),
    ).rejects.toThrow("Secret not found.");
    expect(fake.secretUpdate).not.toHaveBeenCalled();
  });

  // Backlog sm-login-timeout-overlap: a timed-out login kept running and the
  // next call started a second one.
  it("a login that timed out is reused by the next call when it later succeeds", async () => {
    const fake = fakeModule({ login: () => after(80) });
    const client = await load(fake);
    await expect(client.projectList("org-1")).rejects.toThrow(/login timed out after 50 ms/);
    await expect(client.projectList("org-1")).resolves.toEqual([]);
    expect(fake.login).toHaveBeenCalledTimes(1);
    expect(fake.constructed).toHaveLength(1);
  });

  it("concurrent calls share one login", async () => {
    const fake = fakeModule({ login: () => after(10) });
    const client = await load(fake);
    await Promise.all([client.projectList("org-1"), client.projectList("org-1")]);
    expect(fake.login).toHaveBeenCalledTimes(1);
  });
});
