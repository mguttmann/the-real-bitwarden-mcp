import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { BitwardenHttpClient } from "../../src/http/bitwarden-http-client.js";
import {
  makeLicenseSubscriptionGetTool,
  makeLicenseSeatsUpdateTool,
  makeLicenseStorageUpdateTool,
  makeLicenseSmSeatsUpdateTool,
  makeLicenseSmServiceAccountsUpdateTool,
} from "../../src/tools/wrappers/bw_license.js";
import { withConfirmGuard } from "../../src/tools/confirm.js";
import { fakeApi, textOf } from "../helpers.js";

function stubClient(handler: (m: string, p: string, opts?: any) => any) {
  return { request: vi.fn(async (m: string, p: string, opts?: any) => handler(m, p, opts)) };
}

describe("bw_license_*", () => {
  it("subscription_get GETs /public/organization/subscription", async () => {
    const client = stubClient((_m, p) => {
      expect(p).toBe("/public/organization/subscription");
      return { status: 200, headers: new Headers(), body: { seats: { purchased: 50, used: 32 } } };
    });
    const res = await makeLicenseSubscriptionGetTool(client as any).handler({});
    expect(textOf(res)).toContain("purchased");
  });

  it("seats/storage tools are destructive", () => {
    const s = makeLicenseSeatsUpdateTool({ request: vi.fn() } as any);
    const t = makeLicenseStorageUpdateTool({ request: vi.fn() } as any);
    expect(s.annotations.destructiveHint).toBe(true);
    expect(t.annotations.destructiveHint).toBe(true);
  });

  it("sm_seats/sm_service_accounts tools are destructive", () => {
    const s = makeLicenseSmSeatsUpdateTool({ request: vi.fn() } as any);
    const t = makeLicenseSmServiceAccountsUpdateTool({ request: vi.fn() } as any);
    expect(s.annotations.destructiveHint).toBe(true);
    expect(t.annotations.destructiveHint).toBe(true);
  });
});

// The cloud endpoint takes absolute totals (passwordManager.seats / .storage,
// secretsManager.seats / .serviceAccounts); unknown fields are dropped and the
// call still answers 200. The tools keep their delta inputs and send
// current + delta, then read the subscription back.
type Sub = {
  passwordManager: {
    seats: number | null;
    maxAutoScaleSeats: number | null;
    storage: number | null;
  };
  secretsManager: {
    seats: number | null;
    maxAutoScaleSeats: number | null;
    serviceAccounts: number | null;
    maxAutoScaleServiceAccounts: number | null;
  };
};

function subscriptionApi(initial: Sub, opts: { applyPut?: boolean } = {}) {
  let state: Sub = structuredClone(initial);
  return fakeApi({
    "GET /public/organization/subscription": () => structuredClone(state),
    "PUT /public/organization/subscription": (body: unknown) => {
      if (opts.applyPut !== false) {
        const b = body as { passwordManager?: object; secretsManager?: object };
        state = {
          passwordManager: { ...state.passwordManager, ...b.passwordManager },
          secretsManager: { ...state.secretsManager, ...b.secretsManager },
        };
      }
      return { message: "Subscription updated successfully." };
    },
  });
}

const baseSub: Sub = {
  passwordManager: { seats: 10, maxAutoScaleSeats: null, storage: 5 },
  secretsManager: {
    seats: 4,
    maxAutoScaleSeats: null,
    serviceAccounts: 50,
    maxAutoScaleServiceAccounts: null,
  },
};

const cases = [
  {
    name: "bw_license_seats_update",
    make: makeLicenseSeatsUpdateTool,
    param: "seatAdjustment",
    delta: 5,
    body: { passwordManager: { seats: 15 } },
    before: 10,
    after: 15,
  },
  {
    name: "bw_license_storage_update",
    make: makeLicenseStorageUpdateTool,
    param: "storageGbAdjustment",
    delta: 2,
    body: { passwordManager: { storage: 7 } },
    before: 5,
    after: 7,
  },
  {
    name: "bw_license_sm_seats_update",
    make: makeLicenseSmSeatsUpdateTool,
    param: "seatAdjustment",
    delta: -1,
    body: { secretsManager: { seats: 3 } },
    before: 4,
    after: 3,
  },
  {
    name: "bw_license_sm_service_accounts_update",
    make: makeLicenseSmServiceAccountsUpdateTool,
    param: "serviceAccountAdjustment",
    delta: 10,
    body: { secretsManager: { serviceAccounts: 60 } },
    before: 50,
    after: 60,
  },
] as const;

describe("bw_license_* update tools send absolute totals", () => {
  for (const c of cases) {
    it(`${c.name}: GET, PUT current + delta with the real field name, read back`, async () => {
      const { client, calls } = subscriptionApi(baseSub);
      const res = await c.make(client).handler({ [c.param]: c.delta });
      expect(res.isError).toBeFalsy();
      expect(calls.map((x) => x.method)).toEqual(["GET", "PUT", "GET"]);
      expect(calls[1]?.body).toEqual(c.body);
      const data = JSON.parse(textOf(res));
      expect(data.before).toBe(c.before);
      expect(data.after).toBe(c.after);
    });

    it(`${c.name}: reports an error when the read-back shows no change`, async () => {
      const { client } = subscriptionApi(baseSub, { applyPut: false });
      const res = await c.make(client).handler({ [c.param]: c.delta });
      expect(res.isError).toBe(true);
      expect(textOf(res)).toMatch(/unchanged/);
    });

    it(`${c.name}: rejects a 0 adjustment and a total below 1 without writing`, async () => {
      for (const delta of [0, -c.before]) {
        const { client, calls } = subscriptionApi(baseSub);
        const res = await c.make(client).handler({ [c.param]: delta });
        expect(res.isError).toBe(true);
        expect(calls.some((x) => x.method === "PUT")).toBe(false);
      }
    });
  }

  it("confirm preview shows the computed total and does not write", async () => {
    const { client, calls } = subscriptionApi(baseSub);
    const res = await withConfirmGuard(makeLicenseSeatsUpdateTool(client), true).handler({
      seatAdjustment: 5,
    });
    const text = textOf(res);
    expect(text).toContain("PUT /public/organization/subscription");
    expect(text).toContain('"seats": 15');
    expect(calls.every((x) => x.method === "GET")).toBe(true);
  });

  it("descriptions no longer name the non-existent delta fields", () => {
    for (const c of cases) {
      expect(c.make(fakeApi({}).client).description).not.toMatch(/Adjustment:/);
    }
  });
});

// Unknown-outcome paths against the real HTTP client and a local mock server
// (127.0.0.1, OS-assigned port). The tools take deltas, so a blind retry after
// an unknown outcome could apply the delta twice.
describe("bw_license_* update tools when the outcome is unknown", () => {
  type Handler = (req: IncomingMessage, res: ServerResponse) => void;
  let server: Server;
  let handler: Handler = () => {};
  const seen: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(req.method ?? "");
      req.resume();
      req.on("end", () => handler(req, res));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  function realClient(timeoutMs = 2000) {
    seen.length = 0;
    return new BitwardenHttpClient({
      apiBase: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`,
      tokenCache: { getToken: async () => "FAKE-TOKEN-1", invalidate: () => {} } as never,
      timeoutMs,
      sleep: async () => {},
    });
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  it("PUT timeout: error tells the caller to check bw_license_subscription_get first", async () => {
    handler = (req, res) => {
      if (req.method === "GET") return json(res, 200, baseSub);
      // Answer the PUT only after the client timeout has fired.
      setTimeout(() => {
        if (!res.destroyed) json(res, 200, { message: "ok" });
      }, 500);
    };
    const res = await makeLicenseSeatsUpdateTool(realClient(100)).handler({ seatAdjustment: 5 });
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toMatch(/network_error.*request timeout/);
    expect(text).toMatch(/may or may not have been applied/);
    expect(text).toMatch(/bw_license_subscription_get/);
    expect(text).toMatch(/before retrying/);
    expect(seen).toEqual(["GET", "PUT"]);
  });

  it("PUT 503: error tells the caller to check bw_license_subscription_get first", async () => {
    handler = (req, res) =>
      req.method === "GET" ? json(res, 200, baseSub) : json(res, 503, "Service Unavailable");
    const res = await makeLicenseSeatsUpdateTool(realClient()).handler({ seatAdjustment: 5 });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/bw_license_subscription_get/);
    expect(seen).toEqual(["GET", "PUT"]);
  });

  it("PUT 200 then read-back 503: says the PUT succeeded and the read-back failed", async () => {
    let gets = 0;
    handler = (req, res) => {
      if (req.method === "PUT") return json(res, 200, { message: "ok" });
      gets++;
      return gets === 1 ? json(res, 200, baseSub) : json(res, 503, "Service Unavailable");
    };
    const res = await makeLicenseSeatsUpdateTool(realClient()).handler({ seatAdjustment: 5 });
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toMatch(/PUT .*answered successfully/);
    expect(text).toMatch(/read-back .*failed/i);
    expect(text).toMatch(/bw_license_subscription_get before retrying/);
    expect(text).toMatch(/503/);
    // Exactly one PUT: no automatic retry of the write.
    expect(seen.filter((m) => m === "PUT")).toHaveLength(1);
  });

  it("a 4xx on the PUT is a plain error without the retry warning", async () => {
    handler = (req, res) =>
      req.method === "GET"
        ? json(res, 200, baseSub)
        : json(res, 400, { Message: "The request's model state is invalid." });
    const res = await makeLicenseSeatsUpdateTool(realClient()).handler({ seatAdjustment: 5 });
    expect(res.isError).toBe(true);
    expect(textOf(res)).not.toMatch(/bw_license_subscription_get/);
  });
});
