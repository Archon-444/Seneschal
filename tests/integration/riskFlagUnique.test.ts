import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";

// H2 — the partial unique index is the DB-level safety net behind the risk
// engine's app-level idempotency: at most one ACTIVE (OPEN|ACKNOWLEDGED) flag per
// (workspace, scope, code), while CLEARED rows accumulate as history.

let W: TestActor;

function flag(status: "OPEN" | "ACKNOWLEDGED" | "CLEARED") {
  return {
    workspaceId: W.workspaceId,
    scopeType: "TENANCY" as const,
    scopeId: "scope-1",
    code: "MISSING_EJARI" as const,
    severity: "WARN" as const,
    raisedBy: "RULE" as const,
    status,
  };
}

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Risk WS");
});

describe("RiskFlag partial unique", () => {
  it("allows many CLEARED rows for the same scope+code (history)", async () => {
    await prisma.riskFlag.create({ data: flag("CLEARED") });
    await prisma.riskFlag.create({ data: flag("CLEARED") });
    await prisma.riskFlag.create({ data: flag("CLEARED") });
    expect(await prisma.riskFlag.count({ where: { scopeId: "scope-1", status: "CLEARED" } })).toBe(3);
  });

  it("rejects a second OPEN flag for the same scope+code", async () => {
    await prisma.riskFlag.create({ data: flag("OPEN") });
    await expect(prisma.riskFlag.create({ data: flag("OPEN") })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("rejects an ACKNOWLEDGED alongside an OPEN (both are active)", async () => {
    await prisma.riskFlag.create({ data: flag("OPEN") });
    await expect(prisma.riskFlag.create({ data: flag("ACKNOWLEDGED") })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("permits a fresh OPEN once the prior flag is CLEARED", async () => {
    const open = await prisma.riskFlag.create({ data: flag("OPEN") });
    await prisma.riskFlag.update({ where: { id: open.id }, data: { status: "CLEARED" } });
    // a new active flag for the same scope+code is now allowed
    await expect(prisma.riskFlag.create({ data: flag("OPEN") })).resolves.toBeTruthy();
  });
});

describe("PR5 migration pre-flight invariants", () => {
  // The same queries scripts/preflight-pr5.mjs runs — asserted clean here so CI
  // catches any regression that reintroduces duplicate active flags or orphan refs.
  it("no (workspace, scope, code) has more than one active flag", async () => {
    await prisma.riskFlag.create({ data: flag("OPEN") });
    await prisma.riskFlag.create({ data: { ...flag("CLEARED") } });
    const dupes = await prisma.$queryRaw<unknown[]>`
      SELECT 1 FROM "RiskFlag"
       WHERE "status" IN ('OPEN', 'ACKNOWLEDGED')
       GROUP BY "workspaceId", "scopeType", "scopeId", "code"
      HAVING count(*) > 1
    `;
    expect(dupes).toHaveLength(0);
  });

  it("no Tenancy.contractDocId is orphaned", async () => {
    const orphans = await prisma.$queryRaw<unknown[]>`
      SELECT 1 FROM "Tenancy" t
      LEFT JOIN "Document" d ON d."id" = t."contractDocId"
       WHERE t."contractDocId" IS NOT NULL AND d."id" IS NULL
    `;
    expect(orphans).toHaveLength(0);
  });
});
