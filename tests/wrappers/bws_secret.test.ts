import { describe, it, expect, vi } from "vitest";
import {
  makeSecretListTool,
  makeSecretGetValueTool,
  makeSecretCreateTool,
  makeSecretUpdateTool,
  makeSecretDeleteTool,
} from "../../src/tools/wrappers/bws_secret.js";
import type { SmSdkClient } from "../../src/http/sm-sdk-client.js";
import { textOf } from "../helpers.js";

function stubSdk(overrides: Partial<SmSdkClient> = {}): SmSdkClient {
  return {
    projectList: vi.fn(async () => []),
    projectGet: vi.fn(async () => ({ id: "p1", name: "proj", organizationId: "org-1" })),
    projectCreate: vi.fn(async () => ({ id: "p2", name: "proj", organizationId: "org-1" })),
    projectUpdate: vi.fn(async () => ({ id: "p1", name: "proj", organizationId: "org-1" })),
    projectDelete: vi.fn(async () => ({})),
    secretList: vi.fn(async () => [{ id: "s1", key: "DB_PASS", organizationId: "org-1" }]),
    secretGet: vi.fn(async () => ({
      id: "s1",
      key: "DB_PASS",
      value: "shhh",
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
      note: "n",
      organizationId: "org-1",
    })),
    secretDelete: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe("bws_secret_* (SDK-backed)", () => {
  it("list calls sdk.secretList with orgId and returns metadata only (no value)", async () => {
    // The stub returns a value on purpose: the tool must drop it, not rely
    // on the SDK leaving it out.
    const sdk = stubSdk({
      secretList: vi.fn(async () => [
        { id: "s1", key: "DB_PASS", organizationId: "org-1", value: "FAKE-SECRET-1" },
      ]),
    });
    const res = await makeSecretListTool(sdk, "org-1").handler({});
    expect(sdk.secretList).toHaveBeenCalledWith("org-1");
    expect(JSON.parse(textOf(res))).toEqual({
      secrets: [{ id: "s1", key: "DB_PASS", organizationId: "org-1" }],
    });
  });

  it("list accepts organizationId from input", async () => {
    const sdk = stubSdk();
    await makeSecretListTool(sdk, undefined).handler({ organizationId: "org-2" });
    expect(sdk.secretList).toHaveBeenCalledWith("org-2");
  });

  it("list returns isError when sdk is undefined", async () => {
    const res = await makeSecretListTool(undefined, "org-1").handler({});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/SDK not available/i);
  });

  it("get_value calls sdk.secretGet and returns value", async () => {
    const sdk = stubSdk();
    const res = await makeSecretGetValueTool(sdk).handler({ id: "s1" });
    expect(sdk.secretGet).toHaveBeenCalledWith("s1");
    expect(textOf(res)).toContain("shhh");
  });

  it("get_value returns isError when sdk is undefined", async () => {
    const res = await makeSecretGetValueTool(undefined).handler({ id: "s1" });
    expect(res.isError).toBe(true);
  });

  it("create calls sdk.secretCreate with all params", async () => {
    const sdk = stubSdk();
    await makeSecretCreateTool(sdk, "org-1").handler({ key: "K", value: "V", projectIds: ["p1"] });
    expect(sdk.secretCreate).toHaveBeenCalledWith("org-1", "K", "V", "", ["p1"]);
  });

  // Audit case preview-echoes-secret-value: cleartext only via bws_secret_get_value.
  it("create and update return metadata without the decrypted value", async () => {
    const secret = {
      id: "s2",
      key: "DB_PASS",
      value: "FAKE-SECRET-1",
      note: "n",
      organizationId: "org-1",
      projectId: "p1",
      creationDate: "2026-01-01T00:00:00Z",
      revisionDate: "2026-01-02T00:00:00Z",
    };
    const sdk = stubSdk({
      secretCreate: vi.fn(async () => secret),
      secretUpdate: vi.fn(async () => secret),
    });
    const created = await makeSecretCreateTool(sdk, "org-1").handler({
      key: "DB_PASS",
      value: "FAKE-SECRET-1",
    });
    const updated = await makeSecretUpdateTool(sdk, undefined).handler({
      id: "s2",
      key: "DB_PASS",
      value: "FAKE-SECRET-1",
      organizationId: "org-1",
    });
    const { value: _v, ...metadata } = secret;
    for (const res of [created, updated]) {
      expect(res.isError).toBeUndefined();
      expect(textOf(res)).not.toContain("FAKE-SECRET-1");
      expect(JSON.parse(textOf(res))).toEqual(metadata);
    }
  });

  it("create returns isError when sdk is undefined", async () => {
    const res = await makeSecretCreateTool(undefined, "org-1").handler({ key: "K", value: "V" });
    expect(res.isError).toBe(true);
  });

  it("update calls sdk.secretUpdate with all params", async () => {
    const sdk = stubSdk();
    await makeSecretUpdateTool(sdk, undefined).handler({
      id: "s1",
      key: "K",
      value: "V2",
      note: "n",
      projectIds: ["p1"],
      organizationId: "org-1",
    });
    expect(sdk.secretUpdate).toHaveBeenCalledWith("org-1", "s1", "K", "V2", "n", ["p1"]);
  });

  it("update without organizationId and without BWS_ORG_ID is an error", async () => {
    const sdk = stubSdk();
    const res = await makeSecretUpdateTool(sdk, undefined).handler({
      id: "s1",
      key: "K",
      value: "V2",
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/BWS_ORG_ID/);
    expect(sdk.secretUpdate).not.toHaveBeenCalled();
  });

  // Audit cases bws-update-no-orgid-fallback, sm-update-ignores-bws-org-id.
  it("update falls back to the configured BWS_ORG_ID", async () => {
    const sdk = stubSdk();
    const res = await makeSecretUpdateTool(sdk, "org-1").handler({
      id: "s1",
      key: "K",
      value: "V2",
      note: "n",
      projectIds: ["p1"],
    });
    expect(res.isError).toBeUndefined();
    expect(sdk.secretUpdate).toHaveBeenCalledWith("org-1", "s1", "K", "V2", "n", ["p1"]);
  });

  // Audit case bws-secret-update-wipes-note-projects: the SDK update is a full
  // replace; omitted fields were sent as "" and [].
  it("update keeps the current note and project for omitted note and projectIds", async () => {
    const sdk = stubSdk({
      secretGet: vi.fn(async () => ({
        id: "s1",
        key: "K",
        value: "FAKE-SECRET-1",
        note: "keep me",
        organizationId: "org-1",
        projectId: "p9",
      })),
    });
    const tool = makeSecretUpdateTool(sdk, "org-1");
    await tool.handler({ id: "s1", key: "K", value: "V2" });
    expect(sdk.secretGet).toHaveBeenCalledWith("s1");
    expect(sdk.secretUpdate).toHaveBeenLastCalledWith("org-1", "s1", "K", "V2", "keep me", ["p9"]);
    await tool.handler({ id: "s1", key: "K", value: "V2", projectIds: ["p2"] });
    expect(sdk.secretUpdate).toHaveBeenLastCalledWith("org-1", "s1", "K", "V2", "keep me", ["p2"]);
    await tool.handler({ id: "s1", key: "K", value: "V2", note: "" });
    expect(sdk.secretUpdate).toHaveBeenLastCalledWith("org-1", "s1", "K", "V2", "", ["p9"]);
  });

  it("update does not read the secret when note and projectIds are given", async () => {
    const sdk = stubSdk();
    await makeSecretUpdateTool(sdk, "org-1").handler({
      id: "s1",
      key: "K",
      value: "V2",
      note: "n",
      projectIds: [],
    });
    expect(sdk.secretGet).not.toHaveBeenCalled();
    expect(sdk.secretUpdate).toHaveBeenCalledWith("org-1", "s1", "K", "V2", "n", []);
  });

  it("update does not change the secret when reading the current one fails", async () => {
    const sdk = stubSdk({
      secretGet: vi.fn(async () => {
        throw new Error("Secret not found.");
      }),
    });
    const res = await makeSecretUpdateTool(sdk, "org-1").handler({
      id: "s1",
      key: "K",
      value: "V",
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("Secret not found.");
    expect(sdk.secretUpdate).not.toHaveBeenCalled();
  });

  it("update schema advertises no defaults for note and projectIds", () => {
    const props = makeSecretUpdateTool(undefined, undefined).inputSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(props.note).not.toHaveProperty("default");
    expect(props.projectIds).not.toHaveProperty("default");
  });

  it("update returns isError when sdk is undefined", async () => {
    const res = await makeSecretUpdateTool(undefined, undefined).handler({
      id: "s1",
      key: "K",
      value: "V2",
      organizationId: "org-1",
    });
    expect(res.isError).toBe(true);
  });

  it("delete calls sdk.secretDelete", async () => {
    const sdk = stubSdk();
    await makeSecretDeleteTool(sdk).handler({ id: "s1" });
    expect(sdk.secretDelete).toHaveBeenCalledWith("s1");
  });

  it("delete returns isError when sdk is undefined", async () => {
    const res = await makeSecretDeleteTool(undefined).handler({ id: "s1" });
    expect(res.isError).toBe(true);
  });
});
