# Bitwarden MCP Server

[![npm version](https://img.shields.io/npm/v/the-real-bitwarden-mcp.svg)](https://www.npmjs.com/package/the-real-bitwarden-mcp)
[![Node.js](https://img.shields.io/node/v/the-real-bitwarden-mcp.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)
[![Tests](https://img.shields.io/badge/tests-180%20passing-success.svg)](#testing)

A local [Model Context Protocol](https://modelcontextprotocol.io) (stdio)
server that exposes Bitwarden's Public API (organization management) and
the Bitwarden Secrets Manager (projects + secrets via the official
SDK) as typed tools — read and write.

Intended use: an admin-facing MCP that lets an AI assistant manage
members, groups, collections, policies, license seats, and Secrets-Manager
data from a single host. Designed for a self-hosted Bitwarden instance,
the official Bitwarden Cloud, or both.

> **Quick links:** [Architecture](ARCHITECTURE.md) ·
> [Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) ·
> [Changelog](CHANGELOG.md) · [Issues](https://github.com/mguttmann/the-real-bitwarden-mcp/issues)

## Features

- **Public API:** members, groups, collections, policies, events, organization
  import, subscription/licensing.
- **Secrets Manager:** projects and secrets via the official `@bitwarden/sdk-napi`
  (Zero-Knowledge crypto — cleartext names and values returned directly).
- **Dual-instance aware:** runs against a self-hosted Bitwarden instance, the
  official cloud, or both. Tools are wired to their instance at registration
  time so routing mistakes are impossible by accident.
- **Two-layer tool surface:** ~50 hand-written wrappers for common flows
  (`bw_member_list`, `bw_license_subscription_get`, `bws_secret_get_value`, …)
  plus a generated `bw_<resource>_<op>_raw` tool for every Public API
  operation, derived from the live Swagger document of your instance.
- **Confirm-gated writes:** every destructive tool returns a request preview
  unless invoked with `confirm: "YES"`. Default is on.
- **Secret-safe by design:** the metadata list never returns values; access
  tokens are managed in the web vault only.
- **Token-budget-aware list defaults:** list tools (`bw_member_list`,
  `bw_collection_list`, `bw_group_list`, `bw_event_query`) return slim
  projections by default to stay within LLM tool-call token budgets. See
  [List-response shape](#list-response-shape) for the opt-in to full nested
  responses.

## What this MCP can and cannot do

Bitwarden's APIs expose different surfaces with different auth and crypto
requirements. This MCP wraps everything that's _cleanly_ reachable. Some
operations require Bitwarden's encryption layer (so we use the official
SDK); others have no public API at all and need the web vault.

### Can — Public API (Organization & Members)

Uses the Organization Public-API key (`organization.<uuid>` /
client_credentials / scope `api.organization`).

- List, get, invite, update, remove organization members
- Create, update, delete groups; manage group membership
- Update collection access per group (read / hide-passwords / manage);
  omitted fields of update tools keep their current value
- Read, set organization policies
- Query the event log
- Bulk-import groups + members
- Read full subscription details (PM seats, SM seats, storage,
  service-account slots)
- Adjust PM seats, PM storage, SM seats, SM service-account slots via the
  unified `PUT /public/organization/subscription` endpoint: the tools take a
  delta, send current + delta as the new total and read it back
- Cloud-only: license inspection on the cloud organization

### Can — Secrets Manager (via the official Bitwarden SDK)

Uses the Machine-Account access token (`BWS_ACCESS_TOKEN`), exchanged
through `@bitwarden/sdk-napi` which handles Bitwarden's Zero-Knowledge
encryption.

- List, get, create, update, delete projects (visible to the configured MA)
- List secret metadata, fetch full secret incl. cleartext value, create,
  update, delete secrets

### Cannot — these need a human in the web vault

Bitwarden's APIs do not expose these. The SDK doesn't either.

- Create, update, delete Machine Accounts
- Assign projects to a Machine Account
- Create or rotate Machine Account Access Tokens
- List all Machine Accounts in the organization (Machine Accounts cannot
  enumerate each other; security model)
- Trigger a Cloud → Self-Host license re-sync
- **Read, grant or revoke** a member's Secrets Manager access. Bitwarden's
  Public API neither returns nor applies `accessSecretsManager`;
  `bw_member_grant_sm` / `bw_member_revoke_sm` stay registered but always
  return an error.
- Per-user collection access (`bw_collection_update` rejects a non-empty
  `users` list; give members direct access via `bw_member_update`
  `collections`), group `accessAll` (removed upstream), and filtering events
  by IP address.

For all of these: use the web vault at `https://<your-host>/#/sm/{orgId}/`.

## Requirements

- Node ≥ 22.12.
- A Bitwarden Public-API key (`client_id` / `client_secret`) for at least one
  instance (self-host or cloud).
- For Secrets Manager: a Machine-Account access token (from the web vault).

## Platform support

This MCP works on any Node ≥ 22.12 platform for **all Public API features**
(members, groups, collections, policies, events, license adjustments,
member SM-grant/revoke).

The **Secrets Manager features** (`bws_project_*`, `bws_secret_*`) depend
on `@bitwarden/sdk-napi`, which ships native Rust binaries through optional
dependencies. Supported platforms:

| OS / Arch                                | SDK binary    | SM tools  |
| ---------------------------------------- | ------------- | --------- |
| macOS Apple Silicon (M1/M2/M3)           | available     | available |
| macOS Intel                              | available     | available |
| Linux x86_64 (glibc)                     | available     | available |
| Windows x86_64                           | available     | available |
| Linux ARM64 (Raspberry Pi, AWS Graviton) | not available | stubbed   |
| Linux Musl / Alpine                      | not available | stubbed   |
| Other                                    | not available | stubbed   |

On unsupported platforms the MCP still starts and all Public-API tools
work normally. The `bws_project_*` and `bws_secret_*` tools return
"Secrets Manager SDK not available on this platform" at call time.

If Bitwarden ships SDK binaries for a new platform, simply `npm install`
will pick them up — no MCP code change needed.

## Setup

```bash
git clone <repo-url>
cd <repo>
npm install          # also pulls the platform-specific SDK binary automatically
cp .env.example .env
# Fill in .env — see "Configuration".
npm run refresh-spec      # pull Swagger from your self-host (optional)
npm run generate          # build the generated tool list (optional)
npm run build
```

The SDK binary is an optional dependency — `npm install` succeeds even on
unsupported platforms (the binary simply won't be present, and SM tools will
return a clear "not available" message).

## Configuration

All values are read from `.env`. **At least one instance must be fully
configured**, otherwise the server refuses to start.

| Variable                           | Required when                 | Purpose                                                                       |
| ---------------------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `BITWARDEN_SELFHOST_API_BASE`      | self-host mode                | `https://vault.example.com/api`                                               |
| `BITWARDEN_SELFHOST_IDENTITY_URL`  | self-host mode                | `https://vault.example.com/identity`                                          |
| `BITWARDEN_SELFHOST_CLIENT_ID`     | self-host mode                | Public-API client id (`organization.{orgId}`)                                 |
| `BITWARDEN_SELFHOST_CLIENT_SECRET` | self-host mode                | Public-API client secret                                                      |
| `BITWARDEN_CLOUD_API_BASE`         | cloud mode                    | `https://api.bitwarden.com`                                                   |
| `BITWARDEN_CLOUD_IDENTITY_URL`     | cloud mode                    | `https://identity.bitwarden.com`                                              |
| `BITWARDEN_CLOUD_CLIENT_ID`        | cloud mode                    | Public-API client id (cloud)                                                  |
| `BITWARDEN_CLOUD_CLIENT_SECRET`    | cloud mode                    | Public-API client secret (cloud)                                              |
| `BWS_ACCESS_TOKEN`                 | SM tools                      | Machine-account access token (3-part format — see below)                      |
| `BWS_API_BASE`                     | SM tools (optional)           | Defaults to selfhost API base                                                 |
| `BWS_IDENTITY_URL`                 | SM tools (optional)           | Defaults to selfhost identity URL                                             |
| `BWS_ORG_ID`                       | SM project/secret create/list | Organization UUID                                                             |
| `BITWARDEN_CONFIRM_WRITES`         |                               | `true` (default) returns previews for destructive tools                       |
| `LOG_LEVEL`                        |                               | `debug` \| `info` \| `warn` (default) \| `error`                              |
| `HTTP_TIMEOUT_MS`                  |                               | default 30000                                                                 |
| `PAGINATION_MAX_ITEMS`             |                               | default 1000                                                                  |
| `PAGINATION_MAX_PAGES`             |                               | default 20                                                                    |
| `BW_MCP_MAX_LIST_RESPONSE_BYTES`   |                               | default 60000 — adds a `note` warning to list responses that exceed this size |

### Mode matrix

| `BITWARDEN_SELFHOST_*` | `BITWARDEN_CLOUD_*` | Result                                                                                                                        |
| ---------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| present                | absent              | Public-API operational tools + SM tools registered. License tools not registered. `bw_raw_request(instance:"cloud")` rejects. |
| absent                 | present             | Only license tools + raw cloud requests usable.                                                                               |
| present                | present             | All tool groups registered.                                                                                                   |
| absent                 | absent              | Server fails to start.                                                                                                        |

### Getting a Secrets Manager access token

1. In the self-host vault → **Secrets Manager → Machine accounts** → create
   one (a neutral name like `mcp-bitwarden` works).
2. Grant the machine account access to the projects you want the MCP to
   manage.
3. Create an **access token** for the machine account and copy the cleartext
   value into `.env` as `BWS_ACCESS_TOKEN`.
4. Also set `BWS_ORG_ID` to the organization UUID (from the URL of the
   organization in the web vault).
5. Restart the MCP — the `bws_*` tools become operational.

Until then, the SM tools stay registered but return _"Secrets Manager not
configured"_ so the surface remains discoverable.

### BWS_ACCESS_TOKEN format

The access token has a **three-part format**, separated by `.` and `:`:

```
0.{ACCESS_TOKEN_UUID}.{CLIENT_SECRET}:{ENCRYPTION_KEY}
```

Example (all values fictional):

```
0.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCCCCCCCCCCCC==
```

The MCP passes this token directly to the Bitwarden SDK, which handles
all credential parsing and crypto internally.

| Part                   | Value                 | Used by                                                        |
| ---------------------- | --------------------- | -------------------------------------------------------------- |
| Segment 1              | `0`                   | Version prefix                                                 |
| Segment 2              | `{ACCESS_TOKEN_UUID}` | SDK → OAuth `client_id`                                        |
| Segment 3 (before `:`) | `{CLIENT_SECRET}`     | SDK → OAuth `client_secret`                                    |
| After `:`              | `{ENCRYPTION_KEY}`    | SDK → decrypts response payload. **Never sent to the server.** |

The OAuth request to the identity server uses `scope=api.secrets` (not
`api.organization`). The Org Public-API key (`organization.*` client_id with
`api.organization` scope) **cannot** access Secrets Manager endpoints — this
is by design, not a bug.

### Self-hosted Bitwarden: Secrets Manager availability

Current self-hosted Bitwarden (server 2026.x) bundles the Secrets Manager API
**inside the standard `bitwarden-api` container** — there is no separate
`sm-api` container and no `enable_secrets_manager` toggle in
`bwdata/config.yml`. If your `docker-compose.yml` does not show an `sm-api`
service, that is correct and expected.

The SM endpoints are accessible as soon as you create a machine account with a
valid access token in the web vault.

## List-response shape

The four list tools (`bw_member_list`, `bw_collection_list`, `bw_group_list`,
`bw_event_query`) return **slim projections by default** because Bitwarden's
Public API embeds the full permission graph in every list item, which inflates
the response by a factor of 5–10× and overruns LLM tool-call token budgets at
modest org sizes (live observed: 81 KB on ~200 members).

Default fields:

| Tool                 | Default fields                                              |
| -------------------- | ----------------------------------------------------------- |
| `bw_member_list`     | `id`, `email`, `name`, `type`, `status`, `twoFactorEnabled` |
| `bw_collection_list` | `id`, `externalId`                                          |
| `bw_group_list`      | `id`, `name`, `externalId`                                  |
| `bw_event_query`     | Defaults to last 24 h when `start`/`end` are omitted        |

For the full response, pass the `include` parameter (whitelist of nested
fields):

```json
{ "include": ["collections", "groups"] }   // member list with nested data
{ "include": ["all"] }                     // full Bitwarden response
```

For per-item details, use the dedicated detail endpoints
(`bw_member_get`, `bw_collection_get`, `bw_group_get`,
`bw_member_get_groups`, `bw_group_get_members`).

A response-size guard adds a `note` field to any list response that exceeds
`BW_MCP_MAX_LIST_RESPONSE_BYTES` (default 60 000 chars). The response is
still returned in full — nothing is truncated silently.

## Running

```bash
npm start              # production: dist/index.js (stdio)
npm run dev            # development: tsx src/index.ts (stdio)
npm test               # unit tests
npm run test:live      # opt-in live smoke tests (read-only, RUN_LIVE_TESTS=1)
npm run inspector      # open the MCP Inspector against the built bundle
```

## Connector wiring

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the platform equivalent:

```json
{
  "mcpServers": {
    "bitwarden": {
      "command": "node",
      "args": ["/absolute/path/to/the-real-bitwarden-mcp/dist/index.js"]
    }
  }
}
```

### Claude Code

Add the same JSON block to your project's MCP config (typically
`.claude/config.json` at the project root, or the user-level
`~/.claude/config.json`).

### Environment

The server reads `.env` from the **process working directory**. If your
host launches the binary from a different directory, set the env vars
in the connector's `env` field directly, or wrap with a launcher that
`cd`s first.

## Tool reference

Run `bw_help` from inside the MCP to get a grouped, always-current catalogue.
A short list:

### Public API — operational (self-host, hand-written)

- `bw_member_list`, `bw_member_get`, `bw_member_invite`, `bw_member_update`,
  `bw_member_remove`, `bw_member_reinvite`, `bw_member_get_groups`,
  `bw_member_set_groups`, `bw_member_grant_sm`, `bw_member_revoke_sm`
  (the last two always return an error, see "Cannot")
- `bw_group_list`, `bw_group_get`, `bw_group_create`, `bw_group_update`,
  `bw_group_delete`, `bw_group_get_members`, `bw_group_set_members`
- `bw_collection_list`, `bw_collection_get`, `bw_collection_update`,
  `bw_collection_delete`
- `bw_policy_list`, `bw_policy_get`, `bw_policy_set`
- `bw_event_query`
- `bw_org_import`

### Public API — generated raw tools (self-host)

- `bw_<resource>_<op>_raw` — one tool per Public-API operation. See
  `src/tools/generated/snapshot.json` for the exact set produced from the
  current spec.

### License / subscription (cloud)

- `bw_license_subscription_get`
- `bw_license_seats_update`: adjusts Password Manager seats (`passwordManager.seats`)
- `bw_license_storage_update`: adjusts Password Manager storage (`passwordManager.storage`)
- `bw_license_sm_seats_update`: adjusts Secrets Manager seats (`secretsManager.seats`)
- `bw_license_sm_service_accounts_update`: adjusts Secrets Manager service-account slots
  (`secretsManager.serviceAccounts`)

All four take a delta, send current + delta as the new absolute total through
`PUT /public/organization/subscription`, read the subscription back and return
an error if the total did not change.

### Secrets Manager — SDK-backed (require `BWS_ACCESS_TOKEN` + supported platform)

- Projects: `bws_project_list`, `bws_project_get`, `bws_project_create`,
  `bws_project_update`, `bws_project_delete`
- Secrets: `bws_secret_list` (identifiers only), `bws_secret_get_value`,
  `bws_secret_create`, `bws_secret_update`, `bws_secret_delete`

### Secrets Manager — web vault only (always stubbed)

- Machine accounts: `bws_machine_account_list`, `..._get`, `..._create`,
  `..._update`, `..._delete`, `..._projects`, `..._grant_project`,
  `..._revoke_project`
- Access tokens: `bws_access_token_list`, `..._create`, `..._revoke`

These tools are discoverable via `tools/list` and `bw_help`, but calling
them always returns `isError: true` with a link to the web vault. Use
`https://<your-host>/#/sm/{orgId}/machine-accounts` to manage them.

### Universal

- `bw_raw_request` — escape hatch with `instance` parameter (`selfhost`, `cloud`, or `sm`).
  Use this for any Public API or SM REST call not covered by the hand-written tools.
  Note: SM `bws_*` CRUD goes through the SDK (not raw REST) — raw_request with
  `instance: "sm"` still works for read operations but cannot create/update projects
  or secrets because the API requires encrypted names/values.
- `bw_help` — grouped catalogue of registered tools.

## Safety model

- `BITWARDEN_CONFIRM_WRITES=true` (default): destructive tools return a
  preview unless invoked with `confirm: "YES"`.
- The `bws_secret_list` tool returns secret identifiers only (no value field).
  Cleartext values are only returned through `bws_secret_get_value(id)`, one
  secret at a time.
- The logger redacts all bearer tokens, client secrets, access tokens, and
  the `value` field. Tokens are never echoed back in tool responses.
- The `bw_raw_request` escape hatch defaults to `instance: "selfhost"` and
  rejects calls against instances that are not configured.
- The `{ENCRYPTION_KEY}` portion of `BWS_ACCESS_TOKEN` is passed to the SDK
  and never sent to any server as a credential.

## Troubleshooting

### OAuth client_credentials returns `invalid_client`

The `client_id` must be segment 2 of the BWS_ACCESS_TOKEN (the UUID), and
`client_secret` must be segment 3 (between the second `.` and the `:`). Do
not use the full raw token or the encryption key as either field.

Fastest diagnosis: run `docker logs bitwarden-identity` on the server host
immediately after a failed auth attempt. Duende IdentityServer logs exactly
which `client_id` was attempted and whether the client was found.

Quick smoke test (replace placeholders with real values):

```bash
# Step 1: obtain a Secrets Manager JWT
curl -sS -X POST "https://vault.example.com/identity/connect/token" \
    -d grant_type=client_credentials \
    -d "client_id={ACCESS_TOKEN_UUID}" \
    -d "client_secret={CLIENT_SECRET}" \
    -d scope=api.secrets
# Expected: HTTP 200, JSON with access_token, token_type, expires_in, scope="api.secrets"

# Step 2: list projects (replace JWT and ORG_ID)
curl -sS "https://vault.example.com/api/organizations/{ORG_ID}/projects" \
    -H "Authorization: Bearer {JWT}"
# Expected: HTTP 200, JSON with a "data" array (empty if no projects assigned)
```

### `bws_*` tools return "SDK not available on this platform"

The `@bitwarden/sdk-napi` native binary is not available for the current
platform. See the Platform support table above for the list of supported
combinations. The MCP will log the load error to stderr at startup.

On unsupported platforms, all Public-API tools (`bw_*`) continue to work
normally. Only the `bws_project_*` and `bws_secret_*` tools are affected.

### POST to `/api/organizations/.../projects` returns 400 "Name is not a valid encrypted string"

Do not use `bw_raw_request` to create or update projects/secrets. Bitwarden's
SM API requires encrypted names and values at the REST layer. The `bws_*`
wrapper tools go through the official SDK which handles encryption
transparently. Use `bws_project_create`, `bws_secret_create`, etc. instead.

### Empty project / secret lists

If `bws_project_list` or `bws_secret_list` return empty arrays, the machine
account authenticated successfully but has **no project assignments**. This is
a permission issue, not an auth bug.

To fix: go to the web vault →
`/#/sm/{ORG_ID}/machine-accounts/{SERVICE_ACCOUNT_ID}/projects` and assign
the desired projects to the machine account.

The `bws_project_list` tool surfaces this hint inline when it detects an
empty response.

### Self-host auth debugging

Run `docker logs bitwarden-identity` on the server host after a failed auth.
Duende IdentityServer logs the `client_id` attempted and the exact failure
reason (client not found vs. secret mismatch).

## License

MIT
