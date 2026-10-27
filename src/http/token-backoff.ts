import { TOKEN_BACKOFF_FAILURES, TOKEN_BACKOFF_MS } from "../limits.js";

/**
 * Pause after repeated failed token requests of one client, so an identity
 * outage or bad credentials do not turn every tool call into a new token
 * request. A success resets the count; a failure right after a pause starts
 * the next pause.
 */
export class TokenBackoff {
  private failures = 0;
  private pausedUntil = 0;
  private lastError = "";

  constructor(private readonly now: () => number = Date.now) {}

  /** Throws while paused; the text says how long. */
  check(): void {
    const remaining = this.pausedUntil - this.now();
    if (remaining <= 0) return;
    throw new Error(
      `identity backoff: the last ${this.failures} token requests failed (last: ${this.lastError}); ` +
        `retry after ${Math.ceil(remaining / 1000)} s`,
    );
  }

  success(): void {
    this.failures = 0;
    this.pausedUntil = 0;
  }

  failure(err: unknown): void {
    this.failures += 1;
    this.lastError = err instanceof Error ? err.message : String(err);
    if (this.failures >= TOKEN_BACKOFF_FAILURES) this.pausedUntil = this.now() + TOKEN_BACKOFF_MS;
  }
}
