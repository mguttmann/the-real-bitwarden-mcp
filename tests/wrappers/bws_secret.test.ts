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
    const sdk = stubSdk();
    const res = await makeSecretListTool(sdk, "org-1").handler({});
    expect(sdk.secretList).toHaveBeenCalledWith("org-1");
    const text = textOf(res);
    // SDK list returns identifiers (no value field in response from SDK)
    expect(text).toContain("DB_PASS");
    // Value should not appear (identifier response doesn't include it)
    expect(text).not.toContain("shhh");
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

  it("create returns isError when sdk is undefined", async () => {
    const res = await makeSecretCreateTool(undefined, "org-1").handler({ key: "K", value: "V" });
    expect(res.isError).toBe(true);
  });

  it("update calls sdk.secretUpdate with all params", async () => {
    const sdk = stubSdk();
    await makeSecretUpdateTool(sdk).handler({
      id: "s1",
      key: "K",
      value: "V2",
      note: "n",
      projectIds: ["p1"],
      organizationId: "org-1",
    });
    expect(sdk.secretUpdate).toHaveBeenCalledWith("org-1", "s1", "K", "V2", "n", ["p1"]);
  });

  it("update requires organizationId", async () => {
    const sdk = stubSdk();
    const res = await makeSecretUpdateTool(sdk).handler({ id: "s1", key: "K", value: "V2" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/organizationId/i);
  });

  it("update returns isError when sdk is undefined", async () => {
    const res = await makeSecretUpdateTool(undefined).handler({
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
