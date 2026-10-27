// End to end over stdio: scripts/stdio-probe.mjs starts the server the way
// the gateway does (`node --env-file=<file> <repo>/dist/index.js`), runs the
// handshake for each protocol revision and lists the tools. The result must
// be the contract (tests/fixtures/tool-contract.json plus the recorded
// additions, scripts/tool-contract.mjs) and package.json's version.
//
// By default <repo>/dist/index.js is a symlink to src/index.ts in a temp
// dir (tsx via NODE_OPTIONS), so `npm test` needs no build. With
// STDIO_PROBE_BUILT=1 (CI, after `npm run build`) the probe runs against the
// built dist/index.js of this checkout instead.
// Fake credentials and .invalid hosts only; no tool is called.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, it, expect } from "vitest";
import {
  expectedContract,
  loadContractFixtures,
  probeAsContract,
} from "../scripts/tool-contract.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const probe = join(root, "scripts", "stdio-probe.mjs");
const tsxLoader = join(root, "node_modules", "tsx", "dist", "loader.mjs");
const built = process.env.STDIO_PROBE_BUILT === "1";

const fixtures = loadContractFixtures(root);
const contract = {
  selfhostCloud: expectedContract(fixtures.baseline.selfhostCloud, fixtures.added.selfhostCloud),
  selfhostCloudBws: expectedContract(
    fixtures.baseline.selfhostCloudBws,
    fixtures.added.selfhostCloudBws,
  ),
};
const pkgVersion = (
  JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string }
).version;

const instances: Record<string, string> = {
  BITWARDEN_SELFHOST_API_BASE: "https://vault.example.invalid/api",
  BITWARDEN_SELFHOST_IDENTITY_URL: "https://vault.example.invalid/identity",
  BITWARDEN_SELFHOST_CLIENT_ID: "organization.FAKE-CLIENT-ID",
  BITWARDEN_SELFHOST_CLIENT_SECRET: "FAKE-SECRET-1",
  BITWARDEN_CLOUD_API_BASE: "https://api.example.invalid",
  BITWARDEN_CLOUD_IDENTITY_URL: "https://identity.example.invalid",
  BITWARDEN_CLOUD_CLIENT_ID: "organization.FAKE-CLIENT-ID",
  BITWARDEN_CLOUD_CLIENT_SECRET: "FAKE-SECRET-2",
  BITWARDEN_CONFIRM_WRITES: "true",
  LOG_LEVEL: "warn",
};
const bws = { BWS_ACCESS_TOKEN: "0.FAKE-UUID-1.FAKE-SECRET-3:FAKE-KEY-1" };

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bwmcp-probe-"));
  dirs.push(dir);
  return dir;
}

/** A repo dir whose dist/index.js is the real entry point. */
function repoDir(): string {
  if (built) return root;
  const dir = tempDir();
  mkdirSync(join(dir, "dist"));
  symlinkSync(join(root, "src", "index.ts"), join(dir, "dist", "index.js"));
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  symlinkSync(join(root, "package.json"), join(dir, "package.json"));
  return dir;
}

function baseEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!/^(BITWARDEN_|BWS_|DOTENV_|LOG_LEVEL$|NODE_OPTIONS$)/.test(k)) env[k] = v;
  }
  if (!built) env.NODE_OPTIONS = `--import ${tsxLoader}`;
  return env;
}

type Probe = {
  serverInfo: { name: string; version: string };
  protocolVersion: string;
  tools: { name: string; required: string[]; props: string[] }[];
};

function runProbe(
  repo: string,
  version: string,
  envFile: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [probe, repo, version, envFile],
      { env, timeout: 40_000 },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === "number" ? err.code : -1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

describe.each(["2025-06-18", "2025-11-25", "2026-07-28"])("stdio probe, revision %s", (rev) => {
  for (const cfg of ["selfhostCloud", "selfhostCloudBws"] as const) {
    it(`${cfg}: tools/list matches the contract and serverInfo.version is package.json's`, async () => {
      const repo = repoDir();
      const envFile = join(tempDir(), "server.env");
      const vars = cfg === "selfhostCloudBws" ? { ...instances, ...bws } : instances;
      writeFileSync(
        envFile,
        Object.entries(vars)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n") + "\n",
      );
      const res = await runProbe(repo, rev, envFile, baseEnv());
      expect(res.stderr).toBe("");
      expect(res.code).toBe(0);
      const p = JSON.parse(res.stdout) as Probe;
      expect(p.protocolVersion).toBe(rev);
      expect(p.serverInfo).toEqual({ name: "the-real-bitwarden-mcp", version: pkgVersion });
      expect(probeAsContract(p)).toEqual(contract[cfg]);
    }, 60_000);
  }

  it("passes the caller's environment to the server (config not in the env file)", async () => {
    const repo = repoDir();
    const envFile = join(tempDir(), "empty.env");
    writeFileSync(envFile, "");
    const res = await runProbe(repo, rev, envFile, { ...baseEnv(), ...instances });
    expect(res.code).toBe(0);
    const p = JSON.parse(res.stdout) as Probe;
    expect(probeAsContract(p)).toEqual(contract.selfhostCloud);
  }, 60_000);
});
