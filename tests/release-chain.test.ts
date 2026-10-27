import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";

// Release rules that live in workflow files and package metadata. The
// workflows are read as text (no YAML parser in the tree); jobs are the
// two-space-indented keys under `jobs:`.
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

/** `jobs:` of a workflow, keyed by job id, each with its raw text. */
function jobs(workflow: string): Map<string, string> {
  const start = workflow.indexOf("\njobs:\n");
  expect(start).toBeGreaterThanOrEqual(0);
  const body = workflow.slice(start + "\njobs:\n".length);
  const heads = [...body.matchAll(/^ {2}([a-z0-9-]+):\n/gm)];
  const out = new Map<string, string>();
  heads.forEach((m, i) => out.set(m[1]!, body.slice(m.index, heads[i + 1]?.index ?? body.length)));
  return out;
}

/** The `run:` commands of a job, one entry per script line. */
function runLines(job: string): string[] {
  const lines: string[] = [];
  const all = job.split("\n");
  all.forEach((line, i) => {
    const single = /^\s*(?:- )?run: (?![|>])(.+)$/.exec(line);
    if (single) lines.push(single[1]!.replace(/^["']|["']$/g, ""));
    else if (/^\s*(?:- )?run: [|>]-?\s*$/.test(line)) {
      const indent = /^\s*/.exec(all[i + 1] ?? "")![0].length;
      for (let j = i + 1; j < all.length; j++) {
        const next = all[j]!;
        if (next.trim() && /^\s*/.exec(next)![0].length < indent) break;
        lines.push(next.trim());
      }
    }
  });
  return lines.filter(Boolean);
}

/** Positional (non-option) arguments of every `npm publish` command line. */
function publishPaths(lines: string[]): string[] {
  const paths: string[] = [];
  for (const line of lines) {
    const m = /\bnpm publish\b(.*)$/.exec(line);
    if (!m) continue;
    const args = m[1]!.trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg.startsWith("-")) {
        // Options with a separate value.
        if (["--tag", "--access", "--otp", "--registry", "--workspace", "-w"].includes(arg)) i++;
        continue;
      }
      paths.push(arg);
    }
  }
  return paths;
}

const pkg = JSON.parse(read("package.json")) as {
  name: string;
  version: string;
  mcpName?: string;
  files?: string[];
  publishConfig?: Record<string, unknown>;
  repository?: { url?: string };
  engines?: { node?: string };
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};
const release = read(".github/workflows/release.yml");
const releaseJobs = jobs(release);

describe("release.yml npm-publish", () => {
  const job = releaseJobs.get("npm-publish") ?? "";
  const run = runLines(job);

  it("publishes a tarball and installs nothing", () => {
    expect(job).not.toBe("");
    expect(run.filter((l) => /\bnpm (ci|install|i)\b/.test(l))).toEqual([]);
    expect(publishPaths(run).length).toBeGreaterThan(0);
    expect(job).toContain("sha256sum --check");
    expect(job).toMatch(/^ {6}id-token: write$/m);
    expect(job).toContain("vars.NPM_PUBLISH_ENABLED == 'true'");
  });

  it("names the tarball by a ./ path, so npm does not read it as a GitHub owner/repo shorthand", () => {
    // npm parses a bare "release/x.tgz" (one slash, no ./) as the GitHub
    // repository "release/x.tgz"; that broke a workflow publish before.
    const paths = publishPaths(run);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(p, `npm publish ${p}`).toMatch(/^\.\/\S+\.tgz$/);
    }
  });
});

describe("release.yml MCP Registry", () => {
  it("lists stable releases in the MCP Registry after a successful npm publish", () => {
    const job = releaseJobs.get("mcp-registry");
    expect(job, "release.yml job mcp-registry").toBeDefined();
    expect(job).toMatch(/needs: \[[^\]]*\bnpm-publish\b[^\]]*\]/);
    expect(job).toContain("uses: ./.github/workflows/mcp-registry.yml");
    expect(job).toContain("needs.verify.outputs.prerelease != 'true'");
    expect(job).toContain("needs.npm-publish.result == 'success'");
    expect(job).toMatch(/^ {6}id-token: write$/m);
  });

  it("mcp-registry.yml pins mcp-publisher by version and SHA-256 and logs in with GitHub OIDC", () => {
    const wf = read(".github/workflows/mcp-registry.yml");
    expect(wf).toMatch(/^ {2}workflow_call:$/m);
    expect(wf).toMatch(/^ {2}workflow_dispatch:$/m);
    expect(wf).toMatch(/MCP_PUBLISHER_VERSION: v\d+\.\d+\.\d+\n/);
    expect(wf).toMatch(/MCP_PUBLISHER_SHA256: [0-9a-f]{64}\n/);
    expect(wf).toContain("sha256sum --check --strict");
    expect(wf).toContain("mcp-publisher login github-oidc");
    expect(wf).not.toMatch(/secrets\./);
    // npm must serve the version with our mcpName before publishing, and
    // a version the registry already lists is skipped.
    expect(wf).toContain(".mcpName");
    expect(wf).toContain("registry.modelcontextprotocol.io");
  });
});

describe("release recovery", () => {
  // Backlog registry-dispatch-uses-main-server-json: a manual run took
  // server.json from the branch it was started from and only the version
  // from the tag.
  it("mcp-registry.yml checks out the tag, validated before the checkout", () => {
    const wf = read(".github/workflows/mcp-registry.yml");
    const steps = wf.slice(wf.indexOf("    steps:"));
    const validate = steps.indexOf("is not a stable release tag");
    const checkout = steps.indexOf("uses: actions/checkout@");
    expect(validate).toBeGreaterThan(-1);
    expect(checkout).toBeGreaterThan(validate);
    expect(steps.slice(checkout, steps.indexOf("\n      - ", checkout))).toContain(
      "ref: refs/tags/${{ inputs.tag }}",
    );
    // The tag's server.json must already carry the tag version; it is not rewritten.
    expect(wf).not.toContain("> server.json.tmp");
    expect(wf).toContain("do not match tag");
  });

  // Backlog release-recovery-recipes: the error text told users to push a
  // new tag, which RELEASING.md forbids.
  it("release.yml never tells users to push a new tag, and its recipes are in RELEASING.md", () => {
    expect(release).not.toMatch(/push a new tag/i);
    expect(release).toContain("RELEASING.md");
    const doc = read("RELEASING.md");
    expect(doc).toContain("### Tag pushed while publishing was off");
    expect(doc).toContain("### Half-created release");
  });
});

describe("package.json for npm", () => {
  it("has the publish metadata the registry and provenance need", () => {
    expect(pkg.name).toBe("the-real-bitwarden-mcp");
    expect(pkg.mcpName).toBe("io.github.mguttmann/the-real-bitwarden-mcp");
    expect(pkg.publishConfig).toEqual({ access: "public", provenance: true });
    expect(pkg.repository?.url).toBe("git+https://github.com/mguttmann/the-real-bitwarden-mcp.git");
    expect(pkg.engines?.node).toBe(">=22.12");
    expect(Object.values(pkg.bin ?? {})).toEqual(["dist/index.js"]);
  });

  it("ships only the runtime files and the legal and security notes", () => {
    expect([...(pkg.files ?? [])].sort()).toEqual(
      [
        ".env.example",
        "CHANGELOG.md",
        "LICENSE",
        "NOTICE",
        "README.md",
        "SECURITY.md",
        "dist/",
      ].sort(),
    );
  });

  it("needs no install script (gateways install with --ignore-scripts)", () => {
    for (const s of ["preinstall", "install", "postinstall", "prepare"]) {
      expect(pkg.scripts?.[s], s).toBeUndefined();
    }
  });
});

describe("server.json", () => {
  const load = () =>
    JSON.parse(read("server.json")) as {
      name: string;
      version: string;
      description: string;
      repository: { url: string; source: string };
      packages: {
        registryType: string;
        identifier: string;
        version: string;
        transport: { type: string };
        environmentVariables: {
          name: string;
          isRequired?: boolean;
          isSecret?: boolean;
          default?: string;
        }[];
      }[];
    };
  const example = read(".env.example");

  it("matches package.json: name is mcpName, versions are the package version", () => {
    const server = load();
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.repository).toEqual({
      url: "https://github.com/mguttmann/the-real-bitwarden-mcp",
      source: "github",
    });
    // The registry limits the description length.
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.packages).toHaveLength(1);
    const [npm] = server.packages;
    expect(npm!.registryType).toBe("npm");
    expect(npm!.identifier).toBe(pkg.name);
    expect(npm!.version).toBe(pkg.version);
    expect(npm!.transport).toEqual({ type: "stdio" });
  });

  it("describes only variables the server reads, marks secrets, and requires none on its own", () => {
    const vars = load().packages[0]!.environmentVariables;
    expect(vars.length).toBeGreaterThan(0);
    for (const v of vars) {
      expect(example, v.name).toMatch(new RegExp(`^(# )?${v.name}=`, "m"));
      // Either self-host or cloud is enough, so no single variable is required.
      expect(v.isRequired ?? false, v.name).toBe(false);
      expect(v.isSecret ?? false, v.name).toBe(/_CLIENT_SECRET$|^BWS_ACCESS_TOKEN$/.test(v.name));
    }
    const byName = new Map(vars.map((v) => [v.name, v]));
    for (const name of [
      "BITWARDEN_SELFHOST_CLIENT_SECRET",
      "BITWARDEN_CLOUD_CLIENT_SECRET",
      "BWS_ACCESS_TOKEN",
    ]) {
      expect(byName.get(name)?.isSecret, name).toBe(true);
    }
    // Defaults named in server.json are the defaults of src/config.ts.
    const cfg = loadConfig({
      BITWARDEN_SELFHOST_API_BASE: "https://vault.example.invalid/api",
      BITWARDEN_SELFHOST_IDENTITY_URL: "https://vault.example.invalid/identity",
      BITWARDEN_SELFHOST_CLIENT_ID: "organization.FAKE",
      BITWARDEN_SELFHOST_CLIENT_SECRET: "FAKE-SECRET-1",
    });
    expect(byName.get("BITWARDEN_CONFIRM_WRITES")?.default).toBe(String(cfg.confirmWrites));
    expect(byName.get("BITWARDEN_READ_ONLY")?.default).toBe(String(cfg.readOnly));
    expect(byName.get("LOG_LEVEL")?.default).toBe(cfg.logLevel);
    expect(byName.get("BW_MCP_MAX_RESPONSE_BYTES")?.default).toBe(String(cfg.maxResponseBytes));
  });
});

describe("glama.json", () => {
  it("names the maintainer", () => {
    expect(JSON.parse(read("glama.json"))).toEqual({
      $schema: "https://glama.ai/mcp/schemas/server.json",
      maintainers: ["mguttmann"],
    });
  });
});

describe("docs/maintainers/repo-settings.md", () => {
  it("lists every ci.yml job as a required check of the main ruleset", () => {
    const settings = read("docs/maintainers/repo-settings.md");
    for (const [id, job] of jobs(read(".github/workflows/ci.yml"))) {
      const matrix = /^\s*node: \[([^\]]+)\]/m.exec(job);
      const names = matrix
        ? matrix[1]!.split(",").map((v) => `${id} (${v.trim().replace(/"/g, "")})`)
        : [id];
      for (const name of names) {
        expect(settings, name).toContain(`\`${name}\``);
        expect(settings, name).toContain(`{ "context": "${name}" }`);
      }
    }
  });
});
