# Backlog

Known minor issues and open notes that were not fixed in 0.2.0. Each run
that touches an area reads its section first and takes the items along.
Ids in brackets refer to the 2026-10-27 audit. Remove an item in the same
change that fixes it.

## HTTP, tokens and transport

- [config-url-not-validated] API base and identity URLs are not parsed or checked at startup (scheme, query, fragment); a bad URL fails at the first call.
- [token-cache-edge-cases] An `expires_in` at or below the 60 s refresh buffer disables token caching; failed token requests are neither cached nor backed off.
- [unbounded-response-buffering] Response bodies are read and returned in full with no size limit, including upstream error bodies in tool errors.
- [stdio-10mib-silent-exit, stdio-10mib-kills-server, prod-stdio-10mib-exit] An incoming stdio line over 10 MiB (SDK limit) ends the process without a response or own log line; documented in README, not handled.
- [epipe-crash-on-shutdown] An EPIPE on stdout when the client disconnects during an in-flight tool call is not handled.
- [get-retry-total-duration] A GET that times out is retried, so one call can take about 4 x `HTTP_TIMEOUT_MS` plus backoff, which may exceed a gateway or client tool timeout.
- [dotenv-cwd-merge-and-stdout, dotenv-cwd-merge] `import "dotenv/config"` also loads a `.env` from the working directory on top of `--env-file` (fills unset variables; documented in README); its debug output would go to stdout.

## Secrets Manager

- [sdk-calls-no-timeout] Secrets Manager SDK calls and the startup login have no timeout.
- [sm-sdk-login-blocks-startup] The SDK login runs before the stdio transport connects, so a slow identity server delays `initialize`.
- [sdk-init-failed-misreported] A failed SDK login at startup gives the same tool error as a missing platform binary ("not available on this platform"); only the log line (`smSdk.kind`) tells them apart.
- [bws-secret-update-wipes-note-projects] `bws_secret_update` sends an empty note and no projects when `note` / `projectIds` are omitted (full replace); documented in README, not merged with the current secret.
- [readme-secret-update-projects-wording] The README says an omitted `projectIds` on `bws_secret_update` detaches the secret from its projects; for a machine account the server rejects such an update instead (error, nothing rotated). Reword: an omitted note becomes empty, an omitted `projectIds` makes the update fail, so pass `projectIds`. Do it in the next run that touches Secrets Manager.
- [bws-update-no-orgid-fallback, sm-update-ignores-bws-org-id] `bws_project_update` / `bws_secret_update` need `organizationId` in the call and ignore `BWS_ORG_ID`; documented in README.
- [sm-delete-per-item-error-hidden] `bws_project_delete` / `bws_secret_delete` report per-item SDK errors as success.
- [sdk-napi-stale-no-arm64] `@bitwarden/sdk-napi` is still 1.0.0 with no linux-arm64 binary; watch upstream for a new release.

## Tools and schemas

- [member-schema-drift] Minor: the harmful part (wiping state on update) is fixed in 0.2.0; what remains is a feature gap. `bw_member_invite` / `bw_member_update` still accept the legacy member type 3 (removed upstream), do not expose `permissions` for Custom members on invite, and do not expose the newer `email` / `name` update fields; changing the schema needs a contract fixture update.
- [import-policy-missing-fields] `bw_org_import` lacks `inviteUsersAfterProvisioning` and requires email on deleted members; `bw_policy_set` lacks metadata.
- [pagination-not-resumable, pagination-token-not-resumable] List tools return a `continuationToken` that no tool accepts, and the oversize note suggests paging with it; truncation at `PAGINATION_MAX_ITEMS` drops the token.
- [no-input-size-limits] Tool inputs are not validated against the schema or bounded (array lengths, string lengths).
- [license-get-description-overclaims] `bw_license_subscription_get` description promises plan, billing period and seats used, which the endpoint does not return.
- [license-delta-lost-update] The `bw_license_*_update` tools read the current total and send current + delta (read-modify-write); two concurrent updates can lose one of them.
- [placeholder-annotations-flip] Stub and placeholder write tools are annotated read-only and have no `confirm` property; configuring Secrets Manager later changes their annotations and schema.
- [generated-tools-empty-and-latent-bugs] The raw-tool generator misclassifies sub-resource GETs as paged lists; not reachable while the shipped spec is empty.

## Safety model

- [confirm-gate-self-confirm-no-readonly] The confirm gate is a self-confirmation by the model (documented); there is no read-only mode and no real dry-run switch.
- [prompt-injection-no-framing] Upstream strings (names, notes, event data, error bodies) reach the model unframed and the server sends no instructions (documented in SECURITY.md).
- [completeness-gaps-unverified] Not yet reviewed: role changes towards Owner through the member tools, and SDK token renewal in long-running processes.

## Tests

- [live-smoke-false-green] `tests/live-smoke.test.ts` still returns early (passes) when a tool is not registered, instead of skipping visibly.
- [error-paths-untested] Error paths below OAuth are only partly tested (401 after refresh, wrapper 4xx/5xx mapping, server catch and log path).
- [tautological-security-tests] Some security-labelled tests assert stub behaviour rather than code behaviour.
- [confirm-gate-registry-test-missing] No registry-wide test that every write tool is wrapped by the confirm gate.
- [sdk-and-wiring-untested] The Secrets Manager SDK loader (`tryLoadSmSdk`) has no unit test.
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
