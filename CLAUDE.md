# CLAUDE.md

Stdio MCP server for the Bitwarden Public API and Secrets Manager
(TypeScript, ESM, Node >=22.12). Architecture: `ARCHITECTURE.md`.

## Commands

```bash
npm ci
npm run build          # tsc, dist/
npm run lint
npm run typecheck      # src, tests and scripts
npm run format:check   # prettier; npm run format to fix
npm test               # vitest, mocked HTTP only
npm run test:contract  # tool contract and protocol versions
bash scripts/container-smoke.sh   # build and probe in the gateway Node image (needs docker)
```

CI (`.github/workflows/ci.yml`) runs the same on Node 22, 24 and 26, plus
`npm audit --omit=dev` and gitleaks. Releases: `RELEASING.md`.

## Rules

- **Tool contract:** tool names, parameter names and required parameters
  never change and no tool is removed; gateways prefix and pin them.
  `tests/tool-contract.test.ts` and `tests/fixtures/tool-contract.json`
  hold the contract. New environment variables are optional with a safe
  default. Every change a caller can notice (defaults, output, errors)
  goes into `CHANGELOG.md` under "Behaviour changes".
- **Bug fixes:** first a test that fails on the old code, then the fix.
  Test behaviour, not coverage.
- **Secrets:** never in logs, error texts, previews or test data that
  looks real; use obvious fakes (`FAKE-SECRET-1`, `.invalid` hosts). All
  scrubbing goes through `src/redact.ts`. Tests never call a real
  Bitwarden instance.
- **No long dashes:** never write the em dash or en dash characters (code,
  comments, docs, commit messages); use "-" or rephrase.
- **Docs:** no fixed numbers in docs unless a test holds them.
- Repository content is in English. Conventional Commits.

## Where things live

- Known minor issues: `docs/BACKLOG.md` (read the section of the area
  you work on first; remove items you fix).
- Design decisions: `docs/design/`.
- Audit reports under `docs/audit/` are confidential and not committed.
