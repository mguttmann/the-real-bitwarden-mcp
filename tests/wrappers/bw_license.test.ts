import { describe, it, expect, vi } from "vitest";
import {
  makeLicenseSubscriptionGetTool,
  makeLicenseSeatsUpdateTool, makeLicenseStorageUpdateTool,
  makeLicenseSmSeatsUpdateTool, makeLicenseSmServiceAccountsUpdateTool,
} from "../../src/tools/wrappers/bw_license.js";

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
    expect(res.content[0]!.text).toContain("purchased");
  });

  it("seats_update PUTs the nested passwordManager body", async () => {
    const client = stubClient((m, p, o) => {
      expect(m).toBe("PUT");
      expect(p).toBe("/public/organization/subscription");
      expect(o.body).toEqual({ passwordManager: { seatAdjustment: 5 } });
      return { status: 200, headers: new Headers(), body: { message: "Subscription updated successfully." } };
    });
    await makeLicenseSeatsUpdateTool(client as any).handler({ seatAdjustment: 5 });
    expect(client.request).toHaveBeenCalled();
  });

  it("storage_update PUTs the nested passwordManager body", async () => {
    const client = stubClient((m, p, o) => {
      expect(m).toBe("PUT");
      expect(p).toBe("/public/organization/subscription");
      expect(o.body).toEqual({ passwordManager: { storageGbAdjustment: 10 } });
      return { status: 200, headers: new Headers(), body: { message: "ok" } };
    });
    await makeLicenseStorageUpdateTool(client as any).handler({ storageGbAdjustment: 10 });
    expect(client.request).toHaveBeenCalled();
  });

  it("sm_seats_update PUTs the nested secretsManager body", async () => {
    const client = stubClient((m, p, o) => {
      expect(m).toBe("PUT");
      expect(p).toBe("/public/organization/subscription");
      expect(o.body).toEqual({ secretsManager: { seatAdjustment: 3 } });
      return { status: 200, headers: new Headers(), body: { message: "ok" } };
    });
    await makeLicenseSmSeatsUpdateTool(client as any).handler({ seatAdjustment: 3 });
    expect(client.request).toHaveBeenCalled();
  });

  it("sm_service_accounts_update PUTs the nested secretsManager body", async () => {
    const client = stubClient((m, p, o) => {
      expect(m).toBe("PUT");
      expect(p).toBe("/public/organization/subscription");
      expect(o.body).toEqual({ secretsManager: { serviceAccountAdjustment: 50 } });
      return { status: 200, headers: new Headers(), body: { message: "ok" } };
    });
    await makeLicenseSmServiceAccountsUpdateTool(client as any).handler({ serviceAccountAdjustment: 50 });
    expect(client.request).toHaveBeenCalled();
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
