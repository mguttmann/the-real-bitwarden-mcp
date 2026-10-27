import { describe, it, expect, vi } from "vitest";
import { makeEventQueryTool } from "../../src/tools/wrappers/bw_event.js";
import { textOf } from "../helpers.js";

function stubClient(handler: (m: string, p: string, opts?: any) => any) {
  return { request: vi.fn(async (m: string, p: string, opts?: any) => handler(m, p, opts)) };
}
const limits = { maxItems: 1000, maxPages: 20 };

describe("bw_event_query", () => {
  it("passes through filter params", async () => {
    const client = stubClient((_m, _p, o) => {
      expect(o.query.start).toBe("2026-01-01");
      expect(o.query.actingUserId).toBe("u1");
      return { status: 200, headers: new Headers(), body: { data: [{ type: 1000 }] } };
    });
    await makeEventQueryTool(client as any, limits).handler({
      start: "2026-01-01",
      actingUserId: "u1",
    });
    expect(client.request).toHaveBeenCalled();
  });

  it("auto-paginates", async () => {
    const pages = [{ data: [{ type: 1 }], continuationToken: "p2" }, { data: [{ type: 2 }] }];
    let i = 0;
    const client = stubClient(() => ({ status: 200, headers: new Headers(), body: pages[i++] }));
    const res = await makeEventQueryTool(client as any, limits).handler({});
    const parsed = JSON.parse(textOf(res));
    expect(parsed.events).toHaveLength(2);
  });

  it("defaults to a 24h window when no start/end provided", async () => {
    const captured: { start: string; end: string }[] = [];
    const before = Date.now();
    const client = stubClient((_m, _p, o) => {
      captured.push({ start: o.query.start, end: o.query.end });
      return { status: 200, headers: new Headers(), body: { data: [] } };
    });
    await makeEventQueryTool(client as any, limits).handler({});
    const after = Date.now();

    expect(captured).toHaveLength(1);
    const startMs = new Date(captured[0]!.start).getTime();
    const endMs = new Date(captured[0]!.end).getTime();

    // Both values must be valid dates
    expect(isNaN(startMs)).toBe(false);
    expect(isNaN(endMs)).toBe(false);

    // Window must be approximately 24h (allow small clock tolerance)
    const windowMs = endMs - startMs;
    const oneDayMs = 24 * 60 * 60 * 1000;
    expect(windowMs).toBeGreaterThanOrEqual(oneDayMs - 1000);
    expect(windowMs).toBeLessThanOrEqual(oneDayMs + 1000);

    // end must be around "now"
    expect(endMs).toBeGreaterThanOrEqual(before);
    expect(endMs).toBeLessThanOrEqual(after + 100);
  });

  it("injects note when querying a > 24h window", async () => {
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: { data: [{ type: 1 }] },
    }));
    // Provide a 7-day window explicitly
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date().toISOString();
    const res = await makeEventQueryTool(client as any, limits).handler({ start, end });
    const parsed = JSON.parse(textOf(res));
    expect(parsed.note).toBeDefined();
    expect(parsed.note).toMatch(/> 24h window/);
  });

  it("does not set note for a ≤ 24h window", async () => {
    const client = stubClient(() => ({
      status: 200,
      headers: new Headers(),
      body: { data: [{ type: 1 }] },
    }));
    const start = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const end = new Date().toISOString();
    const res = await makeEventQueryTool(client as any, limits).handler({ start, end });
    const parsed = JSON.parse(textOf(res));
    expect(parsed.note).toBeUndefined();
  });
});

describe("bw_event_query unsupported filters", () => {
  it("ipAddress is rejected instead of returning unfiltered events", async () => {
    const client = stubClient(() => ({ status: 200, headers: new Headers(), body: { data: [] } }));
    const res = await makeEventQueryTool(client as any, limits).handler({
      ipAddress: "203.0.113.7",
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/ipAddress/);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("actingUserId together with itemId is rejected (the API applies only one)", async () => {
    const client = stubClient(() => ({ status: 200, headers: new Headers(), body: { data: [] } }));
    const res = await makeEventQueryTool(client as any, limits).handler({
      actingUserId: "u1",
      itemId: "i1",
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/actingUserId.*itemId|itemId.*actingUserId/);
    expect(client.request).not.toHaveBeenCalled();
  });
});
