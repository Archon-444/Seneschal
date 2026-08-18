import { beforeEach, describe, expect, it } from "vitest";
import { addMember, makeWorkspace, prisma, resetDb, type TestActor } from "../helpers";
import * as clients from "@/server/services/clients";
import * as contacts from "@/server/services/contacts";
import * as properties from "@/server/services/properties";
import * as tenancies from "@/server/services/tenancies";
import * as proofs from "@/server/services/proofs";
import * as documents from "@/server/services/documents";
import { buildEvidencePack, exportEvidencePack } from "@/server/services/evidencePack";
import { AuthzError } from "@/server/authz";
import { findBannedCopy } from "../copyConstraints";
import { readFileSync } from "node:fs";
import { join } from "node:path";

let W: TestActor;
let tenancyId: string;
let clientId: string;
let tenantId: string;

beforeEach(async () => {
  await resetDb();
  W = await makeWorkspace("Evidence pack WS");
  const client = await clients.createClient(W.ctx, { displayName: "Family Office" });
  clientId = client.id;
  const owner = await contacts.createContact(W.ctx, { kind: "OWNER", name: "Owner" });
  const tenant = await contacts.createContact(W.ctx, { kind: "TENANT", name: "Tenant" });
  tenantId = tenant.id;
  const p = await properties.createProperty(W.ctx, {
    clientPrincipalId: client.id,
    ownerContactId: owner.id,
    community: "Marina",
    unitNo: "1204",
  });
  tenancyId = (
    await tenancies.createTenancy(W.ctx, {
      propertyId: p.id,
      tenantContactId: tenant.id,
      landlordContactId: owner.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      annualRent: 80_000,
      ejariNo: "E-1",
    })
  ).id;
});

describe("evidence pack export", () => {
  it("chronology includes a proof event that carries no tenancyId (OR shape)", async () => {
    await proofs.createProofRequest(W.ctx, {
      scopeType: "TENANCY",
      scopeId: tenancyId,
      title: "Upload Emirates ID",
      requiredEvidence: "Clear photo of the tenant ID",
      assignedContactId: tenantId,
    });
    const requested = await prisma.evidenceEvent.findFirstOrThrow({
      where: { type: "PROOF_REQUESTED" },
    });
    expect(requested.tenancyId).toBeNull();

    const pack = await buildEvidencePack(W.ctx, tenancyId);
    expect(pack.chronology.some((e) => e.type === "PROOF_REQUESTED")).toBe(true);
  });

  it("manifest hashes equal Document.sha256; export logs EXPORTED and writes one EVIDENCE_PACK_EXPORTED", async () => {
    const doc = await documents.uploadDocument(W.ctx, {
      scopeType: "TENANCY",
      scopeId: tenancyId,
      kind: "TENANCY_CONTRACT",
      fileName: "contract.pdf",
      mime: "application/pdf",
      data: Buffer.from("contract-body-bytes"),
    });
    const pdf = await exportEvidencePack(W.ctx, tenancyId);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const pack = await buildEvidencePack(W.ctx, tenancyId);
    expect(pack.documents).toHaveLength(1);
    expect(pack.documents[0].sha256).toBe(doc.sha256);

    expect(await prisma.documentAccessLog.count({
      where: { documentId: doc.id, action: "EXPORTED" },
    })).toBe(1);

    const exported = await prisma.evidenceEvent.findMany({
      where: { type: "EVIDENCE_PACK_EXPORTED", tenancyId },
    });
    expect(exported).toHaveLength(1);
    expect(exported[0].payloadHash).toBeTruthy();
    expect(exported[0].payload).toMatchObject({
      documentIds: [doc.id],
      documentHashes: [doc.sha256],
    });
  });

  it("AUDITOR can export; CLIENT_VIEWER and MANAGING_AGENT get 403", async () => {
    const auditor = await addMember(W.workspaceId, "AUDITOR");
    await expect(exportEvidencePack(auditor.ctx, tenancyId)).resolves.toBeInstanceOf(Buffer);

    const viewer = await addMember(W.workspaceId, "CLIENT_VIEWER", clientId);
    await expect(exportEvidencePack(viewer.ctx, tenancyId)).rejects.toBeInstanceOf(AuthzError);
    await expect(exportEvidencePack(viewer.ctx, tenancyId)).rejects.toMatchObject({ status: 403 });

    const delegate = await addMember(W.workspaceId, "MANAGING_AGENT", undefined, undefined, [clientId]);
    await expect(exportEvidencePack(delegate.ctx, tenancyId)).rejects.toMatchObject({ status: 403 });
  });

  it("PDF source copy is free of banned legal terms", () => {
    const src = readFileSync(join(process.cwd(), "src/server/pdf/evidencePackPdf.ts"), "utf8");
    expect(findBannedCopy(src)).toBeNull();
  });
});
