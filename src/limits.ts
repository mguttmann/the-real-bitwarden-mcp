// Size and rate limits of the server, in one place. README ("Limits")
// names these values; tests/docs-numbers.test.ts holds the docs to them.

/** Default of BW_MCP_MAX_RESPONSE_BYTES: successful tool output above this is cut. */
export const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

/** A string anywhere in a tool input longer than this (UTF-8 bytes) is rejected. */
export const MAX_INPUT_STRING_BYTES = 100 * 1024;

/** An array anywhere in a tool input with more items than this is rejected. */
export const MAX_INPUT_ARRAY_ITEMS = 10_000;

/** Consecutive failed token requests of one client that start a pause. */
export const TOKEN_BACKOFF_FAILURES = 3;

/** Length of that pause; calls during it fail without a token request. */
export const TOKEN_BACKOFF_MS = 30_000;

/**
 * A Secrets Manager SDK login that is still running is shared by later
 * calls for up to this many HTTP_TIMEOUT_MS from its start; after that the
 * next call gives it up and starts a new login.
 */
export const SM_LOGIN_REUSE_TIMEOUTS = 2;

type JsonPath = (string | number)[];

function pathText(path: JsonPath): string {
  if (path.length === 0) return "input";
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${part}` : part;
  }
  return out;
}

/**
 * The first part of a tool input over a limit, as an error text that names
 * the parameter path and the size but never the value. Undefined when the
 * input is within the limits.
 */
export function inputBoundsViolation(input: unknown): string | undefined {
  const stack: { value: unknown; path: JsonPath }[] = [{ value: input, path: [] }];
  for (let next = stack.pop(); next; next = stack.pop()) {
    const { value, path } = next;
    if (typeof value === "string") {
      // A UTF-8 byte is at least one UTF-16 unit and at most three per unit.
      if (value.length * 3 <= MAX_INPUT_STRING_BYTES) continue;
      const bytes = Buffer.byteLength(value, "utf8");
      if (bytes > MAX_INPUT_STRING_BYTES) {
        return (
          `Input rejected, nothing was sent: "${pathText(path)}" is a string of ${bytes} bytes; ` +
          `the limit is ${MAX_INPUT_STRING_BYTES} bytes per string.`
        );
      }
    } else if (Array.isArray(value)) {
      if (value.length > MAX_INPUT_ARRAY_ITEMS) {
        return (
          `Input rejected, nothing was sent: "${pathText(path)}" has ${value.length} items; ` +
          `the limit is ${MAX_INPUT_ARRAY_ITEMS} items per array. Split the call into smaller batches.`
        );
      }
      for (let i = value.length - 1; i >= 0; i--)
        stack.push({ value: value[i], path: [...path, i] });
    } else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (Buffer.byteLength(key, "utf8") > MAX_INPUT_STRING_BYTES) {
          return (
            `Input rejected, nothing was sent: an object key under "${pathText(path)}" is longer ` +
            `than ${MAX_INPUT_STRING_BYTES} bytes.`
          );
        }
        stack.push({ value: child, path: [...path, key] });
      }
    }
  }
  return undefined;
}

const CUT_HINT =
  "The result was larger than the response budget (BW_MCP_MAX_RESPONSE_BYTES) and was cut. " +
  "Narrow the query (filters such as email_contains or name_contains, a shorter start/end " +
  "window for events, fewer include fields), lower PAGINATION_MAX_ITEMS to page in smaller " +
  "steps, or use a detail tool for single items.";

type Marker = {
  originalBytes: number;
  limitBytes: number;
  hint: string;
  cutArray?: string;
  keptItems?: number;
  totalItems?: number;
  continuationTokenRemoved?: true;
};

type ArraySlot = { holder: Record<string, unknown> | undefined; key: string; items: unknown[] };

const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const render = (value: unknown) => JSON.stringify(value, null, 2);

/** The largest array at the root, in a root property, or one level below. */
function largestArray(root: unknown): ArraySlot | undefined {
  if (Array.isArray(root)) return { holder: undefined, key: "", items: root };
  if (root === null || typeof root !== "object") return undefined;
  let best: ArraySlot | undefined;
  let bestSize = -1;
  const consider = (holder: Record<string, unknown>, key: string, prefix: string) => {
    const v = holder[key];
    if (!Array.isArray(v)) return;
    const size = bytes(JSON.stringify(v));
    if (size > bestSize) {
      best = { holder, key: prefix + key, items: v };
      bestSize = size;
    }
  };
  const top = root as Record<string, unknown>;
  for (const key of Object.keys(top)) {
    consider(top, key, "");
    const child = top[key];
    if (child !== null && typeof child === "object" && !Array.isArray(child)) {
      for (const sub of Object.keys(child))
        consider(child as Record<string, unknown>, sub, `${key}.`);
    }
  }
  return best;
}

function lastKey(path: string): string {
  return path.slice(path.lastIndexOf(".") + 1);
}

/** The `responseTruncated` marker alone, for output with no list to keep a part of. */
export function truncatedMarkerText(originalBytes: number, limitBytes: number): string {
  return render({ responseTruncated: { originalBytes, limitBytes, hint: CUT_HINT } });
}

/**
 * Cut a successful tool output text to at most `limitBytes` UTF-8 bytes.
 * The result is always valid JSON: a JSON output keeps its leading items of
 * its largest array plus a `responseTruncated` marker; anything else is
 * replaced by the marker alone. A continuationToken next to a cut array is
 * removed, because it would resume after the items that were cut.
 */
export function cutOversizeText(text: string, limitBytes: number): string {
  const originalBytes = bytes(text);
  if (originalBytes <= limitBytes) return text;
  const marker: Marker = { originalBytes, limitBytes, hint: CUT_HINT };
  const markerOnly = truncatedMarkerText(originalBytes, limitBytes);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return markerOnly;
  }
  const slot = largestArray(parsed);
  if (!slot) return markerOnly;

  const full = slot.items;
  const tokenHolder = slot.holder;
  const hadToken = tokenHolder !== undefined && "continuationToken" in tokenHolder;
  const savedToken = hadToken ? tokenHolder.continuationToken : undefined;
  const key = lastKey(slot.key);

  const build = (keep: number): string => {
    const items = full.slice(0, keep);
    const m: Marker = {
      ...marker,
      cutArray: slot.key || "(root)",
      keptItems: keep,
      totalItems: full.length,
      ...(hadToken ? { continuationTokenRemoved: true as const } : {}),
    };
    if (!tokenHolder) return render({ responseTruncated: m, items });
    tokenHolder[key] = items;
    if (hadToken) delete tokenHolder.continuationToken;
    const out = render({ responseTruncated: m, ...(parsed as Record<string, unknown>) });
    tokenHolder[key] = full;
    if (hadToken) tokenHolder.continuationToken = savedToken;
    return out;
  };

  if (bytes(build(0)) > limitBytes) return markerOnly;
  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (bytes(build(mid)) <= limitBytes) lo = mid;
    else hi = mid - 1;
  }
  return build(lo);
}
