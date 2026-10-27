import { describe, it, expect, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../src/server.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createLogger } from "../src/logger.js";
import { loadConfig } from "../src/config.js";
import { makeOrgImportTool } from "../src/tools/wrappers/bw_org_import.js";
import { withConfirmGuard } from "../src/tools/confirm.js";
import {
  DEFAULT_MAX_RESPONSE_BYTES,
  MAX_INPUT_ARRAY_ITEMS,
  MAX_INPUT_STRING_BYTES,
  cutOversizeText,
  inputBoundsViolation,
} from "../src/limits.js";
import type { ToolDef, ToolResult } from "../src/types.js";
import { fakeApi } from "./helpers.js";

const selfhostEnv = {
  BITWARDEN_SELFHOST_API_BASE: "https://vault.example.invalid/api",
  BITWARDEN_SELFHOST_IDENTITY_URL: "https://vault.example.invalid/identity",
  BITWARDEN_SELFHOST_CLIENT_ID: "organization.FAKE",
  BITWARDEN_SELFHOST_CLIENT_SECRET: "FAKE-SECRET-1",
};

function tool(name: string, handler: ToolDef["handler"]): ToolDef {
  return {
    name,
    description: name,
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    handler,
  };
}

async function connect(tools: ToolDef[], options?: { maxResponseBytes?: number }) {
  const registry = new ToolRegistry();
  for (const t of tools) registry.register(t);
  const server = createMcpServer(registry, createLogger("error"), options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    return {
      isError: res.isError === true,
      text: (res.content as { type: string; text: string }[])[0]!.text,
    };
  };
  return {
    call,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

const jsonText = (value: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
});

describe("input bounds", () => {
  it("accepts a string at the limit and rejects one byte more, naming the path but not the value", () => {
    expect(inputBoundsViolation({ note: "a".repeat(MAX_INPUT_STRING_BYTES) })).toBeUndefined();
    const text = inputBoundsViolation({
      body: { items: [{ note: `FAKE-SECRET-1${"a".repeat(MAX_INPUT_STRING_BYTES)}` }] },
    });
    expect(text).toMatch(/nothing was sent/);
    expect(text).toContain('"body.items[0].note"');
    expect(text).toContain(`${MAX_INPUT_STRING_BYTES} bytes`);
    expect(text).not.toContain("FAKE-SECRET-1");
  });

  it("counts UTF-8 bytes, not characters", () => {
    // Each umlaut is two bytes in UTF-8.
    const half = "ä".repeat(MAX_INPUT_STRING_BYTES / 2);
    expect(inputBoundsViolation({ s: half })).toBeUndefined();
    expect(inputBoundsViolation({ s: `${half}ä` })).toMatch(/"s" is a string/);
  });

  it("accepts an array at the limit and rejects one item more", () => {
    expect(
      inputBoundsViolation({ ids: new Array(MAX_INPUT_ARRAY_ITEMS).fill("x") }),
    ).toBeUndefined();
    expect(inputBoundsViolation({ ids: new Array(MAX_INPUT_ARRAY_ITEMS + 1).fill("x") })).toMatch(
      new RegExp(
        `"ids" has ${MAX_INPUT_ARRAY_ITEMS + 1} items; the limit is ${MAX_INPUT_ARRAY_ITEMS}`,
      ),
    );
  });

  it("rejects an oversized string through tools/call before the handler runs", async () => {
    const handler = vi.fn(async () => jsonText({ ok: true }));
    const s = await connect([tool("bw_echo", handler)]);
    const res = await s.call("bw_echo", { message: "a".repeat(MAX_INPUT_STRING_BYTES + 1) });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/"message" is a string/);
    expect(handler).not.toHaveBeenCalled();
    await s.close();
  });

  it("bw_org_import with too many members is rejected, with confirm, and sends nothing", async () => {
    const { client, calls } = fakeApi({ "POST /public/organization/import": null });
    const members = Array.from({ length: MAX_INPUT_ARRAY_ITEMS + 1 }, (_, i) => ({
      email: `user${i}@example.invalid`,
      externalId: `ext-${i}`,
    }));
    const s = await connect([withConfirmGuard(makeOrgImportTool(client), true)]);
    for (const args of [{ members }, { members, confirm: "YES" }, { groups: members }]) {
      const res = await s.call("bw_org_import", args);
      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/nothing was sent/);
    }
    expect(calls).toEqual([]);
    // At the limit the call goes through.
    const ok = await s.call("bw_org_import", {
      members: members.slice(0, MAX_INPUT_ARRAY_ITEMS),
      confirm: "YES",
    });
    expect(ok.isError).toBe(false);
    expect(calls).toHaveLength(1);
    await s.close();
  });
});

describe("response cut", () => {
  it("BW_MCP_MAX_RESPONSE_BYTES defaults to the constant and can be set", () => {
    expect(loadConfig(selfhostEnv).maxResponseBytes).toBe(DEFAULT_MAX_RESPONSE_BYTES);
    expect(DEFAULT_MAX_RESPONSE_BYTES).toBe(1_048_576);
    expect(loadConfig({ ...selfhostEnv, BW_MCP_MAX_RESPONSE_BYTES: "5000" }).maxResponseBytes).toBe(
      5000,
    );
  });

  it("leaves output within the budget byte for byte unchanged", () => {
    const text = JSON.stringify({ members: [{ id: "m1" }] }, null, 2);
    expect(cutOversizeText(text, Buffer.byteLength(text))).toBe(text);
  });

  it("keeps the leading list items, other fields and the list note, as valid JSON within the budget", () => {
    const members = Array.from({ length: 500 }, (_, i) => ({ id: `m${i}`, name: `Member ${i}` }));
    const text = JSON.stringify({ members, truncated: false, note: "Response is ~30 KB" }, null, 2);
    const out = cutOversizeText(text, 4000);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(4000);
    const parsed = JSON.parse(out) as {
      members: { id: string }[];
      truncated: boolean;
      note: string;
      responseTruncated: Record<string, unknown>;
    };
    expect(parsed.note).toBe("Response is ~30 KB");
    expect(parsed.truncated).toBe(false);
    expect(parsed.members.length).toBeGreaterThan(0);
    expect(parsed.members.length).toBeLessThan(500);
    expect(parsed.members).toEqual(members.slice(0, parsed.members.length));
    expect(parsed.responseTruncated).toMatchObject({
      originalBytes: Buffer.byteLength(text),
      limitBytes: 4000,
      cutArray: "members",
      keptItems: parsed.members.length,
      totalItems: 500,
    });
    expect(parsed.responseTruncated.hint).toMatch(/BW_MCP_MAX_RESPONSE_BYTES/);
    expect(parsed.responseTruncated.hint).toMatch(/narrow the query/i);
    // One more item would not fit.
    const oneMore = { ...parsed, members: members.slice(0, parsed.members.length + 1) };
    oneMore.responseTruncated = {
      ...parsed.responseTruncated,
      keptItems: parsed.members.length + 1,
    };
    expect(Buffer.byteLength(JSON.stringify(oneMore, null, 2))).toBeGreaterThan(4000);
  });

  it("removes a continuationToken next to a cut list, since it would skip the cut items", () => {
    const events = Array.from({ length: 300 }, (_, i) => ({ type: 1000, date: `d${i}` }));
    const text = JSON.stringify({ events, truncated: true, continuationToken: "tok-1" }, null, 2);
    const parsed = JSON.parse(cutOversizeText(text, 3000)) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("continuationToken");
    expect(parsed.responseTruncated).toMatchObject({ continuationTokenRemoved: true });
  });

  it("cuts a nested list such as bw_raw_request's body.data, and a top-level array", () => {
    const data = Array.from({ length: 300 }, (_, i) => ({ id: `g${i}` }));
    const raw = JSON.parse(
      cutOversizeText(JSON.stringify({ status: 200, body: { data } }, null, 2), 2000),
    ) as { status: number; body: { data: unknown[] }; responseTruncated: { cutArray: string } };
    expect(raw.status).toBe(200);
    expect(raw.responseTruncated.cutArray).toBe("body.data");
    expect(raw.body.data.length).toBeGreaterThan(0);
    expect(raw.body.data.length).toBeLessThan(300);

    const top = JSON.parse(cutOversizeText(JSON.stringify(data, null, 2), 2000)) as {
      items: unknown[];
      responseTruncated: { cutArray: string };
    };
    expect(top.responseTruncated.cutArray).toBe("(root)");
    expect(top.items.length).toBeGreaterThan(0);
  });

  it("replaces output that is not JSON or has no list by the marker alone", () => {
    for (const text of [
      "PREVIEW - would execute x\n" + "y".repeat(5000),
      JSON.stringify({ s: "z".repeat(5000) }),
    ]) {
      const parsed = JSON.parse(cutOversizeText(text, 1000)) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(["responseTruncated"]);
      expect(parsed.responseTruncated).toMatchObject({ limitBytes: 1000 });
    }
  });

  it("tools/call cuts a successful result to the configured budget and leaves error results alone", async () => {
    const big = { members: Array.from({ length: 2000 }, (_, i) => ({ id: `m${i}` })) };
    const errText = "x".repeat(10_000);
    const s = await connect(
      [
        tool("bw_big", async () => jsonText(big)),
        tool("bw_fail", async () => ({
          content: [{ type: "text", text: errText }],
          isError: true,
        })),
      ],
      { maxResponseBytes: 5000 },
    );
    const ok = await s.call("bw_big", {});
    expect(ok.isError).toBe(false);
    expect(Buffer.byteLength(ok.text)).toBeLessThanOrEqual(5000);
    expect(JSON.parse(ok.text)).toHaveProperty("responseTruncated");
    const fail = await s.call("bw_fail", {});
    expect(fail.text).toBe(errText);
    await s.close();
  });

  it("tools/call uses the default budget when none is given", async () => {
    const small = { members: [{ id: "m1" }] };
    const s = await connect([tool("bw_small", async () => jsonText(small))]);
    expect((await s.call("bw_small", {})).text).toBe(JSON.stringify(small, null, 2));
    await s.close();
    const big = { members: Array.from({ length: 30_000 }, (_, i) => ({ id: `member-${i}` })) };
    expect(Buffer.byteLength(JSON.stringify(big, null, 2))).toBeGreaterThan(
      DEFAULT_MAX_RESPONSE_BYTES,
    );
    const d = await connect([tool("bw_big", async () => jsonText(big))]);
    const out = (await d.call("bw_big", {})).text;
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(DEFAULT_MAX_RESPONSE_BYTES);
    expect(JSON.parse(out)).toHaveProperty(
      "responseTruncated.limitBytes",
      DEFAULT_MAX_RESPONSE_BYTES,
    );
    await d.close();
  });
});
