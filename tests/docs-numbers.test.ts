import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";
import { loadConfig } from "../src/config.js";
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  MAX_INPUT_ARRAY_ITEMS,
  MAX_INPUT_STRING_BYTES,
  TOKEN_BACKOFF_FAILURES,
  TOKEN_BACKOFF_MS,
} from "../src/limits.js";

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
      BW_MCP_MAX_RESPONSE_BYTES: cfg.maxResponseBytes,
    };
    const readme = read("README.md");
    const example = read(".env.example");
    for (const [name, value] of Object.entries(defaults)) {
      expect(readme).toMatch(new RegExp(`\\| \`${name}\` +\\| +\\| default ${value}[; ]`));
      expect(example).toMatch(new RegExp(`^${name}=${value}$`, "m"));
    }
  });

  it("the Limits section in README and the CHANGELOG name the src/limits.ts values", () => {
    const readme = read("README.md");
    const section = readme.slice(readme.indexOf("## Limits"), readme.indexOf("## Running"));
    expect(section).toContain(`default ${DEFAULT_MAX_RESPONSE_BYTES})`);
    expect(MAX_INPUT_STRING_BYTES % 1024).toBe(0);
    expect(section).toContain(
      `longer than ${MAX_INPUT_STRING_BYTES} bytes (${MAX_INPUT_STRING_BYTES / 1024} KiB)`,
    );
    expect(section).toContain(`more than ${MAX_INPUT_ARRAY_ITEMS} items`);
    expect(section).toContain(`more than ${MAX_INPUT_ARRAY_ITEMS}\n  members or groups`);
    expect(section).toContain(`After ${TOKEN_BACKOFF_FAILURES} consecutive failed token requests`);
    expect(section).toContain(`pause for ${TOKEN_BACKOFF_MS / 1000} s`);
    // No other number in the section than these.
    const allowed = new Set(
      [
        DEFAULT_MAX_RESPONSE_BYTES,
        MAX_INPUT_STRING_BYTES,
        MAX_INPUT_STRING_BYTES / 1024,
        MAX_INPUT_ARRAY_ITEMS,
        TOKEN_BACKOFF_FAILURES,
        TOKEN_BACKOFF_MS / 1000,
      ].map(String),
    );
    for (const n of section.match(/\d+/g) ?? []) expect(allowed, n).toContain(n);

    const changelog = read("CHANGELOG.md");
    const unreleased = changelog.slice(0, changelog.indexOf("## [0.2.1]"));
    expect(unreleased).toContain(`default ${DEFAULT_MAX_RESPONSE_BYTES}`);
    expect(unreleased).toContain(`${MAX_INPUT_STRING_BYTES} bytes`);
    expect(unreleased).toContain(`${MAX_INPUT_ARRAY_ITEMS} items`);
    expect(unreleased).toContain(`${TOKEN_BACKOFF_FAILURES} consecutive failed`);
    expect(unreleased).toContain(`${TOKEN_BACKOFF_MS / 1000} s`);
  });
});
