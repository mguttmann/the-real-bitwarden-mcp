import { describe, it, expect } from "vitest";
import { BitwardenApiError, mapErrorResponse } from "../src/http/errors.js";

describe("mapErrorResponse", () => {
  it("returns null for 2xx", () => {
    expect(mapErrorResponse(200, {})).toBeNull();
  });

  it("parses Bitwarden ModelStateDictionary errors", () => {
    const body = {
      Message: "Errors have occurred.",
      ValidationErrors: { email: ["already in use"] },
    };
    const err = mapErrorResponse(400, body)!;
    expect(err).toBeInstanceOf(BitwardenApiError);
    expect(err.status).toBe(400);
    expect(err.message).toMatch(/already in use|Errors/);
  });

  it("falls back to generic message", () => {
    const err = mapErrorResponse(500, undefined)!;
    expect(err.message).toMatch(/HTTP 500/);
  });

  it("uses string body when present", () => {
    const err = mapErrorResponse(404, "Not Found")!;
    expect(err.message).toBe("Not Found");
  });
});
