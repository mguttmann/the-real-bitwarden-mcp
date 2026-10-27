// The machine account and access token tools are placeholders. Their
// description and error text must give the real reason: the endpoints
// exist only for a logged-in user in the web vault, not for the
// organization API key or a machine account token this server uses.
import { describe, it, expect } from "vitest";
import * as ma from "../../src/tools/wrappers/bws_machine_account.js";
import * as at from "../../src/tools/wrappers/bws_access_token.js";
import type { ToolDef } from "../../src/types.js";
import { textOf } from "../helpers.js";

const tools: ToolDef[] = [
  ma.makeMachineAccountListTool(),
  ma.makeMachineAccountGetTool(),
  ma.makeMachineAccountCreateTool(),
  ma.makeMachineAccountUpdateTool(),
  ma.makeMachineAccountDeleteTool(),
  ma.makeMachineAccountProjectsTool(),
  ma.makeMachineAccountGrantProjectTool(),
  ma.makeMachineAccountRevokeProjectTool(),
  at.makeAccessTokenListTool(),
  at.makeAccessTokenCreateTool(),
  at.makeAccessTokenRevokeTool(),
];

const WRONG_REASON = /crypto layer|not supported via api/i;
const RIGHT_REASON = /logged-in user/i;

describe("bws_machine_account_* and bws_access_token_* reason", () => {
  it("covers all placeholder tools", () => {
    expect(tools).toHaveLength(11);
  });

  it.each(tools.map((t) => [t.name, t] as const))(
    "%s states the credential reason in description and error",
    async (_name, tool) => {
      expect(tool.description).not.toMatch(WRONG_REASON);
      expect(tool.description).toMatch(RIGHT_REASON);
      expect(tool.description).toMatch(/web vault/i);
      const res = await tool.handler({});
      expect(res.isError).toBe(true);
      expect(textOf(res)).not.toMatch(WRONG_REASON);
      expect(textOf(res)).toMatch(RIGHT_REASON);
      expect(textOf(res)).toMatch(/web vault/i);
    },
  );
});
