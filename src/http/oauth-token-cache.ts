export type OAuthTokenCacheOptions = {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  expiryBufferMs?: number;
};

type TokenResponse = { access_token: string; expires_in: number };

const DEFAULT_BUFFER_MS = 60_000;

export class OAuthTokenCache {
  private readonly tokenUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly scope: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly expiryBufferMs: number;

  private cached: { token: string; expiresAt: number } | undefined;
  private inFlight: Promise<string> | undefined;

  constructor(opts: OAuthTokenCacheOptions) {
    this.tokenUrl = opts.tokenUrl;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.scope = opts.scope;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = opts.now ?? Date.now;
    this.expiryBufferMs = opts.expiryBufferMs ?? DEFAULT_BUFFER_MS;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  async getToken(): Promise<string> {
    const c = this.cached;
    if (c && c.expiresAt - this.now() > this.expiryBufferMs) {
      return c.token;
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchToken().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams();
    body.set("grant_type", "client_credentials");
    body.set("client_id", this.clientId);
    body.set("client_secret", this.clientSecret);
    body.set("scope", this.scope);
    const res = await this.fetchImpl(this.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      // Intentionally do NOT include the raw response body in the thrown error.
      // A misconfigured or hostile identity server can echo the client_secret
      // back in its error body, and this error propagates up to MCP tool
      // responses and logs. We surface only the status code (safe) and let
      // the operator inspect the upstream server directly for the body.
      // Drain the body to avoid leaving the socket half-open.
      await res.text().catch(() => "");
      // Emit ONLY the numeric status. `res.statusText` is an upstream-controlled
      // reason phrase that could be used to smuggle attacker content into our
      // error message (which bubbles up to MCP tool responses and logs).
      throw new Error(`OAuth token request failed: ${res.status}`);
    }
    // A non-JSON 2xx body would make res.json() throw a SyntaxError whose
    // message can embed a prefix of the (possibly secret-bearing) body. Guard
    // it and surface a static message instead.
    let parsed: TokenResponse;
    try {
      parsed = (await res.json()) as TokenResponse;
    } catch {
      throw new Error("token endpoint returned a non-JSON 2xx response");
    }
    if (!parsed.access_token || typeof parsed.expires_in !== "number") {
      throw new Error("OAuth token response missing access_token or expires_in");
    }
    this.cached = {
      token: parsed.access_token,
      expiresAt: this.now() + parsed.expires_in * 1000,
    };
    return parsed.access_token;
  }
}
