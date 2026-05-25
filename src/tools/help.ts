import type { ToolDef } from "../types.js";
import type { ToolRegistry } from "./registry.js";

function classify(name: string): "license" | "sm" | "universal" | "operational" {
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
      const groups: Record<string, ToolDef[]> = {
        "Public API (operational)": [],
        "License / subscription (cloud)": [],
        "Secrets Manager": [],
        "Universal": [],
      };
      for (const t of registry.getAll()) {
        const k = classify(t.name);
        if (k === "license") groups["License / subscription (cloud)"]!.push(t);
        else if (k === "sm") groups["Secrets Manager"]!.push(t);
        else if (k === "universal") groups["Universal"]!.push(t);
        else groups["Public API (operational)"]!.push(t);
      }
      const lines: string[] = [];
      for (const [group, tools] of Object.entries(groups)) {
        if (tools.length === 0) continue;
        lines.push(`## ${group}`);
        for (const t of tools) lines.push(`- \`${t.name}\` — ${t.description}`);
        lines.push("");
      }
      return { content: [{ type: "text", text: lines.join("\n").trimEnd() }] };
    },
  };
}
