import type { ToolResult } from "../src/types.js";

/** Text of the first content item; fails the test if it is not a text item. */
export function textOf(res: ToolResult): string {
  const first = res.content[0];
  if (first?.type !== "text") throw new Error(`expected text content, got ${first?.type}`);
  return first.text;
}

export type RecordedCall = { method: string; path: string; body?: unknown };

/**
 * Stand-in for BitwardenHttpClient that answers from a route table keyed by
 * "METHOD /path" and records every request. Unknown routes fail the test.
 */
export function fakeApi(routes: Record<string, unknown>) {
  const calls: RecordedCall[] = [];
  const client = {
    request: async (method: string, path: string, opts?: { body?: unknown }) => {
      calls.push({ method, path, ...(opts?.body !== undefined ? { body: opts.body } : {}) });
      const key = `${method} ${path}`;
      if (!(key in routes)) throw new Error(`unexpected request ${key}`);
      const route = routes[key];
      const body =
        typeof route === "function" ? (route as (reqBody: unknown) => unknown)(opts?.body) : route;
      return { status: 200, headers: new Headers(), body };
    },
  };
  return { client: client as never, calls };
}
