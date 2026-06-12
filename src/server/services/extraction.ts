import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { type AuthzContext, AuthzError, assertSameWorkspace, require_, scope } from "../authz";
import { recordEvidence } from "../evidence";
import { readDocumentBytes } from "./documents";
import { addImportRows, commitImportBatch, createImportBatch, type ImportRowData } from "./imports";

// Thin OCR pipeline (T6.3, decision D13). Upload → ExtractionJob → structured
// extraction with per-field confidence → human review → ImportBatch commit.
// P11: NOTHING writes to trusted records without explicit human confirm —
// the only path to commit is reviewAndCommit, which takes reviewed fields.

export interface ExtractedField {
  value: unknown;
  confidence: number; // 0..1
  source?: string; // snippet from the document
}

export type ExtractionFields = Record<string, ExtractedField>;

export interface ExtractionProvider {
  extract(args: {
    fileName: string;
    mime: string;
    data: Buffer;
  }): Promise<{ model: string; fields: ExtractionFields }>;
}

async function provider(): Promise<ExtractionProvider> {
  if (process.env.EXTRACTION_PROVIDER === "anthropic") {
    const { anthropicProvider } = await import("../extraction/anthropic");
    return anthropicProvider();
  }
  const { mockProvider } = await import("../extraction/mock");
  return mockProvider();
}

export async function createExtractionJob(ctx: AuthzContext, documentId: string) {
  require_(ctx, "imports.manage");
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  assertSameWorkspace(ctx, doc);
  return prisma.extractionJob.create({
    data: { workspaceId: ctx.workspaceId, documentId },
  });
}

/** Run extraction (normally via outbox/worker; callable inline in tests). */
export async function runExtraction(jobId: string) {
  const job = await prisma.extractionJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "PENDING") return job;

  const stored = await readDocumentBytes(job.documentId);
  if (!stored) {
    return prisma.extractionJob.update({ where: { id: jobId }, data: { status: "FAILED" } });
  }
  try {
    const result = await (await provider()).extract({
      fileName: stored.doc.fileName,
      mime: stored.doc.mime,
      data: stored.data,
    });
    const confidence: Record<string, number> = {};
    for (const [k, f] of Object.entries(result.fields)) confidence[k] = f.confidence;

    const updated = await prisma.extractionJob.update({
      where: { id: jobId },
      data: {
        status: "EXTRACTED",
        model: result.model,
        rawOutput: result.fields as unknown as Prisma.InputJsonValue,
        confidence: confidence as Prisma.InputJsonValue,
      },
    });
    await recordEvidence({
      workspaceId: job.workspaceId,
      type: "FIELD_EXTRACTED",
      actorType: "SYSTEM",
      scopeType: "IMPORT_BATCH",
      scopeId: jobId,
      payload: { documentId: job.documentId, model: result.model, fieldCount: Object.keys(result.fields).length },
    });
    return updated;
  } catch (err) {
    console.error(`[extraction] job ${jobId} failed:`, err);
    return prisma.extractionJob.update({ where: { id: jobId }, data: { status: "FAILED" } });
  }
}

export async function listExtractionJobs(ctx: AuthzContext) {
  require_(ctx, "imports.manage");
  return prisma.extractionJob.findMany({
    where: scope(ctx),
    orderBy: { createdAt: "desc" },
  });
}

export async function getExtractionJob(ctx: AuthzContext, id: string) {
  require_(ctx, "imports.manage");
  const job = await prisma.extractionJob.findUnique({ where: { id } });
  assertSameWorkspace(ctx, job);
  return job!;
}

/**
 * Human review → commit (P11). The reviewer sees value+confidence+source per
 * field and submits the confirmed/corrected record, which flows through the
 * same ImportBatch machinery as Excel.
 */
export async function reviewAndCommit(
  ctx: AuthzContext,
  jobId: string,
  reviewed: ImportRowData,
  corrections?: Record<string, { from: unknown; to: unknown }>,
) {
  require_(ctx, "imports.manage");
  const job = await getExtractionJob(ctx, jobId);
  if (job.status !== "EXTRACTED" && job.status !== "REVIEWING") {
    throw new AuthzError(`Job is ${job.status}, not reviewable`, 422);
  }

  for (const [field, change] of Object.entries(corrections ?? {})) {
    await recordEvidence({
      workspaceId: ctx.workspaceId,
      type: "FIELD_CORRECTED",
      actorType: ctx.isStaff ? "STAFF" : "USER",
      actorId: ctx.userId,
      onBehalfOfId: ctx.onBehalfOfId,
      scopeType: "IMPORT_BATCH",
      scopeId: jobId,
      payload: { field, from: change.from, to: change.to },
    });
  }
  await recordEvidence({
    workspaceId: ctx.workspaceId,
    type: "FIELD_CONFIRMED",
    actorType: ctx.isStaff ? "STAFF" : "USER",
    actorId: ctx.userId,
    onBehalfOfId: ctx.onBehalfOfId,
    scopeType: "IMPORT_BATCH",
    scopeId: jobId,
    payload: { documentId: job.documentId, fields: Object.keys(reviewed) },
  });

  const batch = await createImportBatch(ctx, "DOCUMENTS", job.documentId);
  await addImportRows(ctx, batch.id, [
    { raw: (job.rawOutput as Record<string, unknown>) ?? {}, mapped: reviewed },
  ]);
  const committed = await commitImportBatch(ctx, batch.id);

  await prisma.extractionJob.update({
    where: { id: jobId },
    data: {
      status: "COMMITTED",
      reviewedById: ctx.userId,
      reviewedAt: new Date(),
      importBatchId: batch.id,
    },
  });
  return committed;
}

export async function rejectExtraction(ctx: AuthzContext, jobId: string) {
  require_(ctx, "imports.manage");
  await getExtractionJob(ctx, jobId);
  return prisma.extractionJob.update({
    where: { id: jobId },
    data: { status: "REJECTED", reviewedById: ctx.userId, reviewedAt: new Date() },
  });
}
