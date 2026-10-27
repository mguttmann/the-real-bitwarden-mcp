# Bitwarden MCP Server

[![npm version](https://img.shields.io/npm/v/the-real-bitwarden-mcp.svg)](https://www.npmjs.com/package/the-real-bitwarden-mcp)
[![Node.js](https://img.shields.io/node/v/the-real-bitwarden-mcp.svg)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)
[![CI](https://github.com/mguttmann/the-real-bitwarden-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mguttmann/the-real-bitwarden-mcp/actions/workflows/ci.yml)

> **Unofficial.** This project is not made by, affiliated with or endorsed
> by Bitwarden Inc. "Bitwarden" is a trademark of Bitwarden Inc. See
> [NOTICE](NOTICE).

A local [Model Context Protocol](https://modelcontextprotocol.io) (stdio)
server that exposes Bitwarden's Public API (organization management) and
the Bitwarden Secrets Manager (projects + secrets via the official
SDK) as typed tools, read and write.

Intended use: an admin-facing MCP that lets an AI assistant manage
members, groups, collections, policies, license seats, and Secrets-Manager
data from a single host. Designed for a self-hosted Bitwarden instance,
the official Bitwarden Cloud, or both.

**Quick links:** [Architecture](ARCHITECTURE.md) ·
[Contributing](CONTRIBUTING.md) · [Security policy](SECURITY.md) ·
[Releasing](RELEASING.md) · [Changelog](CHANGELOG.md) ·
[Issues](https://github.com/mguttmann/the-real-bitwarden-mcp/issues)

### Maintenance status

- Maintained on a best-effort basis by one maintainer
  ([@mguttmann](https://github.com/mguttmann)) in spare time. The author
  uses it in production. There is no support contract and no guaranteed
  response time.
- Security fixes take priority over features. Report vulnerabilities
  privately as described in [SECURITY.md](SECURITY.md), never in a
  public issue.
- Dependency updates come from Dependabot; CI fails when a runtime
  dependency has a known advisory.
- Only the latest minor release gets fixes.
- Issues and pull requests are welcome; see
  [CONTRIBUTING.md](CONTRIBUTING.md).

## Features

- **Public API:** members, groups, collections, policies, events, organization
  import, subscription/licensing.
- **Secrets Manager:** projects and secrets via the official `@bitwarden/sdk-napi`
  (Zero-Knowledge crypto; cleartext names and values returned directly).
- **Dual-instance aware:** runs against a self-hosted Bitwarden instance, the
  official cloud, or both. Tools are wired to their instance at registration
  time so routing mistakes are impossible by accident.
- **Hand-written tools** for common flows (`bw_member_list`,
  `bw_license_subscription_get`, `bws_secret_get_value`, ...) plus the
  `bw_raw_request` escape hatch. With self-host and cloud configured the
  server lists 54 tools, with or without Secrets Manager; names and
  required parameters are pinned by `tests/tool-contract.test.ts`, and
  parameters are only ever added (optional), never removed or renamed.
- **No generated tools in the shipped package:** the generator for
  `bw_<resource>_<op>_raw` tools exists (`npm run generate`), but the
  shipped spec (`specs/public-api.spec.json`) is empty, so 0 generated
  tools are registered. See [Generated raw tools](#generated-raw-tools).
- **Confirm-gated writes:** every write tool returns a request preview
  unless invoked with `confirm: "YES"`. Default is on. The model sets
  `confirm` itself, so this is friction, not a security boundary (see
  [Safety model](#safety-model)).
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

### Can: Public API (organization and members)

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

### Can: Secrets Manager (via the official Bitwarden SDK)

Uses the Machine-Account access token (`BWS_ACCESS_TOKEN`), exchanged
through `@bitwarden/sdk-napi` which handles Bitwarden's Zero-Knowledge
encryption.

- List, get, create, update, delete projects (visible to the configured MA)
- List secret metadata, fetch full secret incl. cleartext value, create,
  update, delete secrets

### Cannot: these need a human in the web vault

These are not available to the credentials this server uses (organization
API key, machine account access token). The SDK and the `bws` CLI don't
offer them either.

- Create, update, delete Machine Accounts
- Assign projects to a Machine Account
- Create or rotate Machine Account Access Tokens
- List all Machine Accounts in the organization
  (machine accounts and access tokens can only be managed by a logged-in
  user in the web vault)
- Trigger a cloud to self-host license re-sync
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

- Node.js 22.12 or newer (`engines.node` `>=22.12`; CI tests 22, 24 and 26).
- A Bitwarden Public-API key (`client_id` / `client_secret`) for at least one
  instance (self-host or cloud).
- For Secrets Manager: a Machine-Account access token (from the web vault).

## Platform support

This MCP works on any platform with Node.js 22.12 or newer for **all
Public API features** (members, groups, collections, policies, events,
license adjustments).

The **Secrets Manager features** (`bws_project_*`, `bws_secret_*`) depend
on `@bitwarden/sdk-napi` (1.0.0, an optional dependency, not MIT licensed),
which ships native Rust binaries as optional per-platform packages. The
lockfile contains `@bitwarden/sdk-napi-darwin-arm64`, `-darwin-x64`,
`-linux-x64-gnu` and `-win32-x64-msvc`:

| OS / Arch                                | SDK binary    | SM tools  |
| ---------------------------------------- | ------------- | --------- |
| macOS Apple Silicon                      | available     | available |
| macOS Intel                              | available     | available |
| Linux x86_64 (glibc)                     | available     | available |
| Windows x86_64                           | available     | available |
| Linux ARM64 (Raspberry Pi, AWS Graviton) | not available | stubbed   |
| Linux Musl / Alpine                      | not available | stubbed   |
| Other                                    | not available | stubbed   |

On unsupported platforms the MCP still starts and all Public-API tools
work normally. The `bws_project_*` and `bws_secret_*` tools stay
registered and return "Secrets Manager SDK not available on this
platform" at call time; the load error is logged once at startup as a
`warn` line.

If Bitwarden releases an SDK version with binaries for a new platform,
updating the dependency and the lockfile picks it up; no code change is
needed.

## Installation

The package is [`the-real-bitwarden-mcp`](https://www.npmjs.com/package/the-real-bitwarden-mcp)
on npm, published from GitHub Actions with
[provenance](https://docs.npmjs.com/generating-provenance-statements). Its
bin is `bitwarden-mcp`. Configuration is the same for every path (see
[Configuration](#configuration)).

### Local MCP clients (npx or npm install)

`npx` fetches and starts the package; pin a version so an update is a
decision, not a side effect of a restart:

```bash
npx -y the-real-bitwarden-mcp@<version>
```

Or install it once and start the bin:

```bash
npm install -g the-real-bitwarden-mcp@<version>
bitwarden-mcp
```

See [Connector wiring](#connector-wiring) for client configs.

### Gateways and servers (pinned, from npm)

Install a pinned version with a lockfile and start it with `node`, without
`npx` and without install scripts. Once, in an empty directory:

```bash
npm init -y
npm install --save-exact the-real-bitwarden-mcp@<version>   # writes package-lock.json
```

Commit or keep `package.json` and `package-lock.json`. On every deploy:

```bash
npm ci --omit=dev --ignore-scripts
node --env-file=/path/to/.env node_modules/the-real-bitwarden-mcp/dist/index.js
```

The package has no install script and no runtime dependency in
`devDependencies`, so `--omit=dev --ignore-scripts` is a complete install.
The Secrets Manager SDK binary is an optional per-platform package that
npm selects by OS and CPU; it needs no script either.

### From source

```bash
git clone https://github.com/mguttmann/the-real-bitwarden-mcp.git
cd the-real-bitwarden-mcp
npm ci               # also pulls the platform-specific SDK binary
cp .env.example .env
# Fill in .env, see "Configuration".
npm run build
node --env-file=.env dist/index.js
```

The SDK binary is an optional dependency: `npm ci` succeeds even on
unsupported platforms (the binary is simply not present, and SM tools
return a clear "not available" message).

### Generated raw tools

`npm run refresh-spec` pulls the Swagger document of your self-host
instance into `specs/public-api.spec.json`, and `npm run generate` builds
one `bw_<resource>_<op>_raw` tool per operation from it. The shipped spec
is empty (`{"paths": {}}`), so a normal build registers 0 generated tools.
Generating tools changes the tool list; if the server runs behind a
gateway that pins the tool surface, treat that as a deploy change.

## Configuration

All values are environment variables. They come from the process
environment (for example `node --env-file=.env`, or the `env` block of an
MCP client config). When the server is **not** started with `--env-file`
(or `--env-file-if-exists`), a `.env` file in the **process working
directory** is read as well and only fills variables that are not already
set; with `--env-file` it is ignored.
**At least one instance must be fully configured**, otherwise the server
refuses to start. A partially configured instance (some but not all four
variables) is also fatal, and so is an API base or identity URL that is
not an `http://` or `https://` URL or that has a query or fragment (the
error names the variable). Invalid values of the optional numeric and
boolean variables fall back to the default.

| Variable                           | Required when           | Purpose                                                                      |
| ---------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `BITWARDEN_SELFHOST_API_BASE`      | self-host mode          | `https://vault.example.com/api`                                              |
| `BITWARDEN_SELFHOST_IDENTITY_URL`  | self-host mode          | `https://vault.example.com/identity`                                         |
| `BITWARDEN_SELFHOST_CLIENT_ID`     | self-host mode          | Public-API client id (`organization.{orgId}`)                                |
| `BITWARDEN_SELFHOST_CLIENT_SECRET` | self-host mode          | Public-API client secret                                                     |
| `BITWARDEN_CLOUD_API_BASE`         | cloud mode              | `https://api.bitwarden.com`                                                  |
| `BITWARDEN_CLOUD_IDENTITY_URL`     | cloud mode              | `https://identity.bitwarden.com`                                             |
| `BITWARDEN_CLOUD_CLIENT_ID`        | cloud mode              | Public-API client id (cloud)                                                 |
| `BITWARDEN_CLOUD_CLIENT_SECRET`    | cloud mode              | Public-API client secret (cloud)                                             |
| `BWS_ACCESS_TOKEN`                 | SM tools                | Machine-account access token (3-part format, see below); malformed is fatal  |
| `BWS_API_BASE`                     | SM tools (optional)     | Defaults to selfhost API base                                                |
| `BWS_IDENTITY_URL`                 | SM tools (optional)     | Defaults to selfhost identity URL                                            |
| `BWS_ORG_ID`                       | SM project/secret tools | Organization UUID, used when `organizationId` is not passed                  |
| `BITWARDEN_CONFIRM_WRITES`         |                         | default `true`: write tools return a preview unless `confirm: "YES"`         |
| `BITWARDEN_READ_ONLY`              |                         | default `false`; `true`: write tools stay listed but refuse to run           |
| `LOG_LEVEL`                        |                         | `debug` \| `info` \| `warn` (default) \| `error`                             |
| `HTTP_TIMEOUT_MS`                  |                         | default 30000; applies to API and OAuth token requests and SM SDK calls      |
| `PAGINATION_MAX_ITEMS`             |                         | default 1000                                                                 |
| `PAGINATION_MAX_PAGES`             |                         | default 20                                                                   |
| `BW_MCP_MAX_LIST_RESPONSE_BYTES`   |                         | default 60000; adds a `note` warning to list responses that exceed this size |

### Mode matrix

| `BITWARDEN_SELFHOST_*` | `BITWARDEN_CLOUD_*` | Result                                                                                                                        |
| ---------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| present                | absent              | Public-API operational tools + SM tools registered. License tools not registered. `bw_raw_request(instance:"cloud")` rejects. |
| absent                 | present             | Only license tools + raw cloud requests usable.                                                                               |
| present                | present             | All tool groups registered.                                                                                                   |
| absent                 | absent              | Server fails to start.                                                                                                        |

### Getting a Secrets Manager access token

1. In the self-host vault, open **Secrets Manager > Machine accounts** and
   create one (a neutral name like `mcp-bitwarden` works).
2. Grant the machine account access to the projects you want the MCP to
   manage.
3. Create an **access token** for the machine account and copy the cleartext
   value into `.env` as `BWS_ACCESS_TOKEN`.
4. Also set `BWS_ORG_ID` to the organization UUID (from the URL of the
   organization in the web vault).
5. Restart the MCP; the `bws_*` tools become operational.

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

| Part                   | Value                 | Used by                                                  |
| ---------------------- | --------------------- | -------------------------------------------------------- |
| Segment 1              | `0`                   | Version prefix                                           |
| Segment 2              | `{ACCESS_TOKEN_UUID}` | SDK, as OAuth `client_id`                                |
| Segment 3 (before `:`) | `{CLIENT_SECRET}`     | SDK, as OAuth `client_secret`                            |
| After `:`              | `{ENCRYPTION_KEY}`    | SDK, decrypts the payload. **Never sent to the server.** |

The OAuth request to the identity server uses `scope=api.secrets` (not
`api.organization`). The Org Public-API key (`organization.*` client_id with
`api.organization` scope) **cannot** access Secrets Manager endpoints; this
is by design, not a bug.

### Self-hosted Bitwarden: Secrets Manager availability

Current self-hosted Bitwarden (server 2026.x) bundles the Secrets Manager API
**inside the standard `bitwarden-api` container**; there is no separate
`sm-api` container and no `enable_secrets_manager` toggle in
`bwdata/config.yml`. If your `docker-compose.yml` does not show an `sm-api`
service, that is correct and expected.

The SM endpoints are accessible as soon as you create a machine account with a
valid access token in the web vault.

## List-response shape

The four list tools (`bw_member_list`, `bw_collection_list`, `bw_group_list`,
`bw_event_query`) return **slim projections by default** because Bitwarden's
Public API embeds the full permission graph in every list item, which inflates
the response several times over and overruns LLM tool-call token budgets at
modest organization sizes.

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
`BW_MCP_MAX_LIST_RESPONSE_BYTES` characters (default in the table above). The
response is still returned in full; nothing is truncated silently.

## Running

```bash
npm start              # production: dist/index.js (stdio)
npm run dev            # development: tsx src/index.ts (stdio)
npm test               # unit tests with mocked HTTP
npm run test:contract  # tool contract and protocol versions only
npm run test:live      # opt-in live smoke tests (read-only, RUN_LIVE_TESTS=1)
npm run inspector      # open the MCP Inspector against the built bundle
```

## Connector wiring

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the platform equivalent. From npm:

```json
{
  "mcpServers": {
    "bitwarden": {
      "command": "npx",
      "args": ["-y", "the-real-bitwarden-mcp@<version>"],
      "env": {
        "BITWARDEN_SELFHOST_API_BASE": "https://vault.example.com/api",
        "BITWARDEN_SELFHOST_IDENTITY_URL": "https://vault.example.com/identity",
        "BITWARDEN_SELFHOST_CLIENT_ID": "organization.<uuid>",
        "BITWARDEN_SELFHOST_CLIENT_SECRET": "<client secret>"
      }
    }
  }
}
```

From a source checkout:

```json
{
  "mcpServers": {
    "bitwarden": {
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/the-real-bitwarden-mcp/.env",
        "/absolute/path/to/the-real-bitwarden-mcp/dist/index.js"
      ]
    }
  }
}
```

Instead of `--env-file`, the variables can also go into an `env` object
next to `args`. Without either, the server only finds a `.env` in the
working directory the client starts it in, which usually is not the
repository, and exits with "No Bitwarden instance configured".

### Claude Code

Register the server with `claude mcp add` (user or project scope), or add
the same `mcpServers` block to a `.mcp.json` file at the project root:

```bash
claude mcp add bitwarden -- node --env-file=/absolute/path/to/.env /absolute/path/to/dist/index.js
```

### Gateway and headless use

The server speaks MCP over stdio only and needs no terminal. A gateway or
supervisor installs the pinned npm package (see
[Gateways and servers](#gateways-and-servers-pinned-from-npm)) and starts
it with `node --env-file=/path/to/.env node_modules/the-real-bitwarden-mcp/dist/index.js`,
or builds a source checkout:

```bash
npm ci --no-audit --no-fund && npm run build
node --env-file=/path/to/.env /path/to/dist/index.js
```

- **Logs** are JSON lines on stderr (pino, level `LOG_LEVEL`); stdout
  carries only the MCP stream.
- **Protocol revisions:** clients that open with `initialize` for
  2025-06-18 or 2025-11-25 get that revision; clients that open with the
  2026-07-28 revision (`server/discover`) are served at 2026-07-28. Pinned
  by `tests/protocol-versions.test.ts`.
- **Message size limit:** the MCP SDK's stdio transport accepts incoming
  lines (one JSON-RPC message each) of at most 10 MiB. A larger line
  closes the transport; the server logs an `error` line and exits with
  code 1, and the client has to start it again.
- **Tool names are stable.** Tool names, parameter names and required
  parameters do not change and no tool or parameter is removed; a tool
  may get a new optional parameter. Changes that a caller can notice are
  listed under "Behaviour changes" in the [changelog](CHANGELOG.md).
  `scripts/container-smoke.sh` builds and probes the server the way a
  gateway does (see CONTRIBUTING).
- **No user separation:** every caller acts with the full rights of the
  configured keys. Restrict which tools each user may call in the
  gateway (see [SECURITY.md](SECURITY.md#threat-model)).

## Tool reference

Run `bw_help` from inside the MCP to get a grouped, always-current catalogue.
A short list:

### Public API: operational (self-host)

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

Optional parameters worth knowing:

- `bw_member_invite`: `permissions` sets the Custom role flags of a type 4
  member (`accessEventLogs`, `manageUsers`, ...; flags not given are false).
- `bw_member_update`: `email` and `name` change a claimed member's address
  and name; the API rejects them for other members. Omitted: unchanged.
- `bw_org_import`: `inviteUsersAfterProvisioning: false` creates new
  members as Staged without an invitation email; a member with
  `deleted: true` needs only `externalId`.
- `bw_policy_set`: `metadata` is passed with the save (for example
  `defaultUserCollectionName` for policy type 5); it is not stored with
  the policy.
- `bw_event_query`: `continuationToken` resumes a truncated result; pass
  the token it returned with the same `start`, `end` and filters.
  `bw_member_list`, `bw_group_list` and `bw_collection_list` take no
  token: the Public API returns those lists in one response.

### Public API: generated raw tools (self-host)

None in the shipped package (the spec is empty, see
[Generated raw tools](#generated-raw-tools)).
`src/tools/generated/snapshot.json` lists the set produced from the
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

### Secrets Manager: SDK-backed (require `BWS_ACCESS_TOKEN` and a supported platform)

- Projects: `bws_project_list`, `bws_project_get`, `bws_project_create`,
  `bws_project_update`, `bws_project_delete`
- Secrets: `bws_secret_list` (identifiers only), `bws_secret_get_value`,
  `bws_secret_create`, `bws_secret_update`, `bws_secret_delete`

Without `organizationId` in the call, every `bws_project_*` /
`bws_secret_*` tool that needs one uses `BWS_ORG_ID`. `bws_secret_update`
keeps the current note and project when `note` or `projectIds` is
omitted (it reads the secret first); pass them to change them. A machine
account cannot remove all projects from a secret: the server rejects an
update with `projectIds: []` for a secret that is in a project.

The SDK logs in with `BWS_ACCESS_TOKEN` on the first `bws_*` call, not at
startup; the login and each SDK call are bounded by `HTTP_TIMEOUT_MS`. A
timed-out write may or may not have been applied.

### Secrets Manager: web vault only (always stubbed)

- Machine accounts: `bws_machine_account_list`, `..._get`, `..._create`,
  `..._update`, `..._delete`, `..._projects`, `..._grant_project`,
  `..._revoke_project`
- Access tokens: `bws_access_token_list`, `..._create`, `..._revoke`

They are not available to the credentials this server uses; only a
logged-in user in the web vault can manage machine accounts and access
tokens. The tools are discoverable via `tools/list` and `bw_help`, but
calling them always returns `isError: true` with a link to the web vault. Use
`https://<your-host>/#/sm/{orgId}/machine-accounts` to manage them.

### Universal

- `bw_raw_request`: escape hatch with `instance` parameter (`selfhost`, `cloud`, or `sm`).
  Use this for any Public API or SM REST call not covered by the hand-written tools.
  Note: SM `bws_*` CRUD goes through the SDK (not raw REST); raw_request with
  `instance: "sm"` still works for read operations but cannot create/update projects
  or secrets because the API requires encrypted names/values.
- `bw_help`: grouped catalogue of registered tools.

## Safety model

- `BITWARDEN_CONFIRM_WRITES=true` (default): write tools return a
  preview unless invoked with `confirm: "YES"`. **This is a
  self-confirmation by the model, not a security boundary:** the model
  decides to send `confirm: "YES"`, also on the first call, and text in
  Bitwarden data can steer it. Read-only tools, including
  `bws_secret_get_value`, are never gated. Limit what the configured keys
  and the machine account may do, and which tools each user may call.
- `BITWARDEN_READ_ONLY=true` (default `false`): write tools keep their
  names and schemas but refuse to run, also with `confirm: "YES"`, and
  `bw_raw_request` allows GET only. Unlike the confirm gate, the model
  cannot switch this off.
- The organization API key acts as a system user, not as a member, so
  Bitwarden applies no role hierarchy to it: `bw_member_invite` and
  `bw_member_update` can create or promote Owners. Use read-only mode or
  gateway rules where callers must not do that.
- The server sends MCP instructions telling the model to treat Bitwarden
  data as data, never as instructions. This is a hint to the model, not
  a control.
- The `bws_secret_list` tool returns secret identifiers only (no value field).
  Cleartext values are only returned through `bws_secret_get_value(id)`, one
  secret at a time: `bws_secret_create` / `bws_secret_update` return the
  metadata without the value, and confirm-gate previews show secret values
  as `<redacted, N chars>`.
- Logs and error texts returned to the client go through one scrubber
  (`src/redact.ts`): the keys listed there (bearer tokens, client secrets,
  access tokens, `value`, ...) are removed at any depth, and secret-shaped
  substrings in messages are replaced with `[REDACTED]`.
- Redirects are never followed; `bw_raw_request` paths and ids with dot
  segments or encoded separators are rejected.
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
platform (see the Platform support table above). The startup `warn` log
line on stderr has the reason in `smSdk.kind` (`module_not_found` or
`binary_not_available`).

A failed login (wrong token, identity server unreachable) gives a
different tool error, "Secrets Manager SDK login failed: ..." or "...
login timed out ...". Fix the token or URLs; the next `bws_*` call logs
in again, no restart needed.

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

MIT, see [LICENSE](LICENSE). [NOTICE](NOTICE) covers what the MIT
License does not: the trademark, the optional `@bitwarden/sdk-napi`
dependency (Bitwarden SDK License Agreement, installed from npm, not
bundled) and the API specification.
