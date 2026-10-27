// One scrubbing mechanism for secret material, used by the logger (formatter
// and err serializer) and by every error text returned to the MCP client.
//
// - Structured values: keys in SENSITIVE_KEYS (matched case-insensitively)
//   are removed at any depth, also inside arrays, Error properties, cause
//   chains and AggregateError children. Stacks are dropped. Cycles are cut.
// - Free text (messages): secret-shaped substrings are replaced with
//   `[REDACTED]`, keeping the label so the text stays diagnosable.
// - Previews: secret values are masked with their length only.

export const SENSITIVE_KEYS = [
  "authorization",
  "Authorization",
  "client_secret",
  "clientSecret",
  "client_id",
  "BWS_ACCESS_TOKEN",
  "access_token",
  "accessToken",
  "token",
  "refreshToken",
  "refresh_token",
  "apiKey",
  "api_key",
  "encryptionKey",
  "password",
  "secret",
  "bearer",
  "Bearer",
  // `key` and `value` are deliberately broad. A false-positive redaction in a
  // log line is cheap; a missed secret is not. SM secret values land under
  // `value`, and generic credential maps frequently use `key`.
  "key",
  "value", // SM secret values
  // Cookies can carry session/auth tokens.
  "cookie",
  "set-cookie",
  "Set-Cookie",
];

const SENSITIVE = new Set(SENSITIVE_KEYS.map((k) => k.toLowerCase()));
// `key` is the name of an SM secret, not its value: keep it visible in previews.
const PREVIEW_MASKED = new Set([...SENSITIVE].filter((k) => k !== "key"));
// Whole header maps on common axios/fetch-style shapes.
const HEADER_CONTAINERS = new Set(["config", "request", "response"]);

export const REDACTED = "[REDACTED]";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const KEY_ALTERNATION = [...SENSITIVE].map(escapeRe).join("|");

const SECRET_MESSAGE_PATTERNS: { re: RegExp; replace: (m: string, ...g: string[]) => string }[] = [
  // BWS access-token shape: 0.<uuid>.<base64>:<base64> - redact the whole token.
  {
    re: /0\.[0-9a-fA-F-]{36}\.[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+/g,
    replace: () => REDACTED,
  },
  // JSON-shaped `"<sensitive key>": <string | array | scalar>`.
  {
    re: new RegExp(
      `("(?:${KEY_ALTERNATION})"\\s*:\\s*)(?:"(?:[^"\\\\]|\\\\.)*"|\\[[^\\]]*\\]|[^\\s,}\\]]+)`,
      "gi",
    ),
    replace: (_m, p1: string) => `${p1}"${REDACTED}"`,
  },
  // `Bearer <token>` (Authorization scheme).
  { re: /(Bearer\s+)[\w.~+/=-]+/gi, replace: (_m, p1: string) => `${p1}${REDACTED}` },
  // `authorization: <value>` / `authorization=<value>` header-in-message.
  {
    re: /(authorization\s*[:=]\s*)[^\s,;"'}]+/gi,
    replace: (_m, p1: string) => `${p1}${REDACTED}`,
  },
  // Form-encoded / text credential params: `client_secret=...`, `value: ...`.
  {
    re: new RegExp(`(\\b(?:${KEY_ALTERNATION})\\b\\s*[:=]\\s*)[^\\s,&;"'}]+`, "gi"),
    replace: (_m, p1: string) => `${p1}${REDACTED}`,
  },
];

/** Replace secret-shaped substrings in free text. */
export function scrubString(input: string): string {
  let out = input;
  for (const { re, replace } of SECRET_MESSAGE_PATTERNS) {
    out = out.replace(re, replace as (substring: string, ...args: unknown[]) => string);
  }
  return out;
}

/** Drop stack frames and a Node `Require stack:` list (absolute paths) from a message. */
function stripStack(text: string): string {
  return text.replace(/\nRequire stack:[\s\S]*$/, "").replace(/\n\s+at\s[^\n]*/g, "");
}

/** Error text for the MCP client: no stacks, no secret-shaped substrings. */
export function scrubClientText(text: string): string {
  return scrubString(stripStack(text));
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE.has(key.toLowerCase());
}

function redactError(err: Error, ancestors: Set<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: err.constructor?.name ?? err.name,
    message: scrubString(err.message),
  };
  for (const [k, v] of Object.entries(err)) {
    if (k === "stack" || k === "message" || isSensitiveKey(k)) continue;
    out[k] = walk(v, k, ancestors);
  }
  if (err.cause !== undefined) out.cause = walk(err.cause, "cause", ancestors);
  if (err instanceof AggregateError) {
    out.aggregateErrors = walk(err.errors, "aggregateErrors", ancestors);
  }
  return out;
}

function walk(value: unknown, parentKey: string | undefined, ancestors: Set<object>): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  try {
    if (value instanceof Error) return redactError(value, ancestors);
    if (Array.isArray(value)) return value.map((v) => walk(v, parentKey, ancestors));
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") return walk(toJSON.call(value), parentKey, ancestors);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (isSensitiveKey(k) || k === "stack") continue;
      if (k === "headers" && parentKey !== undefined && HEADER_CONTAINERS.has(parentKey)) continue;
      out[k] = walk(v, k, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Redacted copy of any value for logging: sensitive keys removed at any
 * depth, strings scrubbed, Errors serialized without stacks (cause chain and
 * AggregateError children included), cycles replaced with "[Circular]".
 */
export function redactForLog(value: unknown): unknown {
  return walk(value, undefined, new Set());
}

/** Copy of a tool input or request body with secret values replaced by their length. */
export function maskSecretValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecretValues);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (PREVIEW_MASKED.has(k.toLowerCase())) {
      out[k] = typeof v === "string" ? `<redacted, ${v.length} chars>` : "<redacted>";
    } else {
      out[k] = maskSecretValues(v);
    }
  }
  return out;
}
