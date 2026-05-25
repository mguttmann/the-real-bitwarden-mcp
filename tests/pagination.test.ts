import { describe, it, expect, vi } from "vitest";
import { fetchAllPages } from "../src/http/pagination.js";

describe("fetchAllPages", () => {
  it("returns single page when no continuationToken", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      headers: new Headers(),
      body: { data: [{ id: 1 }, { id: 2 }] },
    }));
    const res = await fetchAllPages<{ id: number }>(
      request as any,
      "GET",
      "/public/members",
      {},
      { maxItems: 100, maxPages: 10 },
    );
    expect(res.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(res.truncated).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("walks continuationToken pages", async () => {
    const pages: any[] = [
      { data: [{ id: 1 }], continuationToken: "p2" },
      { data: [{ id: 2 }], continuationToken: "p3" },
      { data: [{ id: 3 }] },
    ];
    let i = 0;
    const request = vi.fn(async (_m: string, _p: string, opts?: any) => {
      if (i > 0) {
        expect(opts.query.continuationToken).toBe(`p${i + 1}`);
      }
      const body = pages[i++];
      return { status: 200, headers: new Headers(), body };
    });
    const res = await fetchAllPages<{ id: number }>(
      request as any, "GET", "/public/events", {},
      { maxItems: 100, maxPages: 10 },
    );
    expect(res.items.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(res.truncated).toBe(false);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("truncates at maxItems", async () => {
    const request = vi.fn(async () => ({
      status: 200, headers: new Headers(),
      body: { data: [{ id: 1 }, { id: 2 }, { id: 3 }], continuationToken: "more" },
    }));
    const res = await fetchAllPages<{ id: number }>(
      request as any, "GET", "/x", {},
      { maxItems: 2, maxPages: 10 },
    );
    expect(res.items).toHaveLength(2);
    expect(res.truncated).toBe(true);
  });

  it("truncates at maxPages", async () => {
    const request = vi.fn(async () => ({
      status: 200, headers: new Headers(),
      body: { data: [{ id: 1 }], continuationToken: "next" },
    }));
    const res = await fetchAllPages<{ id: number }>(
      request as any, "GET", "/x", {},
      { maxItems: 100, maxPages: 3 },
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(res.truncated).toBe(true);
  });

  it("passes through user-supplied query params", async () => {
    const request = vi.fn(async (_m: string, _p: string, opts?: any) => {
      expect(opts.query.start).toBe("2026-01-01");
      return { status: 200, headers: new Headers(), body: { data: [] } };
    });
    await fetchAllPages(
      request as any, "GET", "/public/events", { start: "2026-01-01" },
      { maxItems: 100, maxPages: 10 },
    );
  });
});
