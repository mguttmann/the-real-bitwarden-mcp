# Releasing

Releases are built and published by GitHub Actions from a version tag,
never from a laptop. The workflow is `.github/workflows/release.yml`; the
assets are built by `scripts/release-assets.sh`.

## Cutting a release

1. On a branch: bump `version` in `package.json` and the root entries of
   `package-lock.json` (`npm version <x.y.z> --no-git-tag-version` does
   both), move the `[Unreleased]` entries of `CHANGELOG.md` into a dated
   `[x.y.z]` section (keep "Behaviour changes" first) and add the
   compare link at the bottom. Set the same version in `server.json`
   (`version` and the npm package's `version`);
   `tests/release-chain.test.ts` fails otherwise.
2. Merge to `main` once CI is green.
3. Tag the merge commit on `main` and push the tag:

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   Tags with a suffix (`v1.2.3-rc.1`) become prereleases and are published
   to npm under the `next` dist-tag.

## What the workflow does

| Job              | What it does                                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify`         | Fails unless the tag is `v` + `package.json` version and the tag commit is on `main`.                                                                                                                                                                       |
| `ci`             | Runs all of `ci.yml` on the tag commit (Node 22/24/26 build, lint, typecheck, format, tests, tool contract; `npm audit --omit=dev`; gitleaks over the full history).                                                                                        |
| `build`          | `npm ci`, then `scripts/release-assets.sh`: clean build, `npm pack`, a CycloneDX SBOM of the runtime dependency tree (`npm sbom`), `SHA256SUMS`.                                                                                                            |
| `github-release` | Build provenance attestation (`actions/attest-build-provenance`) for the tarball and the SBOM, then a GitHub release with tarball, SBOM and `SHA256SUMS`. An existing release is never overwritten.                                                         |
| `npm-publish`    | Only when the repository variable `NPM_PUBLISH_ENABLED` is `true`: checks the tarball against `SHA256SUMS` and runs `npm publish --provenance` through trusted publishing (OIDC). No npm token is stored.                                                   |
| `mcp-registry`   | Stable tags only, after a successful `npm-publish`: runs `mcp-registry.yml`, which waits until npm serves the version with the right `mcpName` and publishes `server.json` to the official MCP Registry (GitHub OIDC). A version already listed is skipped. |

The assets can be built locally the same way (Linux, after `npm ci`):

```bash
bash scripts/release-assets.sh /tmp/release-check
```

## Verifying a release

```bash
sha256sum --check SHA256SUMS
gh attestation verify the-real-bitwarden-mcp-X.Y.Z.tgz --repo mguttmann/the-real-bitwarden-mcp
npm audit signatures   # in a project that installed the package
```

## Repository, npm and registry settings

A workflow cannot set these; the repository owner applies them once.
They are described in
[docs/maintainers/repo-settings.md](docs/maintainers/repo-settings.md):
rulesets for `main` and `v*` tags, Actions permissions, code security
(private vulnerability reporting, Dependabot, secret scanning with push
protection, CodeQL), npm trusted publishing, the MCP Registry and Glama.

Status on 2026-10-27: the npm trusted publisher (repository
`mguttmann/the-real-bitwarden-mcp`, workflow `release.yml`, no
environment) was configured by the owner. It is validated only by the
first workflow publish: set the repository variable `NPM_PUBLISH_ENABLED`
to `true` before pushing the next release tag, then check that
`npm-publish` succeeds and npmjs.com shows a provenance statement for the
version. Until the variable is `true`, `npm-publish` and `mcp-registry`
are skipped.
