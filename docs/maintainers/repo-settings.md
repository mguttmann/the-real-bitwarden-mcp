# Repository settings (maintainers)

The workflows in `.github/workflows/` assume the GitHub, npm and registry
settings below. A workflow cannot set them itself; the repository owner
applies them once, in the web UI or with the `gh api` calls shown.

`tests/release-chain.test.ts` fails when a job is added to `ci.yml`
without being listed in the required checks below.

State on 2026-10-27, read with the calls in "Check the result": both
rulesets (`main`, `release-tags`) are active, workflow permissions are
read-only, private vulnerability reporting, Dependabot alerts and
security updates, secret scanning with push protection and the CodeQL
default setup are on, and `NPM_PUBLISH_ENABLED` is `true`.

## 1. Ruleset for `main`

Settings > Rules > Rulesets > New branch ruleset.

- Name `main`, enforcement **Active**, target **Default branch**,
  bypass actor **Repository admin** (the single maintainer pushes
  directly; outside contributions go through pull requests and the
  required checks).
- **Restrict deletions** and **Block force pushes**.
- **Require a pull request before merging** (required approvals 0 while
  there is a single maintainer; raise it with a second one).
- **Require status checks to pass**, with **Require branches to be up to
  date before merging**. Required checks (job names of
  `.github/workflows/ci.yml`, GitHub Actions as the source):
  - `build-test (22)`, `build-test (24)`, `build-test (26)`
  - `package-smoke`
  - `audit`
  - `gitleaks`

The same set runs again on every release tag: `release.yml` calls
`ci.yml` on the tag commit and refuses a tag whose commit is not on
`main`.

```bash
gh api -X POST repos/{owner}/{repo}/rulesets --input - <<'EOF'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" } ],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "build-test (22)" }, { "context": "build-test (24)" },
          { "context": "build-test (26)" },
          { "context": "package-smoke" },
          { "context": "audit" },
          { "context": "gitleaks" }
        ] } }
  ]
}
EOF
```

## 2. Ruleset for release tags

Settings > Rules > Rulesets > New tag ruleset: name `release-tags`,
enforcement **Active**, target pattern `v*`, bypass actor **Repository
admin**, rules **Restrict creations**, **Restrict updates**, **Restrict
deletions**. A published tag then cannot be moved to another commit.

## 3. Actions

Settings > Actions > General:

- **Workflow permissions**: _Read repository contents and packages
  permissions_. Every workflow declares its own minimal `permissions`;
  only the `github-release`, `npm-publish` and `mcp-registry` jobs of
  `release.yml` and the job of `mcp-registry.yml` (`id-token: write`,
  also when started by hand) ask for more.
- **Allow GitHub Actions to create and approve pull requests**: off.
- **Actions permissions**: allow actions created by GitHub (all actions
  in use are `actions/*`, pinned by commit SHA).
- **Fork pull request workflows**: require approval for all outside
  collaborators.

```bash
gh api -X PUT repos/{owner}/{repo}/actions/permissions/workflow \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
```

## 4. Code security

Settings > Code security:

- **Private vulnerability reporting**: on (the confidential channel
  `SECURITY.md` points to).
- **Dependabot alerts** and **Dependabot security updates**: on.
  Version updates are configured in `.github/dependabot.yml`.
- **Secret scanning** with **push protection**: on. The `gitleaks` job
  scans the full history in CI as well.
- **CodeQL**: default setup for JavaScript/TypeScript and GitHub
  Actions. After its first run, add its check to the `main` ruleset.

```bash
gh api -X PUT repos/{owner}/{repo}/private-vulnerability-reporting
gh api -X PUT repos/{owner}/{repo}/vulnerability-alerts
gh api -X PUT repos/{owner}/{repo}/automated-security-fixes
```

## 5. npm publishing

State on 2026-10-27: 0.1.0 and 0.1.1 were published by hand without
provenance. The owner configured the trusted publisher for this
repository and workflow `release.yml`, and 0.2.0 and 0.2.1 were
published by the workflow with provenance.

The workflow publishes only when both are done:

- On npmjs.com, package `the-real-bitwarden-mcp`, Settings, Trusted
  Publisher: GitHub Actions, owner `mguttmann`, repository
  `the-real-bitwarden-mcp`, workflow file `release.yml`, environment
  empty (the `npm-publish` job declares none) (done).
- In the GitHub repository, Settings > Secrets and variables > Actions >
  Variables: `NPM_PUBLISH_ENABLED` is `true` (done).

The `npm-publish` job then publishes the tarball the `build` job packed,
after the GitHub release exists, with provenance through OIDC. It needs
no `NPM_TOKEN`; it checks that its npm is 11.5.1 or newer, which trusted
publishing requires, and that the tarball matches `SHA256SUMS`.
Provenance requires the repository to stay public. With the variable
off, `npm-publish` and the `mcp-registry` job after it are skipped.

If a workflow publish fails after the GitHub release exists, or a tag
was pushed while the variable was off, recover as described in
[RELEASING.md](../../RELEASING.md), "Recovering a release".

Optionally, after the first publish through the workflow, disallow
token-based publishing in the npm package settings so only the workflow
can publish.

## 6. MCP Registry

`server.json` describes the server for the official MCP Registry
(`registry.modelcontextprotocol.io`) as
`io.github.mguttmann/the-real-bitwarden-mcp`, with the npm package as its
only package. The `mcp-registry` job of `release.yml` (stable tags only,
after a successful `npm-publish`) runs
`.github/workflows/mcp-registry.yml`, which can also be started by hand
for an existing tag (Actions > MCP Registry > Run workflow, inputs `tag`
and `npm-published`). No repository setting and no secret is needed:

- Authentication is GitHub OIDC (`id-token: write`); the registry grants
  the namespace `io.github.<repository owner>/*`.
- The registry accepts the npm package only when npm serves that version
  with `mcpName` equal to the server name (`mcpName` in `package.json`).
  The workflow checks that first; after a publish in the same run
  (`npm-published: true`) it waits for npm and fails if the version does
  not appear. 0.1.0 and 0.1.1 carry no `mcpName` on npm, so they cannot
  be listed.
- The version comes from the tag; `tests/release-chain.test.ts` holds
  `server.json` name and versions equal to `package.json`.
- A version the registry already lists is skipped, because registry
  versions are permanent.
- `mcp-publisher` is pinned by version and SHA-256 in the workflow
  (`MCP_PUBLISHER_VERSION`, `MCP_PUBLISHER_SHA256`, value from the
  registry release's `registry_<version>_checksums.txt`).

A listed version can be marked deprecated or deleted with
`mcp-publisher status` after a `mcp-publisher login github`; it cannot
be replaced.

## 7. Glama

Glama lists the repository at
`https://glama.ai/mcp/servers/mguttmann/the-real-bitwarden-mcp` on its
own. The `glama.json` in the repository root names the GitHub users who
may maintain that listing (`maintainers`); Glama reads it only during its
"Claim" flow, so after a change to the file the maintainer runs the
claim again. Signed in on glama.ai with GitHub as a listed maintainer,
claim the listing on its page.

Glama's tool inspection runs the server in a container built from a
form in the listing's admin area (Node.js version, build steps, start
command, an environment JSON schema and placeholder values), not from a
file in the repository. The server answers `tools/list` without calling
the Bitwarden API, so placeholders are enough (for example the values
of `.env.example` with `vault.example.invalid` and any non-empty client
id and secret); never enter a real API key or access token there.

## Check the result

```bash
gh api repos/{owner}/{repo}/rulesets
gh api repos/{owner}/{repo}/actions/permissions/workflow
gh api repos/{owner}/{repo}/private-vulnerability-reporting
gh api repos/{owner}/{repo}/vulnerability-alerts   # 204 when on
gh api repos/{owner}/{repo}/automated-security-fixes
gh api repos/{owner}/{repo} --jq .security_and_analysis
gh api repos/{owner}/{repo}/code-scanning/default-setup --jq .state
gh api repos/{owner}/{repo}/actions/variables/NPM_PUBLISH_ENABLED
```
