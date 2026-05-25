import "dotenv/config";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type SelfhostConfig = {
  apiBase: string;
  identityUrl: string;
  clientId: string;
  clientSecret: string;
};

export type CloudConfig = {
  apiBase: string;
  identityUrl: string;
  clientId: string;
  clientSecret: string;
};

/**
 * Parsed representation of a BWS_ACCESS_TOKEN.
 *
 * The raw token has the form:
 *   0.{accessTokenUuid}.{clientSecret}:{encryptionKey}
 *
 * - accessTokenUuid  → OAuth client_id sent to /connect/token
 * - clientSecret     → OAuth client_secret sent to /connect/token
 * - encryptionKey    → stays CLIENT-SIDE, used to decrypt encrypted_payload
 *                      in the identity response — NEVER sent to the server
 *
 * scope used for SM OAuth requests: api.secrets
 */
export type ParsedBwsToken = {
  accessTokenUuid: string;
  clientSecret: string;
  encryptionKey: string;
};

export type SmConfig = {
  apiBase: string;
  identityUrl: string;
  parsedToken: ParsedBwsToken;
  orgId?: string;
};

export type Config = {
  selfhost: SelfhostConfig | undefined;
  cloud: CloudConfig | undefined;
  sm: SmConfig | undefined;
  confirmWrites: boolean;
  logLevel: LogLevel;
  httpTimeoutMs: number;
  paginationMaxItems: number;
  paginationMaxPages: number;
  maxListResponseBytes: number;
};

const DEFAULTS = {
  confirmWrites: true,
  logLevel: "warn" as LogLevel,
  httpTimeoutMs: 30_000,
  paginationMaxItems: 1000,
  paginationMaxPages: 20,
  maxListResponseBytes: 60_000,
} as const;

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return DEFAULTS.logLevel;
}

type Env = Record<string, string | undefined>;

function loadSelfhost(env: Env): SelfhostConfig | undefined {
  const fields = {
    apiBase: env.BITWARDEN_SELFHOST_API_BASE,
    identityUrl: env.BITWARDEN_SELFHOST_IDENTITY_URL,
    clientId: env.BITWARDEN_SELFHOST_CLIENT_ID,
    clientSecret: env.BITWARDEN_SELFHOST_CLIENT_SECRET,
  };
  const set = Object.values(fields).filter(Boolean).length;
  if (set === 0) return undefined;
  if (set < 4) {
    throw new Error(
      "Self-host partially configured. Set all four of BITWARDEN_SELFHOST_API_BASE, BITWARDEN_SELFHOST_IDENTITY_URL, BITWARDEN_SELFHOST_CLIENT_ID, BITWARDEN_SELFHOST_CLIENT_SECRET or none.",
    );
  }
  return fields as SelfhostConfig;
}

function loadCloud(env: Env): CloudConfig | undefined {
  const fields = {
    apiBase: env.BITWARDEN_CLOUD_API_BASE,
    identityUrl: env.BITWARDEN_CLOUD_IDENTITY_URL,
    clientId: env.BITWARDEN_CLOUD_CLIENT_ID,
    clientSecret: env.BITWARDEN_CLOUD_CLIENT_SECRET,
  };
  const set = Object.values(fields).filter(Boolean).length;
  if (set === 0) return undefined;
  if (set < 4) {
    throw new Error(
      "Cloud partially configured. Set all four of BITWARDEN_CLOUD_API_BASE, BITWARDEN_CLOUD_IDENTITY_URL, BITWARDEN_CLOUD_CLIENT_ID, BITWARDEN_CLOUD_CLIENT_SECRET or none.",
    );
  }
  return fields as CloudConfig;
}

/**
 * Parse a BWS_ACCESS_TOKEN string into its three components.
 *
 * Expected format:  0.{uuid}.{clientSecret}:{encryptionKey}
 *
 * The split rules are:
 *   1. Split on the LAST `:` — left side is the OAuth portion, right side is
 *      the encryption key (which stays client-side and is never sent to the
 *      identity server).
 *   2. Split the OAuth portion on `.` — must yield exactly 3 segments:
 *      ["0", uuid, clientSecret].
 *
 * Common mistake: using the full raw token or the encryption key as
 * `client_secret` — the identity server will respond with `invalid_client`.
 */
export function parseBwsToken(raw: string): ParsedBwsToken {
  const colonIdx = raw.lastIndexOf(":");
  if (colonIdx === -1) {
    throw new Error(
      "BWS_ACCESS_TOKEN is malformed: missing `:` separator between OAuth portion and encryption key. " +
        "Expected format: 0.{uuid}.{clientSecret}:{encryptionKey}",
    );
  }
  const oauthPart = raw.slice(0, colonIdx);
  const encryptionKey = raw.slice(colonIdx + 1);
  const segments = oauthPart.split(".");
  if (segments.length !== 3) {
    throw new Error(
      `BWS_ACCESS_TOKEN is malformed: the OAuth portion (before ":") must have exactly 3 dot-separated segments ` +
        `("0", uuid, clientSecret), got ${segments.length}. ` +
        "Expected format: 0.{uuid}.{clientSecret}:{encryptionKey}",
    );
  }
  const [, accessTokenUuid, clientSecret] = segments;
  if (!accessTokenUuid || !clientSecret || !encryptionKey) {
    throw new Error(
      "BWS_ACCESS_TOKEN is malformed: one or more segments are empty. " +
        "Expected format: 0.{uuid}.{clientSecret}:{encryptionKey}",
    );
  }
  return { accessTokenUuid, clientSecret, encryptionKey };
}

function loadSm(env: Env, selfhost: SelfhostConfig | undefined): SmConfig | undefined {
  const token = env.BWS_ACCESS_TOKEN;
  if (!token) return undefined;
  const apiBase = env.BWS_API_BASE ?? selfhost?.apiBase;
  const identityUrl = env.BWS_IDENTITY_URL ?? selfhost?.identityUrl;
  if (!apiBase || !identityUrl) {
    throw new Error(
      "BWS_ACCESS_TOKEN is set but BWS_API_BASE / BWS_IDENTITY_URL are not, and no self-host config to inherit from.",
    );
  }
  const parsedToken = parseBwsToken(token);
  return {
    apiBase,
    identityUrl,
    parsedToken,
    ...(env.BWS_ORG_ID ? { orgId: env.BWS_ORG_ID } : {}),
  };
}

export function loadConfig(env: Env = process.env): Config {
  const selfhost = loadSelfhost(env);
  const cloud = loadCloud(env);
  if (!selfhost && !cloud) {
    throw new Error(
      "No Bitwarden instance configured. Set at least one instance (BITWARDEN_SELFHOST_* or BITWARDEN_CLOUD_*).",
    );
  }
  const sm = loadSm(env, selfhost);
  return {
    selfhost,
    cloud,
    sm,
    confirmWrites: parseBool(env.BITWARDEN_CONFIRM_WRITES, DEFAULTS.confirmWrites),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    httpTimeoutMs: parsePositiveInt(env.HTTP_TIMEOUT_MS, DEFAULTS.httpTimeoutMs),
    paginationMaxItems: parsePositiveInt(env.PAGINATION_MAX_ITEMS, DEFAULTS.paginationMaxItems),
    paginationMaxPages: parsePositiveInt(env.PAGINATION_MAX_PAGES, DEFAULTS.paginationMaxPages),
    maxListResponseBytes: parsePositiveInt(
      env.BW_MCP_MAX_LIST_RESPONSE_BYTES,
      DEFAULTS.maxListResponseBytes,
    ),
  };
}
