import { describe, it, expect } from "vitest";
import {
  makeMachineAccountListTool,
  makeMachineAccountGetTool,
  makeMachineAccountCreateTool,
  makeMachineAccountUpdateTool,
  makeMachineAccountDeleteTool,
  makeMachineAccountProjectsTool,
  makeMachineAccountGrantProjectTool,
  makeMachineAccountRevokeProjectTool,
} from "../../src/tools/wrappers/bws_machine_account.js";
import { textOf } from "../helpers.js";

const WEB_VAULT_PATTERN = /web vault/i;

describe("bws_machine_account_* (web-vault stubs)", () => {
  it("list returns isError with web-vault message", async () => {
    const res = await makeMachineAccountListTool().handler({});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(WEB_VAULT_PATTERN);
  });

  it("get returns isError with web-vault message", async () => {
    const res = await makeMachineAccountGetTool().handler({ id: "ma-1" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(WEB_VAULT_PATTERN);
  });

  it("create returns isError with web-vault message", async () => {
    const res = await makeMachineAccountCreateTool().handler({ name: "test" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(WEB_VAULT_PATTERN);
  });

  it("update returns isError with web-vault message", async () => {
    const res = await makeMachineAccountUpdateTool().handler({ id: "ma-1", name: "renamed" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(WEB_VAULT_PATTERN);
  });

  it("delete returns isError with web-vault message", async () => {
    const res = await makeMachineAccountDeleteTool().handler({ id: "ma-1" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(WEB_VAULT_PATTERN);
  });

  it("projects returns isError with web-vault message", async () => {
    const res = await makeMachineAccountProjectsTool().handler({ id: "ma-1" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(WEB_VAULT_PATTERN);
  });

  it("grant_project returns isError with web-vault message", async () => {
    const res = await makeMachineAccountGrantProjectTool().handler({ id: "ma-1", projectId: "p1" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(WEB_VAULT_PATTERN);
  });

  it("revoke_project returns isError with web-vault message", async () => {
    const res = await makeMachineAccountRevokeProjectTool().handler({
      id: "ma-1",
      projectId: "p1",
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(WEB_VAULT_PATTERN);
  });
});
