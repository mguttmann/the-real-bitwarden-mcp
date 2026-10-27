type ValidationBody = {
  Message?: string;
  ValidationErrors?: Record<string, string[]>;
};

function isValidationBody(body: unknown): body is ValidationBody {
  return (
    typeof body === "object" && body !== null && ("Message" in body || "ValidationErrors" in body)
  );
}

export class BitwardenApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  /** A write failed with a 5xx or a network error/timeout: it may have been applied. */
  readonly outcomeUnknown: boolean;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    opts: { outcomeUnknown?: boolean } = {},
  ) {
    super(message);
    this.name = "BitwardenApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.outcomeUnknown = opts.outcomeUnknown ?? false;
  }

  override toString(): string {
    return `BitwardenApiError[${this.status} ${this.code}]: ${this.message}`;
  }
}

// Upstream error texts (a proxy's HTML page, a long validation list) end up
// in tool errors and are cut to this length.
const MAX_ERROR_MESSAGE_CHARS = 2000;

function cut(text: string): string {
  if (text.length <= MAX_ERROR_MESSAGE_CHARS) return text;
  return `${text.slice(0, MAX_ERROR_MESSAGE_CHARS)} ... [truncated, ${text.length} chars]`;
}

export function mapErrorResponse(status: number, body: unknown): BitwardenApiError | null {
  if (status >= 200 && status < 400) return null;
  if (isValidationBody(body)) {
    const head = body.Message ?? `HTTP ${status}`;
    const ve = body.ValidationErrors;
    const detail = ve
      ? Object.entries(ve)
          .map(([k, v]) => `${k}: ${v.join("; ")}`)
          .join(" | ")
      : "";
    const message = detail ? `${head} (${detail})` : head;
    return new BitwardenApiError(status, "validation_error", cut(message), body);
  }
  if (typeof body === "string" && body.length > 0) {
    return new BitwardenApiError(status, "upstream_error", cut(body));
  }
  return new BitwardenApiError(status, "upstream_error", `HTTP ${status}`);
}
