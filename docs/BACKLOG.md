# Backlog

Known minor issues and open notes that were not fixed in 0.2.0. Each run
that touches an area reads its section first and takes the items along.
Ids in brackets refer to the 2026-10-27 audit. Remove an item in the same
change that fixes it.

## HTTP, tokens and transport

- [read-only-on-off-values] `BITWARDEN_READ_ONLY=off` (or a value of only spaces) turns read-only mode on, because unrecognised values fail safe and `parseBool` does not know on/off.
- [pagination-exact-limit-truncated] When a page ends exactly at `PAGINATION_MAX_ITEMS` and the API still returns a token, the list reports `truncated: true` even if the next page would be empty.
- [token-cache-edge-cases] Failed token requests are neither cached nor backed off, so every call during an identity outage or with bad credentials sends a new token request (the short-lifetime half was fixed in 0.2.0). Kept: a backoff turns a recovered identity server into errors for a chosen time and needs a chosen policy (owner decision).
- [unbounded-response-buffering] Successful response bodies are read and returned in full with no byte limit (upstream error texts are cut since 0.2.0). Kept: a limit changes successful tool output for large results and needs a chosen byte budget (owner decision).

## Secrets Manager

- [sm-call-total-duration] Login and SDK call have separate deadlines, so the first `bws_*` call can take about 2 x `HTTP_TIMEOUT_MS` (about 3 x for `bws_secret_update` without `note`/`projectIds`), possibly above a gateway tool timeout.
- [sm-login-timeout-overlap] A login that runs into its deadline is not cancelled; the next call starts a second login while the first may still run in the background.
- [completeness-gaps-unverified] Unverified: SDK access token renewal in long-running processes (the SDK client from the lazy login is reused for the life of the process; whether `@bitwarden/sdk-napi` renews its token is not checked). The Owner role half was checked against bitwarden/server in 0.2.0.
- [sdk-napi-stale-no-arm64] `@bitwarden/sdk-napi` is still 1.0.0 with no linux-arm64 binary; watch upstream for a new release. Kept: upstream action (npm still lists 1.0.0 as latest, checked 2026-10-27).

## Tools and schemas

- [member-schema-drift] `bw_member_invite` does not expose `permissions` for Custom members and `bw_member_update` does not expose the newer `email` / `name` fields (type 3 was removed from the enum in 0.2.0). Kept: changes the tool contract.
- [import-policy-missing-fields] `bw_org_import` lacks `inviteUsersAfterProvisioning` and requires email on deleted members; `bw_policy_set` lacks metadata. Kept: changes the tool contract.
- [pagination-not-resumable, pagination-token-not-resumable] List tools return a `continuationToken` (after a `PAGINATION_MAX_PAGES` stop) that no list tool accepts; only `bw_raw_request` can pass it on. Kept: changes the tool contract (a new `continuationToken` input).
- [no-input-size-limits] Tool inputs are not validated against the schema or bounded (array lengths, string lengths). Kept: validation and bounds reject calls that work today and need chosen limits (owner decision).
- [license-delta-lost-update] The `bw_license_*_update` tools are read-modify-write; calls in one process are serialized since 0.2.0, but separate server processes can still lose an update. Kept: the API has no conditional update (upstream).
- [placeholder-annotations-flip] Stub and placeholder write tools are annotated read-only and have no `confirm` property; configuring Secrets Manager later changes their annotations and schema. Kept: changes the tool contract (placeholders are pinned with no properties).

## Release and repository (owner actions)

- [pvr-disabled-but-security-md-points-to-it, repo-security-features-off, no-dependabot-no-repo-security-settings] SECURITY.md now names private vulnerability reporting as the channel; the owner enables it, together with secret scanning, push protection, Dependabot security updates, CodeQL and the branch/tag rulesets (docs/maintainers/repo-settings.md). Unverified from the repository; check with the `gh api` calls at the end of that file.
- [npm-manual-publish-no-provenance] The npm trusted publisher is configured (2026-10-27) but unvalidated until the first workflow publish; `NPM_PUBLISH_ENABLED` is not set yet (docs/maintainers/repo-settings.md, section 5).
- [diverged-lines-no-safe-deploy-target, no-ci-on-prod-branch] The deployed line is a separate branch without CI; move production to a tagged release from `main`.
- [tag-npm-mismatch-history-rewrites, release-traceability-inconsistent] Tag v0.1.0 is not the commit npm 0.1.0 was built from, and tags v0.1.0 / v0.1.1 have unrelated histories; keep the commit npm 0.1.0 names reachable. Not changed (tags are not moved).
- [force-pushed-history-still-public] Commits removed by an earlier force push remain fetchable from GitHub by SHA.
- [company-email-in-commit-metadata, commit-identity-convention, agent-identity-on-committer-tagger] Older public commits and tags carry a company address or an agent identity instead of the GitHub noreply address; new commits use the noreply address.
