# Releasing

Releases are built and published by GitHub Actions from a version tag,
never from a laptop. The workflow is `.github/workflows/release.yml`; the
assets are built by `scripts/release-assets.sh`.

## Cutting a release

1. On a branch: bump `version` in `package.json` and the root entries of
   `package-lock.json` (`npm version <x.y.z> --no-git-tag-version` does
   both), move the `[Unreleased]` entries of `CHANGELOG.md` into a dated
   `[x.y.z]` section (keep "Behaviour changes" first) and add the
   compare link at the bottom.
2. Merge to `main` once CI is green.
3. Tag the merge commit on `main` and push the tag:

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   ```

   Tags with a suffix (`v1.2.3-rc.1`) become prereleases and are published
   to npm under the `next` dist-tag.

## What the workflow does

| Job              | What it does                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify`         | Fails unless the tag is `v` + `package.json` version and the tag commit is on `main`.                                                                                                                     |
| `ci`             | Runs all of `ci.yml` on the tag commit (Node 22/24/26 build, lint, typecheck, format, tests, tool contract; `npm audit --omit=dev`; gitleaks over the full history).                                      |
| `build`          | `npm ci`, then `scripts/release-assets.sh`: clean build, `npm pack`, a CycloneDX SBOM of the runtime dependency tree (`npm sbom`), `SHA256SUMS`.                                                          |
| `github-release` | Build provenance attestation (`actions/attest-build-provenance`) for the tarball and the SBOM, then a GitHub release with tarball, SBOM and `SHA256SUMS`. An existing release is never overwritten.       |
| `npm-publish`    | Only when the repository variable `NPM_PUBLISH_ENABLED` is `true`: checks the tarball against `SHA256SUMS` and runs `npm publish --provenance` through trusted publishing (OIDC). No npm token is stored. |

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

## Repository settings

A workflow cannot set these; the repository owner applies them once.
Status at the time of writing: private vulnerability reporting, secret
scanning, push protection, Dependabot security updates and branch
protection are off.

1. **Code security** (Settings > Code security): turn on private
   vulnerability reporting (then update the reporting section of
   `SECURITY.md`), Dependabot alerts and security updates, secret
   scanning with push protection.
2. **Ruleset for `main`**: block force pushes and deletions, require
   pull requests and the CI checks `build-test (22)`, `build-test (24)`,
   `build-test (26)`, `audit` and `gitleaks`.
3. **Ruleset for tags `v*`**: restrict updates and deletions, so a
   released tag cannot move.
4. **Actions** (Settings > Actions > General): default workflow
   permissions read-only; every workflow declares its own `permissions`.

## npm trusted publishing

The `npm-publish` job stays off until both steps are done:

1. On npmjs.com, package `the-real-bitwarden-mcp`, Settings, Trusted
   Publisher: add GitHub Actions with owner `mguttmann`, repository
   `the-real-bitwarden-mcp`, workflow file `release.yml`, no environment.
   The package already exists (0.1.0 and 0.1.1 were published by hand),
   so no bootstrap publish is needed. Provenance requires the repository
   to stay public.
2. In the GitHub repository, Settings > Secrets and variables > Actions >
   Variables: set `NPM_PUBLISH_ENABLED` to `true`.

Optionally, after the first publish through the workflow, disallow
token-based publishing in the npm package settings so only the workflow
can publish.
