import type { ToolDef } from "../../types.js";
import type { BitwardenHttpClient } from "../../http/bitwarden-http-client.js";
import { fetchAllPages } from "../../http/pagination.js";
import { asToolError, jsonResult } from "../_error.js";
import { readOnly, maybeNoteOversize, type Limits } from "./_helpers.js";

type Event = { type: number; [k: string]: unknown };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function makeEventQueryTool(
  client: BitwardenHttpClient,
  limits: Limits,
  maxResponseBytes: number = 60_000,
): ToolDef {
  return {
    name: "bw_event_query",
    description:
      "Query the organization event log with optional filters (self-host). " +
      "Defaults to the last 24 hours when no start/end are provided. " +
      "Querying wider windows may produce very large responses. " +
      "Use at most one of actingUserId / itemId (the API applies only one filter). " +
      "ipAddress is not a filter of the Bitwarden Public API and is rejected; each returned " +
      "event carries its own ipAddress field. " +
      "Auto-paginates with continuationToken. When a result is truncated with a " +
      "continuationToken, call again with the same start/end/filters and that " +
      "continuationToken to get the next events.",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", description: "ISO 8601, inclusive. Defaults to 24 h ago." },
        end: { type: "string", description: "ISO 8601, inclusive. Defaults to now." },
        actingUserId: { type: "string" },
        itemId: { type: "string" },
        ipAddress: {
          type: "string",
          description: "Not supported by the Public API: passing it returns an error.",
        },
        continuationToken: {
          type: "string",
          description:
            "Resume a truncated result: the continuationToken it returned. Pass the same " +
            "start, end and filters as that call.",
        },
      },
      additionalProperties: false,
    },
    annotations: readOnly,
    handler: async (input) => {
      try {
        if (input.ipAddress !== undefined) {
          throw new Error(
            "ipAddress is not a filter of the Bitwarden Public API (it would be ignored and all " +
              "events in the window returned). Query without it and check the ipAddress field " +
              "of the returned events.",
          );
        }
        if (input.actingUserId !== undefined && input.itemId !== undefined) {
          throw new Error(
            "Pass either actingUserId or itemId, not both: the Bitwarden Public API applies only " +
              "one of them (actingUserId wins) and would silently ignore itemId.",
          );
        }
        const now = new Date();
        const defaultStart = new Date(now.getTime() - MS_PER_DAY);

        const rawStart = typeof input.start === "string" ? input.start : undefined;
        const rawEnd = typeof input.end === "string" ? input.end : undefined;

        // Apply defaults when not provided
        const effectiveStart = rawStart ?? defaultStart.toISOString();
        const effectiveEnd = rawEnd ?? now.toISOString();

        const query: Record<string, string | number | boolean | undefined | null> = {
          start: effectiveStart,
          end: effectiveEnd,
        };
        for (const k of ["actingUserId", "itemId"]) {
          if (typeof input[k] === "string") query[k] = input[k] as string;
        }

        // Check whether the caller requested a window wider than 24h
        const startMs = new Date(effectiveStart).getTime();
        const endMs = new Date(effectiveEnd).getTime();
        const wideWindow = !isNaN(startMs) && !isNaN(endMs) && endMs - startMs > MS_PER_DAY;

        const page = await fetchAllPages<Event>(
          client.request.bind(client),
          "GET",
          "/public/events",
          query,
          {
            ...limits,
            ...(typeof input.continuationToken === "string"
              ? { startToken: input.continuationToken }
              : {}),
          },
        );

        const payload = {
          events: page.items,
          truncated: page.truncated,
          continuationToken: page.continuationToken ?? null,
        };

        const oversize = maybeNoteOversize(payload, maxResponseBytes, false);

        // Compose notes: wide-window warning takes precedence; oversize note is appended if also triggered
        let note: string | undefined;
        if (wideWindow) {
          note = "Querying a > 24h window - response size may be large.";
          if (oversize.note) note += " " + oversize.note;
        } else if (oversize.note) {
          note = oversize.note;
        }

        return jsonResult({ ...payload, ...(note !== undefined ? { note } : {}) });
      } catch (err) {
        return asToolError(err);
      }
    },
  };
}
