import { describe, it, expect } from "vitest";
import { makeHelpTool } from "../src/tools/help.js";
import { ToolRegistry } from "../src/tools/registry.js";
import type { ToolDef } from "../src/types.js";
import { textOf } from "./helpers.js";

function tool(name: string, desc: string): ToolDef {
  return {
    name,
    description: desc,
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async () => ({ content: [{ type: "text", text: "" }] }),
  };
}

describe("bw_help", () => {
  it("groups tools by prefix", async () => {
    const reg = new ToolRegistry();
    reg.register(tool("bw_member_list", "list members"));
    reg.register(tool("bw_license_subscription_get", "get sub"));
    reg.register(tool("bws_project_list", "list projects"));
    reg.register(tool("bw_raw_request", "raw"));
    reg.register(tool("bw_help", "help"));
    const help = makeHelpTool(reg);
    const res = await help.handler({});
    const text = textOf(res);
    expect(text).toContain("bw_member_list");
    expect(text).toContain("bw_license_subscription_get");
    expect(text).toContain("bws_project_list");
    expect(text).toContain("Public API (operational)");
    expect(text).toContain("License / subscription");
    expect(text).toContain("Secrets Manager");
    expect(text).toContain("Universal");
    expect(text).toContain("- `bw_member_list` - list members");
  });
});
