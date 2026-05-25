import type { ToolDef, ToolResult } from "../types.js";

function shouldGuard(tool: ToolDef, enabled: boolean): boolean {
  if (!enabled) return false;
  return tool.annotations.destructiveHint || !tool.annotations.readOnlyHint;
}

function previewResult(tool: ToolDef, input: Record<string, unknown>): ToolResult {
  const { confirm: _drop, ...rest } = input;
  return {
    content: [
      {
        type: "text",
        text:
          `PREVIEW — would execute ${tool.name}\n` +
          `Input: ${JSON.stringify(rest, null, 2)}\n` +
          `To execute, retry the same call with confirm: "YES".`,
      },
    ],
  };
}

export function withConfirmGuard(tool: ToolDef, enabled: boolean): ToolDef {
  if (!shouldGuard(tool, enabled)) return tool;

  const existingProps =
    (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
  const inputSchema = {
    ...tool.inputSchema,
    properties: {
      ...existingProps,
      confirm: {
        type: "string",
        enum: ["YES"],
        description:
          'Set to "YES" to actually execute. Without this, the tool returns a preview only.',
      },
    },
  };

  const originalHandler = tool.handler;
  return {
    ...tool,
    inputSchema,
    handler: async (input) => {
      if (input.confirm !== "YES") return previewResult(tool, input);
      const { confirm: _drop, ...rest } = input;
      return originalHandler(rest);
    },
  };
}
