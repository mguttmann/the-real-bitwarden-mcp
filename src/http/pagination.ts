import type { HttpMethod, HttpResponse, RequestOptions } from "./bitwarden-http-client.js";

export type PageBody<T> = {
  data?: T[];
  continuationToken?: string | null;
};

export type FetchAllOptions = {
  maxItems: number;
  maxPages: number;
};

export type FetchAllResult<T> = {
  items: T[];
  truncated: boolean;
  continuationToken?: string;
};

type RequestFn = <T = unknown>(
  method: HttpMethod,
  path: string,
  options?: RequestOptions,
) => Promise<HttpResponse<T>>;

export async function fetchAllPages<T>(
  request: RequestFn,
  method: HttpMethod,
  path: string,
  query: Record<string, string | number | boolean | undefined | null>,
  opts: FetchAllOptions,
): Promise<FetchAllResult<T>> {
  const items: T[] = [];
  let continuationToken: string | undefined;
  let pageCount = 0;
  let truncated = false;

  while (true) {
    const q: Record<string, string | number | boolean | undefined | null> = { ...query };
    if (continuationToken) q.continuationToken = continuationToken;
    const res = await request<PageBody<T>>(method, path, { query: q });
    pageCount++;
    const body = res.body ?? {};
    const pageItems = body.data ?? [];

    for (const item of pageItems) {
      if (items.length >= opts.maxItems) {
        truncated = true;
        break;
      }
      items.push(item);
    }

    if (truncated) break;
    if (!body.continuationToken) break;
    if (pageCount >= opts.maxPages) {
      truncated = true;
      continuationToken = body.continuationToken;
      break;
    }
    continuationToken = body.continuationToken;
  }

  if (truncated && continuationToken) {
    return { items, truncated, continuationToken };
  }
  return { items, truncated };
}
