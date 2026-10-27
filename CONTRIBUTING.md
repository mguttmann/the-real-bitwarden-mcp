# Contributing

Thanks for taking the time to look. This is a small, focused project —
small PRs land fastest.

## Ground rules

- **Open an issue first** for new features, behaviour changes, or
  anything bigger than a typo fix. We agree on direction before code is
  written.
- **Bug reports** are most useful with the failing tool name, the
  arguments you passed (with secrets redacted), the actual response,
  the expected response, and the Bitwarden product version
  (`/api/version` for self-host).
- **No proprietary data** — please make sure logs, screenshots, and
  repros are scrubbed of organisation IDs, member emails, secrets, and
  access tokens before posting.

## Local setup

Requires Node.js >= 22.12.

```bash
git clone https://github.com/mguttmann/the-real-bitwarden-mcp.git
cd the-real-bitwarden-mcp
npm ci
cp .env.example .env   # fill in at least one of: selfhost / cloud / SM
npm run build
npm test
```

## The green-bar checklist

Every PR must keep all four green:

```bash
npm run build         # tsc strict, NodeNext ESM
npm test              # 180+ unit tests with mocked HTTP
npm run typecheck     # tsc --noEmit against tsconfig.typecheck.json
npm run lint          # eslint flat config
npm run format:check  # prettier 3
```

Optional but appreciated:

```bash
npm run test:coverage # @vitest/coverage-v8 report (target: ≥ 80 %)
```

Before a dependency or SDK change, run the container smoke test. It builds
the tree in `node:24.22.1-bookworm-slim` with `npm ci --no-audit --no-fund
&& npm run build`, starts `dist/index.js` over stdio with fake credentials
and no network for protocol revisions 2025-06-18, 2025-11-25 and
2026-07-28, and checks `tools/list` against
`tests/fixtures/tool-contract.json`:

```bash
DOCKER_HOST=unix:///path/to/docker.sock bash scripts/container-smoke.sh
```

`DOCKER`, `DOCKER_RUN_ARGS`, `NODE_IMAGE` and `SMOKE_WORKDIR` are optional
(see the script header). `node scripts/stdio-probe.mjs <repoDir>
<protocolVersion> [envFile]` runs a single probe against a local build.

## Adding a new tool

1. Find the resource directory under `src/tools/wrappers/` (e.g.
   `bw_member.ts`). One file per Bitwarden resource keeps blast radius
   small.
2. Add a `make<Operation>Tool(client, …)` factory returning a `ToolDef`.
   Read-only operations get `annotations: readOnly` (see
   `wrappers/_helpers.ts`); writes get `annotations: destructive` and
   are wrapped by `withConfirmGuard` in `src/index.ts`.
3. List tools should return a slim projection by default and accept
   `include: ["all"]` to opt in to nested fields. Use the
   `maybeNoteOversize()` helper from `_helpers.ts` to warn (not
   truncate) on oversized payloads.
4. Register the tool in `src/index.ts → buildRegistry()`.
5. Write a unit test next to the existing tests for that resource. Use
   the `mockClient` helper from `tests/test-utils.ts`.

## Commit style

Conventional Commits, short and present-tense:

- `feat: add bw_member_freeze tool`
- `fix(http): retry 502 on token refresh`
- `docs: clarify confirm-gate behaviour`
- `chore(deps): bump vitest to 4.1.8`

Squash before merging.

## Code style

Set by Prettier (`.prettierrc.json`) and ESLint (`eslint.config.js`).
Run `npm run format && npm run lint:fix` before pushing.

## Security issues

**Do not open public issues for security findings.** See
[SECURITY.md](SECURITY.md) for the private disclosure channel.
