import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { loadConfig } from "../src/config.js";

// Numbers the docs name are held here against their source, so a change
// of the source fails this test instead of leaving the docs wrong.
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("numbers in docs", () => {
  it("the stdio message limit in README and CHANGELOG is the SDK default", () => {
    const mib = STDIO_DEFAULT_MAX_BUFFER_SIZE / (1024 * 1024);
    expect(Number.isInteger(mib)).toBe(true);
    expect(read("README.md")).toContain(`at most ${mib} MiB`);
    expect(read("CHANGELOG.md")).toContain(`than ${mib} MiB`);
  });

  it("the CI Node versions in the docs are the ci.yml matrix", () => {
    const match = /^\s*node: \[([^\]]+)\]/m.exec(read(".github/workflows/ci.yml"));
    expect(match).not.toBeNull();
    const versions = match![1]!.split(",").map((v) => v.trim().replace(/"/g, ""));
    expect(versions.length).toBeGreaterThan(1);
    const spoken = `${versions.slice(0, -1).join(", ")} and ${versions.at(-1)}`;
    expect(read("README.md")).toContain(`CI tests ${spoken}`);
    expect(read("CONTRIBUTING.md")).toContain(`on Node ${spoken}`);
    expect(read("CLAUDE.md")).toContain(`on Node ${spoken}`);
    expect(read("RELEASING.md")).toContain(`Node ${versions.join("/")} build`);
  });

  it("the numeric env defaults in README and .env.example are the config defaults", () => {
    const cfg = loadConfig({
      BITWARDEN_SELFHOST_API_BASE: "https://vault.example.invalid/api",
      BITWARDEN_SELFHOST_IDENTITY_URL: "https://vault.example.invalid/identity",
      BITWARDEN_SELFHOST_CLIENT_ID: "organization.FAKE",
      BITWARDEN_SELFHOST_CLIENT_SECRET: "FAKE-SECRET-1",
    });
    const defaults: Record<string, number> = {
      HTTP_TIMEOUT_MS: cfg.httpTimeoutMs,
      PAGINATION_MAX_ITEMS: cfg.paginationMaxItems,
      PAGINATION_MAX_PAGES: cfg.paginationMaxPages,
      BW_MCP_MAX_LIST_RESPONSE_BYTES: cfg.maxListResponseBytes,
    };
    const readme = read("README.md");
    const example = read(".env.example");
    for (const [name, value] of Object.entries(defaults)) {
      expect(readme).toMatch(new RegExp(`\\| \`${name}\` +\\| +\\| default ${value}[; ]`));
      expect(example).toMatch(new RegExp(`^${name}=${value}$`, "m"));
    }
  });
});
