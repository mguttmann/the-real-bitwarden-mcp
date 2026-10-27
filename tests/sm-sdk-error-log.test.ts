import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { createLogger } from "../src/logger.js";
import { reportSmSdkError } from "../src/index.js";

// Audit case sdk-load-error-raw-stderr: the SDK load/init error went to stderr
// raw, with the full Require stack (absolute paths) and whatever the SDK put
// into its message.
describe("reportSmSdkError", () => {
  it("logs through the scrubbing logger: first line only, secrets redacted", () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger("warn", stream);
    reportSmSdkError(logger, {
      kind: "binary_not_available",
      message:
        "login failed for 0.00000000-0000-0000-0000-000000000000.RkFLRQ==:RkFLRQ== Bearer FAKE-TOKEN-1\nRequire stack:\n- /home/FAKE-USER/app/node_modules/@bitwarden/sdk-napi/binding.js",
    });
    const text = chunks.join("");
    expect(text).not.toContain("RkFLRQ==");
    expect(text).not.toContain("FAKE-TOKEN-1");
    expect(text).not.toContain("FAKE-USER");
    const line = JSON.parse(text.trim());
    expect(line.level).toBe(40);
    expect(line.msg).toMatch(/sm-sdk: failed to load/);
    expect(line.msg).toMatch(/bws_project_\* and bws_secret_\*/);
    expect(line.smSdk.kind).toBe("binary_not_available");
  });
});
