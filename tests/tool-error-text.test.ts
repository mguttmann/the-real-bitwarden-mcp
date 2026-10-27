import { describe, it, expect } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { asToolError } from "../src/tools/_error.js";
import { createMcpServer } from "../src/server.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createLogger } from "../src/logger.js";
import { mapErrorResponse } from "../src/http/errors.js";
import { makeRawRequestTool } from "../src/tools/raw_request.js";
import type { ToolDef } from "../src/types.js";
import { textOf } from "./helpers.js";

/** The real error undici throws for a token with CR/LF (audit crlf-token-echo-in-tool-error). */
function undiciHeaderError(): Error {
  try {
    new Headers().append("authorization", "Bearer FAKE-TOKEN-1\r\nX-Evil: 1");
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected Headers.append to throw");
}

async function callThrowingTool(err: unknown): Promise<string> {
  const tool: ToolDef = {
    name: "bw_throw",
    description: "throws",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler: async () => {
      throw err;
    },
  };
  const registry = new ToolRegistry();
  registry.register(tool);
  const server = createMcpServer(registry, createLogger("error"));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await client.connect(clientTransport);
  const res = await client.callTool({ name: "bw_throw", arguments: {} });
  await client.close();
  await server.close();
  expect(res.isError).toBe(true);
  return (res.content as { text: string }[])[0]!.text;
}

describe("error text returned to the MCP client", () => {
  it("server catch path does not echo a Bearer token from an undici header error", async () => {
    const err = undiciHeaderError();
    expect(err.message).toContain("FAKE-TOKEN-1"); // precondition: the real message carries it
    const text = await callThrowingTool(err);
    expect(text).not.toContain("FAKE-TOKEN-1");
    expect(text).toContain("invalid header value");
  });

  it("asToolError does not echo a Bearer token from an undici header error", () => {
    const text = textOf(asToolError(undiciHeaderError()));
    expect(text).not.toContain("FAKE-TOKEN-1");
  });

  it("asToolError scrubs secrets in a BitwardenApiError message", () => {
    const err = mapErrorResponse(400, '{"value":"FAKE-SECRET-2","note":"n"}')!;
    const text = textOf(asToolError(err));
    expect(text).not.toContain("FAKE-SECRET-2");
    expect(text).toContain("BitwardenApiError[400 upstream_error]");
  });

  it("asToolError scrubs client_secret= in a plain error message", () => {
    const text = textOf(asToolError(new Error("rejected client_secret=FAKE-SECRET-3&x=1")));
    expect(text).not.toContain("FAKE-SECRET-3");
    expect(text).toContain("client_secret=[REDACTED]");
  });

  it("strips stack frames and a Require stack from client-facing text", () => {
    const err = new Error(
      "Cannot find module '@bitwarden/sdk-napi'\nRequire stack:\n- /home/FAKE-USER/app/dist/x.js\n- /home/FAKE-USER/app/dist/y.js",
    );
    const text = textOf(asToolError(err));
    expect(text).toBe("Cannot find module '@bitwarden/sdk-napi'");

    const withFrames = new Error("boom\n    at handler (/home/FAKE-USER/app/x.js:1:1)\n    at y");
    expect(textOf(asToolError(withFrames))).toBe("boom");
  });

  it("server catch path scrubs a JSON secret in the error message", async () => {
    const text = await callThrowingTool(new Error('upstream said {"secret": "FAKE-SECRET-4"}'));
    expect(text).not.toContain("FAKE-SECRET-4");
  });

  it("bw_raw_request does not echo a secret from an invalid path", async () => {
    const tool = makeRawRequestTool({
      selfhost: undefined,
      cloud: undefined,
      sm: undefined,
      confirmWrites: false,
    });
    const res = await tool.handler({ method: "GET", path: "x?access_token=FAKE-TOKEN-5" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).not.toContain("FAKE-TOKEN-5");
  });
});
