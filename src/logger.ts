import pino, { type Logger, type LoggerOptions, type DestinationStream } from "pino";
import type { LogLevel } from "./config.js";

// Pino redaction paths.
//
// `*` is a SINGLE-level wildcard — it does not recurse. So a path like
// "*.authorization" only matches `something.authorization`, NOT
// `req.headers.authorization` or deeper. We therefore enumerate the realistic
// nesting depths (top, one wildcard, two wildcards, three wildcards) for every
// sensitive key. False positives are cheap; missed redactions are not.
//
// We also redact `err.stack` and `*.stack` because pino's default error
// serializer emits stack traces, and an error message captured mid-request can
// embed a token or secret literally in the stack frames.
const SENSITIVE_KEYS = [
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
  // Cookies can carry session/auth tokens. The header objects below are
  // redacted wholesale, but object-shaped logs may carry these keys directly.
  "cookie",
  "set-cookie",
  "Set-Cookie",
];

function expandPaths(keys: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    out.push(k);
    out.push(`*.${k}`);
    out.push(`*.*.${k}`);
    out.push(`*.*.*.${k}`);
  }
  return out;
}

const REDACT_PATHS = [
  ...expandPaths(SENSITIVE_KEYS),
  // Stack traces can capture secrets verbatim in frames or function arguments
  // when a token-handling call throws. We always strip them from log output.
  "err.stack",
  "*.stack",
  "*.*.stack",
  // Captured request/response bodies on common axios/fetch-style shapes.
  "config.headers",
  "request.headers",
  "response.headers",
];

// Substring scrubbing for error MESSAGES (and folded `cause` messages).
//
// Key-based `redact` cannot reach inside a free-text error message, yet pino's
// std error serializer emits `err.message` and folds `err.cause`. A secret that
// gets interpolated into a thrown Error's message (e.g. an upstream client that
// echoes a token, or a URL with embedded credentials) would otherwise survive
// redaction. We replace the secret-shaped substring with `[REDACTED]`.
//
// Each pattern keeps the leading label/scheme (so the log stays diagnosable)
// and redacts only the value that follows.
const REDACTED = "[REDACTED]";
const SECRET_MESSAGE_PATTERNS: { re: RegExp; replace: (m: string, ...g: string[]) => string }[] = [
  // BWS access-token shape: 0.<uuid>.<base64>:<base64> — redact the whole token.
  {
    re: /0\.[0-9a-fA-F-]{36}\.[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+/g,
    replace: () => REDACTED,
  },
  // `Bearer <token>` (Authorization scheme).
  { re: /(Bearer\s+)[\w.~+/=-]+/gi, replace: (_m, p1: string) => `${p1}${REDACTED}` },
  // `authorization: <value>` / `authorization=<value>` header-in-message.
  {
    re: /(authorization\s*[:=]\s*)[^\s,;"'}]+/gi,
    replace: (_m, p1: string) => `${p1}${REDACTED}`,
  },
  // Form-encoded / JSON-encoded credential params. Covers
  // `client_secret=...`, `"client_secret":"..."`, and the same for the
  // other secret-bearing parameter names.
  {
    re: /("?\b(?:client_secret|client_id|access_token|refresh_token|token|password|api_key)\b"?\s*[:=]\s*"?)[^\s,&;"'}]+/gi,
    replace: (_m, p1: string) => `${p1}${REDACTED}`,
  },
];

function scrubSecretString(input: string): string {
  let out = input;
  for (const { re, replace } of SECRET_MESSAGE_PATTERNS) {
    out = out.replace(re, replace as (substring: string, ...args: unknown[]) => string);
  }
  return out;
}

// Custom error serializer: start from pino's std error output, then scrub the
// message and any nested cause message of secret-shaped substrings, and drop
// the stack entirely (stack frames can capture token literals; the `*.stack`
// redact paths also remove it, but stripping here keeps the serializer
// self-contained and testable).
function serializeError(err: Error): Record<string, unknown> {
  const serialized = pino.stdSerializers.err(err) as Record<string, unknown> & {
    message?: string;
    stack?: string;
    cause?: unknown;
  };
  if (typeof serialized.message === "string") {
    serialized.message = scrubSecretString(serialized.message);
  }
  // pino folds `cause` either as a nested serialized error object (with its own
  // `.message`) or, for non-Error causes, as a string. Scrub both shapes.
  const cause = serialized.cause;
  if (typeof cause === "string") {
    serialized.cause = scrubSecretString(cause);
  } else if (cause && typeof cause === "object") {
    const causeObj = cause as { message?: unknown; stack?: unknown };
    if (typeof causeObj.message === "string") {
      causeObj.message = scrubSecretString(causeObj.message);
    }
    if ("stack" in causeObj) delete causeObj.stack;
  }
  if ("stack" in serialized) delete serialized.stack;
  return serialized;
}

export function createLogger(level: LogLevel, dest?: DestinationStream): Logger {
  const opts: LoggerOptions = {
    level,
    redact: { paths: REDACT_PATHS, remove: true },
    serializers: { err: serializeError },
  };
  return pino(opts, dest ?? pino.destination(2));
}
