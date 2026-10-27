import { describe, it, expect, vi } from "vitest";
import { makeOrgImportTool } from "../../src/tools/wrappers/bw_org_import.js";
import { fakeApi } from "../helpers.js";

describe("bw_org_import", () => {
  it("POSTs the full payload", async () => {
    const client = {
      request: vi.fn(async (m: string, p: string, o: any) => {
        expect(m).toBe("POST");
        expect(p).toBe("/public/organization/import");
        expect(o.body).toEqual({
          groups: [{ name: "Eng", externalId: "e1", memberExternalIds: ["m1"] }],
          members: [{ email: "x@y.z", externalId: "m1", deleted: false }],
          overwriteExisting: false,
          largeImport: false,
        });
        return { status: 200, headers: new Headers(), body: { status: "ok" } };
      }),
    };
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

describe("bw_org_import optional parameters added in 0.3.0", () => {
  const send = async (input: Record<string, unknown>) => {
    const { client, calls } = fakeApi({ "POST /public/organization/import": null });
    const res = await makeOrgImportTool(client).handler(input);
    return { res, body: calls[0]?.body as Record<string, unknown> | undefined };
  };

  it("inviteUsersAfterProvisioning: false is sent as given", async () => {
    const { res, body } = await send({ members: [], inviteUsersAfterProvisioning: false });
    expect(res.isError).toBeFalsy();
    expect(body).toMatchObject({ inviteUsersAfterProvisioning: false });
  });

  it("inviteUsersAfterProvisioning omitted: not sent (the API default applies)", async () => {
    const { body } = await send({ members: [] });
    expect(body).not.toHaveProperty("inviteUsersAfterProvisioning");
  });

  it("a deleted member may be given by externalId alone and is sent without email", async () => {
    const { res, body } = await send({ members: [{ externalId: "m9", deleted: true }] });
    expect(res.isError).toBeFalsy();
    expect(body?.members).toEqual([{ externalId: "m9", deleted: true }]);
  });

  it("schema: top-level required unchanged; member items only require externalId", () => {
    const schema = makeOrgImportTool(fakeApi({}).client).inputSchema as any;
    expect(schema.required).toBeUndefined();
    expect(schema.properties.inviteUsersAfterProvisioning).toMatchObject({ type: "boolean" });
    expect(schema.properties.members.items.required).toEqual(["externalId"]);
  });
});
