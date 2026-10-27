import { describe, it, expect, vi } from "vitest";
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
