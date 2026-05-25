import { describe, it, expect } from "vitest";
import { buildOperations, deriveToolName } from "../scripts/generate.js";

describe("deriveToolName", () => {
  it("list collection", () => {
    expect(deriveToolName("get", "/public/members")).toBe("bw_member_list_raw");
  });
  it("get by id", () => {
    expect(deriveToolName("get", "/public/members/{id}")).toBe("bw_member_get_raw");
  });
  it("create", () => {
    expect(deriveToolName("post", "/public/members")).toBe("bw_member_create_raw");
  });
  it("update", () => {
    expect(deriveToolName("put", "/public/members/{id}")).toBe("bw_member_update_raw");
  });
  it("delete", () => {
    expect(deriveToolName("delete", "/public/members/{id}")).toBe("bw_member_delete_raw");
  });
  it("nested resource (group-ids)", () => {
    expect(deriveToolName("get", "/public/members/{id}/group-ids")).toBe("bw_member_group_id_get_raw");
  });
});

describe("buildOperations", () => {
  it("ignores non-/public paths", () => {
    const ops = buildOperations({
      paths: {
        "/api/internal/x": { get: { summary: "x" } },
        "/public/members": { get: { summary: "members" } },
      },
    });
    expect(ops).toHaveLength(1);
    expect(ops[0]!.path).toBe("/public/members");
  });

  it("preserves request body schema", () => {
    const ops = buildOperations({
      paths: {
        "/public/members": {
          post: {
            requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
          },
        },
      },
    });
    expect(ops[0]!.requestBodySchema).toEqual({ type: "object" });
    expect(ops[0]!.requestBodyRequired).toBe(true);
  });
});
