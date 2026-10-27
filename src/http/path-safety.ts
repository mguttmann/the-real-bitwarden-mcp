// URL normalisation resolves "." and ".." segments (also percent-encoded,
// %2e in any case), so such a segment would move a request outside the
// intended path, e.g. out of the API base prefix. Encoded separators (%2F,
// %5C) can be decoded into segment boundaries by a proxy or the server.
// Both are rejected in bw_raw_request paths and in ids put into paths.

function isDotSegment(segment: string): boolean {
  const decoded = segment.replace(/%2e/gi, ".");
  return decoded === "." || decoded === "..";
}

const ENCODED_SEPARATOR = /%2f|%5c/i;
const REJECTED =
  "dot segments ('.', '..', also percent-encoded) and encoded separators (%2F, %5C) are not allowed";

/** Throws when the path part (before `?` or `#`) contains a dot segment or an encoded separator. */
export function assertSafePath(path: string): void {
  const pathPart = path.split(/[?#]/, 1)[0] ?? "";
  for (const segment of pathPart.split("/")) {
    if (isDotSegment(segment))
      throw new Error(`Path rejected: contains a dot segment; ${REJECTED}.`);
    if (ENCODED_SEPARATOR.test(segment)) {
      throw new Error(`Path rejected: contains an encoded separator; ${REJECTED}.`);
    }
  }
}

/** encodeURIComponent for an id put into a path, rejecting dot segments and separators. */
export function pathId(id: string): string {
  if (isDotSegment(id)) throw new Error(`Invalid id: a dot segment cannot be used as an id.`);
  if (/[/\\]/.test(id) || ENCODED_SEPARATOR.test(id)) {
    throw new Error(`Invalid id: an id cannot contain a path separator.`);
  }
  return encodeURIComponent(id);
}
