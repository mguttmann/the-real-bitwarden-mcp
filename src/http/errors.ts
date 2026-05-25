type ValidationBody = {
  Message?: string;
  ValidationErrors?: Record<string, string[]>;
};

function isValidationBody(body: unknown): body is ValidationBody {
  return (
    typeof body === "object" &&
    body !== null &&
    ("Message" in body || "ValidationErrors" in body)
  );
}

export class BitwardenApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "BitwardenApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  override toString(): string {
    return `BitwardenApiError[${this.status} ${this.code}]: ${this.message}`;
  }
}

export function mapErrorResponse(
  status: number,
  body: unknown,
): BitwardenApiError | null {
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
    return new BitwardenApiError(status, "validation_error", message, body);
  }
  if (typeof body === "string" && body.length > 0) {
    return new BitwardenApiError(status, "upstream_error", body);
  }
  return new BitwardenApiError(status, "upstream_error", `HTTP ${status}`);
}
