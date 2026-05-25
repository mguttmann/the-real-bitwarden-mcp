import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../src/tools/registry.js";
import type { ToolDef } from "../src/types.js";

function fakeTool(name: string): ToolDef {
  return {
    name,
    description: "x",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
  };
}

describe("ToolRegistry", () => {
  it("registers and looks up by name", () => {
    const r = new ToolRegistry();
    r.register(fakeTool("b"));
    r.register(fakeTool("a"));
    expect(r.size()).toBe(2);
    expect(r.getByName("a")?.name).toBe("a");
    expect(r.getAll().map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("throws on duplicate name", () => {
    const r = new ToolRegistry();
    r.register(fakeTool("a"));
    expect(() => r.register(fakeTool("a"))).toThrow(/already registered/);
  });
});
