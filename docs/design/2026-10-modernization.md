# Design: 0.2.0 modernization (2026-10)

## Goal

Bring the server to a state that can run unattended for years behind an MCP
gateway: current dependencies without runtime advisories, an MCP SDK line with
a long support window, write tools that do what they say, no secret material
in logs or tool error texts, and a reproducible, verifiable release chain.

## Done when

- The tool contract is unchanged against the production baseline: the same 54
  tool names, the same required parameters, no tool removed. Pinned by a
  snapshot test of `tools/list` (names, required, property names).
- `npm ci --no-audit --no-fund && npm run build` works in
  `node:24.22.1-bookworm-slim`, and `node --env-file=.env dist/index.js`
  answers `initialize` and `tools/list` over stdio with a dummy env and no
  network, for protocol versions 2025-06-18, 2025-11-25 and 2026-07-28.
- `npm audit --omit=dev` and `npm audit` report 0 vulnerabilities.
- Every behaviour fix has a test that failed before the fix.
- Lint, typecheck (including tests), format check and the full suite are
  green; CI runs on Node 22, 24 and 26.

## Decisions

1. **Base is main (v0.1.1), not the production branch.** The production
   branch is v0.1.0 content plus a lockfile refresh. main is a superset in
   behaviour; the only production-only content is the newer lockfile, which
   is regenerated here anyway.
2. **MCP SDK: move to the v2 line now** (`@modelcontextprotocol/server`),
   keeping the low-level `Server` and the hand-written JSON schemas so
   `tools/list` output does not change. Reasons: v1 only promises fixes until
   at least 2027-01-27, which does not match "runs for years"; with the
   low-level server the migration is limited to imports and handler
   registration; action1-mcp v0.6.0 took the same path behind the same
   gateway client. The 2025 protocol revisions stay served. Fallback if the
   v2 low-level path does not hold: v1 `^1.32.2`, recorded in the CHANGELOG.
   Outcome (stage A): the v2 path holds, no fallback. `@modelcontextprotocol/server`
   2.4 with the low-level `Server` and `serveStdio(..., { legacy: "serve" })`;
   the container probe in `node:24.22.1-bookworm-slim` gives the same tool
   names, required lists and schema hashes as the v0.1.1 baseline in both
   configs, for 2025-06-18, 2025-11-25 and 2026-07-28 (2026-07-28 via
   `server/discover`; a plain `initialize` with 2026-07-28 still negotiates
   2025-11-25). Pinned by `tests/tool-contract.test.ts` and
   `tests/protocol-versions.test.ts`; re-run with `scripts/container-smoke.sh`.
3. **Node floor 22.12**, CI matrix 22, 24, 26; `@types/node` 22.
4. **Write tools keep their input contract.** Parameter names and required
   lists stay; fixes happen in the mapping to the Bitwarden API (field names,
   omitted fields sent as "keep" instead of "clear"). Tools that cannot work
   through the Public API return an explicit error instead of a false success.
5. **Retries only where repeating is safe**: GET/HEAD on 5xx and network
   errors; 429 for every method (the request was not processed).
6. **One scrubbing mechanism** for secret material, used for logs and for
   every error text returned to the client. Confirm-gate previews mask secret
   values.
   Outcome (stage C): `src/redact.ts` (pino formatter and err serializer,
   `asToolError`, the `tools/call` catch path, `bw_raw_request`, SDK load
   error); `bws_secret_create` / `bws_secret_update` return metadata only.
7. **No redirects are followed** for token and API requests; a redirect is
   an error. Outcome (stage C): `redirect: "manual"` on both fetch calls, 3xx
   throws; the token request also honours `HTTP_TIMEOUT_MS`.
8. **Paths**: dot segments (also percent-encoded) and backslashes are
   rejected in `bw_raw_request` paths and in ids interpolated into paths.
   Outcome (stage C): one helper, `src/http/path-safety.ts`
   (`assertSafePath` for raw paths, `pathId` for ids).
9. **Release chain like action1-mcp**: tag-triggered workflow, CI gate, npm
   publish with provenance, SBOM, `SHA256SUMS`, GitHub attestations.
10. **No new required environment variables.**

## Out of scope

Minors from the audit go to `docs/BACKLOG.md` and are handled by the next run
in the same area.
