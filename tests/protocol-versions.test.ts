// Protocol negotiation on the real stdio wiring (startStdio, with an
// in-memory transport instead of the process pipes). 2025-era clients send
// `initialize` with their revision and must get the same revision back;
// a client pinned to 2026-07-28 must be served too.
import { afterEach, describe, it, expect } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { startStdio } from "../src/index.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createLogger } from "../src/logger.js";
import type { ToolDef } from "../src/types.js";

type Msg = { id?: number; result?: Record<string, unknown>; error?: unknown };

const echoTool: ToolDef = {
  name: "bw_echo",
  description: "Returns its input as text.",
  inputSchema: { type: "object", properties: { message: { type: "string" } } },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  handler: async () => ({ content: [{ type: "text", text: "ok" }] }),
};

function registry(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(echoTool);
  return reg;
}

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});

async function legacyHandshake(protocolVersion: string): Promise<{ init: Msg; list: Msg }> {
  const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
  const handle = startStdio(registry(), createLogger("error"), serverTx);
  closers.push(() => handle.close());
  const waiting = new Map<number, (m: Msg) => void>();
  clientTx.onmessage = (m) => {
    const msg = m as Msg;
    if (typeof msg.id === "number") waiting.get(msg.id)?.(msg);
  };
  await clientTx.start();
  const send = (id: number, method: string, params: Record<string, unknown>): Promise<Msg> =>
    new Promise((resolve) => {
      waiting.set(id, resolve);
      void clientTx.send({ jsonrpc: "2.0", id, method, params });
    });
  const init = await send(1, "initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "protocol-test", version: "0" },
  });
  await clientTx.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const list = await send(2, "tools/list", {});
  return { init, list };
}

describe("stdio protocol negotiation", () => {
  for (const version of ["2025-06-18", "2025-11-25"]) {
    it(`initialize with ${version} gets ${version} back and serves tools/list`, async () => {
      const { init, list } = await legacyHandshake(version);
      expect(init.error).toBeUndefined();
      expect(init.result?.protocolVersion).toBe(version);
      expect(list.error).toBeUndefined();
      expect((list.result?.tools as { name: string }[]).map((t) => t.name)).toEqual(["bw_echo"]);
    });
  }

  it("serves tools/list to a client pinned to 2026-07-28", async () => {
    const [clientTx, serverTx] = InMemoryTransport.createLinkedPair();
    const handle = startStdio(registry(), createLogger("error"), serverTx);
    const client = new Client(
      { name: "protocol-test", version: "0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await client.connect(clientTx);
    closers.push(async () => {
      await client.close();
      await handle.close();
    });
    expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["bw_echo"]);
  });
});
