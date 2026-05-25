import pino, { type Logger, type LoggerOptions, type DestinationStream } from "pino";
import type { LogLevel } from "./config.js";

const REDACT_PATHS = [
  "headers.authorization",
  "*.authorization",
  "*.Authorization",
  "client_secret",
  "*.client_secret",
  "BWS_ACCESS_TOKEN",
  "*.BWS_ACCESS_TOKEN",
  "access_token",
  "*.access_token",
  "value", // SM secret values
  "*.value",
];

export function createLogger(level: LogLevel, dest?: DestinationStream): Logger {
  const opts: LoggerOptions = {
    level,
    redact: { paths: REDACT_PATHS, remove: true },
  };
  return pino(opts, dest ?? pino.destination(2));
}
