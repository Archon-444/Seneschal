import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as documents from "@/server/services/documents";
import * as extraction from "@/server/services/extraction";
import type { ImportRowData } from "@/server/services/imports";

// T6.3/T6.4 ⛔ — extraction harness vs ground truth. The mock provider replays
// recorded outputs (allowed in CI); the harness asserts field accuracy ≥90%
// on the clean contract and that NOTHING writes without explicit confirm (P11).

interface GroundTruthFixture {
  id: string;
  expected: Record<string, unknown>;
  derived?: Record<string, unknown>;
  expectedRiskFlags?: string[];
}

const groundTruth = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "ground-truth.json"), "utf8"),
) as { fixtures: GroundTruthFixture[] };

let W: TestActor;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Extraction WS");
});

async function uploadFixture(fixtureId: string) {
  const pdf = readFileSync(join(process.cwd(), "fixtures", "pdf", `${fixtureId}.pdf`));
  return documents.uploadDocument(W.ctx, {
    scopeType: "WORKSPACE",
    kind: "TENANCY_CONTRACT",
    fileName: `${fixtureId}.pdf`,
    mime: "application/pdf",
    data: pdf,
  });
}

function accuracy(fields: extraction.ExtractionFields, expected: Record<string, unknown>) {
  const keys = Object.keys(expected);
  let hits = 0;
  for (const key of keys) {
    const got = fields[key]?.value;
    if (JSON.stringify(got) === JSON.stringify(expected[key])) hits++;
  }
  return { hits, total: keys.length, ratio: hits / keys.length };
}

describe("extraction vs ground truth", () => {
  it("fixture 1 (clean contract) reaches ≥90% field accuracy", async () => {
    const fixture = groundTruth.fixtures.find((f) => f.id === "fixture-1-contract-marina")!;
    const doc = await uploadFixture(fixture.id);
    const job = await extraction.createExtractionJob(W.ctx, doc.id);
    const done = await extraction.runExtraction(job.id);

    expect(done!.status).toBe("EXTRACTED");
    const fields = done!.rawOutput as unknown as extraction.ExtractionFields;
    const { ratio } = accuracy(fields, fixture.expected);
    expect(ratio).toBeGreaterThanOrEqual(0.9);

    // every field carries confidence — 100% human-review coverage material
    for (const f of Object.values(fields)) {
      expect(f.confidence).toBeGreaterThan(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("fixture 2 captures the 60-day override and missing Ejari", async () => {
    const fixture = groundTruth.fixtures.find((f) => f.id === "fixture-2-contract-bayview-override")!;
    const doc = await uploadFixture(fixture.id);
    const job = await extraction.createExtractionJob(W.ctx, doc.id);
    const done = await extraction.runExtraction(job.id);
    const fields = done!.rawOutput as unknown as extraction.ExtractionFields;

    expect(fields.noticePeriodDays.value).toBe(60);
    expect(fields.ejariNo.value).toBeNull();
    const { ratio } = accuracy(fields, fixture.expected);
    expect(ratio).toBeGreaterThanOrEqual(0.9);
  });

  it("P11: extraction alone writes NOTHING to trusted records", async () => {
    const doc = await uploadFixture("fixture-1-contract-marina");
    const job = await extraction.createExtractionJob(W.ctx, doc.id);
    await extraction.runExtraction(job.id);

    expect(await prisma.tenancy.count({ where: { workspaceId: W.workspaceId } })).toBe(0);
    expect(await prisma.property.count({ where: { workspaceId: W.workspaceId } })).toBe(0);
    expect(await prisma.paymentItem.count({ where: { workspaceId: W.workspaceId } })).toBe(0);
  });

  it("review+confirm commits through ImportBatch; evidence trail complete", async () => {
    const doc = await uploadFixture("fixture-2-contract-bayview-override");
    const job = await extraction.createExtractionJob(W.ctx, doc.id);
    const done = await extraction.runExtraction(job.id);
    const fields = done!.rawOutput as unknown as extraction.ExtractionFields;

    // reviewer confirms fields (correcting one to exercise FIELD_CORRECTED)
    const reviewed: ImportRowData = {
      community: String(fields.community.value),
      building: String(fields.building.value),
      unitNo: "803-A", // human correction
      ejariNo: undefined,
      startDate: String(fields.startDate.value),
      endDate: String(fields.endDate.value),
      annualRent: Number(fields.annualRent.value),
      depositAmount: Number(fields.depositAmount.value),
      noticePeriodDays: Number(fields.noticePeriodDays.value),
      paymentItems: (fields.paymentItems.value as ImportRowData["paymentItems"]) ?? [],
    };
    const batch = await extraction.reviewAndCommit(W.ctx, job.id, reviewed, {
      unitNo: { from: "803", to: "803-A" },
    });
    expect(batch!.status).toBe("COMMITTED");

    const tenancy = await prisma.tenancy.findFirst({ where: { workspaceId: W.workspaceId } });
    expect(tenancy).toBeTruthy();
    expect(tenancy!.noticePeriodDays).toBe(60);
    expect(tenancy!.source).toBe("OCR");

    // derived: notice gate per ground truth (2026-09-01)
    const gate = await prisma.deadline.findFirst({
      where: { tenancyId: tenancy!.id, kind: "NOTICE_GATE", status: "OPEN" },
    });
    expect(gate!.dueAt.toISOString().slice(0, 10)).toBe("2026-09-01");

    // expected risk flag from ground truth: MISSING_EJARI
    const flag = await prisma.riskFlag.findFirst({
      where: { scopeId: tenancy!.id, code: "MISSING_EJARI", status: "OPEN" },
    });
    expect(flag).toBeTruthy();

    // evidence: extracted → corrected → confirmed → committed
    const types = (
      await prisma.evidenceEvent.findMany({
        where: { workspaceId: W.workspaceId, type: { in: ["FIELD_EXTRACTED", "FIELD_CORRECTED", "FIELD_CONFIRMED", "IMPORT_COMMITTED"] } },
      })
    ).map((e) => e.type);
    expect(types).toContain("FIELD_EXTRACTED");
    expect(types).toContain("FIELD_CORRECTED");
    expect(types).toContain("FIELD_CONFIRMED");
    expect(types).toContain("IMPORT_COMMITTED");

    const updatedJob = await prisma.extractionJob.findUnique({ where: { id: job.id } });
    expect(updatedJob!.status).toBe("COMMITTED");
    expect(updatedJob!.reviewedById).toBe(W.ctx.userId);
  });

  it("remaining fixtures replay against ground truth (cross-check corpus)", async () => {
    for (const fixtureId of [
      "fixture-3-ejari-certificate",
      "fixture-5-quotation",
      "fixture-6-invoice-mismatch",
    ]) {
      const fixture = groundTruth.fixtures.find((f) => f.id === fixtureId)!;
      const doc = await uploadFixture(fixtureId);
      const job = await extraction.createExtractionJob(W.ctx, doc.id);
      const done = await extraction.runExtraction(job.id);
      const fields = done!.rawOutput as unknown as extraction.ExtractionFields;
      const { ratio } = accuracy(fields, fixture.expected);
      expect(ratio, fixtureId).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("invoice/quote mismatch surfaces both amounts for review, never auto-approves", async () => {
    const quoteDoc = await uploadFixture("fixture-5-quotation");
    const invoiceDoc = await uploadFixture("fixture-6-invoice-mismatch");
    const quoteJob = await extraction.createExtractionJob(W.ctx, quoteDoc.id);
    const invoiceJob = await extraction.createExtractionJob(W.ctx, invoiceDoc.id);
    const quote = (await extraction.runExtraction(quoteJob.id))!.rawOutput as unknown as extraction.ExtractionFields;
    const invoice = (await extraction.runExtraction(invoiceJob.id))!.rawOutput as unknown as extraction.ExtractionFields;

    expect(quote.quoteRef.value).toBe(invoice.quoteRef.value); // linked via Q ref
    expect(quote.amount.value).not.toBe(invoice.amount.value); // delta visible
    // both jobs sit in EXTRACTED awaiting human review
    expect((await prisma.extractionJob.findUnique({ where: { id: quoteJob.id } }))!.status).toBe("EXTRACTED");
    expect((await prisma.extractionJob.findUnique({ where: { id: invoiceJob.id } }))!.status).toBe("EXTRACTED");
  });
});
