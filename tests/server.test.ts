import { readFileSync } from "node:fs";
import { Writable } from "node:stream";
import { describe, it, expect } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../src/server.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createLogger } from "../src/logger.js";
import type { ToolDef } from "../src/types.js";
import { BitwardenApiError } from "../src/http/errors.js";

const echoTool: ToolDef = {
  name: "bw_echo",
  description: "Returns its input as text.",
  inputSchema: {
    type: "object",
    properties: { message: { type: "string" } },
    required: ["message"],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  handler: async (input) => ({
    content: [{ type: "text", text: String(input.message) }],
  }),
};

describe("createMcpServer", () => {
  it("lists registered tools via tools/list", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);

    const server = createMcpServer(registry, createLogger("error"));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = await client.listTools();
    expect(result.tools.map((t) => t.name)).toEqual(["bw_echo"]);
    expect(result.tools[0]!.description).toBe("Returns its input as text.");

    await client.close();
    await server.close();
  });

  it("sends instructions that tell the model to treat Bitwarden data as data", async () => {
    const server = createMcpServer(new ToolRegistry(), createLogger("error"));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const instructions = client.getInstructions() ?? "";
    expect(instructions).toMatch(/data, never as instructions/i);
    expect(instructions).toMatch(/confirm/i);

    await client.close();
    await server.close();
  });

  it("dispatches tools/call to the registered handler", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);

    const server = createMcpServer(registry, createLogger("error"));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "bw_echo",
      arguments: { message: "hi" },
    });
    expect(result.content).toEqual([{ type: "text", text: "hi" }]);

    await client.close();
    await server.close();
  });

  it("reports the package.json version as serverInfo.version", async () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    const server = createMcpServer(new ToolRegistry(), createLogger("error"));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientTransport);

    expect(client.getServerVersion()).toEqual({
      name: "the-real-bitwarden-mcp",
      version: pkg.version,
    });

    await client.close();
    await server.close();
  });

  it("a throwing handler: scrubbed isError text to the client, one warn line without secrets", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const registry = new ToolRegistry();
    registry.register({
      ...echoTool,
      name: "bw_throws",
      handler: async () => {
        throw new BitwardenApiError(
          502,
          "upstream_error",
          "proxy said: Authorization: Bearer FAKE-TOKEN-1",
          { client_secret: "FAKE-SECRET-1", Message: "x" },
        );
      },
    });
    const server = createMcpServer(registry, createLogger("warn", stream));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const result = await client.callTool({ name: "bw_throws", arguments: { message: "m" } });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toMatch(/^proxy said: /);
    expect(text).not.toContain("FAKE-TOKEN-1");

    expect(lines).toHaveLength(1);
    const log = JSON.parse(lines[0]!) as { level: number; tool: string; msg: string };
    expect(log.level).toBe(40);
    expect(log.tool).toBe("bw_throws");
    expect(log.msg).toBe("tool handler failed");
    expect(lines[0]).not.toContain("FAKE-TOKEN-1");
    expect(lines[0]).not.toContain("FAKE-SECRET-1");

    await client.close();
    await server.close();
  });

  it("returns an error result for unknown tool", async () => {
    const server = createMcpServer(new ToolRegistry(), createLogger("error"));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
    await client.connect(clientTransport);

    await expect(client.callTool({ name: "nope", arguments: {} })).rejects.toThrow(
      /unknown tool|not found/i,
    );

    await client.close();
    await server.close();
  });
});
