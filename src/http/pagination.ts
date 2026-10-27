import type { HttpMethod, HttpResponse, RequestOptions } from "./bitwarden-http-client.js";

type PageBody<T> = {
  data?: T[];
  continuationToken?: string | null;
};

type FetchAllOptions = {
  maxItems: number;
  maxPages: number;
  /** Token of a previous truncated result; the first request resumes there. */
  startToken?: string;
  /** Items of the first page to skip (they were returned by the previous call). */
  startSkip?: number;
};

type FetchAllResult<T> = {
  items: T[];
  truncated: boolean;
  continuationToken?: string;
  /**
   * Set when the stop fell inside a page: the token that fetched that page
   * (undefined for the first page of the query) and how many of its items
   * were returned, so a caller that can repeat the page may resume there.
   */
  resumeInPage?: { token: string | undefined; skip: number };
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
  let continuationToken: string | undefined = opts.startToken || undefined;
  let pageCount = 0;
  let truncated = false;
  let skip = opts.startSkip ?? 0;
  let resumeInPage: { token: string | undefined; skip: number } | undefined;

  while (true) {
    const pageToken = continuationToken;
    const q: Record<string, string | number | boolean | undefined | null> = { ...query };
    if (continuationToken) q.continuationToken = continuationToken;
    const res = await request<PageBody<T>>(method, path, { query: q });
    pageCount++;
    const body = res.body ?? {};
    const pageItems = body.data ?? [];
    const pageSkip = skip;
    skip = 0;

    for (let i = pageSkip; i < pageItems.length; i++) {
      if (items.length >= opts.maxItems) {
        truncated = true;
        resumeInPage = { token: pageToken, skip: i };
        break;
      }
      items.push(pageItems[i] as T);
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
  return { items, truncated, ...(resumeInPage ? { resumeInPage } : {}) };
}
