import type { ToolResult } from "../src/types.js";

/** Text of the first content item; fails the test if it is not a text item. */
export function textOf(res: ToolResult): string {
  const first = res.content[0];
  if (first?.type !== "text") throw new Error(`expected text content, got ${first?.type}`);
  return first.text;
}
