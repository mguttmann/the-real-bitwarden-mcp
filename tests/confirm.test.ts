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
    expect(textOf(res)).toMatch(/^PREVIEW - would execute /);
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

  // Audit case preview-echoes-secret-value.
  it("masks secret values in the preview input", async () => {
    const tool = makeTool({ destructive: true, readOnly: false });
    const guarded = withConfirmGuard(tool, true);
    const res = await guarded.handler({ key: "DB_PASS", value: "FAKE-SECRET-1-abc", note: "n" });
    const text = textOf(res);
    expect(text).not.toContain("FAKE-SECRET-1-abc");
    expect(text).toContain('"value": "<redacted, 17 chars>"');
    // The secret name and other fields stay visible so the caller can check them.
    expect(text).toContain('"key": "DB_PASS"');
    expect(text).toContain('"note": "n"');
  });

  it("masks secret values in the planned request body", async () => {
    const tool: ToolDef = {
      ...makeTool({ destructive: true, readOnly: false }),
      plan: async () => ({
        method: "PUT",
        path: "/x",
        body: { nested: [{ password: "FAKE-SECRET-2" }], name: "kept" },
      }),
    };
    const text = textOf(await withConfirmGuard(tool, true).handler({}));
    expect(text).not.toContain("FAKE-SECRET-2");
    expect(text).toContain('"password": "<redacted, 13 chars>"');
    expect(text).toContain('"name": "kept"');
  });
});
