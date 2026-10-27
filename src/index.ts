#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { Transport } from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import type { Logger } from "pino";
import { loadConfig, type Config } from "./config.js";
import { createLogger } from "./logger.js";
import { scrubClientText } from "./redact.js";
import { BitwardenHttpClient } from "./http/bitwarden-http-client.js";
import { OAuthTokenCache } from "./http/oauth-token-cache.js";
import { SmHttpClient } from "./http/sm-client.js";
import { tryLoadSmSdk, type SmSdkClient, type SmSdkLoadError } from "./http/sm-sdk-client.js";
import { createMcpServer } from "./server.js";
import { ToolRegistry } from "./tools/registry.js";
import { withConfirmGuard } from "./tools/confirm.js";
import { makeRawRequestTool } from "./tools/raw_request.js";
import { makeHelpTool } from "./tools/help.js";

import {
  makeMemberListTool,
  makeMemberGetTool,
  makeMemberInviteTool,
  makeMemberUpdateTool,
  makeMemberRemoveTool,
  makeMemberReinviteTool,
  makeMemberGetGroupsTool,
  makeMemberSetGroupsTool,
  makeMemberGrantSmTool,
  makeMemberRevokeSmTool,
} from "./tools/wrappers/bw_member.js";
import {
  makeGroupListTool,
  makeGroupGetTool,
  makeGroupCreateTool,
  makeGroupUpdateTool,
  makeGroupDeleteTool,
  makeGroupGetMembersTool,
  makeGroupSetMembersTool,
} from "./tools/wrappers/bw_group.js";
import {
  makeCollectionListTool,
  makeCollectionGetTool,
  makeCollectionUpdateTool,
  makeCollectionDeleteTool,
} from "./tools/wrappers/bw_collection.js";
import {
  makePolicyListTool,
  makePolicyGetTool,
  makePolicySetTool,
} from "./tools/wrappers/bw_policy.js";
import { makeEventQueryTool } from "./tools/wrappers/bw_event.js";
import { makeOrgImportTool } from "./tools/wrappers/bw_org_import.js";
import {
  makeLicenseSubscriptionGetTool,
  makeLicenseSeatsUpdateTool,
  makeLicenseStorageUpdateTool,
  makeLicenseSmSeatsUpdateTool,
  makeLicenseSmServiceAccountsUpdateTool,
} from "./tools/wrappers/bw_license.js";
import {
  makeProjectListTool,
  makeProjectGetTool,
  makeProjectCreateTool,
  makeProjectUpdateTool,
  makeProjectDeleteTool,
} from "./tools/wrappers/bws_project.js";
import {
  makeSecretListTool,
  makeSecretGetValueTool,
  makeSecretCreateTool,
  makeSecretUpdateTool,
  makeSecretDeleteTool,
} from "./tools/wrappers/bws_secret.js";
import {
  makeMachineAccountListTool,
  makeMachineAccountGetTool,
  makeMachineAccountCreateTool,
  makeMachineAccountUpdateTool,
  makeMachineAccountDeleteTool,
  makeMachineAccountProjectsTool,
  makeMachineAccountGrantProjectTool,
  makeMachineAccountRevokeProjectTool,
} from "./tools/wrappers/bws_machine_account.js";
import {
  makeAccessTokenListTool,
  makeAccessTokenCreateTool,
  makeAccessTokenRevokeTool,
} from "./tools/wrappers/bws_access_token.js";

import { OPERATIONS } from "./tools/generated/operations.js";
import { buildGeneratedTools } from "./tools/generated/tools.js";
import type { ToolDef } from "./types.js";

export type Clients = {
  selfhost: BitwardenHttpClient | undefined;
  cloud: BitwardenHttpClient | undefined;
  sm: SmHttpClient | undefined; // REST escape hatch
  smSdk: SmSdkClient | undefined; // SDK-backed CRUD
  smSdkError?: SmSdkLoadError; // captured for logging when load fails
};

export async function buildClients(
  config: Config,
  fetchImpl?: typeof globalThis.fetch,
): Promise<Clients> {
  const selfhost = config.selfhost
    ? new BitwardenHttpClient({
        apiBase: config.selfhost.apiBase,
        tokenCache: new OAuthTokenCache({
          tokenUrl: `${config.selfhost.identityUrl.replace(/\/+$/, "")}/connect/token`,
          clientId: config.selfhost.clientId,
          clientSecret: config.selfhost.clientSecret,
          scope: "api.organization",
          fetch: fetchImpl,
          timeoutMs: config.httpTimeoutMs,
        }),
        fetch: fetchImpl,
        timeoutMs: config.httpTimeoutMs,
      })
    : undefined;
  const cloud = config.cloud
    ? new BitwardenHttpClient({
        apiBase: config.cloud.apiBase,
        tokenCache: new OAuthTokenCache({
          tokenUrl: `${config.cloud.identityUrl.replace(/\/+$/, "")}/connect/token`,
          clientId: config.cloud.clientId,
          clientSecret: config.cloud.clientSecret,
          scope: "api.organization",
          fetch: fetchImpl,
          timeoutMs: config.httpTimeoutMs,
        }),
        fetch: fetchImpl,
        timeoutMs: config.httpTimeoutMs,
      })
    : undefined;
  const sm = config.sm
    ? new SmHttpClient({
        apiBase: config.sm.apiBase,
        tokenCache: new OAuthTokenCache({
          tokenUrl: `${config.sm.identityUrl.replace(/\/+$/, "")}/connect/token`,
          clientId: config.sm.parsedToken.accessTokenUuid,
          clientSecret: config.sm.parsedToken.clientSecret,
          scope: "api.secrets",
          fetch: fetchImpl,
          timeoutMs: config.httpTimeoutMs,
        }),
        fetch: fetchImpl,
        timeoutMs: config.httpTimeoutMs,
      })
    : undefined;

  let smSdk: SmSdkClient | undefined;
  let smSdkError: SmSdkLoadError | undefined;
  if (config.sm) {
    // Loads the module only; the SDK logs in on the first bws_* call.
    // Reconstruct raw token from parsed parts: 0.{uuid}.{clientSecret}:{encryptionKey}
    const { accessTokenUuid, clientSecret, encryptionKey } = config.sm.parsedToken;
    const rawAccessToken = `0.${accessTokenUuid}.${clientSecret}:${encryptionKey}`;
    const loaded = await tryLoadSmSdk({
      accessToken: rawAccessToken,
      apiUrl: config.sm.apiBase,
      identityUrl: config.sm.identityUrl,
      timeoutMs: config.httpTimeoutMs,
    });
    if (loaded.ok) smSdk = loaded.client;
    else smSdkError = loaded.error;
  }

  return { selfhost, cloud, sm, smSdk, smSdkError };
}

function notConfiguredTool(name: string, reason: string): ToolDef {
  return {
    name,
    description: `${name} (not registered: ${reason})`,
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async () => ({ content: [{ type: "text", text: reason }], isError: true }),
  };
}

export function buildRegistry(config: Config, clients: Clients): ToolRegistry {
  const reg = new ToolRegistry();
  const limits = { maxItems: config.paginationMaxItems, maxPages: config.paginationMaxPages };
  const guard = (tool: ToolDef) => reg.register(withConfirmGuard(tool, config.confirmWrites));

  if (clients.selfhost) {
    const sh = clients.selfhost;
    const maxBytes = config.maxListResponseBytes;
    guard(makeMemberListTool(sh, limits, maxBytes));
    guard(makeMemberGetTool(sh));
    guard(makeMemberInviteTool(sh));
    guard(makeMemberUpdateTool(sh));
    guard(makeMemberRemoveTool(sh));
    guard(makeMemberReinviteTool(sh));
    guard(makeMemberGetGroupsTool(sh));
    guard(makeMemberSetGroupsTool(sh));
    guard(makeMemberGrantSmTool(sh));
    guard(makeMemberRevokeSmTool(sh));

    guard(makeGroupListTool(sh, limits, maxBytes));
    guard(makeGroupGetTool(sh));
    guard(makeGroupCreateTool(sh));
    guard(makeGroupUpdateTool(sh));
    guard(makeGroupDeleteTool(sh));
    guard(makeGroupGetMembersTool(sh));
    guard(makeGroupSetMembersTool(sh));

    guard(makeCollectionListTool(sh, limits, maxBytes));
    guard(makeCollectionGetTool(sh));
    guard(makeCollectionUpdateTool(sh));
    guard(makeCollectionDeleteTool(sh));

    guard(makePolicyListTool(sh));
    guard(makePolicyGetTool(sh));
    guard(makePolicySetTool(sh));

    guard(makeEventQueryTool(sh, limits, maxBytes));
    guard(makeOrgImportTool(sh));

    for (const tool of buildGeneratedTools(sh, OPERATIONS, limits)) {
      if (reg.getByName(tool.name)) continue;
      guard(tool);
    }
  }

  if (clients.cloud) {
    const cl = clients.cloud;
    guard(makeLicenseSubscriptionGetTool(cl));
    guard(makeLicenseSeatsUpdateTool(cl));
    guard(makeLicenseStorageUpdateTool(cl));
    guard(makeLicenseSmSeatsUpdateTool(cl));
    guard(makeLicenseSmServiceAccountsUpdateTool(cl));
  }

  const smReason =
    "Secrets Manager not configured. Set BWS_ACCESS_TOKEN (and BWS_API_BASE/IDENTITY_URL if not inherited from self-host) in .env, then restart.";

  if (config.sm) {
    // SM is configured — register SDK-backed project/secret tools (may be undefined if SDK failed to load)
    const sdk = clients.smSdk;
    const orgId = config.sm.orgId;

    guard(makeProjectListTool(sdk, orgId));
    guard(makeProjectGetTool(sdk));
    guard(makeProjectCreateTool(sdk, orgId));
    guard(makeProjectUpdateTool(sdk, orgId));
    guard(makeProjectDeleteTool(sdk));
    guard(makeSecretListTool(sdk, orgId));
    guard(makeSecretGetValueTool(sdk));
    guard(makeSecretCreateTool(sdk, orgId));
    guard(makeSecretUpdateTool(sdk, orgId));
    guard(makeSecretDeleteTool(sdk));

    // Machine account and access token tools are stubs (web vault only)
    guard(makeMachineAccountListTool());
    guard(makeMachineAccountGetTool());
    guard(makeMachineAccountCreateTool());
    guard(makeMachineAccountUpdateTool());
    guard(makeMachineAccountDeleteTool());
    guard(makeMachineAccountProjectsTool());
    guard(makeMachineAccountGrantProjectTool());
    guard(makeMachineAccountRevokeProjectTool());
    guard(makeAccessTokenListTool());
    guard(makeAccessTokenCreateTool());
    guard(makeAccessTokenRevokeTool());
  } else {
    for (const name of [
      "bws_project_list",
      "bws_project_get",
      "bws_project_create",
      "bws_project_update",
      "bws_project_delete",
      "bws_secret_list",
      "bws_secret_get_value",
      "bws_secret_create",
      "bws_secret_update",
      "bws_secret_delete",
      "bws_machine_account_list",
      "bws_machine_account_get",
      "bws_machine_account_create",
      "bws_machine_account_update",
      "bws_machine_account_delete",
      "bws_machine_account_projects",
      "bws_machine_account_grant_project",
      "bws_machine_account_revoke_project",
      "bws_access_token_list",
      "bws_access_token_create",
      "bws_access_token_revoke",
    ]) {
      guard(notConfiguredTool(name, smReason));
    }
  }

  reg.register(
    makeRawRequestTool({
      selfhost: clients.selfhost,
      cloud: clients.cloud,
      sm: clients.sm,
      confirmWrites: config.confirmWrites,
    }),
  );
  reg.register(makeHelpTool(reg));
  return reg;
}

/**
 * Serve MCP over stdio. serveStdio picks the protocol era from the client's
 * opening message: an `initialize` request (2025-11-25, 2025-06-18 and older)
 * gets a 2025-era instance, served as a hand-wired stdio server; a 2026-07-28
 * opening gets a modern instance. Both come from the same factory.
 * `transport` replaces the process pipes (tests).
 */
export function startStdio(
  registry: ToolRegistry,
  logger: Logger,
  transport?: Transport,
): StdioServerHandle {
  return serveStdio(() => createMcpServer(registry, logger), {
    legacy: "serve",
    ...(transport ? { transport } : {}),
    onerror: (err) => reportStdioError(logger, err),
  });
}

/**
 * Transport errors are logged. An incoming line over the SDK's read buffer
 * limit closes the transport and the process ends; exit non-zero so a
 * supervisor sees a failure, not a clean shutdown.
 */
export function reportStdioError(logger: Logger, err: Error): void {
  if (/ReadBuffer exceeded maximum size/.test(err.message)) {
    logger.error(
      { err },
      "stdio: incoming message larger than the stdio limit; transport closed, exiting",
    );
    process.exitCode = 1;
    return;
  }
  logger.warn({ err }, "stdio transport error");
}

/**
 * Log why the Secrets Manager SDK is unavailable. Goes through the logger so
 * the scrubber applies; the message keeps its first line only (a Node
 * "Require stack" lists absolute paths).
 */
export function reportSmSdkError(logger: Logger, error: SmSdkLoadError): void {
  logger.warn(
    { smSdk: { kind: error.kind, message: scrubClientText(error.message) } },
    "sm-sdk: failed to load; bws_project_* and bws_secret_* will return 'SDK not available' until resolved. See README, Platform support.",
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const clients = await buildClients(config);

  if (clients.smSdkError) reportSmSdkError(logger, clients.smSdkError);

  const registry = buildRegistry(config, clients);
  startStdio(registry, logger);
  logger.info({ tools: registry.size() }, "the-real-bitwarden-mcp ready");
}

/**
 * True when this module is the process entry point (not imported by tests).
 * argv[1] is the path Node was started with, which for the npm bin is a
 * symlink (node_modules/.bin/bitwarden-mcp); import.meta.url is the real
 * path of this file. Resolving argv[1] makes both comparable.
 */
export function isEntryPoint(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  try {
    return pathToFileURL(realpathSync(argv1)).href === moduleUrl;
  } catch {
    return false;
  }
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(
      `fatal: ${scrubClientText(err instanceof Error ? err.message : String(err))}\n`,
    );
    process.exit(1);
  });
}
