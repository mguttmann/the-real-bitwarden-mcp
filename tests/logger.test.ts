import { describe, it, expect } from "vitest";
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

  it("redacts deeply-nested authorization headers", () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger("info", stream);
    logger.info({ req: { headers: { authorization: "Bearer DEEP_LEAK" } } }, "outbound");
    logger.info({ req: { headers: { Authorization: "Bearer DEEP_CAPS" } } }, "outbound");
    const text = chunks.join("");
    expect(text).not.toContain("DEEP_LEAK");
    expect(text).not.toContain("DEEP_CAPS");
  });

  it("strips err.stack so captured tokens in stack frames don't leak", () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger("info", stream);
    const err = new Error("upstream failed");
    // Stack frames in real code can contain literal token strings when an
    // error is thrown from within a token-handling closure. We simulate that
    // by injecting a sentinel into the stack property.
    err.stack = `Error: upstream failed\n    at handler (token=STACK_LEAK_TOKEN_42)`;
    logger.warn({ err }, "tool handler failed");
    const text = chunks.join("");
    expect(text).not.toContain("STACK_LEAK_TOKEN_42");
  });

  it("redacts SM secret values and encryption keys", () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger("info", stream);
    logger.info({ secret: { value: "SECRET_VAL_XYZ", encryptionKey: "ENC_KEY_QQ" } }, "secret");
    const text = chunks.join("");
    expect(text).not.toContain("SECRET_VAL_XYZ");
    expect(text).not.toContain("ENC_KEY_QQ");
  });

  it("redacts the extended set of secret-bearing keys", () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger("info", stream);
    logger.info(
      {
        token: "TOKEN_LEAK_1",
        secret: "SECRET_LEAK_2",
        apiKey: "APIKEY_LEAK_3",
        refreshToken: "REFRESH_LEAK_4",
        client_id: "CLIENTID_LEAK_5",
        "set-cookie": "session=COOKIE_LEAK_6",
      },
      "extended keys",
    );
    const text = chunks.join("");
    expect(text).not.toContain("TOKEN_LEAK_1");
    expect(text).not.toContain("SECRET_LEAK_2");
    expect(text).not.toContain("APIKEY_LEAK_3");
    expect(text).not.toContain("REFRESH_LEAK_4");
    expect(text).not.toContain("CLIENTID_LEAK_5");
    expect(text).not.toContain("COOKIE_LEAK_6");
  });

  it("scrubs a Bearer token embedded in err.message", () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger("info", stream);
    // Obviously-fake placeholder token, introduced via the Bearer scheme only
    // (no preceding `authorization:` label, so exactly the Bearer pattern fires).
    const err = new Error("upstream rejected Bearer fake-bearer-AAA111 on retry");
    logger.warn({ err }, "tool handler failed");
    const text = chunks.join("");
    expect(text).not.toContain("fake-bearer-AAA111");
    // The scheme label is preserved so the log stays diagnosable.
    expect(text).toContain("Bearer [REDACTED]");
  });

  it("scrubs an authorization header value embedded in err.message", () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger("info", stream);
    const err = new Error("request failed with authorization: fake-bearer-EEE555");
    logger.warn({ err }, "tool handler failed");
    const text = chunks.join("");
    expect(text).not.toContain("fake-bearer-EEE555");
    expect(text).toContain("[REDACTED]");
  });

  it("scrubs a client_secret embedded in a nested err.cause message", () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger("info", stream);
    const cause = new Error("token endpoint rejected client_secret=fake-secret-BBB222");
    const err = new Error("oauth flow failed", { cause });
    logger.warn({ err }, "tool handler failed");
    const text = chunks.join("");
    expect(text).not.toContain("fake-secret-BBB222");
  });

  it("scrubs a BWS-shaped token embedded in err.message", () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger("info", stream);
    // Obviously-fake placeholder in the 3-part BWS token shape.
    const fakeBws = "0.00000000-0000-0000-0000-000000000000.ZmFrZQ==:ZmFrZQ==";
    const err = new Error(`auth failed: ${fakeBws}`);
    logger.warn({ err }, "tool handler failed");
    const text = chunks.join("");
    expect(text).not.toContain(fakeBws);
    expect(text).not.toContain("ZmFrZQ==");
  });

  it("does not emit err.stack when serializing an error", () => {
    const { stream, chunks } = captureStream();
    const logger = createLogger("info", stream);
    const err = new Error("upstream failed");
    err.stack = `Error: upstream failed\n    at handler (token=SERIALIZER_STACK_LEAK)`;
    logger.warn({ err }, "tool handler failed");
    const text = chunks.join("");
    expect(text).not.toContain("SERIALIZER_STACK_LEAK");
    // The serialized error object must not carry a `stack` field at all.
    expect(text).not.toContain('"stack"');
  });
});
