import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { OPERATIONS } from "../src/tools/generated/operations.js";

describe("generated tool snapshot", () => {
  it("matches the committed snapshot", async () => {
    const snapPath = resolve(process.cwd(), "src/tools/generated/snapshot.json");
    const snap = JSON.parse(await readFile(snapPath, "utf8")) as { toolNames: string[] };
    const actual = OPERATIONS.map((o) => o.toolName).sort();
    expect(actual).toEqual(snap.toolNames);
  });
});
