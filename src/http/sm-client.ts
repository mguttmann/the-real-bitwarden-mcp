/**
 * SmHttpClient - thin re-export of BitwardenHttpClient.
 *
 * Secrets Manager requests are authenticated via OAuth client_credentials
 * with scope "api.secrets". The OAuthTokenCache is configured in
 * src/index.ts buildClients() using the parsed BWS_ACCESS_TOKEN fields:
 *   client_id     = parsedToken.accessTokenUuid
 *   client_secret = parsedToken.clientSecret
 *   scope         = "api.secrets"
 *
 * The parsedToken.encryptionKey stays client-side (used to decrypt the
 * encrypted_payload in the identity response) and is NEVER sent to the server.
 */
export { BitwardenHttpClient as SmHttpClient } from "./bitwarden-http-client.js";
