# Backlog

Known minor issues and open notes that were not fixed in 0.2.0. Each run
that touches an area reads its section first and takes the items along.
Ids in brackets refer to the 2026-10-27 audit. Remove an item in the same
change that fixes it.

## HTTP, tokens and transport

- [unbounded-response-buffering] Successful response bodies are read and returned in full with no byte limit (upstream error texts are cut since 0.2.0). Kept: a limit changes successful tool output for large results and needs a chosen byte budget (owner decision).

## Secrets Manager

- [sdk-napi-stale-no-arm64] `@bitwarden/sdk-napi` is still 1.0.0 with no linux-arm64 binary; watch upstream for a new release. Kept: upstream action (npm still lists 1.0.0 as latest, checked 2026-10-27).

## Tools and schemas

- [member-schema-drift] `bw_member_invite` does not expose `permissions` for Custom members and `bw_member_update` does not expose the newer `email` / `name` fields (type 3 was removed from the enum in 0.2.0). Kept: changes the tool contract.
- [import-policy-missing-fields] `bw_org_import` lacks `inviteUsersAfterProvisioning` and requires email on deleted members; `bw_policy_set` lacks metadata. Kept: changes the tool contract.
- [pagination-not-resumable, pagination-token-not-resumable] List tools return a `continuationToken` (after a `PAGINATION_MAX_PAGES` stop) that no list tool accepts; only `bw_raw_request` can pass it on. Kept: changes the tool contract (a new `continuationToken` input).
- [no-input-size-limits] Tool inputs are not validated against the schema or bounded (array lengths, string lengths). Kept: validation and bounds reject calls that work today and need chosen limits (owner decision).
- [license-delta-lost-update] The `bw_license_*_update` tools are read-modify-write; calls in one process are serialized since 0.2.0, but separate server processes can still lose an update. Kept: the API has no conditional update (upstream).
- [placeholder-annotations-flip] Stub and placeholder write tools are annotated read-only and have no `confirm` property; configuring Secrets Manager later changes their annotations and schema. Kept: changes the tool contract (placeholders are pinned with no properties).

## Safety model

- [confirm-gate-self-confirm-no-readonly] The confirm gate is a self-confirmation by the model (documented); there is no read-only mode and no real dry-run switch.
- [prompt-injection-no-framing] Upstream strings (names, notes, event data, error bodies) reach the model unframed and the server sends no instructions (documented in SECURITY.md).
- [completeness-gaps-unverified] Not yet reviewed: role changes towards Owner through the member tools, and SDK token renewal in long-running processes.

## Tests

- [live-smoke-false-green] `tests/live-smoke.test.ts` still returns early (passes) when a tool is not registered, instead of skipping visibly.
- [error-paths-untested] Error paths below OAuth are only partly tested (401 after refresh, wrapper 4xx/5xx mapping, server catch and log path).
- [tautological-security-tests] Some security-labelled tests assert stub behaviour rather than code behaviour.
- [confirm-gate-registry-test-missing] No registry-wide test that every write tool is wrapped by the confirm gate.
- [no-stdio-e2e-and-version] CI does not start the built `dist/index.js` over stdio; that path is covered by `scripts/container-smoke.sh`, run by hand.
- [stdio-probe-env-not-passed] `scripts/stdio-probe.mjs` in 2026-07-28 mode does not pass the environment to the spawned server.
- [entrypoint-test-temp-dir-leak] `tests/entrypoint.test.ts` creates a `bwmcp-bin-*` temp dir with a symlink on each run and never removes it; clean it up in a `finally` or `afterAll`.

## Docs

- [org-size-telemetry-in-docs] Source comments in `bw_member.ts`, `bw_group.ts` and `bw_collection.ts` still mention observed organization sizes.
- Existing tool descriptions and source comments still contain long dashes; replace them when the file is touched (descriptions are part of `tools/list`).
- [long-dashes-in-touched-files] Files touched by the 0.2.0 change (for example `src/tools/confirm.ts` preview text, `src/tools/raw_request.ts`, `src/tools/wrappers/_helpers.ts`, `bws_machine_account.ts`, `tests/wrappers/bw_member.test.ts`) still hold old long dashes, some in tool output and descriptions. Replace them in a later run; list the changed description and preview strings in CHANGELOG (output change, not a contract change).
- [docs-fixed-numbers] README and CHANGELOG name fixed numbers no test holds: the stdio message limit ("10 MiB", an SDK default) and the CI Node versions (only in `ci.yml`). Refer to the SDK default and `ci.yml` instead, or add a test.

## Release and repository (owner actions)

- [pvr-disabled-but-security-md-points-to-it, security-md-reporting-channel-disabled] Private vulnerability reporting is off; SECURITY.md describes the interim channel. Turn it on and update SECURITY.md (RELEASING.md, Repository settings).
- [repo-security-features-off, no-dependabot-no-repo-security-settings] Secret scanning, push protection, Dependabot security updates and branch/tag rulesets are off (RELEASING.md lists the settings).
- [npm-manual-publish-no-provenance] The release workflow can publish with provenance, but npm trusted publishing and `NPM_PUBLISH_ENABLED` are not configured yet (RELEASING.md).
- [diverged-lines-no-safe-deploy-target, no-ci-on-prod-branch] The deployed line is a separate branch without CI; move production to a tagged release from `main`.
- [tag-npm-mismatch-history-rewrites, release-traceability-inconsistent] Tag v0.1.0 is not the commit npm 0.1.0 was built from, and tags v0.1.0 / v0.1.1 have unrelated histories; keep the commit npm 0.1.0 names reachable. Not changed (tags are not moved).
- [force-pushed-history-still-public] Commits removed by an earlier force push remain fetchable from GitHub by SHA.
- [company-email-in-commit-metadata, commit-identity-convention, agent-identity-on-committer-tagger] Older public commits and tags carry a company address or an agent identity instead of the GitHub noreply address; new commits use the noreply address.
