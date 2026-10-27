import type { ToolAnnotations } from "../../types.js";

export const readOnly: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
};

export const destructive: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
};

export type Limits = { maxItems: number; maxPages: number };

export function requireString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Missing required string parameter "${key}".`);
  }
  return v;
}

export function requireInt(input: Record<string, unknown>, key: string): number {
  const v = input[key];
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new Error(`Missing required integer parameter "${key}".`);
  }
  return v;
}

export function requireOrgId(orgId: string | undefined): string {
  if (!orgId) throw new Error("orgId required — set BWS_ORG_ID in .env.");
  return orgId;
}

/**
 * Pick only the specified keys from an object. Used to build slim list
 * projections without removing keys through extra logic — we simply omit
 * the nested fields that inflate response sizes.
 */
export function pickFields<T extends Record<string, unknown>>(
  obj: T,
  keys: readonly string[],
): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    if (k in obj) (out as Record<string, unknown>)[k] = obj[k];
  }
  return out;
}

/**
 * After building a list response, check whether its JSON size exceeds the
 * configured limit. If it does, return a `note` string that warns the caller.
 * The response is returned as-is — we never truncate silently.
 *
 * Caveats:
 *  - Returns a `{note: string}` object meant to be spread into the response.
 *    Do NOT call on payloads that already carry their own top-level `note`
 *    field (e.g. `bws_project_list` uses one for "no project assignments") —
 *    the spread will silently overwrite it. Use a distinct field name in
 *    that case.
 *  - Size measurement is `JSON.stringify(payload).length`, which counts
 *    UTF-16 code units, not bytes. For payloads with multibyte characters
 *    (umlauts etc.) the real byte size is up to ~5–10% larger than reported.
 *    This is intentional — the field is a hint, not a hard limit.
 *
 * @param payload         The list payload object (members/collections/groups array etc.)
 * @param limitBytes      Maximum allowed JSON length (approx-bytes from config).
 * @param explicitInclude True when the caller opted in to nested fields via
 *                        the `include` parameter — the warning text differs.
 */
export function maybeNoteOversize(
  payload: object,
  limitBytes: number,
  explicitInclude: boolean,
): { note?: string } {
  const size = JSON.stringify(payload).length;
  if (size <= limitBytes) return {};
  const kb = Math.round(size / 1024);
  const hint = explicitInclude
    ? `Response is ~${kb} KB because explicit include was requested. Consider narrowing the include set or using detail endpoints instead.`
    : `Response is ~${kb} KB, which may exceed the LLM client's per-tool token budget. The current call used the slim default projection. If you encounter context issues, narrow the query (e.g. email_contains / name_contains, or a shorter start/end window for events).`;
  return { note: hint };
}
