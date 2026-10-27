# Backlog

Known minor issues and open notes that were not fixed in 0.3.0. Each run
that touches an area reads its section first and takes the items along.
Ids in brackets refer to the 2026-10-27 audit. Remove an item in the same
change that fixes it.

## HTTP, tokens and transport

- [response-body-read-in-full] Since 0.3.0 successful tool output is cut to `BW_MCP_MAX_RESPONSE_BYTES`, but the upstream body is still read and parsed in full first, so a very large upstream response costs memory before the cut (follow-up of the audit item unbounded-response-buffering).

## Secrets Manager

- [completeness-gaps-unverified] Unverified: SDK access token renewal in long-running processes (the SDK client from the lazy login is reused for the life of the process; whether `@bitwarden/sdk-napi` renews its token is not checked). The Owner role half was checked against bitwarden/server in 0.2.0.
- [sdk-napi-stale-no-arm64] `@bitwarden/sdk-napi` is still 1.0.0 with no linux-arm64 binary; watch upstream for a new release. Kept: upstream action (npm still lists 1.0.0 as latest, checked 2026-10-27).

## Tools and schemas

- [member-update-permissions] `bw_member_update` keeps a Custom member's current permissions but cannot set new ones (only `bw_member_invite` got `permissions` in 0.3.0); changing the flags needs `bw_raw_request`. The Public API accepts `permissions` on PUT.
- [license-delta-lost-update] The `bw_license_*_update` tools are read-modify-write; calls in one process are serialized since 0.2.0, but separate server processes can still lose an update. Kept: the API has no conditional update (upstream).
- [placeholder-annotations-flip] Stub and placeholder write tools are annotated read-only and have no `confirm` property; configuring Secrets Manager later changes their annotations and schema. Kept: changes the tool contract (placeholders are pinned with no properties).

## Release and repository

- [diverged-lines-no-safe-deploy-target, no-ci-on-prod-branch] The deployed line is a separate branch without CI. Closed once the gateway runs npm 0.2.1 or later (a tagged release from `main`).
- [tag-npm-mismatch-history-rewrites, release-traceability-inconsistent] Tag v0.1.0 is not the commit npm 0.1.0 was built from, and tags v0.1.0 / v0.1.1 have unrelated histories; keep the commit npm 0.1.0 names reachable. Not changed (tags are not moved).
- [force-pushed-history-still-public] Commits removed by an earlier force push remain fetchable from GitHub by SHA. Kept: only GitHub support can purge them; the repository cannot.
- [company-email-in-commit-metadata, commit-identity-convention, agent-identity-on-committer-tagger] Older public commits and tags carry a company address or an agent identity instead of the GitHub noreply address; new commits use the noreply address. Kept: changing them would rewrite public history and move tags.
