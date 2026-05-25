import { describe, it, expect, vi } from "vitest";
import { Writable } from "node:stream";
import { createLogger } from "../src/logger.js";

function captureStream(): { stream: Writable; chunks: string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { stream, chunks };
}

describe("createLogger", () => {
  it("redacts authorization headers", () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger("info", stream);
    logger.info({ headers: { authorization: "Bearer ABC" } }, "outbound");
    const text = chunks.join("");
    expect(text).not.toContain("ABC");
  });

  it("redacts client_secret and BWS_ACCESS_TOKEN", () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger("info", stream);
    logger.info({ client_secret: "S1", BWS_ACCESS_TOKEN: "T1" }, "env");
    const text = chunks.join("");
    expect(text).not.toContain("S1");
    expect(text).not.toContain("T1");
  });
});
