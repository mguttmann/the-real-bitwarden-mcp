#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type Config } from "./config.js";
import { createLogger } from "./logger.js";
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
        }),
        fetch: fetchImpl,
        timeoutMs: config.httpTimeoutMs,
      })
    : undefined;

  let smSdk: SmSdkClient | undefined;
  let smSdkError: SmSdkLoadError | undefined;
  if (config.sm) {
    // Reconstruct raw token from parsed parts: 0.{uuid}.{clientSecret}:{encryptionKey}
    const { accessTokenUuid, clientSecret, encryptionKey } = config.sm.parsedToken;
    const rawAccessToken = `0.${accessTokenUuid}.${clientSecret}:${encryptionKey}`;
    const loaded = await tryLoadSmSdk({
      accessToken: rawAccessToken,
      apiUrl: config.sm.apiBase,
      identityUrl: config.sm.identityUrl,
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
    guard(makeProjectUpdateTool(sdk));
    guard(makeProjectDeleteTool(sdk));
    guard(makeSecretListTool(sdk, orgId));
    guard(makeSecretGetValueTool(sdk));
    guard(makeSecretCreateTool(sdk, orgId));
    guard(makeSecretUpdateTool(sdk));
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

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const clients = await buildClients(config);

  if (clients.smSdkError) {
    process.stderr.write(
      `sm-sdk: failed to load — ${clients.smSdkError.kind}: ${clients.smSdkError.message}. ` +
        `bws_project_* and bws_secret_* will return 'SDK not available' until resolved. See README → Platform support.\n`,
    );
  }

  const registry = buildRegistry(config, clients);
  const server = createMcpServer(registry, logger);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info({ tools: registry.size() }, "the-real-bitwarden-mcp ready");
}

const isDirect = process.argv[1]?.endsWith("index.js") || process.argv[1]?.endsWith("index.ts");
if (isDirect) {
  main().catch((err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  });
}
