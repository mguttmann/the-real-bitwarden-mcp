# Architecture

A single-binary stdio MCP server that exposes Bitwarden Password Manager
(self-hosted + cloud Public API) and Bitwarden Secrets Manager from one
process. Routing is wired at construction time so every tool talks to a
fixed instance — no per-call switching, no surprises.

```
┌────────────────────────────────────────────────────────────────────────┐
│  MCP client (Claude Code, Claude Desktop, any stdio MCP host)          │
└─────────────────────────────┬──────────────────────────────────────────┘
                              │ JSON-RPC over stdio
┌─────────────────────────────▼──────────────────────────────────────────┐
│  src/index.ts                                                          │
│    loadConfig() → buildClients() → buildRegistry() → createMcpServer() │
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

| Layer     | Path                        | Responsibility                                                                                                  |
| --------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Entry     | `src/index.ts`              | Bootstrap, build clients, build registry, attach stdio transport                                                |
| Config    | `src/config.ts`             | Read `.env`, parse 3-part `BWS_ACCESS_TOKEN`, validate URLs/UUIDs                                               |
| Logging   | `src/logger.ts`             | Pino; every log object goes through `src/redact.ts`                                                             |
| HTTP      | `src/http/*`                | OAuth client_credentials, token cache, retries, pagination, host-locking                                        |
| SM SDK    | `src/http/sm-sdk-client.ts` | Dynamic-loaded `@bitwarden/sdk-napi` wrapper, graceful fallback when binary missing                             |
| Tools     | `src/tools/*`               | Tool registry, confirm-gate decorator, raw-request escape hatch, help index                                     |
| Wrappers  | `src/tools/wrappers/*`      | One file per Bitwarden resource (members, groups, collections, policies, events, projects, secrets, license, …) |
| Generated | `src/tools/generated/*`     | Auto-generated tools from the Public API spec (`specs/public-api.spec.json`)                                    |

## Three HTTP clients, three scopes

1. **`BitwardenHttpClient` (self-host)** — OAuth `api.organization`, hits
   `BITWARDEN_SELFHOST_API_BASE`. Powers `bw_member_*`, `bw_group_*`,
   `bw_collection_*`, `bw_policy_*`, `bw_event_*`, `bw_org_import`, and
   all generated `/public/*` tools.
2. **`BitwardenHttpClient` (cloud)** — OAuth `api.organization`, hits
   `bitwarden.com`. Powers the cloud-only `bw_license_*` family.
3. **`SmHttpClient` (Secrets Manager REST)** — OAuth `api.secrets`. Only
   used by `bw_raw_request` (instance `sm`). All standard SM CRUD goes
   through the SDK instead, because the wire format is Zero-Knowledge
   and requires client-side crypto the REST surface doesn't expose.

## Secrets Manager via SDK

`@bitwarden/sdk-napi` is an **optional** dependency — it ships native
binaries for common platforms but may be missing on yours.
`tryLoadSmSdk()` dynamic-imports it, surfaces a structured error, and
the server still starts. SM tools then return a clear "SDK not
available" error per call instead of crashing the process. Machine
accounts and access tokens are intentionally **web-vault stubs**: the
Public API does not expose them with the required crypto layer.

## Safety rails

- **Confirm-gate** (`src/tools/confirm.ts`) — when
  `BITWARDEN_CONFIRM_WRITES=true` (default), every write tool returns a
  PREVIEW unless the caller passes `confirm: "YES"`. Anti-foot-gun for
  LLMs that move fast.
- **Slim list projections** — list tools strip nested fields by default
  and warn (not truncate) when the JSON exceeds
  `BW_MCP_MAX_LIST_RESPONSE_BYTES`. Use `include: ["all"]` to opt in.
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
config parser. An opt-in live-smoke script (`scripts/live-smoke.ts`)
hits a real Bitwarden instance when `RUN_LIVE_SMOKE=1`.

```
npm run build && npm test && npm run typecheck && npm run lint
```

is the full green-bar checklist.
