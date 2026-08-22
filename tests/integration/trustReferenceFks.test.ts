import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";

// #58 — non-polymorphic trust refs are real FKs. An insert that names a missing
// Contact / ClientPrincipal must fail at the database (P2003), not drift until
// a later read. Archive is the delete path; Restrict blocks a hard delete of a
// still-referenced party.

let W: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Trust FK WS");
});

async function contact(kind: "OWNER" | "TENANT" | "AGENT", name: string) {
  return prisma.contact.create({
    data: { workspaceId: W.workspaceId, kind, name },
  });
}

async function client(displayName: string) {
  return prisma.clientPrincipal.create({
    data: { workspaceId: W.workspaceId, displayName },
  });
}

async function property(opts: {
  clientPrincipalId?: string | null;
  ownerContactId?: string | null;
  assignedAgentId?: string | null;
}) {
  return prisma.property.create({
    data: {
      workspaceId: W.workspaceId,
      community: "Marina",
      unitNo: "1",
      ...opts,
    },
  });
}

describe("trust-reference foreign keys (#58)", () => {
  it("rejects a tenancy whose landlord or tenant id does not exist", async () => {
    const p = await property({});
    const missing = randomUUID();
    await expect(
      prisma.tenancy.create({
        data: {
          workspaceId: W.workspaceId,
          propertyId: p.id,
          landlordContactId: missing,
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-12-31"),
          annualRent: 90_000,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      prisma.tenancy.create({
        data: {
          workspaceId: W.workspaceId,
          propertyId: p.id,
          tenantContactId: missing,
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-12-31"),
          annualRent: 90_000,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("rejects a property whose client, owner, or agent id does not exist", async () => {
    const missing = randomUUID();
    await expect(property({ clientPrincipalId: missing })).rejects.toMatchObject({ code: "P2003" });
    await expect(property({ ownerContactId: missing })).rejects.toMatchObject({ code: "P2003" });
    await expect(property({ assignedAgentId: missing })).rejects.toMatchObject({ code: "P2003" });
  });

  it("accepts live contacts and a live client, then blocks deleting them while referenced", async () => {
    const owner = await contact("OWNER", "Owner");
    const tenant = await contact("TENANT", "Tenant");
    const agent = await contact("AGENT", "Agent");
    const cp = await client("Al Noor");
    const p = await property({
      clientPrincipalId: cp.id,
      ownerContactId: owner.id,
      assignedAgentId: agent.id,
    });
    const t = await prisma.tenancy.create({
      data: {
        workspaceId: W.workspaceId,
        propertyId: p.id,
        landlordContactId: owner.id,
        tenantContactId: tenant.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        annualRent: 90_000,
      },
    });
    expect(t.landlordContactId).toBe(owner.id);

    await expect(prisma.contact.delete({ where: { id: owner.id } })).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.contact.delete({ where: { id: tenant.id } })).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.contact.delete({ where: { id: agent.id } })).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.clientPrincipal.delete({ where: { id: cp.id } })).rejects.toMatchObject({ code: "P2003" });
  });

  it("seed/fixture-shaped data has no dangling trust refs", async () => {
    const orphans = await prisma.$queryRaw<{ src: string }[]>`
      SELECT 'Tenancy.landlordContactId' AS src FROM "Tenancy" t
        LEFT JOIN "Contact" c ON c."id" = t."landlordContactId"
       WHERE t."landlordContactId" IS NOT NULL AND c."id" IS NULL
      UNION ALL
      SELECT 'Tenancy.tenantContactId' FROM "Tenancy" t
        LEFT JOIN "Contact" c ON c."id" = t."tenantContactId"
       WHERE t."tenantContactId" IS NOT NULL AND c."id" IS NULL
      UNION ALL
      SELECT 'Property.clientPrincipalId' FROM "Property" p
        LEFT JOIN "ClientPrincipal" c ON c."id" = p."clientPrincipalId"
       WHERE p."clientPrincipalId" IS NOT NULL AND c."id" IS NULL
      UNION ALL
      SELECT 'Property.ownerContactId' FROM "Property" p
        LEFT JOIN "Contact" c ON c."id" = p."ownerContactId"
       WHERE p."ownerContactId" IS NOT NULL AND c."id" IS NULL
      UNION ALL
      SELECT 'Property.assignedAgentId' FROM "Property" p
        LEFT JOIN "Contact" c ON c."id" = p."assignedAgentId"
       WHERE p."assignedAgentId" IS NOT NULL AND c."id" IS NULL
    `;
    expect(orphans).toEqual([]);
  });
});
