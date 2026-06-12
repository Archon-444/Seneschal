import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { generateToken, sha256Hex } from "./crypto";
import { toUtcDateOnly } from "./calculators/dates";
import { regenerateDeadlinesForTenancy } from "./services/deadlines";
import { evaluateRiskForTenancy } from "./services/risk";
import { newStorageKey, storage } from "./storage";

// Idempotent seed (T0.2): creates the Farina workspace fixture set per the
// build handoff. Safe to run repeatedly — every create is find-or-create.

function date(iso: string): Date {
  return toUtcDateOnly(new Date(iso));
}

async function findOrCreate<T>(find: () => Promise<T | null>, create: () => Promise<T>): Promise<T> {
  return (await find()) ?? (await create());
}

/**
 * Normalize and validate an operator email before it becomes a login-capable
 * FIDUCIARY user. A blank or malformed value would create an account that can
 * never receive its OTP, so reject it loudly instead.
 */
export function normalizeAdminEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`adminEmail is not a valid email address: "${raw}"`);
  }
  return email;
}

export interface SeedResult {
  proofLinkUrl: string | null;
}

export async function runSeed(opts?: { adminEmail?: string }): Promise<SeedResult> {
  let proofLinkUrl: string | null = null;
  // ── Plan + workspace + users
  const plan = await prisma.plan.upsert({
    where: { code: "fiduciary_client_pack_v1" },
    update: {},
    create: {
      code: "fiduciary_client_pack_v1",
      name: "Fiduciary Client Pack",
      features: { proof_requests: true, ocr_intake: true, reports: true, whatsapp: false },
      limits: { clients: 10, properties_per_client: 20 },
    },
  });

  const workspace = await findOrCreate(
    () => prisma.workspace.findFirst({ where: { name: "Farina Legal Advisory" } }),
    () => prisma.workspace.create({ data: { name: "Farina Legal Advisory", type: "FIDUCIARY" } }),
  );

  const farina = await prisma.user.upsert({
    where: { email: "farina@example.com" },
    update: {},
    create: { email: "farina@example.com", name: "Farina Al Rashid", locale: "en" },
  });
  const staff = await prisma.user.upsert({
    where: { email: "staff@seneschal.example" },
    update: {},
    create: { email: "staff@seneschal.example", name: "Seneschal Staff", isStaff: true },
  });
  void staff;

  await prisma.membership.upsert({
    where: {
      workspaceId_userId_role: {
        workspaceId: workspace.id,
        userId: farina.id,
        role: "FIDUCIARY",
      },
    },
    update: {},
    create: { workspaceId: workspace.id, userId: farina.id, role: "FIDUCIARY" },
  });

  // optional real-login user: farina@example.com cannot receive OTP email, so
  // production bootstrap can attach an actual operator address as FIDUCIARY
  if (opts?.adminEmail !== undefined) {
    const email = normalizeAdminEmail(opts.adminEmail);
    const admin = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: "Pilot Operator" },
    });
    await prisma.membership.upsert({
      where: {
        workspaceId_userId_role: {
          workspaceId: workspace.id,
          userId: admin.id,
          role: "FIDUCIARY",
        },
      },
      update: {},
      create: { workspaceId: workspace.id, userId: admin.id, role: "FIDUCIARY" },
    });
  }

  await findOrCreate(
    () => prisma.subscription.findFirst({ where: { workspaceId: workspace.id, planId: plan.id } }),
    () =>
      prisma.subscription.create({
        data: { workspaceId: workspace.id, planId: plan.id, period: "YEAR" },
      }),
  );
  for (const [featureKey, value] of Object.entries({
    proof_requests: true,
    ocr_intake: true,
    reports: true,
    whatsapp: false,
  })) {
    await prisma.workspaceEntitlement.upsert({
      where: { workspaceId_featureKey: { workspaceId: workspace.id, featureKey } },
      update: {},
      create: { workspaceId: workspace.id, featureKey, value },
    });
  }

  // ── Clients + contacts
  const alNoor = await findOrCreate(
    () => prisma.clientPrincipal.findFirst({ where: { workspaceId: workspace.id, displayName: "Al Noor Family Office" } }),
    () => prisma.clientPrincipal.create({ data: { workspaceId: workspace.id, displayName: "Al Noor Family Office" } }),
  );
  const privateA = await findOrCreate(
    () => prisma.clientPrincipal.findFirst({ where: { workspaceId: workspace.id, displayName: "Private Client A" } }),
    () => prisma.clientPrincipal.create({ data: { workspaceId: workspace.id, displayName: "Private Client A" } }),
  );

  const fernandes = await findOrCreate(
    () => prisma.contact.findFirst({ where: { workspaceId: workspace.id, name: "Ricardo Fernandes" } }),
    () =>
      prisma.contact.create({
        data: {
          workspaceId: workspace.id,
          kind: "TENANT",
          name: "Ricardo Fernandes",
          phone: "+971-52-555-0144",
          email: "r.fernandes@example.com",
        },
      }),
  );
  const haddad = await findOrCreate(
    () => prisma.contact.findFirst({ where: { workspaceId: workspace.id, name: "Amal & Mazen Haddad" } }),
    () => prisma.contact.create({ data: { workspaceId: workspace.id, kind: "TENANT", name: "Amal & Mazen Haddad" } }),
  );
  const samir = await findOrCreate(
    () => prisma.contact.findFirst({ where: { workspaceId: workspace.id, name: "Samir Khan" } }),
    () =>
      prisma.contact.create({
        data: {
          workspaceId: workspace.id,
          kind: "AGENT",
          name: "Samir Khan",
          email: "samir.khan@example.com",
          phone: "+971-50-555-0177",
        },
      }),
  );
  await findOrCreate(
    () => prisma.contact.findFirst({ where: { workspaceId: workspace.id, name: "CoolAir Technical Services" } }),
    () =>
      prisma.contact.create({
        data: {
          workspaceId: workspace.id,
          kind: "VENDOR",
          name: "CoolAir Technical Services",
          company: "CoolAir Technical Services LLC",
        },
      }),
  );

  // ── Properties
  const marina = await findOrCreate(
    () => prisma.property.findFirst({ where: { workspaceId: workspace.id, building: "Marina Heights Tower", unitNo: "1204" } }),
    () =>
      prisma.property.create({
        data: {
          workspaceId: workspace.id,
          clientPrincipalId: alNoor.id,
          community: "Dubai Marina",
          building: "Marina Heights Tower",
          unitNo: "1204",
          propertyType: "apartment",
          bedrooms: 1,
          sizeSqft: 780,
          assignedAgentId: samir.id,
        },
      }),
  );
  const bayview = await findOrCreate(
    () => prisma.property.findFirst({ where: { workspaceId: workspace.id, building: "Bayview Residence", unitNo: "803" } }),
    () =>
      prisma.property.create({
        data: {
          workspaceId: workspace.id,
          clientPrincipalId: alNoor.id,
          community: "Business Bay",
          building: "Bayview Residence",
          unitNo: "803",
          propertyType: "apartment",
          bedrooms: 2,
        },
      }),
  );
  const jvc = await findOrCreate(
    () => prisma.property.findFirst({ where: { workspaceId: workspace.id, building: "Park Gate", community: "Jumeirah Village Circle" } }),
    () =>
      prisma.property.create({
        data: {
          workspaceId: workspace.id,
          clientPrincipalId: privateA.id,
          community: "Jumeirah Village Circle",
          building: "Park Gate",
          unitNo: "411",
          propertyType: "apartment",
          bedrooms: 0,
        },
      }),
  );

  // ── Tenancies + payment schedules
  const marinaTenancy = await findOrCreate(
    () => prisma.tenancy.findFirst({ where: { propertyId: marina.id, ejariNo: "2025/118402" } }),
    () =>
      prisma.tenancy.create({
        data: {
          workspaceId: workspace.id,
          propertyId: marina.id,
          tenantContactId: fernandes.id,
          ejariNo: "2025/118402",
          startDate: date("2025-09-16"),
          endDate: date("2026-09-15"),
          annualRent: new Prisma.Decimal(72000),
          depositAmount: new Prisma.Decimal(5000),
          noticePeriodDays: 90,
          source: "MANUAL",
        },
      }),
  );
  const marinaCheques = [
    { seq: 1, dueDate: "2025-09-16", chequeNo: "000451", status: "CLEARED" },
    { seq: 2, dueDate: "2025-12-16", chequeNo: "000452", status: "CLEARED" },
    { seq: 3, dueDate: "2026-03-16", chequeNo: "000453", status: "CLEARED" },
    { seq: 4, dueDate: "2026-06-16", chequeNo: "000454", status: "SCHEDULED" },
  ] as const;
  for (const c of marinaCheques) {
    await prisma.paymentItem.upsert({
      where: { tenancyId_seq: { tenancyId: marinaTenancy.id, seq: c.seq } },
      update: {},
      create: {
        workspaceId: workspace.id,
        tenancyId: marinaTenancy.id,
        seq: c.seq,
        dueDate: date(c.dueDate),
        amount: new Prisma.Decimal(18000),
        instrument: "CHEQUE",
        chequeNo: c.chequeNo,
        bank: "Emirates NBD",
        status: c.status,
      },
    });
  }

  const bayviewTenancy = await findOrCreate(
    () => prisma.tenancy.findFirst({ where: { propertyId: bayview.id, startDate: date("2025-11-01") } }),
    () =>
      prisma.tenancy.create({
        data: {
          workspaceId: workspace.id,
          propertyId: bayview.id,
          tenantContactId: haddad.id,
          ejariNo: null, // fixture 2: missing Ejari → MISSING_EJARI flag
          startDate: date("2025-11-01"),
          endDate: date("2026-10-31"),
          annualRent: new Prisma.Decimal(110000),
          depositAmount: new Prisma.Decimal(8000),
          noticePeriodDays: 60, // fixture 2: contract clause 9 override
          source: "MANUAL",
        },
      }),
  );
  for (const c of [
    { seq: 1, dueDate: "2025-11-01" },
    { seq: 2, dueDate: "2026-05-01" },
  ]) {
    await prisma.paymentItem.upsert({
      where: { tenancyId_seq: { tenancyId: bayviewTenancy.id, seq: c.seq } },
      update: {},
      create: {
        workspaceId: workspace.id,
        tenancyId: bayviewTenancy.id,
        seq: c.seq,
        dueDate: date(c.dueDate),
        amount: new Prisma.Decimal(55000),
        instrument: "CHEQUE",
        bank: "RAKBANK",
        status: "SCHEDULED",
      },
    });
  }

  const jvcTenancy = await findOrCreate(
    () => prisma.tenancy.findFirst({ where: { propertyId: jvc.id, endDate: date("2027-01-20") } }),
    () =>
      prisma.tenancy.create({
        data: {
          workspaceId: workspace.id,
          propertyId: jvc.id,
          startDate: date("2026-01-21"),
          endDate: date("2027-01-20"),
          annualRent: new Prisma.Decimal(48000),
          noticePeriodDays: 90,
          source: "MANUAL",
        },
      }),
  );
  for (const c of [
    { seq: 1, dueDate: "2026-01-21" },
    { seq: 2, dueDate: "2026-07-21" },
  ]) {
    await prisma.paymentItem.upsert({
      where: { tenancyId_seq: { tenancyId: jvcTenancy.id, seq: c.seq } },
      update: {},
      create: {
        workspaceId: workspace.id,
        tenancyId: jvcTenancy.id,
        seq: c.seq,
        dueDate: date(c.dueDate),
        amount: new Prisma.Decimal(24000),
        instrument: "CHEQUE",
        status: "SCHEDULED",
      },
    });
  }

  // ── Deadlines + risk flags (via the real engine, so rules are exercised)
  for (const t of [marinaTenancy, bayviewTenancy, jvcTenancy]) {
    await regenerateDeadlinesForTenancy(t.id);
    await evaluateRiskForTenancy(t.id);
  }

  // ── Sample document with hash + access log
  let sampleDoc = await prisma.document.findFirst({
    where: { workspaceId: workspace.id, fileName: "marina-tenancy-contract.txt" },
  });
  if (!sampleDoc) {
    const content = Buffer.from(
      "FIXTURE — Tenancy Contract TC-2025-118402, Unit 1204 Marina Heights Tower. See /fixtures for the PDF rendering.",
    );
    const storageKey = await storage().put(
      newStorageKey(workspace.id, "marina-tenancy-contract.txt"),
      content,
    );
    sampleDoc = await prisma.document.create({
      data: {
        workspaceId: workspace.id,
        scopeType: "TENANCY",
        scopeId: marinaTenancy.id,
        kind: "TENANCY_CONTRACT",
        fileName: "marina-tenancy-contract.txt",
        mime: "text/plain",
        sizeBytes: content.length,
        storageKey,
        sha256: sha256Hex(content),
        uploadedById: farina.id,
      },
    });
    await prisma.documentAccessLog.create({
      data: {
        workspaceId: workspace.id,
        documentId: sampleDoc.id,
        actorUserId: farina.id,
        action: "UPLOADED",
      },
    });
    await prisma.tenancy.update({
      where: { id: marinaTenancy.id },
      data: { contractDocId: sampleDoc.id },
    });
    await evaluateRiskForTenancy(marinaTenancy.id);
  }

  // ── Proof request + live secure link
  const cheque4 = await prisma.paymentItem.findUnique({
    where: { tenancyId_seq: { tenancyId: marinaTenancy.id, seq: 4 } },
  });
  const proof = await findOrCreate(
    () =>
      prisma.proofRequest.findFirst({
        where: { workspaceId: workspace.id, title: "Upload proof: Marina cheque 4 received" },
      }),
    () =>
      prisma.proofRequest.create({
        data: {
          workspaceId: workspace.id,
          scopeType: "PAYMENT_ITEM",
          scopeId: cheque4!.id,
          title: "Upload proof: Marina cheque 4 received",
          requiredEvidence: "Photo or scan of cheque 000454 deposit slip or bank confirmation.",
          assignedContactId: samir.id,
          dueAt: date("2026-06-23"),
          status: "SENT",
          createdById: farina.id,
        },
      }),
  );
  // earlier seeds left the scope target null — repair so client scoping resolves it
  if (!proof.scopeId && cheque4) {
    await prisma.proofRequest.update({ where: { id: proof.id }, data: { scopeId: cheque4.id } });
  }

  const existingLink = await prisma.secureLink.findFirst({
    where: { workspaceId: workspace.id, scopeType: "PROOF_REQUEST", scopeId: proof.id, revokedAt: null },
  });
  if (!existingLink) {
    const { token, tokenHash } = generateToken();
    await prisma.secureLink.create({
      data: {
        workspaceId: workspace.id,
        purpose: "PROOF_UPLOAD",
        scopeType: "PROOF_REQUEST",
        scopeId: proof.id,
        contactId: samir.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        createdById: farina.id,
      },
    });
    proofLinkUrl = `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/link/${token}`;
  }

  // ── Representative evidence events
  const hasEvidence = await prisma.evidenceEvent.findFirst({
    where: { workspaceId: workspace.id, type: "PROOF_REQUESTED", scopeId: proof.id },
  });
  if (!hasEvidence) {
    await prisma.evidenceEvent.createMany({
      data: [
        {
          workspaceId: workspace.id,
          type: "PROOF_REQUESTED",
          actorType: "USER",
          actorId: farina.id,
          scopeType: "PROOF_REQUEST",
          scopeId: proof.id,
          payload: { title: proof.title },
        },
        {
          workspaceId: workspace.id,
          type: "DOCUMENT_UPLOADED",
          actorType: "USER",
          actorId: farina.id,
          scopeType: "TENANCY",
          scopeId: marinaTenancy.id,
          tenancyId: marinaTenancy.id,
          propertyId: marina.id,
          payload: { documentId: sampleDoc.id, fileName: sampleDoc.fileName },
        },
        {
          workspaceId: workspace.id,
          type: "CHEQUE_CLEARED",
          actorType: "USER",
          actorId: farina.id,
          scopeType: "TENANCY",
          scopeId: marinaTenancy.id,
          tenancyId: marinaTenancy.id,
          propertyId: marina.id,
          payload: { seq: 3, chequeNo: "000453", clearedDate: "2026-03-17" },
        },
      ],
    });
  }

  return { proofLinkUrl };
}
