// tests/live-smoke.test.ts
// Skipped unless RUN_LIVE_TESTS=1. Performs READ-ONLY calls against the
// real configured Bitwarden instance(s). Never invokes any destructive tool.
import { describe, it, expect, beforeAll } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildClients, buildRegistry } from "../src/index.js";
import { ToolRegistry } from "../src/tools/registry.js";

const live = process.env.RUN_LIVE_TESTS === "1";
const d = live ? describe : describe.skip;

d("live smoke", () => {
  let reg: ToolRegistry;
  beforeAll(() => {
    const cfg = loadConfig();
    reg = buildRegistry(cfg, buildClients(cfg));
  });

  it("self-host: bw_member_list returns a list and does not leak Bearer tokens", async () => {
    const tool = reg.getByName("bw_member_list");
    if (!tool) return; // skip if selfhost not configured
    const res = await tool.handler({});
    expect(res.isError).toBeFalsy();
    const text = res.content[0]!.text as string;
    expect(text).toMatch(/"members"/);
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9._-]+/);
  });

  it("self-host: bw_raw_request GET passes the confirm gate", async () => {
    const tool = reg.getByName("bw_raw_request");
    if (!tool) return;
    const res = await tool.handler({ method: "GET", path: "/public/collections" });
    expect(res.isError).toBeFalsy();
  });

  it("cloud: bw_license_subscription_get returns plan metadata", async () => {
    const tool = reg.getByName("bw_license_subscription_get");
    if (!tool) return;
    const res = await tool.handler({});
    expect(res.isError).toBeFalsy();
  });

  it("sm: bws_project_list returns data (skipped if BWS_ACCESS_TOKEN unset)", async () => {
    if (!process.env.BWS_ACCESS_TOKEN) return;
    const tool = reg.getByName("bws_project_list");
    if (!tool) return;
    const res = await tool.handler({});
    expect(res.isError).toBeFalsy();
  });
});
