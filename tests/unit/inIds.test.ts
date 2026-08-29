import { describe, expect, it } from "vitest";
import { inIds, NEVER_MATCH_ID } from "@/server/services/clientScope";

describe("inIds", () => {
  it("passes through a non-empty list", () => {
    expect(inIds(["a", "b"])).toEqual({ in: ["a", "b"] });
  });

  it("never emits an empty IN () — that would skip the filter", () => {
    expect(inIds([])).toEqual({ in: [NEVER_MATCH_ID] });
  });
});
