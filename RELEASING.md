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
| `ci`             | Runs all of `ci.yml` on the tag commit (Node 22/24/26 build, lint, typecheck, format, tests, tool contract; `npm audit --omit=dev`; gitleaks over the full history; package smoke of the packed tarball on linux x86_64).                                   |
| `build`          | `npm ci`, then `scripts/release-assets.sh`: clean build, `npm pack`, a CycloneDX SBOM of the runtime dependency tree (`npm sbom`), `SHA256SUMS`.                                                                                                            |
| `github-release` | Build provenance attestation (`actions/attest-build-provenance`) for the tarball and the SBOM, then a GitHub release with tarball, SBOM and `SHA256SUMS`. An existing release is never overwritten.                                                         |
| `npm-publish`    | Only when the repository variable `NPM_PUBLISH_ENABLED` is `true`: checks the tarball against `SHA256SUMS` and runs `npm publish --provenance` through trusted publishing (OIDC). No npm token is stored.                                                   |
| `mcp-registry`   | Stable tags only, after a successful `npm-publish`: runs `mcp-registry.yml`, which waits until npm serves the version with the right `mcpName` and publishes `server.json` to the official MCP Registry (GitHub OIDC). A version already listed is skipped. |

## Recovering a release

A tag of a version is never moved, deleted or pushed again (the
`release-tags` ruleset refuses it), and an existing GitHub release is
never overwritten by the workflow.

### A job failed after the release was created

If `npm-publish` or `mcp-registry` fails after `github-release` has
created the release, fix the cause and use "Re-run failed jobs" on the
same run: it reuses that run's build artifact, which matches the
published release assets. Never use "Re-run all jobs" (it stops at
`github-release` because the release already exists). A failed
`mcp-registry` alone can also be retried by running the MCP Registry
workflow by hand with the tag; it checks out that tag, so it publishes
the `server.json` released with the version, not the one on `main`.

### Tag pushed while publishing was off

With `NPM_PUBLISH_ENABLED` unset, `npm-publish` and `mcp-registry` are
skipped, not failed, so the run is green and "Re-run failed jobs" has
nothing to run. The GitHub release exists; npm and the registry do not
have the version.

- Usually: set `NPM_PUBLISH_ENABLED` to `true` and release the next
  patch version the normal way. The skipped version stays a GitHub-only
  release; say so in its CHANGELOG entry.
- Only if the version must reach npm and nobody uses its release assets
  yet: set the variable, delete the GitHub release but not the tag
  (`gh release delete vX.Y.Z --yes`, without `--cleanup-tag`), then
  "Re-run all jobs" on the tag's release run. It builds again from the
  tag commit and creates the release with new assets, checksums and
  attestation, so the old `SHA256SUMS` no longer apply. If `npm-publish`
  is skipped again in that run, use the first option.

### Half-created release

If `github-release` fails after `gh release create` began (for example a
release with some assets missing), nothing is on npm yet, because
`npm-publish` runs only after `github-release` succeeded.

1. Delete the incomplete release, not the tag:
   `gh release delete vX.Y.Z --yes` (without `--cleanup-tag`).
2. "Re-run failed jobs" on the same run. It reuses the run's build
   artifact, so the new release has the assets the attestation names,
   and `npm-publish` and `mcp-registry` follow.

If the attestation step failed before the release was created, step 2
alone is enough.

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
environment) is configured and `NPM_PUBLISH_ENABLED` is `true`. The 0.2.0
and 0.2.1 release runs published to npm with provenance and listed the
versions in the MCP Registry. If the variable is ever unset again,
`npm-publish` and `mcp-registry` are skipped (see "Tag pushed while
publishing was off").
