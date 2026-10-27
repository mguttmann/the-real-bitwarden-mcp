# Security Policy

## Reporting a vulnerability

Please do not put details of a security issue into a public GitHub
issue, pull request or discussion.

GitHub private vulnerability reporting is currently **not enabled** for
this repository (enabling it is a pending owner action, see
[RELEASING.md](RELEASING.md#repository-settings)). Until it is on:

1. Open a public issue titled "Security contact request" that contains
   **no details** of the issue, only that you have something to report.
2. The maintainer answers with a private channel; send the details there.

Once private vulnerability reporting is enabled, use
[Security Advisories](https://github.com/mguttmann/the-real-bitwarden-mcp/security/advisories/new)
directly and this section will say so.

I aim to acknowledge new reports within 7 days and to publish a fix or
mitigation guidance within 30 days for high-severity issues.

This project wraps the official Bitwarden APIs but is not affiliated with
or endorsed by Bitwarden Inc. Vulnerabilities in Bitwarden Server itself
should be reported to Bitwarden via their
[responsible disclosure programme](https://bitwarden.com/security/).

## Supported versions

Only the latest minor release on `main` and on npm receives security
fixes.

| Version | Supported |
| ------- | --------- |
| 0.2.x   | yes       |
| < 0.2   | no        |

## Threat model

The server is a stdio MCP process. It runs either locally for a single
user, or behind an MCP gateway that starts it headless
(`node --env-file=.env dist/index.js`) and forwards tool calls from its
own users. In both cases the server itself has no notion of users: every
caller that can reach it acts with the full rights of the configured
Bitwarden API keys and Secrets Manager machine account. Access control
between users belongs in the gateway (which tools each user may call).

**The confirm gate is not a security boundary.** `confirm: "YES"` is an
argument the model sets itself. It is friction against hasty writes, not
protection: text inside Bitwarden data (member or collection names,
notes, event data, error bodies) reaches the model unframed, and a model
that follows instructions hidden in it can confirm writes on its own.
Read-only tools are never gated; that includes `bws_secret_get_value`,
which returns a cleartext secret. Scope the API keys and the machine
account to what the callers may do.

In scope:

- Leaking secrets (OAuth client secret, BWS access token, bearer tokens,
  secret values) through logs, error texts, previews or tool results
  other than `bws_secret_get_value`.
- Requests to a host other than the configured API base, or to paths
  outside the API base prefix.
- Writes that report success without effect, or that change state the
  caller did not ask to change.
- Dependency vulnerabilities reachable at runtime.

Out of scope:

- Compromise of the host machine, the MCP client or gateway, or the
  user's shell: whoever can read `.env` already has the credentials.
- A model that confirms a write on its own (see above).
- Bitwarden product vulnerabilities (report to Bitwarden directly).
- Denial of service against your own Bitwarden instance through
  legitimate but heavy use of the tools.

## Hardening defaults

- `BITWARDEN_CONFIRM_WRITES=true` is the default: write tools return a
  preview unless the call carries `confirm: "YES"`.
- One scrubber (`src/redact.ts`) is used for logs and for every error
  text returned to the MCP client: the keys listed in `SENSITIVE_KEYS`
  are removed at any depth (case-insensitive, also in arrays, error
  details, cause chains and AggregateError children), secret-shaped
  substrings in messages (`Bearer ...`, `client_secret=...`, JSON
  `"value": ...`, BWS tokens) are replaced, and stacks are dropped.
- Confirm-gate previews mask secret values (`<redacted, N chars>`);
  `bws_secret_create` / `bws_secret_update` return metadata without the
  value.
- OAuth error responses are reduced to the status code before being
  thrown, so a failed token request cannot echo the submitted client
  secret.
- Request URLs are built as API base plus path and parsed once, so a
  tool path cannot name another host. Dot segments (`.`, `..`, also
  percent-encoded) and encoded separators (`%2F`, `%5C`) are rejected in
  `bw_raw_request` paths and in ids put into wrapper paths, so a path
  cannot leave the API base prefix either (`src/http/path-safety.ts`).
  `bw_raw_request` also rejects control characters and backslashes.
- Redirects are never followed, for API and OAuth token requests; a 3xx
  answer is an error.
- `HTTP_TIMEOUT_MS` bounds API requests and the OAuth token request.
  Calls into the Secrets Manager SDK have no timeout of their own.
- Writes (POST, PUT, PATCH, DELETE) are not retried after a 5xx or a
  network error; only a 429 answer (request not processed) is retried
  for every method. Both cases report that the write may or may not have
  been applied.
