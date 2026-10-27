# Contributing

Thanks for taking the time to look. This is a small, focused project;
small PRs land fastest.

## Ground rules

- **Open an issue first** for new features, behaviour changes, or
  anything bigger than a typo fix. We agree on direction before code is
  written.
- **Bug reports** are most useful with the failing tool name, the
  arguments you passed (with secrets redacted), the actual response,
  the expected response, and the Bitwarden product version
  (`/api/version` for self-host).
- **No proprietary data**: please make sure logs, screenshots, and
  repros are scrubbed of organisation IDs, member emails, secrets, and
  access tokens before posting.

## Local setup

Requires Node.js >= 22.12.

```bash
git clone https://github.com/mguttmann/the-real-bitwarden-mcp.git
cd the-real-bitwarden-mcp
npm ci
cp .env.example .env   # fill in self-host and/or cloud; SM lines are optional
npm run build
npm test
```

## The green-bar checklist

Every PR must keep all of these green; CI (`.github/workflows/ci.yml`)
runs them on Node 22, 24 and 26, plus `npm audit --omit=dev` and a
gitleaks scan of the full history:

```bash
npm run build         # tsc strict, NodeNext ESM
npm run lint          # eslint flat config
npm run typecheck     # tsc --noEmit against tsconfig.typecheck.json (src, tests, scripts)
npm run format:check  # prettier 3
npm test              # unit tests with mocked HTTP
npm run test:contract # tool contract and protocol versions (also part of npm test)
```

`npm test` includes `tests/stdio-probe.test.ts`, which starts the server
from `src/` over stdio. CI also runs it against the build:
`npm run build && STDIO_PROBE_BUILT=1 npx vitest run tests/stdio-probe.test.ts`.

Optional: `npm run test:coverage` (@vitest/coverage-v8 report; no
threshold is enforced).

## The tool contract

Tool names and required parameters are a public contract: gateways
prefix and pin them. `tests/tool-contract.test.ts` compares `tools/list`
(names, required lists, property names) with
`tests/fixtures/tool-contract.json`. Do not rename or remove a tool, do
not rename a parameter and do not add a required parameter. If a change
adds a tool or an optional parameter, update the fixture in the same
change and say so in the changelog. Any change a caller can notice
(defaults, output shape, errors) goes under "Behaviour changes" in
`CHANGELOG.md`.

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
(see the script header).

`bash scripts/package-smoke.sh` (after `npm ci && npm run build`) packs
the tarball, installs it the way the gateway does (`npm ci --omit=dev
--ignore-scripts`), probes it from `node_modules` and fails if the tool
contract differs or the Secrets Manager SDK binary does not load. CI runs
it on linux x86_64 (job `package-smoke`); on a platform without an SDK
binary set `REQUIRE_SDK=0`. `node scripts/stdio-probe.mjs <repoDir>
<protocolVersion> [envFile]` runs a single probe against a local build.

## Adding a new tool

1. Find the resource directory under `src/tools/wrappers/` (e.g.
   `bw_member.ts`). One file per Bitwarden resource keeps blast radius
   small.
2. Add a `make<Operation>Tool(client, …)` factory returning a `ToolDef`.
   Read-only operations get `annotations: readOnly` (see
   `wrappers/_helpers.ts`); writes get `annotations: destructive` and
   are wrapped by `withConfirmGuard` in `src/index.ts`. A write that
   changes existing state should also have a `plan` function, so the
   confirm preview shows the effective request.
3. List tools should return a slim projection by default and accept
   `include: ["all"]` to opt in to nested fields. Use the
   `maybeNoteOversize()` helper from `_helpers.ts` to warn (not
   truncate) on oversized payloads.
4. Register the tool in `src/index.ts → buildRegistry()`.
5. Write a unit test next to the existing tests for that resource
   (`tests/wrappers/`). `fakeApi()` in `tests/helpers.ts` is a stand-in
   HTTP client that answers from a route table and records every
   request; `textOf()` reads the text of a tool result.
6. Update `tests/fixtures/tool-contract.json` and the tool count asserted
   in `tests/tool-contract.test.ts` (see "The tool contract").

## Commit style

Conventional Commits, short and present-tense:

- `feat: add bw_member_freeze tool`
- `fix(http): retry 502 on token refresh`
- `docs: clarify confirm-gate behaviour`
- `chore(deps): bump vitest to 5.0.5`

Squash before merging.

## Code style

Set by Prettier (`.prettierrc.json`) and ESLint (`eslint.config.js`).
Run `npm run format && npm run lint:fix` before pushing.

## Releases

See [RELEASING.md](RELEASING.md). Releases are built by the tag-triggered
release workflow, not by hand.

## Security issues

**Do not put details of security findings into public issues.** See
[SECURITY.md](SECURITY.md) for how to report them.
