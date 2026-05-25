// Dynamic-loaded wrapper around @bitwarden/sdk-napi.
// Falls back gracefully when the binary isn't available for the current platform.

export type SdkProjectResponse = { id: string; name: string; organizationId: string; creationDate?: string; revisionDate?: string };
export type SdkSecretIdentifier = { id: string; key: string; organizationId: string };
export type SdkSecretResponse = { id: string; key: string; value: string; note: string; organizationId: string; projectId?: string | null; creationDate?: string; revisionDate?: string };

export type SmSdkClient = {
  projectList(orgId: string): Promise<SdkProjectResponse[]>;
  projectGet(id: string): Promise<SdkProjectResponse>;
  projectCreate(orgId: string, name: string): Promise<SdkProjectResponse>;
  projectUpdate(orgId: string, id: string, name: string): Promise<SdkProjectResponse>;
  projectDelete(id: string): Promise<unknown>;
  secretList(orgId: string): Promise<SdkSecretIdentifier[]>;
  secretGet(id: string): Promise<SdkSecretResponse>;
  secretCreate(orgId: string, key: string, value: string, note: string, projectIds: string[]): Promise<SdkSecretResponse>;
  secretUpdate(orgId: string, id: string, key: string, value: string, note: string, projectIds: string[]): Promise<SdkSecretResponse>;
  secretDelete(id: string): Promise<unknown>;
};

export type SmSdkInit = {
  accessToken: string;
  apiUrl: string;
  identityUrl: string;
};

export type SmSdkLoadError = {
  kind: "module_not_found" | "binary_not_available" | "init_failed";
  message: string;
};

/**
 * Try to load and initialise the Bitwarden SDK.
 * Returns a working client on success, or an error object describing why it failed.
 * Never throws — the caller decides how to surface the error.
 */
export async function tryLoadSmSdk(
  init: SmSdkInit,
): Promise<{ ok: true; client: SmSdkClient } | { ok: false; error: SmSdkLoadError }> {
  let mod: any;
  try {
    mod = await import("@bitwarden/sdk-napi");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const kind: SmSdkLoadError["kind"] = /Cannot find module|MODULE_NOT_FOUND/i.test(msg)
      ? "module_not_found"
      : "binary_not_available";
    return { ok: false, error: { kind, message: msg } };
  }
  let rawClient: any;
  try {
    rawClient = new mod.BitwardenClient({
      apiUrl: init.apiUrl,
      identityUrl: init.identityUrl,
      userAgent: "the-real-bitwarden-mcp",
    });
    await rawClient.auth().loginAccessToken(init.accessToken);
  } catch (err) {
    return {
      ok: false,
      error: { kind: "init_failed", message: err instanceof Error ? err.message : String(err) },
    };
  }
  const client: SmSdkClient = {
    async projectList(orgId) {
      const r = await rawClient.projects().list(orgId);
      return r.data ?? [];
    },
    projectGet(id)               { return rawClient.projects().get(id); },
    projectCreate(orgId, name)   { return rawClient.projects().create(orgId, name); },
    projectUpdate(orgId, id, name) { return rawClient.projects().update(orgId, id, name); },
    projectDelete(id)            { return rawClient.projects().delete([id]); },
    async secretList(orgId)      { const r = await rawClient.secrets().list(orgId); return r.data ?? []; },
    secretGet(id)                { return rawClient.secrets().get(id); },
    secretCreate(orgId, key, value, note, projectIds) {
      return rawClient.secrets().create(orgId, key, value, note, projectIds);
    },
    secretUpdate(orgId, id, key, value, note, projectIds) {
      return rawClient.secrets().update(orgId, id, key, value, note, projectIds);
    },
    secretDelete(id) { return rawClient.secrets().delete([id]); },
  };
  return { ok: true, client };
}
