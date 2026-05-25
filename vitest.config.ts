import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: process.env.RUN_LIVE_TESTS ? [] : ["tests/live-smoke.test.ts"],
  },
});
