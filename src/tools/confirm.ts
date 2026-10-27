import type { PlannedRequest, ToolDef, ToolResult } from "../types.js";
import { asToolError } from "./_error.js";

function shouldGuard(tool: ToolDef, enabled: boolean): boolean {
  if (!enabled) return false;
  return tool.annotations.destructiveHint || !tool.annotations.readOnlyHint;
}

function describePlan(plan: PlannedRequest): string {
  let text = `Request: ${plan.method} ${plan.path}\n`;
  if (plan.body !== undefined) text += `Body: ${JSON.stringify(plan.body, null, 2)}\n`;
  for (const note of plan.notes ?? []) text += `Note: ${note}\n`;
  return text;
}

async function previewResult(tool: ToolDef, input: Record<string, unknown>): Promise<ToolResult> {
  const { confirm: _drop, ...rest } = input;
  let planned = "";
  if (tool.plan) {
    try {
      planned = describePlan(await tool.plan(rest));
    } catch (err) {
      return asToolError(err);
    }
  }
  return {
    content: [
      {
        type: "text",
        text:
          `PREVIEW — would execute ${tool.name}\n` +
          `Input: ${JSON.stringify(rest, null, 2)}\n` +
          planned +
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
