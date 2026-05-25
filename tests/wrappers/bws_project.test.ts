import { describe, it, expect, vi } from "vitest";
import {
  makeProjectListTool,
  makeProjectGetTool,
  makeProjectCreateTool,
  makeProjectUpdateTool,
  makeProjectDeleteTool,
} from "../../src/tools/wrappers/bws_project.js";
import type { SmSdkClient } from "../../src/http/sm-sdk-client.js";

function stubSdk(overrides: Partial<SmSdkClient> = {}): SmSdkClient {
  return {
    projectList: vi.fn(async () => [{ id: "p1", name: "infra", organizationId: "org-1" }]),
    projectGet: vi.fn(async () => ({ id: "p1", name: "infra", organizationId: "org-1" })),
    projectCreate: vi.fn(async () => ({ id: "p2", name: "new", organizationId: "org-1" })),
    projectUpdate: vi.fn(async () => ({ id: "p1", name: "renamed", organizationId: "org-1" })),
    projectDelete: vi.fn(async () => ({ data: [{ id: "p1", error: null }] })),
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
    ...overrides,
  };
}

describe("bws_project_* (SDK-backed)", () => {
  it("list calls sdk.projectList with orgId", async () => {
    const sdk = stubSdk();
    const res = await makeProjectListTool(sdk, "org-1").handler({});
    expect(sdk.projectList).toHaveBeenCalledWith("org-1");
    expect(res.content[0]!.text).toContain("infra");
  });

  it("list accepts organizationId from input", async () => {
    const sdk = stubSdk();
    await makeProjectListTool(sdk, undefined).handler({ organizationId: "org-2" });
    expect(sdk.projectList).toHaveBeenCalledWith("org-2");
  });

  it("list errors when no orgId available", async () => {
    const sdk = stubSdk();
    const res = await makeProjectListTool(sdk, undefined).handler({});
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/orgId/i);
  });

  it("list returns assignment hint when projects array is empty", async () => {
    const sdk = stubSdk({ projectList: vi.fn(async () => []) });
    const res = await makeProjectListTool(sdk, "org-1").handler({});
    expect(res.isError).toBeUndefined();
    const data = JSON.parse(res.content[0]!.text as string);
    expect(data.projects).toEqual([]);
    expect(data.note).toMatch(/no project assignments/i);
  });

  it("list returns isError when sdk is undefined", async () => {
    const res = await makeProjectListTool(undefined, "org-1").handler({});
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/SDK not available/i);
  });

  it("get calls sdk.projectGet", async () => {
    const sdk = stubSdk();
    const res = await makeProjectGetTool(sdk).handler({ id: "p1" });
    expect(sdk.projectGet).toHaveBeenCalledWith("p1");
    expect(res.content[0]!.text).toContain("infra");
  });

  it("get returns isError when sdk is undefined", async () => {
    const res = await makeProjectGetTool(undefined).handler({ id: "p1" });
    expect(res.isError).toBe(true);
  });

  it("create calls sdk.projectCreate", async () => {
    const sdk = stubSdk();
    const res = await makeProjectCreateTool(sdk, "org-1").handler({ name: "new" });
    expect(sdk.projectCreate).toHaveBeenCalledWith("org-1", "new");
    expect(res.content[0]!.text).toContain("new");
  });

  it("create returns isError when sdk is undefined", async () => {
    const res = await makeProjectCreateTool(undefined, "org-1").handler({ name: "new" });
    expect(res.isError).toBe(true);
  });

  it("update calls sdk.projectUpdate", async () => {
    const sdk = stubSdk();
    const res = await makeProjectUpdateTool(sdk).handler({
      id: "p1",
      name: "renamed",
      organizationId: "org-1",
    });
    expect(sdk.projectUpdate).toHaveBeenCalledWith("org-1", "p1", "renamed");
    expect(res.content[0]!.text).toContain("renamed");
  });

  it("update requires organizationId", async () => {
    const sdk = stubSdk();
    const res = await makeProjectUpdateTool(sdk).handler({ id: "p1", name: "renamed" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/organizationId/i);
  });

  it("update returns isError when sdk is undefined", async () => {
    const res = await makeProjectUpdateTool(undefined).handler({
      id: "p1",
      name: "renamed",
      organizationId: "org-1",
    });
    expect(res.isError).toBe(true);
  });

  it("delete calls sdk.projectDelete", async () => {
    const sdk = stubSdk();
    await makeProjectDeleteTool(sdk).handler({ id: "p1" });
    expect(sdk.projectDelete).toHaveBeenCalledWith("p1");
  });

  it("delete returns isError when sdk is undefined", async () => {
    const res = await makeProjectDeleteTool(undefined).handler({ id: "p1" });
    expect(res.isError).toBe(true);
  });
});
