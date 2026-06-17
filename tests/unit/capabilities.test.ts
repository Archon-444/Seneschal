import { describe, expect, it } from "vitest";
import { CAPABILITIES, ROLE_CAPABILITIES, roleHas } from "@/server/capabilities";
import type { Role } from "@prisma/client";

// T1.3 — matrix tests: each role × capability asserts allow/deny.

const ROLES = Object.keys(ROLE_CAPABILITIES) as Role[];

describe("role capability matrix", () => {
  it("covers every role", () => {
    expect(ROLES.sort()).toEqual(
      [
        "WORKSPACE_ADMIN", "MANAGER", "FIDUCIARY", "CLIENT_VIEWER", "AGENT",
        "LICENSED_PARTNER", "VENDOR", "AUDITOR", "LANDLORD", "TENANT",
      ].sort(),
    );
  });

  it("grants only known capabilities", () => {
    for (const role of ROLES) {
      for (const cap of ROLE_CAPABILITIES[role]) {
        expect(CAPABILITIES).toContain(cap);
      }
    }
  });

  // explicit allow/deny matrix for the load-bearing capabilities
  const matrix: Record<string, Partial<Record<Role, boolean>>> = {
    "workspace.manage": {
      WORKSPACE_ADMIN: true, FIDUCIARY: false, MANAGER: false, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: false, TENANT: false,
    },
    "clients.write": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: false, TENANT: false,
    },
    "tenancies.write": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: false, TENANT: false,
    },
    "tenancies.read": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: true,
      AGENT: true, LICENSED_PARTNER: true, VENDOR: false, AUDITOR: true,
      LANDLORD: true, TENANT: true,
    },
    "properties.read": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: true,
      AGENT: true, LICENSED_PARTNER: true, VENDOR: false, AUDITOR: true,
      LANDLORD: true, TENANT: false,
    },
    "listings.read": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: true, TENANT: false,
    },
    "listings.write": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: true, TENANT: false,
    },
    "listings.publish": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: true, TENANT: false,
    },
    "offers.write": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: true, TENANT: false,
    },
    "offers.decide": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: true, TENANT: false,
    },
    "contracts.write": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: true, TENANT: false,
    },
    "landlords.verify": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: false, TENANT: false,
    },
    "passport.write": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: false, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: false, TENANT: true,
    },
    "passport.share": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: false, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: false, TENANT: true,
    },
    "enquiries.read": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: false, TENANT: false,
    },
    "enquiries.write": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: false, TENANT: false,
    },
    "viewings.write": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: false, TENANT: false,
    },
    "payments.read": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: true,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: true,
      LANDLORD: true, TENANT: true,
    },
    "payments.write": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
      LANDLORD: false, TENANT: false,
    },
    "renewals.read": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: true,
      AGENT: true, LICENSED_PARTNER: true, VENDOR: false, AUDITOR: true,
    },
    "renewals.write": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
    },
    "renewals.decide": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
    },
    "messaging.manage": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
    },
    "imports.manage": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
    },
    "proofs.decide": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
    },
    "evidence.read": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: true,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: true,
      LANDLORD: false, TENANT: false,
    },
    "reports.generate": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: false, VENDOR: false, AUDITOR: false,
    },
    "documents.write": {
      WORKSPACE_ADMIN: true, FIDUCIARY: true, MANAGER: true, CLIENT_VIEWER: false,
      AGENT: false, LICENSED_PARTNER: true, VENDOR: true, AUDITOR: false,
    },
  };

  for (const [cap, expectations] of Object.entries(matrix)) {
    for (const [role, allowed] of Object.entries(expectations)) {
      it(`${role} ${allowed ? "can" : "cannot"} ${cap}`, () => {
        expect(roleHas(role as Role, cap as (typeof CAPABILITIES)[number])).toBe(allowed);
      });
    }
  }

  it("AUDITOR has no write capability anywhere", () => {
    for (const cap of ROLE_CAPABILITIES.AUDITOR) {
      expect(cap.endsWith(".write")).toBe(false);
      expect(cap).not.toBe("imports.manage");
      expect(cap).not.toBe("proofs.decide");
    }
  });

  it("CLIENT_VIEWER is read-only", () => {
    for (const cap of ROLE_CAPABILITIES.CLIENT_VIEWER) {
      expect(/\.(read)$/.test(cap)).toBe(true);
    }
  });

  // Self-service personas are read-only in F0a (offers.*/renewals.* arrive with
  // their authenticated services in Stage 2). Scoping to one Contact is enforced
  // separately in authz/contactScope.
  // TENANT is read-only across the portfolio EXCEPT for managing/sharing its own
  // rental passport (1C): passport.read/write/share. Scoping to one Contact is
  // enforced separately in authz/contactScope.
  it("TENANT is read-only apart from its own passport", () => {
    for (const cap of ROLE_CAPABILITIES.TENANT) {
      expect(cap.endsWith(".read") || cap.startsWith("passport.")).toBe(true);
    }
  });

  // LANDLORD is read-only across the portfolio EXCEPT for managing its own listings
  // (1B supply side) and negotiating offers on them (2A): listings.* and offers.*.
  // Scoping to one Contact's owned properties is enforced separately in contactScope.
  it("LANDLORD is read-only apart from its own listings, offers and contracts", () => {
    for (const cap of ROLE_CAPABILITIES.LANDLORD) {
      expect(
        cap.endsWith(".read") ||
          cap.startsWith("listings.") ||
          cap.startsWith("offers.") ||
          cap.startsWith("contracts."),
      ).toBe(true);
    }
  });
});
