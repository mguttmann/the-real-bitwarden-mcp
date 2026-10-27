import pino, { type Logger, type LoggerOptions, type DestinationStream } from "pino";
import type { LogLevel } from "./config.js";
import { redactForLog, scrubString } from "./redact.js";

// Every log object goes through redactForLog (src/redact.ts), the same
// mechanism that scrubs error texts returned to the MCP client: sensitive
// keys are removed at any depth (also in arrays, error details, cause chains
// and AggregateError children), messages are scrubbed of secret-shaped
// substrings, and stacks are dropped (frames can capture token literals).
export function createLogger(level: LogLevel, dest?: DestinationStream): Logger {
  const opts: LoggerOptions = {
    level,
    formatters: { log: (obj) => redactForLog(obj) as Record<string, unknown> },
    serializers: {
      err: (err: unknown) => redactForLog(err),
      // pino takes `msg` from err.message when no message is given.
      msg: (msg: unknown) => (typeof msg === "string" ? scrubString(msg) : msg),
    },
  };
  return pino(opts, dest ?? pino.destination(2));
}
