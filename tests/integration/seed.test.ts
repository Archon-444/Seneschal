import { beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { prisma, resetDb } from "../helpers";
import { runSeed } from "@/server/seed";
import { ROLE_CAPABILITIES } from "@/server/capabilities";

// T0.2 — the demo seed models the member-vs-link-party boundary: USERs are recurring orchestration
// relationships; the tenant (episodic counterparty whose own attestation is the evidence) is a
// link-party with no account. These tests pin that intent so it can't quietly regress.

async function gallery() {
  return prisma.workspace.findFirstOrThrow({ where: { name: "Example", type: "FIDUCIARY" } });
}

describe("runSeed — access-model gallery", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("seats the configured builder as the SOLE WORKSPACE_ADMIN of the FIDUCIARY gallery, stable across runs", async () => {
    await runSeed({ adminEmail: " Pilot@Example.COM " });
    await runSeed({ adminEmail: "pilot@example.com" }); // idempotent re-run, normalises to the same login

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "pilot@example.com" } });
    const ws = await gallery();
    const memberships = await prisma.membership.findMany({
      where: { workspaceId: ws.id, userId: user.id, revokedAt: null },
    });
    expect(memberships).toHaveLength(1); // never a second active row despite a role-shape change
    expect(memberships[0].role).toBe("WORKSPACE_ADMIN");
  });

  it("the tenant is a LINK-PARTY: a Contact with secure links, but NO user and NO membership", async () => {
    await runSeed({ adminEmail: "pilot@example.com" });

    const fernandes = await prisma.contact.findFirstOrThrow({ where: { name: "Ricardo Fernandes" } });
    // No tenant account anywhere — not a user, not a TENANT membership.
    expect(await prisma.user.findUnique({ where: { email: "r.fernandes@example.com" } })).toBeNull();
    expect(await prisma.membership.count({ where: { role: "TENANT" } })).toBe(0);
    // The tenant acts through minted links instead (accept terms + upload own ID).
    const links = await prisma.secureLink.findMany({ where: { contactId: fernandes.id, revokedAt: null } });
    expect(links.map((l) => l.purpose).sort()).toEqual(["PROOF_UPLOAD", "TENANT_OFFER"]);
    // The TENANT_OFFER link must resolve to a real Offer (getOfferForLink reads scopeId as Offer.id),
    // else the tenant just hits "this link is no longer available".
    const offerLink = links.find((l) => l.purpose === "TENANT_OFFER")!;
    expect(await prisma.offer.findUnique({ where: { id: offerLink.scopeId } })).toBeTruthy();
  });

  it("seats one member per taught recurring role and none for TENANT or deferred marketplace roles", async () => {
    await runSeed({ adminEmail: "pilot@example.com" });
    const ws = await gallery();
    const seated = new Set(
      (await prisma.membership.findMany({ where: { workspaceId: ws.id, revokedAt: null } })).map((m) => m.role),
    );
    const notTaught = new Set<Role>(["TENANT", "AGENT", "LICENSED_PARTNER", "VENDOR"]);
    for (const role of Object.keys(ROLE_CAPABILITIES) as Role[]) {
      if (notTaught.has(role)) expect(seated.has(role)).toBe(false);
      else expect(seated.has(role)).toBe(true);
    }
  });

  it("the absentee landlord is a passive CLIENT_VIEWER scoped to the managed client", async () => {
    await runSeed({ adminEmail: "pilot@example.com" });
    const viewer = await prisma.user.findUniqueOrThrow({ where: { email: "absentee-owner@example.com" } });
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: viewer.id, revokedAt: null } });
    expect(m.role).toBe("CLIENT_VIEWER");
    expect(m.clientPrincipalId).toBeTruthy(); // scoped to the managed client
    expect(await prisma.secureLink.count({ where: { purpose: "APPROVAL", revokedAt: null } })).toBe(1);
    const approvalLink = await prisma.secureLink.findFirstOrThrow({ where: { purpose: "APPROVAL", revokedAt: null } });
    expect(approvalLink.scopeType).toBe("OFFER");
    expect(await prisma.offer.findUnique({ where: { id: approvalLink.scopeId } })).toBeTruthy();
    expect(await prisma.approval.findFirst({
      where: { subjectType: "offer", subjectId: approvalLink.scopeId, decision: null },
    })).toBeTruthy();
  });

  it("records Private Client A's owner as an OWNER contact with no LANDLORD seat", async () => {
    await runSeed({ adminEmail: "pilot@example.com" });
    const karim = await prisma.contact.findFirstOrThrow({ where: { name: "Karim Mansour" } });
    expect(karim.kind).toBe("OWNER");
    expect(
      await prisma.membership.count({
        where: { role: "LANDLORD", subjectContactId: karim.id, revokedAt: null },
      }),
    ).toBe(0);
    const parkGate = await prisma.property.findFirstOrThrow({ where: { building: "Park Gate" } });
    expect(parkGate.ownerContactId).toBe(karim.id);
  });

  it("the MANAGING_AGENT delegate is scoped through live PropertyAssignment rows", async () => {
    await runSeed({ adminEmail: "pilot@example.com" });
    const delegate = await prisma.user.findUniqueOrThrow({ where: { email: "managing-agent@example.com" } });
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: delegate.id, revokedAt: null } });
    expect(m.role).toBe("MANAGING_AGENT");
    const assignments = await prisma.propertyAssignment.findMany({ where: { membershipId: m.id, revokedAt: null } });
    expect(assignments).toHaveLength(3); // Marina, Bayview, Palm Vista (Al Noor) — not Private Client A's JVC
  });

  it("re-homes Al Noor units onto the demo agent if another member already holds them", async () => {
    await runSeed({ adminEmail: "pilot@example.com" });
    const ws = await gallery();
    const demo = await prisma.membership.findFirstOrThrow({
      where: {
        workspaceId: ws.id,
        user: { email: "managing-agent@example.com" },
        revokedAt: null,
      },
    });
    const otherUser = await prisma.user.create({
      data: { email: "other-agent@test.example", name: "Other Agent" },
    });
    const other = await prisma.membership.create({
      data: { workspaceId: ws.id, userId: otherUser.id, role: "MANAGING_AGENT" },
    });
    const marina = await prisma.property.findFirstOrThrow({
      where: { workspaceId: ws.id, building: "Marina Heights Tower", unitNo: "1204" },
    });
    await prisma.propertyAssignment.updateMany({
      where: { propertyId: marina.id, revokedAt: null },
      data: { membershipId: other.id },
    });

    await expect(runSeed({ adminEmail: "pilot@example.com" })).resolves.toBeTruthy();

    const live = await prisma.propertyAssignment.findMany({
      where: { propertyId: marina.id, revokedAt: null },
    });
    expect(live).toHaveLength(1);
    expect(live[0].membershipId).toBe(demo.id);
    expect(
      await prisma.propertyAssignment.count({
        where: { membershipId: demo.id, revokedAt: null },
      }),
    ).toBe(3);
  });

  it("produces four workspaces (one per type) with no duplicate ClientPrincipals on re-run", async () => {
    await runSeed({ adminEmail: "pilot@example.com" });
    await runSeed({ adminEmail: "pilot@example.com" });
    const types = (await prisma.workspace.findMany()).map((w) => w.type).sort();
    expect(types).toEqual(["FIDUCIARY", "INTERNAL", "OPERATOR", "OWNER"]);
    const owner = await prisma.workspace.findFirstOrThrow({ where: { type: "OWNER" } });
    expect(await prisma.clientPrincipal.count({ where: { workspaceId: owner.id } })).toBe(2);
  });

  it("rejects a blank adminEmail without creating an empty-email user", async () => {
    await expect(runSeed({ adminEmail: "   " })).rejects.toThrow(/not a valid email/);
    expect(await prisma.user.findUnique({ where: { email: "" } })).toBeNull();
  });
});
