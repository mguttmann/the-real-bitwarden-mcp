// The entry point must run main() when started through the npm bin symlink
// (node_modules/.bin/bitwarden-mcp, global install, npx), not only when
// argv[1] ends in index.js. With no instance configured, main() fails
// with the config error and exit code 1; a skipped main() exits 0 silently.
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const tsxLoader = fileURLToPath(new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url));

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith("BITWARDEN_") && !k.startsWith("BWS_")) env[k] = v;
  }
  return env;
}

describe("entry point", () => {
  it("runs main() when started through a bin symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "bwmcp-bin-"));
    const link = join(dir, "bitwarden-mcp");
    symlinkSync(entry, link);
    // cwd is the empty temp dir so no .env is picked up.
    const res = spawnSync(process.execPath, ["--import", tsxLoader, link], {
      cwd: dir,
      env: cleanEnv(),
      input: "",
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(res.stderr).toContain("No Bitwarden instance configured");
    expect(res.status).toBe(1);
  });
});
