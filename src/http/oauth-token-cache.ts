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
      const text = await res.text().catch(() => "");
      throw new Error(
        `OAuth token request failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`,
      );
    }
    const parsed = (await res.json()) as TokenResponse;
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
