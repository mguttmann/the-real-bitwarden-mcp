import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, it, expect } from "vitest";
import { loadConfig, parseBwsToken } from "../src/config.js";

const minimalSelfhost = {
  BITWARDEN_SELFHOST_API_BASE: "https://h/api",
  BITWARDEN_SELFHOST_IDENTITY_URL: "https://h/identity",
  BITWARDEN_SELFHOST_CLIENT_ID: "organization.s",
  BITWARDEN_SELFHOST_CLIENT_SECRET: "secret-s",
};
const minimalCloud = {
  BITWARDEN_CLOUD_API_BASE: "https://api.bitwarden.com",
  BITWARDEN_CLOUD_IDENTITY_URL: "https://identity.bitwarden.com",
  BITWARDEN_CLOUD_CLIENT_ID: "organization.c",
  BITWARDEN_CLOUD_CLIENT_SECRET: "secret-c",
};

describe("loadConfig", () => {
  it("detects self-host-only mode", () => {
    const cfg = loadConfig(minimalSelfhost);
    expect(cfg.selfhost).toBeDefined();
    expect(cfg.cloud).toBeUndefined();
    expect(cfg.sm).toBeUndefined();
    expect(cfg.confirmWrites).toBe(true); // default true
  });

  it("detects cloud-only mode", () => {
    const cfg = loadConfig(minimalCloud);
    expect(cfg.selfhost).toBeUndefined();
    expect(cfg.cloud).toBeDefined();
  });

  it("detects both", () => {
    const cfg = loadConfig({ ...minimalSelfhost, ...minimalCloud });
    expect(cfg.selfhost).toBeDefined();
    expect(cfg.cloud).toBeDefined();
  });

  it("detects SM when token is set", () => {
    const token =
      "0.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCCCCCCCCCCCC==";
    const cfg = loadConfig({
      ...minimalSelfhost,
      BWS_ACCESS_TOKEN: token,
      BWS_API_BASE: "https://h/api",
      BWS_IDENTITY_URL: "https://h/identity",
    });
    expect(cfg.sm).toBeDefined();
    expect(cfg.sm?.parsedToken.accessTokenUuid).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(cfg.sm?.parsedToken.clientSecret).toBe("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
    expect(cfg.sm?.parsedToken.encryptionKey).toBe("CCCCCCCCCCCCCCCCCCCCCC==");
  });

  it("throws when neither instance is configured", () => {
    expect(() => loadConfig({})).toThrow(/at least one instance/i);
  });

  it("throws when self-host is partially configured", () => {
    expect(() => loadConfig({ BITWARDEN_SELFHOST_CLIENT_ID: "x" })).toThrow(/self.?host/i);
  });

  it("CONFIRM_WRITES=false disables guard", () => {
    const cfg = loadConfig({
      ...minimalSelfhost,
      BITWARDEN_CONFIRM_WRITES: "false",
    });
    expect(cfg.confirmWrites).toBe(false);
  });

  it("BITWARDEN_READ_ONLY defaults to off; true, 1 and yes turn it on", () => {
    expect(loadConfig(minimalSelfhost).readOnly).toBe(false);
    expect(loadConfig({ ...minimalSelfhost, BITWARDEN_READ_ONLY: "" }).readOnly).toBe(false);
    expect(loadConfig({ ...minimalSelfhost, BITWARDEN_READ_ONLY: "false" }).readOnly).toBe(false);
    for (const v of ["true", "1", "yes", "TRUE"]) {
      expect(loadConfig({ ...minimalSelfhost, BITWARDEN_READ_ONLY: v }).readOnly).toBe(true);
    }
  });

  it("an unrecognised BITWARDEN_READ_ONLY value turns read-only mode on (fails safe)", () => {
    expect(loadConfig({ ...minimalSelfhost, BITWARDEN_READ_ONLY: "ture" }).readOnly).toBe(true);
  });

  it("BITWARDEN_READ_ONLY accepts on/off, yes/no, true/false and 1/0 in any case", () => {
    for (const v of ["off", "OFF", "Off", "no", "NO", "false", "False", "0", " off "]) {
      expect(loadConfig({ ...minimalSelfhost, BITWARDEN_READ_ONLY: v }).readOnly).toBe(false);
    }
    for (const v of ["on", "ON", "On", "yes", "Yes", "true", "1", " on "]) {
      expect(loadConfig({ ...minimalSelfhost, BITWARDEN_READ_ONLY: v }).readOnly).toBe(true);
    }
  });

  it("a BITWARDEN_READ_ONLY value of only whitespace counts as unset (off)", () => {
    for (const v of [" ", "   ", "\t", " \n "]) {
      expect(loadConfig({ ...minimalSelfhost, BITWARDEN_READ_ONLY: v }).readOnly).toBe(false);
    }
  });

  it("BITWARDEN_CONFIRM_WRITES accepts off and on; whitespace or unknown keeps it on", () => {
    expect(loadConfig({ ...minimalSelfhost, BITWARDEN_CONFIRM_WRITES: "OFF" }).confirmWrites).toBe(
      false,
    );
    expect(loadConfig({ ...minimalSelfhost, BITWARDEN_CONFIRM_WRITES: "on" }).confirmWrites).toBe(
      true,
    );
    for (const v of ["  ", "nope"]) {
      expect(loadConfig({ ...minimalSelfhost, BITWARDEN_CONFIRM_WRITES: v }).confirmWrites).toBe(
        true,
      );
    }
  });

  it("defaults maxListResponseBytes to 60000", () => {
    const cfg = loadConfig(minimalSelfhost);
    expect(cfg.maxListResponseBytes).toBe(60000);
  });

  it("BW_MCP_MAX_LIST_RESPONSE_BYTES overrides maxListResponseBytes", () => {
    const cfg = loadConfig({ ...minimalSelfhost, BW_MCP_MAX_LIST_RESPONSE_BYTES: "120000" });
    expect(cfg.maxListResponseBytes).toBe(120000);
  });

  it("rejects an API base or identity URL that is not a plain http(s) URL, naming the variable only", () => {
    const bad = [
      ["BITWARDEN_SELFHOST_API_BASE", "vault.example.invalid/api"],
      ["BITWARDEN_SELFHOST_IDENTITY_URL", "ftp://vault.example.invalid/identity"],
      ["BITWARDEN_SELFHOST_API_BASE", "https://vault.example.invalid/api?x=1"],
      ["BITWARDEN_SELFHOST_IDENTITY_URL", "https://vault.example.invalid/identity#frag"],
    ] as const;
    for (const [name, value] of bad) {
      let message = "";
      try {
        loadConfig({ ...minimalSelfhost, [name]: value });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain(name);
      expect(message).not.toContain(value);
    }
    expect(() =>
      loadConfig({ ...minimalCloud, BITWARDEN_CLOUD_API_BASE: "https://api.bitwarden.com?x" }),
    ).toThrow(/BITWARDEN_CLOUD_API_BASE/);
  });

  it("rejects a bad BWS_API_BASE / BWS_IDENTITY_URL", () => {
    const token =
      "0.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCCCCCCCCCCCC==";
    expect(() =>
      loadConfig({ ...minimalSelfhost, BWS_ACCESS_TOKEN: token, BWS_API_BASE: "not a url" }),
    ).toThrow(/BWS_API_BASE/);
    expect(() =>
      loadConfig({
        ...minimalSelfhost,
        BWS_ACCESS_TOKEN: token,
        BWS_IDENTITY_URL: "https://h/identity?x",
      }),
    ).toThrow(/BWS_IDENTITY_URL/);
  });

  it("accepts http and https URLs with a path", () => {
    const cfg = loadConfig({
      ...minimalSelfhost,
      BITWARDEN_SELFHOST_API_BASE: "http://127.0.0.1:8087/api/",
    });
    expect(cfg.selfhost?.apiBase).toBe("http://127.0.0.1:8087/api/");
  });

  it("includes BWS_ORG_ID when set", () => {
    const token =
      "0.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCCCCCCCCCCCC==";
    const cfg = loadConfig({
      ...minimalSelfhost,
      BWS_ACCESS_TOKEN: token,
      BWS_ORG_ID: "org-uuid",
    });
    expect(cfg.sm?.orgId).toBe("org-uuid");
  });
});

describe("parseBwsToken", () => {
  const validToken =
    "0.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCCCCCCCCCCCC==";

  it("parses a valid 3-part token correctly", () => {
    const parsed = parseBwsToken(validToken);
    expect(parsed.accessTokenUuid).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(parsed.clientSecret).toBe("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
    expect(parsed.encryptionKey).toBe("CCCCCCCCCCCCCCCCCCCCCC==");
  });

  it("uses the last colon as the OAuth/encryption-key separator", () => {
    // The encryption key portion is everything after the LAST colon.
    // Token: 0.{uuid}.{secret}:{encKey}
    const parsed = parseBwsToken(validToken);
    // Verify: what comes after the last colon is treated as encryptionKey
    const lastColon = validToken.lastIndexOf(":");
    expect(parsed.encryptionKey).toBe(validToken.slice(lastColon + 1));
  });

  it("throws when the colon separator is missing", () => {
    expect(() => parseBwsToken("0.uuid.secretNOCOLON")).toThrow(/missing.*:/i);
  });

  it("throws when the OAuth portion has too few dot segments (only 2)", () => {
    expect(() => parseBwsToken("0.uuid:encryptionKey")).toThrow(/3.*segment/i);
  });

  it("throws when the OAuth portion has too many dot segments (4)", () => {
    expect(() => parseBwsToken("0.uuid.secret.extra:encryptionKey")).toThrow(/3.*segment/i);
  });

  it("throws when uuid segment is empty", () => {
    expect(() => parseBwsToken("0..secret:key")).toThrow(/malformed|empty/i);
  });

  it("does NOT include the encryption key in the client_secret field", () => {
    const parsed = parseBwsToken(validToken);
    // Verify encryptionKey is separate and not mixed into clientSecret
    expect(parsed.clientSecret).not.toContain("CCCCCCCCCCCCCCCCCCCCCC==");
    expect(parsed.clientSecret).toBe("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
  });
});

describe(".env.example", () => {
  it("copied unedited, starts with both instances and SM not configured", () => {
    const env = parseEnv(readFileSync(new URL("../.env.example", import.meta.url), "utf8"));
    const cfg = loadConfig(env);
    expect(cfg.selfhost).toBeDefined();
    expect(cfg.cloud).toBeDefined();
    expect(cfg.sm).toBeUndefined();
  });

  it("lists every variable that loadConfig reads", () => {
    const text = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    const source = readFileSync(new URL("../src/config.ts", import.meta.url), "utf8");
    const read = [...source.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]);
    for (const name of new Set(read)) expect(text).toMatch(new RegExp(`^#? ?${name}=`, "m"));
  });
});
