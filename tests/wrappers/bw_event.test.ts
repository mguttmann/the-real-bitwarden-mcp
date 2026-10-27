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

describe("bw_event_query continuationToken (added in 0.3.0)", () => {
  it("resumes from the given token: the first request carries it, later pages follow", async () => {
    const seen: (string | undefined)[] = [];
    const pages: Record<string, unknown> = {
      "FAKE-TOKEN-2": { data: [{ type: 2 }], continuationToken: "FAKE-TOKEN-3" },
      "FAKE-TOKEN-3": { data: [{ type: 3 }] },
    };
    const client = stubClient((_m, p, o) => {
      expect(p).toBe("/public/events");
      seen.push(o.query.continuationToken);
      return { status: 200, headers: new Headers(), body: pages[o.query.continuationToken] };
    });
    const res = await makeEventQueryTool(client as any, limits).handler({
      start: "2026-01-01T00:00:00Z",
      end: "2026-01-02T00:00:00Z",
      continuationToken: "FAKE-TOKEN-2",
    });
    expect(seen).toEqual(["FAKE-TOKEN-2", "FAKE-TOKEN-3"]);
    const parsed = JSON.parse(textOf(res));
    expect(parsed.events).toEqual([{ type: 2 }, { type: 3 }]);
    expect(parsed.continuationToken).toBeNull();
  });

  it("a token returned after a maxPages stop resumes exactly where the list stopped", async () => {
    const all: Record<string, { data: { type: number }[]; continuationToken?: string }> = {
      first: { data: [{ type: 1 }], continuationToken: "FAKE-TOKEN-2" },
      "FAKE-TOKEN-2": { data: [{ type: 2 }], continuationToken: "FAKE-TOKEN-3" },
      "FAKE-TOKEN-3": { data: [{ type: 3 }] },
    };
    const client = stubClient((_m, _p, o) => ({
      status: 200,
      headers: new Headers(),
      body: all[o.query.continuationToken ?? "first"],
    }));
    const tool = makeEventQueryTool(client as any, { maxItems: 1000, maxPages: 1 });
    const window = { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" };
    const first = JSON.parse(textOf(await tool.handler(window)));
    expect(first).toMatchObject({ truncated: true, continuationToken: "FAKE-TOKEN-2" });
    const second = JSON.parse(
      textOf(await tool.handler({ ...window, continuationToken: first.continuationToken })),
    );
    expect(second.events).toEqual([{ type: 2 }]);
    expect(second.continuationToken).toBe("FAKE-TOKEN-3");
  });

  it("continuationToken is an optional string input", () => {
    const schema = makeEventQueryTool(stubClient(() => ({})) as any, limits).inputSchema as any;
    expect(schema.required).toBeUndefined();
    expect(schema.properties.continuationToken).toMatchObject({ type: "string" });
  });
});

describe("bw_event_query limit (added in 0.3.1)", () => {
  const window = { start: "2026-01-01T00:00:00Z", end: "2026-01-01T02:00:00Z" };
  // Three upstream pages of three events each.
  const pages: Record<string, { data: { type: number }[]; continuationToken?: string }> = {
    first: { data: [{ type: 1 }, { type: 2 }, { type: 3 }], continuationToken: "FAKE-TOKEN-2" },
    "FAKE-TOKEN-2": {
      data: [{ type: 4 }, { type: 5 }, { type: 6 }],
      continuationToken: "FAKE-TOKEN-3",
    },
    "FAKE-TOKEN-3": { data: [{ type: 7 }, { type: 8 }, { type: 9 }] },
  };
  function pagedClient() {
    return stubClient((_m, _p, o) => ({
      status: 200,
      headers: new Headers(),
      body: pages[o.query.continuationToken ?? "first"],
    }));
  }
  const types = (r: { events: { type: number }[] }) => r.events.map((e) => e.type);

  it("stops paging at a page boundary and returns the next page's token", async () => {
    const client = pagedClient();
    const res = JSON.parse(
      textOf(await makeEventQueryTool(client as any, limits).handler({ ...window, limit: 3 })),
    );
    expect(types(res)).toEqual([1, 2, 3]);
    expect(res).toMatchObject({ truncated: true, continuationToken: "FAKE-TOKEN-2" });
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("a limit inside a page returns a token that resumes after the last returned event", async () => {
    const client = pagedClient();
    const tool = makeEventQueryTool(client as any, limits);
    const seen: number[] = [];
    let token: string | undefined;
    let calls = 0;
    do {
      const res = JSON.parse(
        textOf(
          await tool.handler({
            ...window,
            limit: 2,
            ...(token !== undefined ? { continuationToken: token } : {}),
          }),
        ),
      );
      expect(res.events.length).toBeLessThanOrEqual(2);
      seen.push(...types(res));
      token = res.continuationToken ?? undefined;
      calls++;
    } while (token !== undefined && calls < 10);
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("the first call with a limit inside the first page stops after one request", async () => {
    const client = pagedClient();
    const res = JSON.parse(
      textOf(await makeEventQueryTool(client as any, limits).handler({ ...window, limit: 2 })),
    );
    expect(types(res)).toEqual([1, 2]);
    expect(res.truncated).toBe(true);
    expect(typeof res.continuationToken).toBe("string");
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it("a limit that covers everything returns all events without a token", async () => {
    const client = pagedClient();
    const res = JSON.parse(
      textOf(await makeEventQueryTool(client as any, limits).handler({ ...window, limit: 50 })),
    );
    expect(types(res)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(res).toMatchObject({ truncated: false, continuationToken: null });
  });

  it("a limit above PAGINATION_MAX_ITEMS is capped at it", async () => {
    const client = pagedClient();
    const res = JSON.parse(
      textOf(
        await makeEventQueryTool(client as any, { maxItems: 3, maxPages: 20 }).handler({
          ...window,
          limit: 100,
        }),
      ),
    );
    expect(types(res)).toEqual([1, 2, 3]);
    expect(res).toMatchObject({ truncated: true, continuationToken: "FAKE-TOKEN-2" });
  });

  it("without limit the current behaviour is kept", async () => {
    const client = pagedClient();
    const res = JSON.parse(textOf(await makeEventQueryTool(client as any, limits).handler(window)));
    expect(types(res)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(res).toMatchObject({ truncated: false, continuationToken: null });
    expect(client.request).toHaveBeenCalledTimes(3);
  });

  for (const bad of [0, -1, 1.5, "5", null]) {
    it(`limit ${JSON.stringify(bad)} is an error before any request`, async () => {
      const client = pagedClient();
      const res = await makeEventQueryTool(client as any, limits).handler({
        ...window,
        limit: bad,
      });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/limit/);
      expect(client.request).not.toHaveBeenCalled();
    });
  }

  it("limit is an optional integer input with minimum 1", () => {
    const schema = makeEventQueryTool(stubClient(() => ({})) as any, limits).inputSchema as any;
    expect(schema.required).toBeUndefined();
    expect(schema.properties.limit).toMatchObject({ type: "integer", minimum: 1 });
  });
});
