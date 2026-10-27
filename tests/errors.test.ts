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

  it("cuts a long upstream error body (for example a proxy HTML page) in the message", () => {
    const page = "<html>" + "x".repeat(50_000) + "</html>";
    const err = mapErrorResponse(502, page)!;
    expect(err.message.length).toBeLessThanOrEqual(2000 + 40);
    expect(err.message.startsWith("<html>xxx")).toBe(true);
    expect(err.message).toMatch(/\[truncated, 50013 chars\]$/);
  });

  it("cuts a long validation message too", () => {
    const err = mapErrorResponse(400, { Message: "m".repeat(5000) })!;
    expect(err.message).toMatch(/^m{2000} \.\.\. \[truncated, 5000 chars\]$/);
  });
});
