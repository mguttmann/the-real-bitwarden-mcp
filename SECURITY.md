# Security Policy

## Reporting a vulnerability

If you find a security issue in this MCP server, **please do not open a
public GitHub issue.** Instead, report it privately via GitHub's
[Security Advisories](https://github.com/mguttmann/the-real-bitwarden-mcp/security/advisories/new).

I aim to acknowledge new reports within 7 days and to publish a fix or
mitigation guidance within 30 days for high-severity issues.

> **Note:** This project wraps the official Bitwarden APIs but is not
> affiliated with or endorsed by Bitwarden Inc. Vulnerabilities in
> Bitwarden Server itself should be reported to Bitwarden via their
> [responsible disclosure programme](https://bitwarden.com/security/).

## Supported versions

Only the latest minor release on `main` and on npm receives security
fixes. Pin to a specific version in `package.json` only if you also
plan to track advisories.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |

## Threat model

This server is designed to be **run locally** by a single user as an
MCP transport for their AI assistant. It is **not** a multi-tenant
service.

In scope:

- Leaking secrets (OAuth client_secret, BWS access token, bearer
  tokens) through logs, error messages, or tool outputs.
- Bypassing the confirm-gate on destructive writes.
- Sending requests to a host other than the configured Bitwarden API
  base (host-locking).
- Injecting control characters or path-traversal sequences into the
  `bw_raw_request` escape hatch.
- Dependency vulnerabilities reachable at runtime.

Out of scope:

- Compromise of the host machine, the MCP client, or the user's
  shell — if an attacker can read your `.env` file they already have
  your Bitwarden credentials.
- Bitwarden product vulnerabilities (report to Bitwarden directly).
- Denial of service against your own self-hosted Bitwarden instance via
  legitimate but heavy use of the tools.

## Hardening defaults

- `BITWARDEN_CONFIRM_WRITES=true` is the default — destructive tools
  return a preview unless explicitly confirmed.
- One scrubber (`src/redact.ts`) is used for logs and for every error
  text returned to the MCP client: the keys listed in `SENSITIVE_KEYS`
  are removed at any depth (case-insensitive, also in arrays, error
  details, cause chains and AggregateError children), secret-shaped
  substrings in messages (`Bearer ...`, `client_secret=...`, JSON
  `"value": ...`, BWS tokens) are replaced, and stacks are dropped.
- Confirm-gate previews mask secret values (`<redacted, N chars>`);
  `bws_secret_create` / `bws_secret_update` return metadata without the
  value.
- OAuth error responses are stripped of their body before being thrown,
  so a failed token request can't echo back the submitted
  `client_secret`.
- Request URLs are built as API base plus path, so tool paths cannot
  reach another host. Dot segments (`.`, `..`, also percent-encoded) and
  encoded separators (`%2F`, `%5C`) are rejected in `bw_raw_request`
  paths and in ids put into wrapper paths, so a path cannot leave the
  API base prefix either (`src/http/path-safety.ts`).
- `bw_raw_request` rejects control characters and backslashes in
  `path`.
- Redirects are never followed, for API and OAuth token requests; a 3xx
  answer is an error (a followed 307/308 would re-send the request body,
  including the `client_secret`, to the new location).
- `HTTP_TIMEOUT_MS` bounds API requests and the OAuth token request.
