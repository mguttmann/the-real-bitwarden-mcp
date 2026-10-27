// Dynamic-loaded wrapper around @bitwarden/sdk-napi.
// Falls back gracefully when the binary isn't available for the current platform.

import { UNKNOWN_OUTCOME_HINT } from "./bitwarden-http-client.js";
import { SM_LOGIN_REUSE_TIMEOUTS } from "../limits.js";
import { TokenBackoff } from "./token-backoff.js";

type SdkProjectResponse = {
  id: string;
  name: string;
  organizationId: string;
  creationDate?: string;
  revisionDate?: string;
};
type SdkSecretIdentifier = { id: string; key: string; organizationId: string };
type SdkSecretResponse = {
  id: string;
  key: string;
  value: string;
  note: string;
  organizationId: string;
  projectId?: string | null;
  creationDate?: string;
  revisionDate?: string;
};

export type SmSdkClient = {
  projectList(orgId: string): Promise<SdkProjectResponse[]>;
  projectGet(id: string): Promise<SdkProjectResponse>;
  projectCreate(orgId: string, name: string): Promise<SdkProjectResponse>;
  projectUpdate(orgId: string, id: string, name: string): Promise<SdkProjectResponse>;
  projectDelete(id: string): Promise<unknown>;
  secretList(orgId: string): Promise<SdkSecretIdentifier[]>;
  secretGet(id: string): Promise<SdkSecretResponse>;
  secretCreate(
    orgId: string,
    key: string,
    value: string,
    note: string,
    projectIds: string[],
  ): Promise<SdkSecretResponse>;
  /**
   * The SDK update replaces the whole secret: an omitted (undefined) note or
   * projectIds is read from the current secret first, within the same
   * deadline.
   */
  secretUpdate(
    orgId: string,
    id: string,
    key: string,
    value: string,
    note: string | undefined,
    projectIds: string[] | undefined,
  ): Promise<SdkSecretResponse>;
  secretDelete(id: string): Promise<unknown>;
};

type SmSdkInit = {
  accessToken: string;
  apiUrl: string;
  identityUrl: string;
  /**
   * Deadline of one client method (HTTP_TIMEOUT_MS), covering the login it
   * may wait for and all SDK calls it makes.
   */
  timeoutMs: number;
  /** Clock for the login backoff and the login reuse window (tests). */
  now?: () => number;
};

export type SmSdkLoadError = {
  kind: "module_not_found" | "binary_not_available";
  message: string;
};

type DeleteResponse = { data?: { id: string; error?: string | null }[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ImportSdk = () => Promise<any>;

/** The SDK reports per-item delete failures inside a successful response. */
function failOnItemError<T>(result: T): T {
  const failed = (result as DeleteResponse | undefined)?.data?.filter((item) => item.error);
  if (failed && failed.length > 0) {
    throw new Error(
      `Secrets Manager delete failed for ${failed.map((item) => `${item.id}: ${item.error}`).join("; ")}`,
    );
  }
  return result;
}

/**
 * Try to load the Bitwarden SDK module. Returns a client on success, or an
 * error object describing why the module is not available. Never throws.
 * No network here: the login happens on the first SDK call, so startup does
 * not wait for the identity server. A failed or timed-out login is reported
 * by that call and retried by the next one.
 */
export async function tryLoadSmSdk(
  init: SmSdkInit,
  importSdk: ImportSdk = () => import("@bitwarden/sdk-napi"),
): Promise<{ ok: true; client: SmSdkClient } | { ok: false; error: SmSdkLoadError }> {
  // `any` is unavoidable here: the SDK is dynamic-imported because the native binary
  // is an optional dependency that may be missing on unsupported platforms.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any;
  try {
    mod = await importSdk();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const kind: SmSdkLoadError["kind"] = /Cannot find module|MODULE_NOT_FOUND/i.test(msg)
      ? "module_not_found"
      : "binary_not_available";
    return { ok: false, error: { kind, message: msg } };
  }

  const ms = init.timeoutMs;
  const now = init.now ?? Date.now;
  // The SDK login is this client's token request: same pause as OAuthTokenCache.
  const backoff = new TokenBackoff(now);

  type Login = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    promise: Promise<any>;
    startedAt: number;
    settled: boolean;
    /** A waiter timed out on it; that already counted as a failure. */
    counted: boolean;
  };
  let current: Login | undefined;

  /**
   * The login to wait for. A running login is shared by every call until it
   * settles, also after a caller timed out on it, so a late success is used
   * and no second login runs beside it. Only a login still running after
   * SM_LOGIN_REUSE_TIMEOUTS x HTTP_TIMEOUT_MS is given up (it cannot be
   * cancelled; its result is dropped) and a new one starts.
   */
  function sharedLogin(): Login {
    if (current && (current.settled || now() - current.startedAt < SM_LOGIN_REUSE_TIMEOUTS * ms)) {
      return current;
    }
    current = undefined;
    backoff.check();
    const entry: Login = {
      promise: undefined as never,
      startedAt: now(),
      settled: false,
      counted: false,
    };
    entry.promise = (async () => {
      const rawClient = new mod.BitwardenClient({
        apiUrl: init.apiUrl,
        identityUrl: init.identityUrl,
        userAgent: "the-real-bitwarden-mcp",
      });
      await rawClient.auth().loginAccessToken(init.accessToken);
      return rawClient;
    })().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Secrets Manager SDK login failed: ${msg}. Check BWS_ACCESS_TOKEN, BWS_API_BASE and BWS_IDENTITY_URL; the next call retries the login.`,
      );
    });
    entry.promise.then(
      () => {
        entry.settled = true;
        if (current === entry) backoff.success();
      },
      (err: unknown) => {
        entry.settled = true;
        if (current !== entry) return;
        current = undefined;
        if (!entry.counted) backoff.failure(err);
      },
    );
    current = entry;
    return entry;
  }

  type Phase = "login" | "read" | "write";
  type Step = <U>(phase: Phase, work: () => Promise<U>) => Promise<U>;

  /**
   * Run one client method under one deadline that covers the login and every
   * SDK call it makes. The native calls cannot be cancelled: on timeout a
   * call keeps running in the background and its result is dropped.
   */
  async function withDeadline<T>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: (rawClient: any, step: Step) => Promise<T>,
  ): Promise<T> {
    let phase: Phase = "login";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const text =
          phase === "login"
            ? `Secrets Manager SDK login timed out after ${ms} ms; the next call waits for the same login or retries it.`
            : phase === "write"
              ? `Secrets Manager SDK call timed out after ${ms} ms; ${UNKNOWN_OUTCOME_HINT}.`
              : `Secrets Manager SDK call timed out after ${ms} ms.`;
        reject(new Error(text));
      }, ms);
    });
    deadline.catch(() => {});
    const step: Step = (p, work) => {
      phase = p;
      return Promise.race([Promise.resolve().then(work), deadline]);
    };
    try {
      const login = sharedLogin();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rawClient: any;
      try {
        rawClient = await step("login", () => login.promise);
      } catch (err) {
        if (!login.settled && !login.counted) {
          login.counted = true;
          backoff.failure(err);
        }
        throw err;
      }
      return await run(rawClient, step);
    } finally {
      clearTimeout(timer);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function call<T>(write: boolean, run: (rawClient: any) => Promise<T>): Promise<T> {
    return withDeadline((rawClient, step) => step(write ? "write" : "read", () => run(rawClient)));
  }

  const client: SmSdkClient = {
    async projectList(orgId) {
      const r = await call<{ data?: SdkProjectResponse[] }>(false, (c) => c.projects().list(orgId));
      return r.data ?? [];
    },
    projectGet(id) {
      return call(false, (c) => c.projects().get(id));
    },
    projectCreate(orgId, name) {
      return call(true, (c) => c.projects().create(orgId, name));
    },
    projectUpdate(orgId, id, name) {
      return call(true, (c) => c.projects().update(orgId, id, name));
    },
    async projectDelete(id) {
      return failOnItemError(await call(true, (c) => c.projects().delete([id])));
    },
    async secretList(orgId) {
      const r = await call<{ data?: SdkSecretIdentifier[] }>(false, (c) => c.secrets().list(orgId));
      return r.data ?? [];
    },
    secretGet(id) {
      return call(false, (c) => c.secrets().get(id));
    },
    secretCreate(orgId, key, value, note, projectIds) {
      return call(true, (c) => c.secrets().create(orgId, key, value, note, projectIds));
    },
    secretUpdate(orgId, id, key, value, note, projectIds) {
      return withDeadline(async (c, step) => {
        if (note === undefined || projectIds === undefined) {
          const existing: SdkSecretResponse = await step("read", () => c.secrets().get(id));
          note ??= existing.note ?? "";
          projectIds ??= existing.projectId ? [existing.projectId] : [];
        }
        const keptNote = note;
        const keptProjects = projectIds;
        return step("write", () =>
          c.secrets().update(orgId, id, key, value, keptNote, keptProjects),
        );
      });
    },
    async secretDelete(id) {
      return failOnItemError(await call(true, (c) => c.secrets().delete([id])));
    },
  };
  return { ok: true, client };
}
