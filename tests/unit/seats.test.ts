import { describe, expect, it } from "vitest";
import { Role } from "@prisma/client";
import { isInviteableSeat, INVITEABLE_SEATS, memberSeatLabel, ROLE_SEAT_LABEL } from "@/lib/seats";

describe("invite seats", () => {
  it("labels every Role in English", () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_SEAT_LABEL[role].length).toBeGreaterThan(0);
      expect(ROLE_SEAT_LABEL[role]).not.toBe(role);
    }
  });

  it("inviteable seats are office admin, staff, and agent — not workspace admin or fiduciary", () => {
    expect([...INVITEABLE_SEATS]).toEqual(["ORG_ADMIN", "MANAGER", "MANAGING_AGENT"]);
    expect(isInviteableSeat("ORG_ADMIN")).toBe(true);
    expect(isInviteableSeat("WORKSPACE_ADMIN")).toBe(false);
    expect(isInviteableSeat("FIDUCIARY")).toBe(false);
  });

  it("office-admin overlay is named in English, not as a bundle", () => {
    expect(memberSeatLabel("MANAGER", true)).toBe("Staff · office admin");
    expect(memberSeatLabel("ORG_ADMIN", true)).toBe("Office admin");
    expect(memberSeatLabel("MANAGING_AGENT", false)).toBe("Agent");
  });
});
