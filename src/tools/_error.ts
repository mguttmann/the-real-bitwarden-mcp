import { BitwardenApiError } from "../http/errors.js";
import type { ToolResult } from "../types.js";

export function asToolError(err: unknown): ToolResult {
  if (err instanceof BitwardenApiError) {
    return {
      content: [{ type: "text", text: err.toString() }],
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }],
    isError: true,
  };
}

export function jsonResult(obj: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(obj, null, 2) }],
  };
}
