import type { PlannedRequest, ToolDef, ToolResult } from "../types.js";
import { asToolError } from "./_error.js";
import { maskSecretValues } from "../redact.js";

function isWriteTool(tool: ToolDef): boolean {
  return tool.annotations.destructiveHint || !tool.annotations.readOnlyHint;
}

function shouldGuard(tool: ToolDef, enabled: boolean): boolean {
  return enabled && isWriteTool(tool);
}

export function readOnlyRefusal(toolName: string): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: `${toolName} was not executed: the server runs in read-only mode (BITWARDEN_READ_ONLY=true), which refuses every write.`,
      },
    ],
    isError: true,
  };
}

/**
 * BITWARDEN_READ_ONLY: write tools keep their name and schema (so the tool
 * list and its fingerprints do not change) but refuse to run.
 */
export function withReadOnly(tool: ToolDef, readOnly: boolean): ToolDef {
  if (!readOnly || !isWriteTool(tool)) return tool;
  return { ...tool, handler: async () => readOnlyRefusal(tool.name) };
}

function describePlan(plan: PlannedRequest): string {
  let text = `Request: ${plan.method} ${plan.path}\n`;
  if (plan.body !== undefined)
    text += `Body: ${JSON.stringify(maskSecretValues(plan.body), null, 2)}\n`;
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
      // The plan's pre-read failed: say that this was the preview, so the
      // upstream error is not taken for a failed write.
      const error = asToolError(err);
      const first = error.content[0];
      const reason = first && first.type === "text" ? first.text : "";
      return {
        content: [
          {
            type: "text",
            text:
              `PREVIEW - would execute ${tool.name}, but the preview could not be built; ` +
              `nothing was written.\n${reason}`,
          },
        ],
        isError: true,
      };
    }
  }
  return {
    content: [
      {
        type: "text",
        text:
          `PREVIEW - would execute ${tool.name}\n` +
          `Input: ${JSON.stringify(maskSecretValues(rest), null, 2)}\n` +
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
