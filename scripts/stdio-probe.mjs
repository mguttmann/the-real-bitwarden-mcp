#!/usr/bin/env node
// stdio probe: starts the built server the way the gateway does
// (`node --env-file=<env> <repo>/dist/index.js`), runs the opening handshake
// for one protocol revision, pages through tools/list and prints a JSON
// summary (serverInfo, negotiated revision, tool count, and per tool the
// name, required list, sorted property names and a short schema hash).
//
// Usage: node scripts/stdio-probe.mjs <repoDir> <protocolVersion> [envFile]
//   protocolVersion 2025-xx-xx: raw JSON-RPC `initialize` with that revision.
//   protocolVersion 2026-07-28: the SDK client pinned to that revision
//                               (server/discover and per-request envelope).
//   envFile defaults to <repoDir>/.env.
// Exit codes: 0 ok, 1 protocol error, 2 timeout.
/* global process, console, setTimeout, clearTimeout */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const repo = resolve(process.argv[2] ?? ".");
const protocolVersion = process.argv[3] ?? "2025-06-18";
const envFile = resolve(process.argv[4] ?? `${repo}/.env`);
const serverArgs = [`--env-file=${envFile}`, `${repo}/dist/index.js`];
const TIMEOUT_MS = 20_000;
const MODERN = new Set(["2026-07-28"]);

const hash = (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 12);

function summarize({ serverInfo, negotiated, capabilities, tools, stderr }) {
  return {
    serverInfo,
    requestedProtocolVersion: protocolVersion,
    protocolVersion: negotiated,
    capabilities,
    count: tools.length,
    tools: tools.map((t) => ({
      name: t.name,
      required: t.inputSchema?.required ?? [],
      schema: hash(t.inputSchema),
      props: Object.keys(t.inputSchema?.properties ?? {}).sort(),
    })),
    stderrTail: stderr.slice(-1500),
  };
}

async function probeLegacy() {
  const child = spawn(process.execPath, serverArgs, { stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  let stderr = "";
  const pending = new Map();
  child.stderr.on("data", (d) => (stderr += d));
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    }
  });
  let nextId = 1;
  const rpc = (method, params) =>
    new Promise((res) => {
      const id = nextId++;
      pending.set(id, res);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  try {
    const init = await rpc("initialize", {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "stdio-probe", version: "0" },
    });
    if (init.error) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
    );
    const tools = [];
    let cursor;
    do {
      const r = await rpc("tools/list", cursor ? { cursor } : {});
      if (r.error) throw new Error(`tools/list failed: ${JSON.stringify(r.error)}`);
      tools.push(...r.result.tools);
      cursor = r.result.nextCursor;
    } while (cursor);
    return summarize({
      serverInfo: init.result.serverInfo,
      negotiated: init.result.protocolVersion,
      capabilities: init.result.capabilities,
      tools,
      stderr,
    });
  } finally {
    child.kill();
  }
}

async function probeModern() {
  // Resolved from the probed repo, so the script also runs from a checkout
  // without its own node_modules.
  const { createRequire } = await import("node:module");
  const req = createRequire(`${repo}/package.json`);
  const { Client } = await import(req.resolve("@modelcontextprotocol/client"));
  const { StdioClientTransport } = await import(req.resolve("@modelcontextprotocol/client/stdio"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: serverArgs,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (d) => (stderr += d));
  const client = new Client(
    { name: "stdio-probe", version: "0" },
    { versionNegotiation: { mode: { pin: protocolVersion } } },
  );
  await client.connect(transport);
  try {
    const tools = [];
    let cursor;
    do {
      const r = await client.listTools(cursor ? { cursor } : {});
      tools.push(...r.tools);
      cursor = r.nextCursor;
    } while (cursor);
    return summarize({
      serverInfo: client.getServerVersion(),
      negotiated: client.getNegotiatedProtocolVersion(),
      capabilities: client.getServerCapabilities(),
      tools,
      stderr,
    });
  } finally {
    await client.close();
  }
}

const timer = setTimeout(() => {
  console.error(`TIMEOUT after ${TIMEOUT_MS} ms`);
  process.exit(2);
}, TIMEOUT_MS);
try {
  const summary = await (MODERN.has(protocolVersion) ? probeModern() : probeLegacy());
  console.log(JSON.stringify(summary, null, 1));
  clearTimeout(timer);
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
