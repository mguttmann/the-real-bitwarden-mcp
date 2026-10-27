import type { OAuthTokenCache } from "./oauth-token-cache.js";
import { BitwardenApiError, mapErrorResponse } from "./errors.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RequestOptions = {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  timeoutMs?: number;
  maxRetries?: number;
};
export type HttpResponse<T = unknown> = {
  status: number;
  headers: Headers;
  body: T | undefined;
};
export type SleepFn = (ms: number) => Promise<void>;
export type BitwardenHttpClientOptions = {
  apiBase: string;
  tokenCache: OAuthTokenCache;
  fetch?: typeof globalThis.fetch;
  sleep?: SleepFn;
  timeoutMs?: number;
  maxRetries?: number;
};
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 30_000;
// Only these may be repeated after a 5xx or a network error: a write may
// already have been applied upstream. 429 is retried for every method.
const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);
const defaultSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));
const UNKNOWN_OUTCOME_HINT =
  "the request may or may not have been applied upstream; check the current state before repeating it";

/** A write that failed with a 5xx or a network error/timeout: it may have been applied. */
export function isOutcomeUnknown(err: unknown): boolean {
  return err instanceof BitwardenApiError && err.message.includes(UNKNOWN_OUTCOME_HINT);
}

function unknownOutcome(method: string, err: BitwardenApiError): BitwardenApiError {
  return new BitwardenApiError(
    err.status,
    err.code,
    `${err.message} (${method} not retried: ${UNKNOWN_OUTCOME_HINT})`,
    err.details,
  );
}

export class BitwardenHttpClient {
  private readonly apiBase: string;
  private readonly tokenCache: OAuthTokenCache;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleep: SleepFn;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxRetries: number;

  constructor(opts: BitwardenHttpClientOptions) {
    this.apiBase = opts.apiBase.replace(/\/+$/, "");
    this.tokenCache = opts.tokenCache;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = opts.sleep ?? defaultSleep;
    this.defaultTimeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultMaxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<HttpResponse<T>> {
    const maxRetries = options.maxRetries ?? this.defaultMaxRetries;
    const idempotent = IDEMPOTENT_METHODS.has(method);
    let attempt = 0;
    let tokenRefreshed = false;
    while (true) {
      const token = await this.tokenCache.getToken();
      let res: HttpResponse<T>;
      try {
        res = await this.doFetch<T>(method, path, options, token);
      } catch (err) {
        if (!idempotent) {
          // No HTTP status: the request may have reached the server (timeout,
          // connection reset after sending). Same type and hint as a 5xx.
          const message = err instanceof Error ? err.message : String(err);
          throw unknownOutcome(method, new BitwardenApiError(0, "network_error", message));
        }
        if (attempt >= maxRetries) throw err;
        await this.sleep(1000 * 2 ** attempt);
        attempt++;
        continue;
      }
      if (res.status === 401 && !tokenRefreshed) {
        this.tokenCache.invalidate();
        tokenRefreshed = true;
        continue;
      }
      if (res.status >= 300 && res.status < 400) {
        // Redirects are not followed (a 307/308 would re-send the body to the
        // new location); the Bitwarden APIs do not use them.
        throw new BitwardenApiError(
          res.status,
          "redirect_not_followed",
          `HTTP ${res.status} redirect not followed; check the configured API base URL`,
        );
      }
      const delay = this.computeRetryDelay(res.status, res.headers, attempt, idempotent);
      if (delay === null || attempt >= maxRetries) {
        const err = mapErrorResponse(res.status, res.body);
        if (err && !idempotent && res.status >= 500) throw unknownOutcome(method, err);
        if (err) throw err;
        return res;
      }
      await this.sleep(delay);
      attempt++;
    }
  }

  private async doFetch<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions,
    token: string,
  ): Promise<HttpResponse<T>> {
    const url = this.buildUrl(path, options.query);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("request timeout")),
      options.timeoutMs ?? this.defaultTimeoutMs,
    );
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        redirect: "manual",
      });
      const body = await this.parseBody<T>(res);
      return { status: res.status, headers: res.headers, body };
    } finally {
      clearTimeout(timeout);
    }
  }

  private computeRetryDelay(
    status: number,
    headers: Headers,
    attempt: number,
    idempotent: boolean,
  ): number | null {
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(headers.get("retry-after"));
      return Math.min(Math.max(retryAfterMs, 1000 * 2 ** attempt), MAX_RETRY_AFTER_MS);
    }
    if (idempotent && status >= 500 && status < 600) return 1000 * 2 ** attempt;
    return null;
  }

  private buildUrl(path: string, query: RequestOptions["query"]): string {
    const url = new URL(this.apiBase + (path.startsWith("/") ? path : `/${path}`));
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async parseBody<T>(res: Response): Promise<T | undefined> {
    if (res.status === 204) return undefined;
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }
}

/** Retry-After as delta-seconds or HTTP-date, in ms; 0 when absent, invalid or in the past. */
function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const trimmed = value.trim();
  const ms = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}
