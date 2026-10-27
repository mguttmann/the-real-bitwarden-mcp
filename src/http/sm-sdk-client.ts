// Dynamic-loaded wrapper around @bitwarden/sdk-napi.
// Falls back gracefully when the binary isn't available for the current platform.

import { UNKNOWN_OUTCOME_HINT } from "./bitwarden-http-client.js";

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
  secretUpdate(
    orgId: string,
    id: string,
    key: string,
    value: string,
    note: string,
    projectIds: string[],
  ): Promise<SdkSecretResponse>;
  secretDelete(id: string): Promise<unknown>;
};

type SmSdkInit = {
  accessToken: string;
  apiUrl: string;
  identityUrl: string;
  /** Deadline for the login and for each SDK call (HTTP_TIMEOUT_MS). */
  timeoutMs: number;
};

export type SmSdkLoadError = {
  kind: "module_not_found" | "binary_not_available";
  message: string;
};

type DeleteResponse = { data?: { id: string; error?: string | null }[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ImportSdk = () => Promise<any>;

/**
 * The native calls cannot be cancelled: on timeout the call keeps running
 * in the background and its result is dropped.
 */
async function withTimeout<T>(work: Promise<T>, ms: number, timeoutText: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutText)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let session: Promise<any> | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function loggedIn(): Promise<any> {
    if (session) return session;
    const attempt = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rawClient: any;
      const login = (async () => {
        rawClient = new mod.BitwardenClient({
          apiUrl: init.apiUrl,
          identityUrl: init.identityUrl,
          userAgent: "the-real-bitwarden-mcp",
        });
        await rawClient.auth().loginAccessToken(init.accessToken);
      })().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Secrets Manager SDK login failed: ${msg}. Check BWS_ACCESS_TOKEN, BWS_API_BASE and BWS_IDENTITY_URL; the next call retries the login.`,
        );
      });
      await withTimeout(
        login,
        ms,
        `Secrets Manager SDK login timed out after ${ms} ms; the next call retries the login.`,
      );
      return rawClient;
    })();
    session = attempt;
    attempt.catch(() => {
      if (session === attempt) session = undefined;
    });
    return attempt;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function call<T>(write: boolean, run: (rawClient: any) => Promise<T>): Promise<T> {
    const rawClient = await loggedIn();
    const text = write
      ? `Secrets Manager SDK call timed out after ${ms} ms; ${UNKNOWN_OUTCOME_HINT}.`
      : `Secrets Manager SDK call timed out after ${ms} ms.`;
    return withTimeout(Promise.resolve(run(rawClient)), ms, text);
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
      return call(true, (c) => c.secrets().update(orgId, id, key, value, note, projectIds));
    },
    async secretDelete(id) {
      return failOnItemError(await call(true, (c) => c.secrets().delete([id])));
    },
  };
  return { ok: true, client };
}
