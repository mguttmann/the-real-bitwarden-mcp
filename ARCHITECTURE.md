# Architecture

A single-binary stdio MCP server that exposes Bitwarden Password Manager
(self-hosted + cloud Public API) and Bitwarden Secrets Manager from one
process. Routing is wired at construction time so every tool talks to a
fixed instance: no per-call switching, no surprises.

```
┌────────────────────────────────────────────────────────────────────────┐
│  MCP client (Claude Code, Claude Desktop, any stdio MCP host)          │
└─────────────────────────────┬──────────────────────────────────────────┘
                              │ JSON-RPC over stdio
┌─────────────────────────────▼──────────────────────────────────────────┐
│  src/index.ts                                                          │
│    loadConfig() → buildClients() → buildRegistry() → startStdio()      │
└─┬───────────────────────────┬─────────────────────────────┬────────────┘
  │                           │                             │
  ▼                           ▼                             ▼
selfhost OAuth2           cloud OAuth2                Secrets Manager
api.organization          api.organization            api.secrets
BitwardenHttpClient       BitwardenHttpClient         SmHttpClient (REST)
                                                      + SmSdkClient
                                                      (@bitwarden/sdk-napi,
                                                       Zero-Knowledge crypto)
```

## Layers

| Layer     | Path                        | Responsibility                                                                                               |
| --------- | --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Entry     | `src/index.ts`              | Bootstrap, build clients, build registry, serve stdio (`serveStdio` of the MCP SDK v2)                       |
| Config    | `src/config.ts`             | Read env (and `.env` in the cwd without `--env-file`), check base URLs, parse 3-part `BWS_ACCESS_TOKEN`      |
| Logging   | `src/logger.ts`             | Pino; every log object goes through `src/redact.ts`                                                          |
| HTTP      | `src/http/*`                | OAuth client_credentials, token cache, retries, pagination, host-locking                                     |
| SM SDK    | `src/http/sm-sdk-client.ts` | Dynamic-loaded `@bitwarden/sdk-napi` wrapper, graceful fallback when binary missing                          |
| Tools     | `src/tools/*`               | Tool registry, confirm-gate decorator, raw-request escape hatch, help index                                  |
| Wrappers  | `src/tools/wrappers/*`      | One file per Bitwarden resource (members, groups, collections, policies, events, projects, secrets, license) |
| Generated | `src/tools/generated/*`     | Tools generated from `specs/public-api.spec.json`; the shipped spec is empty, so none are registered         |

## Three HTTP clients, three scopes

1. **`BitwardenHttpClient` (self-host)**: OAuth `api.organization`, hits
   `BITWARDEN_SELFHOST_API_BASE`. Powers `bw_member_*`, `bw_group_*`,
   `bw_collection_*`, `bw_policy_*`, `bw_event_*`, `bw_org_import`, and
   generated `/public/*` tools if a spec is generated.
2. **`BitwardenHttpClient` (cloud)**: OAuth `api.organization`, hits
   `bitwarden.com`. Powers the cloud-only `bw_license_*` family.
3. **`SmHttpClient` (Secrets Manager REST)**: OAuth `api.secrets`. Only
   used by `bw_raw_request` (instance `sm`). All standard SM CRUD goes
   through the SDK instead, because the wire format is Zero-Knowledge
   and requires client-side crypto the REST surface doesn't expose.

## Secrets Manager via SDK

`@bitwarden/sdk-napi` is an **optional** dependency: it ships native
binaries for common platforms but may be missing on yours.
`tryLoadSmSdk()` dynamic-imports it, surfaces a structured error, and
the server still starts. SM tools then return a clear "SDK not
available" error per call instead of crashing the process. The SDK
login runs on the first SDK call, not at startup, so `initialize` never
waits for the identity server. One `HTTP_TIMEOUT_MS` deadline covers a
whole SDK client method: the login it waits for and every SDK call it
makes (`secretUpdate` reads the current secret first when note or
projects are omitted). A running login is shared by all calls, also after
a caller timed out on it, and is only given up when it runs far past its
deadline; a failed login is retried by the next call. Machine
accounts and access tokens are intentionally **web-vault stubs**
(`src/tools/wrappers/_web_vault_stub.ts`): they are not available to the
credentials this server uses; only a logged-in user in the web vault can
manage machine accounts and access tokens. Bitwarden serves them only on
its internal Secrets Manager API, which authorizes organization owners,
admins and members with access, not the organization API key or a machine
account token, and its writes need the organization key on the client.
Neither the `bws` CLI nor `@bitwarden/sdk-napi` offer them.

## Safety rails

- **Confirm-gate** (`src/tools/confirm.ts`): when
  `BITWARDEN_CONFIRM_WRITES=true` (default), every write tool returns a
  PREVIEW unless the caller passes `confirm: "YES"`. Tools with a `plan`
  function also show the effective request (after merging current state).
  The model sets `confirm` itself, so this is friction against hasty
  writes, not a security boundary.
- **Read-only mode** (`withReadOnly` in `src/tools/confirm.ts`): with
  `BITWARDEN_READ_ONLY=true` every write tool keeps its name and schema
  but refuses to run, and `bw_raw_request` allows GET only.
- **Retries** (`src/http/bitwarden-http-client.ts`): 5xx and network
  errors are retried for GET/HEAD only, a timeout is not retried; 429 for
  every method, with `Retry-After` capped.
- **Slim list projections**: list tools strip nested fields by default
  and warn (not truncate) when the JSON exceeds
  `BW_MCP_MAX_LIST_RESPONSE_BYTES`. Use `include: ["all"]` to opt in.
- **Limits** (`src/limits.ts`, applied in `tools/call` in
  `src/server.ts`): arguments over the input bounds are rejected before
  any handler runs; a successful result over `BW_MCP_MAX_RESPONSE_BYTES`
  is cut to valid JSON with a `responseTruncated` marker. Token requests
  of one client pause after repeated failures (`src/http/token-backoff.ts`,
  used by `OAuthTokenCache` and the Secrets Manager SDK login). Values:
  README, Limits.
- **Host-locking** - `BitwardenHttpClient.buildUrl()` builds every URL
  as API base plus path, so paths cannot reach another host, even via
  `bw_raw_request`. `src/http/path-safety.ts` rejects dot segments and
  encoded separators in raw paths and in ids, so paths also stay under
  the API base prefix. Redirects are not followed (API and token
  requests).
- **Redaction** - `src/redact.ts` is the one scrubber for logs (pino
  formatter and err serializer in `src/logger.ts`) and for error texts
  returned to the client (`asToolError`, the `tools/call` catch path,
  `bw_raw_request`). It removes the keys in `SENSITIVE_KEYS` at any
  depth, scrubs secret-shaped substrings from messages and drops stacks.
  Confirm-gate previews mask secret values. OAuth error bodies are
  stripped before being thrown so a failed token request can't echo
  back the submitted `client_secret`.

## Testing

Unit tests with mocked HTTP (`tests/`) cover routing, redaction,
confirm-gate, pagination, slim projections, error mapping, and the
config parser. `tests/tool-contract.test.ts` pins the `tools/list`
surface (names, required lists, property names) against the baseline
`tests/fixtures/tool-contract.json` plus the optional parameters recorded
in `tests/fixtures/tool-contract-added.json` (`scripts/tool-contract.mjs`); `tests/protocol-versions.test.ts`
covers protocol negotiation on the stdio wiring. `tests/stdio-probe.test.ts`
starts the real entry point as a child process through
`scripts/stdio-probe.mjs` for every protocol revision and checks the tool
contract and `serverInfo.version`; CI runs it a second time against the
built `dist/index.js` (`STDIO_PROBE_BUILT=1`). The opt-in live smoke
test (`tests/live-smoke.test.ts`, `npm run test:live`, which sets
`RUN_LIVE_TESTS=1`) calls a real Bitwarden instance, read-only; a check
whose instance is not configured is reported as skipped.
`scripts/container-smoke.sh` builds and probes `dist/index.js` in the
gateway's Node image. `scripts/package-smoke.sh` (CI job `package-smoke`,
linux x86_64) packs the tarball, installs it the gateway way
(`npm ci --omit=dev --ignore-scripts`), probes it from `node_modules` and
fails if the Secrets Manager SDK binary does not load.

The full green-bar checklist is the CI job (`.github/workflows/ci.yml`):

```
npm run build && npm run lint && npm run typecheck && npm run format:check && npm test
```
