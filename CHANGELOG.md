# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Behaviour changes

- **Node.js 22.12 or newer is required** (`engines.node` `>=22.12`, was
  `>=20.0.0`). Node 20 is end of life; the test runner (vitest 5) also
  needs 22.12.
- **MCP SDK v2** (`@modelcontextprotocol/server` 2.x replaces
  `@modelcontextprotocol/sdk` 1.x). The server keeps the low-level `Server`
  and the hand-written JSON Schemas, so `tools/list` is unchanged: same
  tool names, required lists, properties and schemas
  (`tests/fixtures/tool-contract.json`). Stdio is now served through
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

### Changed

- Dependencies: `pino` 10, `@types/node` 22, `vitest` and
  `@vitest/coverage-v8` 5, `eslint` 10 (with `@eslint/js` as a direct dev
  dependency), `eslint-config-prettier` 10, current `typescript-eslint`,
  `prettier`, `tsx`, TypeScript 5.9. `zod` comes in through the SDK only
  (no direct dependency; `src/` does not use it). `dotenv` stays on 16.
  `package-lock.json` is generated with the npm of
  `node:24.22.1-bookworm-slim`; `npm audit` and `npm audit --omit=dev`
  report 0 vulnerabilities.
- CI tests Node 22, 24 and 26 (was 20 and 22).
- `npm run typecheck` now really covers `tests/` and `scripts/` (the
  inherited `exclude` had dropped them); the type errors this surfaced in
  tests are fixed.

### Added

- `tests/tool-contract.test.ts`: `tools/list` (names, required lists,
  property names) pinned against the v0.1.1 production baseline for
  selfhost+cloud and selfhost+cloud+Secrets Manager.
- `tests/protocol-versions.test.ts`: negotiation for 2025-06-18,
  2025-11-25 and 2026-07-28 on the real stdio wiring.
- `scripts/stdio-probe.mjs` and `scripts/container-smoke.sh`: build in
  the gateway image and probe `dist/index.js` over stdio without network
  (see CONTRIBUTING).

### Fixed

- `tests/live-smoke.test.ts` passed the `buildClients` promise instead of
  its result, so the opt-in live smoke registered no instance tools.

## [0.1.1] — 2026-06-14

A hardening, tooling, and documentation pass. No runtime behaviour or
public tool-surface changes.

### Security

- **Logger redaction** — `src/logger.ts` redacts sensitive keys at four
  nesting levels plus `err.stack`/`*.stack`. The single-level pino
  wildcard does not recurse, so each key is enumerated across realistic
  depths, and the key set was completed with common synonyms (`token`,
  `refreshToken`, `apiKey`, `api_key`, `secret`, `key`, `client_id`,
  `cookie`, `set-cookie`).
- **Error-message scrubbing** — a custom pino `err` serializer scrubs
  secret-shaped substrings (Bearer tokens, `authorization` headers,
  `client_secret` / `access_token` params, and the
  `0.<uuid>.<base64>:<base64>` BWS token) from `err.message` and any
  folded `err.cause.message`, which key-based redaction cannot reach.
- **OAuth error handling** — `src/http/oauth-token-cache.ts` strips the
  response body from thrown errors and emits only the HTTP status code
  (no upstream-controlled reason phrase). The success-path `res.json()`
  parse is guarded so a non-JSON 2xx body cannot surface inside a
  `SyntaxError`. Prevents a failed token request from echoing the
  submitted `client_secret` back into logs.
- **Raw-request control characters** — `bw_raw_request` rejects
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

- `ARCHITECTURE.md` — concise one-page architecture overview.
- `CONTRIBUTING.md`, `SECURITY.md`, this `CHANGELOG.md`.
- `.github/ISSUE_TEMPLATE/` (bug + feature) and a PR template.
- GitHub Actions CI (`.github/workflows/ci.yml`) — build, test,
  typecheck, lint, and format-check on Node 20 and 22.
- ESLint v9 flat config (`eslint.config.js`) and Prettier 3 config
  (`.prettierrc.json`, `.prettierignore`) — wired into `npm run lint`
  and `npm run format`.

## [0.1.0] — 2026-06-14

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
- Dual-instance routing wired at construction time — no per-call
  switching, no accidental cross-instance writes.
- Confirm-gated writes via `withConfirmGuard` (default on).
- Slim list projections + `BW_MCP_MAX_LIST_RESPONSE_BYTES` size warning.
- 180 unit tests with mocked HTTP plus an opt-in live-smoke script.

[0.1.1]: https://github.com/mguttmann/the-real-bitwarden-mcp/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mguttmann/the-real-bitwarden-mcp/releases/tag/v0.1.0
