import { describe, expect, it } from "vitest";
import { Role, WorkspaceType } from "@prisma/client";
import {
  emailForOwnerContactChoice,
  inviteableSeatsFor,
  inviteSeatCopyFor,
  isInviteableSeat,
  INVITEABLE_SEATS,
  memberSeatLabel,
  ROLE_SEAT_LABEL,
} from "@/lib/seats";

describe("invite seats", () => {
  it("labels every Role in English", () => {
    for (const role of Object.values(Role)) {
      expect(ROLE_SEAT_LABEL[role].length).toBeGreaterThan(0);
      expect(ROLE_SEAT_LABEL[role]).not.toBe(role);
    }
  });

  it("inviteable seats are office admin, staff, agent, and owner — not workspace admin or fiduciary", () => {
    expect([...INVITEABLE_SEATS]).toEqual(["ORG_ADMIN", "MANAGER", "MANAGING_AGENT", "LANDLORD"]);
    expect(isInviteableSeat("ORG_ADMIN")).toBe(true);
    expect(isInviteableSeat("LANDLORD")).toBe(true);
    expect(isInviteableSeat("WORKSPACE_ADMIN")).toBe(false);
    expect(isInviteableSeat("FIDUCIARY")).toBe(false);
  });

  it("owner is invited only on a fiduciary workspace", () => {
    expect(inviteableSeatsFor("FIDUCIARY")).toContain("LANDLORD");
    expect(inviteableSeatsFor("OWNER")).not.toContain("LANDLORD");
    expect(inviteableSeatsFor("OPERATOR")).not.toContain("LANDLORD");
    expect(inviteSeatCopyFor("OWNER").some((s) => s.role === "LANDLORD")).toBe(false);
    expect(inviteSeatCopyFor("FIDUCIARY").some((s) => s.role === "LANDLORD")).toBe(true);
  });

  it("covers every WorkspaceType in inviteableSeatsFor", () => {
    for (const type of Object.values(WorkspaceType)) {
      expect(inviteableSeatsFor(type).length).toBeGreaterThan(0);
    }
  });

  it("office-admin overlay is named in English, not as a bundle", () => {
    expect(memberSeatLabel("MANAGER", true)).toBe("Staff · office admin");
    expect(memberSeatLabel("ORG_ADMIN", true)).toBe("Office admin");
    expect(memberSeatLabel("MANAGING_AGENT", false)).toBe("Agent");
    expect(memberSeatLabel("LANDLORD", false)).toBe("Owner");
  });

  it("clears a previous owner email when the next contact has none", () => {
    const contacts = [
      { id: "with-mail", email: "first@example.com" },
      { id: "no-mail", email: null },
    ];
    expect(emailForOwnerContactChoice(contacts, "with-mail")).toBe("first@example.com");
    expect(emailForOwnerContactChoice(contacts, "no-mail")).toBe("");
    expect(emailForOwnerContactChoice(contacts, "")).toBe("");
    expect(emailForOwnerContactChoice(contacts, "missing")).toBe("");
  });
});
