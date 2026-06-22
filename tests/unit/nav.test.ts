import { describe, expect, it } from "vitest";
import { CREATE_ACTIONS, NAV, createsForRole, navForRole } from "@/components/shell/nav";

// Operator nav IA contract (both halves of the "don't advertise a dead/wrong route" rule):
// the rail is zoned, capability-generated, and never advertises a removed/quarantined route.

describe("operator nav contract", () => {
  it("does not advertise removed marketplace / folded / action routes", () => {
    const hrefs = NAV.map((i) => i.href);
    for (const gone of ["/enquiries", "/viewings", "/members/assignments", "/onboarding/new"]) {
      expect(hrefs).not.toContain(gone);
    }
  });

  it("every item carries a zone, and WORK exposes a ≤7 primary spine", () => {
    for (const item of NAV) expect(item.zone === "WORK" || item.zone === "MANAGE").toBe(true);
    const primary = NAV.filter((i) => i.zone === "WORK" && i.tier === "primary").map((i) => i.href);
    expect(primary).toEqual(["/dashboard", "/renewals", "/properties", "/clients", "/payments", "/evidence"]);
    expect(primary.length).toBeLessThanOrEqual(7);
  });

  it("WORKSPACE_ADMIN sees WORK + MANAGE", () => {
    const nav = navForRole("WORKSPACE_ADMIN");
    expect(nav.some((i) => i.zone === "WORK")).toBe(true);
    expect(nav.some((i) => i.href === "/members")).toBe(true);
  });

  it("ORG_ADMIN resolves to MANAGE-only — decorrelated people-power, no data WORK and no dead Overview", () => {
    const nav = navForRole("ORG_ADMIN");
    expect(nav.map((i) => i.href)).toEqual(["/members"]);
    // Overview stays capability-gated precisely so ORG_ADMIN isn't handed a home link that 404s.
    expect(nav.some((i) => i.href === "/dashboard")).toBe(false);
  });

  it("a MANAGING_AGENT delegate sees a filtered WORK and no MANAGE", () => {
    const nav = navForRole("MANAGING_AGENT");
    expect(nav.length).toBeGreaterThan(0);
    expect(nav.some((i) => i.zone === "MANAGE")).toBe(false);
    expect(nav.some((i) => i.href === "/properties")).toBe(true); // its operational rail
    expect(nav.some((i) => i.href === "/clients")).toBe(false); // not its scope
  });

  it("creates are header actions: cap-filtered, and never in NAV", () => {
    const navHrefs = NAV.map((i) => i.href);
    for (const c of CREATE_ACTIONS) expect(navHrefs).not.toContain(c.href);
    expect(createsForRole("WORKSPACE_ADMIN").length).toBeGreaterThan(0);
    expect(createsForRole("AUDITOR")).toEqual([]); // a read-only role creates nothing
  });
});
