import type { HttpMethod, HttpResponse, RequestOptions } from "./bitwarden-http-client.js";

type PageBody<T> = {
  data?: T[];
  continuationToken?: string | null;
};

type FetchAllOptions = {
  maxItems: number;
  maxPages: number;
};

type FetchAllResult<T> = {
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

    // A stop inside a page has no resume point: the token that fetched this
    // page would repeat it, so none is returned.
    if (truncated) {
      continuationToken = undefined;
      break;
    }
    if (!body.continuationToken) break;
    // A page that ends exactly at maxItems (or the last allowed page) stops
    // here, so the next page's token is a clean resume point.
    if (pageCount >= opts.maxPages || items.length >= opts.maxItems) {
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
