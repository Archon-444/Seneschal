import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { generateToken, sha256Hex } from "./crypto";
import { toUtcDateOnly } from "./calculators/dates";
import { regenerateDeadlinesForTenancy } from "./services/deadlines";
import { evaluateRiskForTenancy } from "./services/risk";
import { newStorageKey, storage } from "./storage";
import { listingReadiness } from "./calculators/listingReadiness";

// Idempotent seed (T0.2): creates the demo workspace fixture set per the
// build handoff. Safe to run repeatedly — every create is find-or-create.
// Nothing about the operator is hard-coded: the operator IS the configured login
// (SEED_ADMIN_EMAIL), carries no fabricated display name (the UI falls back to the
// email), and the workspace name is derived from the login domain.

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

/** Workspace name derived from the operator's login domain (no hard-coded brand):
 *  e.g. operator@acme.com → "Acme". Falls back to "Workspace" if there is no domain. */
export function orgNameFromEmail(email: string): string {
  const root = (email.split("@")[1] ?? "").split(".")[0] ?? "";
  return root ? root[0].toUpperCase() + root.slice(1) : "Workspace";
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

  // The operator is the configured login (SEED_ADMIN_EMAIL); in dev where none is set,
  // a neutral placeholder login. No fabricated display name — the UI shows the email
  // and nothing where there is no profile name. Workspace name comes from the login domain.
  const operatorEmail = opts?.adminEmail ? normalizeAdminEmail(opts.adminEmail) : "operator@example.com";
  const orgName = orgNameFromEmail(operatorEmail);

  const workspace = await findOrCreate(
    () => prisma.workspace.findFirst({ where: { name: orgName, type: "FIDUCIARY" } }),
    () => prisma.workspace.create({ data: { name: orgName, type: "FIDUCIARY" } }),
  );

  const operator = await prisma.user.upsert({
    where: { email: operatorEmail },
    update: {},
    create: { email: operatorEmail, name: "", locale: "en" },
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
        userId: operator.id,
        role: "FIDUCIARY",
      },
    },
    update: {},
    create: { workspaceId: workspace.id, userId: operator.id, role: "FIDUCIARY" },
  });

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
        uploadedById: operator.id,
      },
    });
    await prisma.documentAccessLog.create({
      data: {
        workspaceId: workspace.id,
        documentId: sampleDoc.id,
        actorUserId: operator.id,
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
          createdById: operator.id,
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
        createdById: operator.id,
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
          actorId: operator.id,
          scopeType: "PROOF_REQUEST",
          scopeId: proof.id,
          payload: { title: proof.title },
        },
        {
          workspaceId: workspace.id,
          type: "DOCUMENT_UPLOADED",
          actorType: "USER",
          actorId: operator.id,
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
          actorId: operator.id,
          scopeType: "TENANCY",
          scopeId: marinaTenancy.id,
          tenancyId: marinaTenancy.id,
          propertyId: marina.id,
          payload: { seq: 3, chequeNo: "000453", clearedDate: "2026-03-17" },
        },
      ],
    });
  }

  // ── Persona logins (F0b): a TENANT and a LANDLORD self-service account.
  // TENANT attaches to the existing Ricardo Fernandes contact (tenant of the Marina
  // unit), so the tenant portal renders his real, contact-scoped tenancy + cheques.
  const tenantUser = await prisma.user.upsert({
    where: { email: "r.fernandes@example.com" },
    update: {},
    create: { email: "r.fernandes@example.com", name: "Ricardo Fernandes", locale: "en" },
  });
  await prisma.membership.upsert({
    where: {
      workspaceId_userId_role: { workspaceId: workspace.id, userId: tenantUser.id, role: "TENANT" },
    },
    update: { subjectContactId: fernandes.id, revokedAt: null },
    create: {
      workspaceId: workspace.id,
      userId: tenantUser.id,
      role: "TENANT",
      subjectContactId: fernandes.id,
    },
  });

  // LANDLORD attaches to an OWNER contact set as Property.ownerContactId on the
  // Marina unit (occupied) plus one VACANT unit — so the landlord portal proves
  // Decision 4: an owner sees a unit with no live tenancy.
  const owner = await findOrCreate(
    () => prisma.contact.findFirst({ where: { workspaceId: workspace.id, name: "Yusuf Haddad" } }),
    () =>
      prisma.contact.create({
        data: {
          workspaceId: workspace.id,
          kind: "OWNER",
          name: "Yusuf Haddad",
          email: "owner@example.com",
          phone: "+971-50-555-0199",
        },
      }),
  );
  if (marina.ownerContactId !== owner.id) {
    await prisma.property.update({ where: { id: marina.id }, data: { ownerContactId: owner.id } });
  }
  const palmVista = await findOrCreate(
    () => prisma.property.findFirst({ where: { workspaceId: workspace.id, building: "Palm Vista", unitNo: "12" } }),
    () =>
      prisma.property.create({
        data: {
          workspaceId: workspace.id,
          clientPrincipalId: alNoor.id,
          ownerContactId: owner.id,
          community: "Palm Jumeirah",
          building: "Palm Vista",
          unitNo: "12",
          propertyType: "villa",
          bedrooms: 3,
          sizeSqft: 3200,
        },
      }),
  );
  const ownerUser = await prisma.user.upsert({
    where: { email: "owner@example.com" },
    update: {},
    create: { email: "owner@example.com", name: "Yusuf Haddad", locale: "en" },
  });
  await prisma.membership.upsert({
    where: {
      workspaceId_userId_role: { workspaceId: workspace.id, userId: ownerUser.id, role: "LANDLORD" },
    },
    update: { subjectContactId: owner.id, revokedAt: null },
    create: {
      workspaceId: workspace.id,
      userId: ownerUser.id,
      role: "LANDLORD",
      subjectContactId: owner.id,
    },
  });

  // ── Listings (1B): a draft listing on the vacant Palm Vista villa. Deliberately
  // missing the RERA permit, so it sits below the publish gate — a live demo of the
  // readiness score the landlord portal surfaces.
  const existingListing = await prisma.listing.findFirst({
    where: { workspaceId: workspace.id, propertyId: palmVista.id },
  });
  if (!existingListing) {
    const readiness = listingReadiness({
      askingRent: 220000,
      availableFrom: date("2026-08-01"),
      furnished: true,
      description: "Upgraded 3-bed Palm villa with private beach access, maid's room and two covered parking bays.",
      permitRef: null, // intentionally absent → cannot publish yet
      bedrooms: palmVista.bedrooms,
      sizeSqft: palmVista.sizeSqft,
    });
    await prisma.listing.create({
      data: {
        workspaceId: workspace.id,
        propertyId: palmVista.id,
        status: "DRAFT",
        headline: "Palm Jumeirah 3BR villa — beach access",
        askingRent: new Prisma.Decimal(220000),
        availableFrom: date("2026-08-01"),
        furnished: true,
        description: "Upgraded 3-bed Palm villa with private beach access, maid's room and two covered parking bays.",
        readinessScore: readiness.score,
        readiness: readiness as unknown as Prisma.InputJsonValue,
        createdById: operator.id,
      },
    });
  }

  return { proofLinkUrl };
}
