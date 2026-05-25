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
- Logs redact 13 sensitive keys at four nesting levels plus `err.stack`
  (see `src/logger.ts`).
- OAuth error responses are stripped of their body before being thrown,
  so a failed token request can't echo back the submitted
  `client_secret`.
- The API base URL is parsed and host-locked once at startup; tool
  paths cannot reach outside the configured host.
- `bw_raw_request` rejects control characters and backslashes in
  `path`.
