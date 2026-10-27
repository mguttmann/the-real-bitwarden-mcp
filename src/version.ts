import { readFileSync } from "node:fs";

/**
 * Package version from package.json, the single place it is maintained.
 * Both src/ (dev, tests) and dist/ (build, npm install) sit next to it.
 */
export const SERVER_VERSION: string = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;
