# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-27

Modernization release: MCP SDK v2, Node 22.12 floor, write tools that do
what they say, one secret scrubber for logs and error texts, and a
release chain with provenance. Tool names, parameter names and required
parameters are unchanged (pinned by `tests/tool-contract.test.ts`).

### Breaking

- **Node.js 22.12 or newer is required** (see the first behaviour change).
- **Write tools that could not work now return errors instead of false
  successes**: `bw_member_grant_sm`, `bw_member_revoke_sm`,
  `bw_member_invite` with `accessSecretsManager: true`,
  `bw_group_create` / `bw_group_update` with `accessAll: true`,
  `bw_collection_update` with a non-empty `users` list, `bw_event_query`
  with `ipAddress` or with `actingUserId` and `itemId` together.
- **The four `bw_license_*_update` tools now really change the
  subscription** (before they were no-ops reported as success).
- **`bws_secret_create` / `bws_secret_update` no longer return the
  secret value.**

### Behaviour changes

- **Node.js 22.12 or newer is required** (`engines.node` `>=22.12`, was
  `>=20.0.0`). Node 20 is end of life; the test runner (vitest 5) also
  needs 22.12.
- **MCP SDK v2** (`@modelcontextprotocol/server` 2.x replaces
  `@modelcontextprotocol/sdk` 1.x). The server keeps the low-level `Server`
  and the hand-written JSON Schemas, so the SDK change alone leaves
  `tools/list` as it was. Across this release tool names, required lists
  and property names are unchanged (`tests/fixtures/tool-contract.json`);
  some descriptions changed and the misleading `default` entries of the
  update tools were removed (see below). Stdio is now served through
  `serveStdio(..., { legacy: "serve" })`:
  - clients that send `initialize` with 2025-06-18 or 2025-11-25 get the
    same revision back, as before;
  - `initialize` with 2026-07-28 is still answered with 2025-11-25;
  - new: clients that open with the 2026-07-28 revision
    (`server/discover`, per-request `_meta` envelope) are served at
    2026-07-28.
- **Stdio message size limit**: a single incoming JSON-RPC message larger
  than 10 MiB closes the transport and the process exits (SDK default).
  The v0.1.1 lockfile pinned SDK 1.29, which had no limit.
- **`serverInfo.version`** in the `initialize` result now reports the
  package version from `package.json` (it was hard-coded to `0.1.0`).
- **npm bin `bitwarden-mcp`** (npx, global install,
  `node_modules/.bin`) now starts the server. Before, the entry point
  check compared the file name of `argv[1]`, so a start through the bin
  symlink exited with code 0 without doing anything. Starting
  `node dist/index.js` directly is unaffected.
- **`bw_member_update` keeps state for omitted fields.** Before, leaving out
  `groups`, `collections` or `externalId` sent `[]` / `null` and removed the
  member from all groups, all direct collection access and the external id;
  a Custom member also lost its custom permissions. Now `groups` is only sent
  when given (the API keeps memberships otherwise), and `externalId`,
  `collections` and (for Custom members staying Custom) `permissions` are
  read from the current member (one extra GET) when not given. The schema no
  longer advertises `default: []` / `default: null` for these fields.
- **`bw_group_update` keeps state for omitted fields.** A rename no longer
  sends `collections: []` (which removed all collection access of the
  group) or `externalId: null`; `collections` is only sent when given and
  `externalId` is read from the current group when not given.
- **`bw_policy_set` keeps the policy data when `data` is omitted.** Before,
  it sent `data: null`, which cleared the policy settings (for example on a
  plain enable/disable). Now the current data is read first (one extra GET);
  an explicit `data: null` still clears it. If the policy type was never
  saved (the GET answers 404), `data: null` is sent as before, so the first
  enable of a policy still creates it.
- **`accessAll` on `bw_group_create` / `bw_group_update`** (removed from the
  Bitwarden API, it was silently ignored) is no longer sent; `true` now
  returns an error and nothing is written. `false` is accepted and ignored.
- **`bw_collection_update`**: a non-empty `users` list now returns an error
  (the Public API has no per-user collection access; it was silently
  dropped). `groups` is only sent when given (before, omitting it sent
  `groups: []` and removed all group access), and `externalId` is read from
  the current collection when not given. Description corrected.
- **Confirm previews of `bw_member_update`, `bw_group_update`,
  `bw_collection_update`, `bw_policy_set` and the four `bw_license_*_update` tools** now also
  show the effective request (method, path, body after merging, and which
  fields are left out). Building it may issue read-only GET requests; input
  the tool cannot apply already returns the error at preview time.
- **`bw_member_grant_sm` / `bw_member_revoke_sm` always return an error**
  (`isError`) and send no request. The Public API neither returns nor
  applies `accessSecretsManager`: grant reported success without effect,
  revoke reported "already revoked" while access stayed. Secrets Manager
  access is changed in the web vault / admin console. Both tools stay
  registered with unchanged parameters.
- **`bw_member_invite`** no longer sends `accessSecretsManager` (the API
  ignores it); `accessSecretsManager: true` now returns an error instead of
  inviting the member without Secrets Manager access.
- **`bw_license_*_update` tools now change the subscription.** They sent
  `seatAdjustment` / `storageGbAdjustment` / `serviceAccountAdjustment`,
  which the API does not know, so every call was a no-op reported as
  success. The inputs stay deltas; the tools now GET the subscription, send
  current + delta as the absolute total (`passwordManager.seats`,
  `passwordManager.storage`, `secretsManager.seats`,
  `secretsManager.serviceAccounts`), GET it again and return
  `{field, before, requested, after, response}`. An adjustment of 0, a
  resulting total below 1, a missing current value, or a read-back that
  differs from the requested total return an error.
- **HTTP retries only where repeating is safe.** 5xx responses and network
  errors are retried only for GET (before: 5xx for every method, network
  errors never). POST/PUT/PATCH/DELETE are sent once; on 5xx the error text
  says the outcome is unknown. 429 is still retried for every method.
  `Retry-After` now also accepts an HTTP-date and the wait is capped at
  30 s (before: an HTTP-date caused an immediate retry, large values were
  not capped).
- **`bw_event_query`**: `ipAddress` (not a filter of the Public API; it was
  ignored and all events in the window were returned) now returns an error,
  and so does passing both `actingUserId` and `itemId` (the API silently
  applied only `actingUserId`).
- **`bws_secret_create` / `bws_secret_update` no longer return the
  decrypted value.** The result is the secret metadata (id, key, note,
  organizationId, projectId, dates) without `value`, as the README already
  stated; read the value with `bws_secret_get_value`.
- **Confirm-gate previews mask secret values**: keys such as `value`,
  `password`, `token` or `clientSecret` (the list in `src/redact.ts`,
  except `key`, which is the secret name) in the input of any guarded tool,
  in its planned request body and in `bw_raw_request` write bodies are
  shown as `"<redacted, N chars>"`.
- **Error texts returned to the client are scrubbed** with the same
  mechanism as the logs: secret-shaped substrings (`Bearer ...`,
  `client_secret=...`, JSON `"value": ...`, BWS tokens, ...) become
  `[REDACTED]`, and stack frames or a Node `Require stack:` list are cut
  off. This applies to `asToolError`, the `tools/call` catch path and
  `bw_raw_request`.
- **Logs**: sensitive keys are now removed at any depth and
  case-insensitively (before: four levels, exact case), also inside
  arrays, `BitwardenApiError.details`, cause chains and AggregateError
  children; message scrubbing also covers JSON-shaped secrets and the
  `value` / `secret` keys. Serialized errors carry `type`, `message`, own
  properties, `cause` and `aggregateErrors`, never a stack.
- **Secrets Manager SDK load errors** are logged through the logger as a
  `warn` JSON line (`smSdk.kind`, scrubbed first line of the message)
  instead of a raw stderr line with the full message and Require stack.
  With `LOG_LEVEL=error` the line is no longer shown.
- **Redirects are not followed.** API and OAuth token requests use
  `redirect: "manual"`; a 3xx answer is an error (`BitwardenApiError`
  code `redirect_not_followed`, or `OAuth token request failed: <status>
(redirect not followed)`). Before, fetch followed redirects, including
  ones that re-send the request body.
- **Dot segments and encoded separators are rejected.** `bw_raw_request`
  returns an error for paths with `.` or `..` segments (also
  percent-encoded, `%2e` in any case) or `%2F` / `%5C`; before they were
  normalised and could leave the API base prefix. Ids put into wrapper paths (`bw_member_*`,
  `bw_group_*`, `bw_collection_*`) are rejected when they are `.` / `..`
  (also encoded) or contain `/`, `\`, `%2F` or `%5C`.
- **`HTTP_TIMEOUT_MS` now also bounds the OAuth token request** (before it
  had no timeout, so a token endpoint that accepted the connection but
  never answered held every tool call of that instance until undici's
  default header timeout). A timeout returns `OAuth token request timed
out after <ms> ms`.
- **An `access_token` that is not a valid header value** (anything but
  visible ASCII) is rejected with a static error at token time, instead of
  failing later with an undici error that quoted the token.
- **Retry-After** values that are invalid or in the past fall back to the
  normal backoff.

### Added

- `tests/tool-contract.test.ts`: `tools/list` (names, required lists,
  property names) pinned against the v0.1.1 production baseline for
  selfhost+cloud and selfhost+cloud+Secrets Manager.
- `tests/protocol-versions.test.ts`: negotiation for 2025-06-18,
  2025-11-25 and 2026-07-28 on the real stdio wiring.
- `scripts/stdio-probe.mjs` and `scripts/container-smoke.sh`: build in
  the gateway image and probe `dist/index.js` over stdio without network
  (see CONTRIBUTING).
- Release chain: `.github/workflows/release.yml` (tag `v*`: CI gate,
  clean build, npm tarball, CycloneDX SBOM, `SHA256SUMS`, build
  provenance attestation, GitHub release; npm publish with provenance
  through trusted publishing once the owner enables it),
  `scripts/release-assets.sh`, `RELEASING.md`.
- CI: `npm audit --omit=dev --audit-level=low`, a gitleaks scan of the
  full history (pinned version, verified checksum), a weekly scheduled
  run and a named tool-contract step (`npm run test:contract`).
- `.github/dependabot.yml`: weekly grouped npm and GitHub Actions
  updates.
- Docs: gateway and headless use, the 10 MiB stdio line limit, the
  security model (the confirm gate is a self-confirmation by the model,
  not a security boundary), `CLAUDE.md` for contributors using Claude
  Code, `docs/BACKLOG.md` (known minor issues).

### Changed

- CI tests Node 22, 24 and 26 (was 20 and 22); actions are pinned by
  commit SHA; workflows default to `permissions: contents: read`.
- `npm run typecheck` now really covers `tests/` and `scripts/` (the
  inherited `exclude` had dropped them); the type errors this surfaced in
  tests are fixed.
- `.env.example`: the Secrets Manager lines are commented out (a copied,
  unedited file used to make startup fatal) and
  `BW_MCP_MAX_LIST_RESPONSE_BYTES` is listed.
- README, ARCHITECTURE, SECURITY and CONTRIBUTING corrected against the
  code: generated raw tools (the shipped spec is empty, so 0 are
  registered), platform support, Claude Code configuration (`.mcp.json`
  or `claude mcp add`), live smoke test path and variable, reporting
  channel, and no more fixed test or key counts.

### Fixed

- `bw_member_update`, `bw_group_update`, `bw_collection_update` and
  `bw_policy_set` no longer clear state the caller left out.
- License update tools, `bw_member_grant_sm` / `bw_member_revoke_sm`,
  `accessAll`, collection `users` and `bw_event_query` filters no longer
  report success without effect (see Breaking).
- Writes are no longer repeated after a 5xx answer; reads are now also
  retried after network errors.
- The npm bin `bitwarden-mcp` starts the server (it exited with code 0
  when started through the symlink).
- `serverInfo.version` reports the package version (was `0.1.0`).
- The OAuth token request honours `HTTP_TIMEOUT_MS`.
- `tests/live-smoke.test.ts` passed the `buildClients` promise instead of
  its result, so the opt-in live smoke registered no instance tools.

### Security

- One scrubber (`src/redact.ts`) for logs and for every error text
  returned to the client; it covers nested structures, error details,
  cause chains and free-text messages, and drops stack traces.
- Confirm previews and `bw_raw_request` write bodies mask secret values;
  secret create/update results no longer contain the value.
- Requests never follow redirects, so credentials and request bodies are
  not re-sent to another location.
- Paths and ids with dot segments or encoded separators are rejected, so
  requests stay under the configured API base prefix.
- Access tokens that are not valid header values are rejected before use.
- The Secrets Manager SDK load error is logged through the scrubber.
- Runtime and dev dependency trees have no known advisories
  (`npm audit` and `npm audit --omit=dev` report 0 vulnerabilities at
  release time).

### Dependencies

- MCP SDK: `@modelcontextprotocol/server` `^2.4.0` (v2 line) replaces
  `@modelcontextprotocol/sdk` `^1.0.0` (the v0.1.1 lockfile resolved
  1.29.0); `@modelcontextprotocol/client` `^2.4.0` is a new dev
  dependency for tests and the probe. The SDK's stdio transport limits
  one incoming line to 10 MiB (`STDIO_DEFAULT_MAX_BUFFER_SIZE`); a larger
  line closes the transport and the process exits.
- `pino` `^10.4.0`; `dotenv` stays on `^16.4.0` (16.6.1 locked);
  `@bitwarden/sdk-napi` stays `^1.0.0` (optional).
- Dev: `@types/node` `^22.20.5`, `vitest` and `@vitest/coverage-v8`
  `^5.0.5`, `eslint` `^10.13.0` with `@eslint/js` `^10.0.1` as a direct
  dev dependency, `eslint-config-prettier` `^10.1.8`, `typescript-eslint`
  `^8.72.1`, `prettier` `^3.9.10`, `tsx` `^4.23.15`, `typescript`
  `^5.9.3` (typescript-eslint 8.72 does not support TypeScript 7).
- `zod` comes in through the SDK only (no direct dependency).
- `package-lock.json` is generated with the npm of
  `node:24.22.1-bookworm-slim` and contains the `@bitwarden/sdk-napi`
  binaries for darwin-arm64, darwin-x64, linux-x64-gnu and
  win32-x64-msvc.

## [0.1.1] - 2026-06-14

A hardening, tooling, and documentation pass. The public tool surface
did not change.

Correction (added with 0.2.0): this release did change runtime
behaviour that a caller can notice, although it originally said it did
not. OAuth token errors no longer contain the upstream reason phrase or
response body (only the status code), error texts in logs are scrubbed,
and `bw_raw_request` rejects control characters and backslashes in
`path`. The lockfile of this release also resolved an older MCP SDK
(1.29.0).

### Security

- **Logger redaction**: `src/logger.ts` redacts sensitive keys at four
  nesting levels plus `err.stack`/`*.stack`. The single-level pino
  wildcard does not recurse, so each key is enumerated across realistic
  depths, and the key set was completed with common synonyms (`token`,
  `refreshToken`, `apiKey`, `api_key`, `secret`, `key`, `client_id`,
  `cookie`, `set-cookie`).
- **Error-message scrubbing**: a custom pino `err` serializer scrubs
  secret-shaped substrings (Bearer tokens, `authorization` headers,
  `client_secret` / `access_token` params, and the
  `0.<uuid>.<base64>:<base64>` BWS token) from `err.message` and any
  folded `err.cause.message`, which key-based redaction cannot reach.
- **OAuth error handling**: `src/http/oauth-token-cache.ts` strips the
  response body from thrown errors and emits only the HTTP status code
  (no upstream-controlled reason phrase). The success-path `res.json()`
  parse is guarded so a non-JSON 2xx body cannot surface inside a
  `SyntaxError`. Prevents a failed token request from echoing the
  submitted `client_secret` back into logs.
- **Raw-request control characters**: `bw_raw_request` rejects
  CR / LF / NUL / tab / backslash in `path` as defense-in-depth against
  future refactors and header-injection attempts.

### Changed

- `vitest` major bump `^1.6.0 → ^4.1.8` plus a fresh `@vitest/coverage-v8`
  to close the `esbuild` GHSA-67mh-4wv8-2f99 dev-chain CVE. Production
  runtime is unaffected.
- Trimmed dead code: dropped `export` from internal-only types, removed
  orphaned type re-exports, and removed no-op `tsconfig.json` options
  that merely restated NodeNext defaults.

### Added

- `ARCHITECTURE.md`: concise one-page architecture overview.
- `CONTRIBUTING.md`, `SECURITY.md`, this `CHANGELOG.md`.
- `.github/ISSUE_TEMPLATE/` (bug + feature) and a PR template.
- GitHub Actions CI (`.github/workflows/ci.yml`): build, test,
  typecheck, lint, and format-check on Node 20 and 22.
- ESLint v9 flat config (`eslint.config.js`) and Prettier 3 config
  (`.prettierrc.json`, `.prettierignore`): wired into `npm run lint`
  and `npm run format`.

## [0.1.0] - 2026-05-26

Initial public release.

### Added

- ~50 hand-written tool wrappers for Bitwarden's Public API:
  members, groups, collections, policies, events, organization import,
  subscription/licensing.
- Secrets Manager CRUD (`bws_project_*`, `bws_secret_*`) backed by the
  official `@bitwarden/sdk-napi` for Zero-Knowledge crypto.
- Web-vault stubs for unsupported SM operations (machine accounts,
  access tokens).
- Generated `bw_<resource>_<op>_raw` tool per Public API operation,
  derived from the live Swagger of your instance
  (`scripts/generate.ts`).
- `bw_raw_request` escape hatch with explicit instance routing
  (`selfhost` / `cloud` / `sm`).
- Dual-instance routing wired at construction time: no per-call
  switching, no accidental cross-instance writes.
- Confirm-gated writes via `withConfirmGuard` (default on).
- Slim list projections + `BW_MCP_MAX_LIST_RESPONSE_BYTES` size warning.
- 180 unit tests with mocked HTTP plus an opt-in live-smoke script.

Correction (added with 0.2.0): the shipped spec
(`specs/public-api.spec.json`) was empty, so no generated
`bw_<resource>_<op>_raw` tools were registered.

[Unreleased]: https://github.com/mguttmann/the-real-bitwarden-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/mguttmann/the-real-bitwarden-mcp/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/mguttmann/the-real-bitwarden-mcp/releases/tag/v0.1.1
[0.1.0]: https://github.com/mguttmann/the-real-bitwarden-mcp/releases/tag/v0.1.0
