import type { ToolDef } from "../types.js";
import type { ToolRegistry } from "./registry.js";

type Category = "license" | "sm" | "universal" | "operational";

const GROUP_TITLES: Record<Category, string> = {
  operational: "Public API (operational)",
  license: "License / subscription (cloud)",
  sm: "Secrets Manager",
  universal: "Universal",
};

function classify(name: string): Category {
  if (name.startsWith("bw_license_")) return "license";
  if (name.startsWith("bws_")) return "sm";
  if (name === "bw_help" || name === "bw_raw_request") return "universal";
  return "operational";
}

export function makeHelpTool(registry: ToolRegistry): ToolDef {
  return {
    name: "bw_help",
    description: "Show a grouped catalogue of every registered tool with its short description.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async () => {
      const groups = new Map<Category, ToolDef[]>([
        ["operational", []],
        ["license", []],
        ["sm", []],
        ["universal", []],
      ]);
      for (const tool of registry.getAll()) {
        const bucket = groups.get(classify(tool.name));
        if (bucket) bucket.push(tool);
      }
      const lines: string[] = [];
      for (const [category, tools] of groups) {
        if (tools.length === 0) continue;
        lines.push(`## ${GROUP_TITLES[category]}`);
        for (const tool of tools) lines.push(`- \`${tool.name}\` — ${tool.description}`);
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n").trimEnd() }] };
    },
  };
}
