import { describe, it, expect } from "vitest";
import {
  makeAccessTokenListTool, makeAccessTokenCreateTool, makeAccessTokenRevokeTool,
} from "../../src/tools/wrappers/bws_access_token.js";

const WEB_VAULT_PATTERN = /web vault/i;

describe("bws_access_token_* (web-vault stubs)", () => {
  it("list returns isError with web-vault message", async () => {
    const res = await makeAccessTokenListTool().handler({ machineAccountId: "ma-1" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(WEB_VAULT_PATTERN);
  });

  it("create returns isError with web-vault message", async () => {
    const res = await makeAccessTokenCreateTool().handler({ machineAccountId: "ma-1", name: "ci" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(WEB_VAULT_PATTERN);
  });

  it("revoke returns isError with web-vault message", async () => {
    const res = await makeAccessTokenRevokeTool().handler({ machineAccountId: "ma-1", tokenIds: ["t1", "t2"] });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(WEB_VAULT_PATTERN);
  });
});
