import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Project rule: no en dash or em dash anywhere in tracked files (code,
// tool descriptions, tool output, docs). Written as escapes so this file
// passes its own check.
const LONG_DASH = /[\u2013\u2014]/;
const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("long dashes", () => {
  it("no tracked file contains an en dash or em dash", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(new URL(file, `file://${ROOT}`), "utf8");
      } catch {
        continue; // deleted in the working tree but still in the index
      }
      text.split("\n").forEach((line, i) => {
        if (LONG_DASH.test(line)) hits.push(`${file}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
