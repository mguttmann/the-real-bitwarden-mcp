import { describe, it, expect, vi } from "vitest";
import { makeOrgImportTool } from "../../src/tools/wrappers/bw_org_import.js";

describe("bw_org_import", () => {
  it("POSTs the full payload", async () => {
    const client = { request: vi.fn(async (m: string, p: string, o: any) => {
      expect(m).toBe("POST"); expect(p).toBe("/public/organization/import");
      expect(o.body).toEqual({
        groups: [{ name: "Eng", externalId: "e1", memberExternalIds: ["m1"] }],
        members: [{ email: "x@y.z", externalId: "m1", deleted: false }],
        overwriteExisting: false, largeImport: false,
      });
      return { status: 200, headers: new Headers(), body: { status: "ok" } };
    })};
    await makeOrgImportTool(client as any).handler({
      groups: [{ name: "Eng", externalId: "e1", memberExternalIds: ["m1"] }],
      members: [{ email: "x@y.z", externalId: "m1", deleted: false }],
    });
    expect(client.request).toHaveBeenCalled();
  });

  it("is destructive", () => {
    const t = makeOrgImportTool({ request: vi.fn() } as any);
    expect(t.annotations.destructiveHint).toBe(true);
  });
});
