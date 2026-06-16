import { describe, expect, it } from "vitest";
import { shouldApplyCount } from "@/components/shell/notificationBadge";

describe("shouldApplyCount", () => {
  it("applies a response newer than the shown value", () => {
    expect(shouldApplyCount(4, 3)).toBe(true);
  });

  it("applies a response equal to the shown value", () => {
    expect(shouldApplyCount(3, 3)).toBe(true);
  });

  it("drops a stale response issued before a later mark action", () => {
    expect(shouldApplyCount(2, 3)).toBe(false);
  });
});
