import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as imports from "@/server/services/imports";
import * as properties from "@/server/services/properties";

// T6.1 ⛔ — commit, partial-conflict commit, rollback restore-of-visibility.

let W: TestActor;

const row = (over: Partial<imports.ImportRowData> = {}): imports.ImportRowData => ({
  community: "Dubai Marina",
  building: "Tower T",
  unitNo: "1204",
  ejariNo: "2025/118402",
  startDate: "2025-09-16",
  endDate: "2026-09-15",
  annualRent: 72000,
  paymentItems: [
    { seq: 1, dueDate: "2025-09-16", amount: 36000, chequeNo: "0001" },
    { seq: 2, dueDate: "2026-03-16", amount: 36000, chequeNo: "0002" },
  ],
  ...over,
});

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Importer");
});

describe("import commit", () => {
  it("creates property, tenancy, payment items, deadlines; writes evidence + audit", async () => {
    const batch = await imports.createImportBatch(W.ctx, "EXCEL");
    await imports.addImportRows(W.ctx, batch.id, [{ raw: {}, mapped: row() }]);
    const committed = await imports.commitImportBatch(W.ctx, batch.id);

    expect(committed!.status).toBe("COMMITTED");
    expect(committed!.rows[0].status).toBe("ACCEPTED");

    const tenancy = await prisma.tenancy.findFirst({ where: { ejariNo: "2025/118402" } });
    expect(tenancy).toBeTruthy();
    expect(tenancy!.source).toBe("EXCEL");
    const deadlineCount = await prisma.deadline.count({
      where: { tenancyId: tenancy!.id, status: "OPEN" },
    });
    expect(deadlineCount).toBe(5); // gate, expiry, renewal, 2 cheques

    const evidence = await prisma.evidenceEvent.findFirst({
      where: { workspaceId: W.workspaceId, type: "IMPORT_COMMITTED", scopeId: batch.id },
    });
    expect(evidence).toBeTruthy();
    const audit = await prisma.auditEvent.findFirst({
      where: { verb: "import.commit", objectId: batch.id },
    });
    expect(audit).toBeTruthy();
  });

  it("conflicts block the row, not the batch (partial-conflict commit)", async () => {
    // pre-existing tenancy with the ejariNo
    const first = await imports.createImportBatch(W.ctx, "EXCEL");
    await imports.addImportRows(W.ctx, first.id, [{ raw: {}, mapped: row() }]);
    await imports.commitImportBatch(W.ctx, first.id);

    const second = await imports.createImportBatch(W.ctx, "EXCEL");
    const rows = await imports.addImportRows(W.ctx, second.id, [
      { raw: {}, mapped: row() }, // duplicate ejariNo → CONFLICT
      { raw: {}, mapped: row({ ejariNo: "2025/999999", unitNo: "901", startDate: "2025-10-01", endDate: "2026-09-30" }) },
    ]);
    expect(rows.filter((r) => r.status === "CONFLICT")).toHaveLength(1);

    const committed = await imports.commitImportBatch(W.ctx, second.id);
    expect(committed!.status).toBe("COMMITTED");
    const statuses = committed!.rows.map((r) => r.status).sort();
    expect(statuses).toEqual(["ACCEPTED", "CONFLICT"]);

    expect(await prisma.tenancy.count({ where: { ejariNo: "2025/999999" } })).toBe(1);
    // conflicted row created nothing
    expect(await prisma.tenancy.count({ where: { ejariNo: "2025/118402" } })).toBe(1);
  });

  it("detects overlapping tenancy dates for the same property", async () => {
    const first = await imports.createImportBatch(W.ctx, "EXCEL");
    await imports.addImportRows(W.ctx, first.id, [{ raw: {}, mapped: row() }]);
    await imports.commitImportBatch(W.ctx, first.id);

    const second = await imports.createImportBatch(W.ctx, "EXCEL");
    const rows = await imports.addImportRows(W.ctx, second.id, [
      // same property, overlapping window, different ejari
      { raw: {}, mapped: row({ ejariNo: "2026/000001", startDate: "2026-06-01", endDate: "2027-05-31" }) },
    ]);
    expect(rows[0].status).toBe("CONFLICT");
    expect(rows[0].conflictReason).toMatch(/Overlapping/);
  });
});

describe("import rollback", () => {
  it("archives created records via createdRecordRefs and restores visibility", async () => {
    const batch = await imports.createImportBatch(W.ctx, "EXCEL");
    await imports.addImportRows(W.ctx, batch.id, [{ raw: {}, mapped: row() }]);
    await imports.commitImportBatch(W.ctx, batch.id);

    expect(await properties.listProperties(W.ctx)).toHaveLength(1);

    const rolled = await imports.rollbackImportBatch(W.ctx, batch.id);
    expect(rolled!.status).toBe("ROLLED_BACK");

    // default lists hide the archived records (restore-of-visibility)
    expect(await properties.listProperties(W.ctx)).toHaveLength(0);
    // but nothing was hard-deleted — records and evidence remain
    expect(await prisma.property.count({ where: { workspaceId: W.workspaceId } })).toBe(1);
    expect(await prisma.tenancy.count({ where: { workspaceId: W.workspaceId } })).toBe(1);
    const openDeadlines = await prisma.deadline.count({
      where: { workspaceId: W.workspaceId, status: "OPEN" },
    });
    expect(openDeadlines).toBe(0);

    const evidence = await prisma.evidenceEvent.findFirst({
      where: { type: "IMPORT_ROLLED_BACK", scopeId: batch.id },
    });
    expect(evidence).toBeTruthy();

    // a fresh import of the same data succeeds (archived rows don't conflict)
    const again = await imports.createImportBatch(W.ctx, "EXCEL");
    const rows = await imports.addImportRows(W.ctx, again.id, [{ raw: {}, mapped: row() }]);
    expect(rows[0].status).toBe("PENDING");
  });

  it("only committed batches roll back; double commit rejected", async () => {
    const batch = await imports.createImportBatch(W.ctx, "EXCEL");
    await imports.addImportRows(W.ctx, batch.id, [{ raw: {}, mapped: row() }]);
    await expect(imports.rollbackImportBatch(W.ctx, batch.id)).rejects.toThrow();
    await imports.commitImportBatch(W.ctx, batch.id);
    await expect(imports.commitImportBatch(W.ctx, batch.id)).rejects.toThrow();
  });
});

describe("CSV parsing (T6.2)", () => {
  it("maps template columns and isolates bad rows", () => {
    const csv = [
      "community,building,unitNo,ejariNo,startDate,endDate,annualRent,depositAmount,noticePeriodDays,tenantName,landlordName,propertyType,bedrooms",
      "Dubai Marina,Marina Heights Tower,1204,2025/118402,2025-09-16,2026-09-15,72000,5000,90,Ricardo Fernandes,Al Noor Properties LLC,apartment,1",
      "Business Bay,Bayview Residence,803,,2025-11-01,2026-10-31,not-a-number,,,Haddad,,apartment,2",
    ].join("\n");
    const rows = imports.parseCsvRows(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].mapped?.community).toBe("Dubai Marina");
    expect(rows[0].mapped?.annualRent).toBe(72000);
    expect(rows[1].mapped).toBeNull();
    expect(rows[1].error).toMatch(/annualRent/);
  });
});

describe("import parties", () => {
  it("creates landlord and tenant contacts from names and links them on the tenancy", async () => {
    const batch = await imports.createImportBatch(W.ctx, "EXCEL");
    await imports.addImportRows(W.ctx, batch.id, [
      { raw: {}, mapped: row({ landlordName: "Al Noor Properties LLC", tenantName: "Ricardo Fernandes" }) },
    ]);
    await imports.commitImportBatch(W.ctx, batch.id);

    const tenancy = await prisma.tenancy.findFirst({ where: { ejariNo: "2025/118402" } });
    const landlord = await prisma.contact.findUnique({ where: { id: tenancy!.landlordContactId! } });
    const tenant = await prisma.contact.findUnique({ where: { id: tenancy!.tenantContactId! } });
    expect(landlord!.kind).toBe("OWNER");
    expect(landlord!.name).toBe("Al Noor Properties LLC");
    expect(tenant!.kind).toBe("TENANT");
    expect(tenant!.name).toBe("Ricardo Fernandes");
    expect(tenancy!.propertyId).toBeTruthy();
    const property = await prisma.property.findUnique({ where: { id: tenancy!.propertyId } });
    expect(property!.ownerContactId).toBe(landlord!.id);
  });

  it("reuses a unique existing landlord on a second import; rollback archives only newly created parties", async () => {
    const first = await imports.createImportBatch(W.ctx, "EXCEL");
    await imports.addImportRows(W.ctx, first.id, [
      { raw: {}, mapped: row({ landlordName: "Al Noor Properties LLC", tenantName: "Ricardo Fernandes" }) },
    ]);
    await imports.commitImportBatch(W.ctx, first.id);
    const firstLandlordId = (await prisma.tenancy.findFirst({ where: { ejariNo: "2025/118402" } }))!.landlordContactId;

    const second = await imports.createImportBatch(W.ctx, "EXCEL");
    await imports.addImportRows(W.ctx, second.id, [
      {
        raw: {},
        mapped: row({
          ejariNo: "2026/000002",
          unitNo: "901",
          startDate: "2026-10-01",
          endDate: "2027-09-30",
          landlordName: "al noor properties llc",
          tenantName: "New Tenant",
        }),
      },
    ]);
    await imports.commitImportBatch(W.ctx, second.id);
    const secondTenancy = await prisma.tenancy.findFirst({ where: { ejariNo: "2026/000002" } });
    expect(secondTenancy!.landlordContactId).toBe(firstLandlordId);
    expect(await prisma.contact.count({ where: { workspaceId: W.workspaceId, kind: "OWNER", archivedAt: null } })).toBe(1);

    await imports.rollbackImportBatch(W.ctx, second.id);
    expect(await prisma.contact.count({ where: { id: firstLandlordId!, archivedAt: null } })).toBe(1);
    const newTenant = await prisma.contact.findFirst({ where: { workspaceId: W.workspaceId, name: "New Tenant" } });
    expect(newTenant!.archivedAt).toBeTruthy();
  });

  it("fills an even cheque split when chequeCount is set and no items were extracted", async () => {
    const batch = await imports.createImportBatch(W.ctx, "EXCEL");
    await imports.addImportRows(W.ctx, batch.id, [
      { raw: {}, mapped: row({ paymentItems: [], chequeCount: 4, annualRent: 72000 }) },
    ]);
    await imports.commitImportBatch(W.ctx, batch.id);
    const items = await prisma.paymentItem.findMany({
      where: { tenancy: { ejariNo: "2025/118402" } },
      orderBy: { seq: "asc" },
    });
    expect(items).toHaveLength(4);
    const total = items.reduce((s, i) => s + Number(i.amount), 0);
    expect(total).toBe(72000);
  });
});
