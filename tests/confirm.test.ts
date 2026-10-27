import { describe, it, expect, vi } from "vitest";
import { withConfirmGuard } from "../src/tools/confirm.js";
import type { ToolDef } from "../src/types.js";
import { textOf } from "./helpers.js";

function makeTool(opts: { destructive: boolean; readOnly: boolean }, handler = vi.fn()): ToolDef {
  return {
    name: "bw_x",
    description: "x",
    inputSchema: { type: "object", properties: { foo: { type: "string" } } },
    annotations: {
      readOnlyHint: opts.readOnly,
      destructiveHint: opts.destructive,
      openWorldHint: true,
    },
    handler: async (input) => {
      handler(input);
      return { content: [{ type: "text", text: "ran" }] };
    },
  };
}

describe("withConfirmGuard", () => {
  it("passes through when confirmWrites is false", async () => {
    const inner = vi.fn();
    const tool = makeTool({ destructive: true, readOnly: false }, inner);
    const guarded = withConfirmGuard(tool, false);
    await guarded.handler({});
    expect(inner).toHaveBeenCalled();
  });

  it("passes through read-only tools even when guard is enabled", async () => {
    const inner = vi.fn();
    const tool = makeTool({ destructive: false, readOnly: true }, inner);
    const guarded = withConfirmGuard(tool, true);
    await guarded.handler({});
    expect(inner).toHaveBeenCalled();
  });

  it("returns a preview when destructive and confirm missing", async () => {
    const inner = vi.fn();
    const tool = makeTool({ destructive: true, readOnly: false }, inner);
    const guarded = withConfirmGuard(tool, true);
    const res = await guarded.handler({ foo: "bar" });
    expect(inner).not.toHaveBeenCalled();
    expect(textOf(res)).toMatch(/PREVIEW/);
  });

  it("executes when confirm=YES", async () => {
    const inner = vi.fn();
    const tool = makeTool({ destructive: true, readOnly: false }, inner);
    const guarded = withConfirmGuard(tool, true);
    const res = await guarded.handler({ foo: "bar", confirm: "YES" });
    expect(inner).toHaveBeenCalledWith({ foo: "bar" });
    expect(textOf(res)).toBe("ran");
  });

  it("adds `confirm` to inputSchema when guarded", () => {
    const tool = makeTool({ destructive: true, readOnly: false });
    const guarded = withConfirmGuard(tool, true);
    const props = (guarded.inputSchema as any).properties;
    expect(props.confirm.enum).toEqual(["YES"]);
  });
});
