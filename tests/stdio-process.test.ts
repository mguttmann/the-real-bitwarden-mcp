// The real entry point as a child process: what reaches stdout, stderr and
// the exit code. No Bitwarden instance is contacted (no tool is called).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, it, expect } from "vitest";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const tsxLoader = fileURLToPath(new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url));
const dirs: string[] = [];

const selfhost = [
  "BITWARDEN_SELFHOST_API_BASE=https://vault.example.invalid/api",
  "BITWARDEN_SELFHOST_IDENTITY_URL=https://vault.example.invalid/identity",
  "BITWARDEN_SELFHOST_CLIENT_ID=organization.fake",
  "BITWARDEN_SELFHOST_CLIENT_SECRET=FAKE-SECRET-1",
];

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!/^(BITWARDEN_|BWS_|DOTENV_|LOG_LEVEL$)/.test(k)) env[k] = v;
  }
  return { ...env, ...extra };
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bwmcp-proc-"));
  dirs.push(dir);
  return dir;
}

type Run = { code: number | null; stdout: string; stderr: string };

/** Start the server, write `lines` (then keep stdin open for `holdMs`), collect output. */
function run(
  nodeArgs: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; lines?: string[]; holdMs?: number },
): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...nodeArgs, "--import", tsxLoader, entry], {
      cwd: opts.cwd,
      env: opts.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.on("error", () => {});
    const killer = setTimeout(() => child.kill(), 20_000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(killer);
      resolve({ code, stdout, stderr });
    });
    for (const line of opts.lines ?? []) child.stdin.write(line + "\n");
    setTimeout(() => child.stdin.end(), opts.holdMs ?? 0);
  });
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("stdio process", () => {
  it("an incoming line over the SDK limit is logged and exits non-zero", async () => {
    const cwd = tempDir();
    const envFile = join(cwd, "server.env");
    writeFileSync(envFile, selfhost.join("\n") + "\n");
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "bw_help", arguments: { pad: "x".repeat(11 * 1024 * 1024) } },
    });
    // stdin stays open: without the fix the process exits 0 on its own.
    const res = await run([`--env-file=${envFile}`], {
      cwd,
      env: cleanEnv(),
      lines: [big],
      holdMs: 15_000,
    });
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/stdio limit/);
    expect(res.stdout).toBe("");
  }, 30_000);

  it("with --env-file, a .env in the working directory is not merged and dotenv writes nothing to stdout", async () => {
    const cwd = tempDir();
    const envFile = join(cwd, "server.env");
    writeFileSync(envFile, [...selfhost, "DOTENV_CONFIG_DEBUG=true"].join("\n") + "\n");
    writeFileSync(join(cwd, ".env"), "LOG_LEVEL=info\n");
    const res = await run([`--env-file=${envFile}`], { cwd, env: cleanEnv() });
    expect(res.code).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).not.toMatch(/ready/);
  }, 30_000);

  it("without --env-file, the working-directory .env is still loaded, quietly", async () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, ".env"), [...selfhost, "LOG_LEVEL=info"].join("\n") + "\n");
    const res = await run([], { cwd, env: cleanEnv({ DOTENV_CONFIG_DEBUG: "true" }) });
    expect(res.code).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toMatch(/the-real-bitwarden-mcp ready/);
  }, 30_000);
});
