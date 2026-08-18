import { mkdir, writeFile } from "node:fs/promises";
import type { FullConfig } from "@playwright/test";
import { Prisma, PrismaClient, type Role } from "@prisma/client";
import { runSeed } from "../../src/server/seed";
import { contextFromMembership } from "../../src/server/authz";
import { sha256Hex } from "../../src/server/crypto";
import {
  captureRentIndex,
  mintRenewedTenancy,
  openRenewalCase,
  proposeOffer,
  respondToOfferViaLink,
  sendOfferToTenant,
} from "../../src/server/services/renewals";
import { serveRenewalNotice } from "../../src/server/services/notice";
import { validateLinkToken } from "../../src/server/services/secureLinks";
import { authDir, authState, manifestPath, type E2EManifest } from "./paths";

const prisma = new PrismaClient();

function day(offset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset));
}

async function resetTestDatabase() {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  if (!url || (!url.includes("localhost") && !url.includes("127.0.0.1")) || !url.includes("test")) {
    throw new Error("E2E database reset is restricted to a local test database.");
  }
  await prisma.$executeRawUnsafe(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations')
      LOOP EXECUTE 'TRUNCATE TABLE "' || r.tablename || '" CASCADE'; END LOOP;
    END $$;
  `);
}

async function ensureMembership(
  workspaceId: string,
  email: string,
  role: Role,
  scope: { clientPrincipalId?: string; subjectContactId?: string } = {},
) {
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: `E2E ${role.replaceAll("_", " ")}`, locale: "en" },
  });
  const membership = await prisma.membership.upsert({
    where: { workspaceId_userId_role: { workspaceId, userId: user.id, role } },
    update: { revokedAt: null, ...scope },
    create: { workspaceId, userId: user.id, role, ...scope },
  });
  return { user, membership };
}

async function writeStorageState(
  file: string,
  userId: string,
  workspaceId: string | null,
  baseURL: string,
) {
  const token = `e2e-session-${file.split("/").at(-1)}`;
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      expiresAt: day(30),
      device: "Playwright release gate",
    },
  });
  const url = new URL(baseURL);
  const cookies = [
    {
      name: "seneschal_session",
      value: token,
      domain: url.hostname,
      path: "/",
      expires: Math.floor(day(30).getTime() / 1000),
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax" as const,
    },
  ];
  if (workspaceId) {
    cookies.push({
      name: "seneschal_workspace",
      value: workspaceId,
      domain: url.hostname,
      path: "/",
      expires: Math.floor(day(30).getTime() / 1000),
      httpOnly: false,
      secure: url.protocol === "https:",
      sameSite: "Lax" as const,
    });
  }
  await writeFile(file, JSON.stringify({ cookies, origins: [] }), { mode: 0o600 });
}

async function createRenewalTenancy(
  workspaceId: string,
  clientPrincipalId: string,
  tenantContactId: string,
  landlordContactId: string,
  label: string,
  endOffset: number,
) {
  const property = await prisma.property.create({
    data: {
      workspaceId,
      clientPrincipalId,
      ownerContactId: landlordContactId,
      community: "Dubai Marina",
      building: `E2E ${label} Tower`,
      unitNo: String(endOffset),
      propertyType: "apartment",
      bedrooms: 2,
      sizeSqft: 1100,
    },
  });
  return prisma.tenancy.create({
    data: {
      workspaceId,
      propertyId: property.id,
      tenantContactId,
      landlordContactId,
      ejariNo: `E2E-${label.toUpperCase().replaceAll(" ", "-")}`,
      startDate: day(endOffset - 365),
      endDate: day(endOffset),
      annualRent: new Prisma.Decimal(80_000),
      depositAmount: new Prisma.Decimal(4_000),
      noticePeriodDays: 90,
      source: "MANUAL",
    },
  });
}

async function advanceRenewal(
  ctx: ReturnType<typeof contextFromMembership>,
  tenancyId: string,
  state: "pending" | "awaiting" | "ready" | "completed",
) {
  await captureRentIndex(ctx, {
    tenancyId,
    marketRentAvg: 100_000,
    capturedAt: day(-1),
    indexSource: "SMART_RENTAL_INDEX_2025",
    sourceRef: { reference: "https://dubailand.gov.ae/e2e-source" },
  });
  const renewalCase = await openRenewalCase(ctx, tenancyId);
  await serveRenewalNotice(ctx, {
    renewalCaseId: renewalCase.id,
    serviceMethod: "EMAIL",
    serviceRef: state === "pending" ? undefined : `E2E-${state}-delivery`,
  });
  if (state === "pending") return;
  const offer = await proposeOffer(ctx, {
    renewalCaseId: renewalCase.id,
    party: "LANDLORD",
    annualRent: 84_000,
    paymentSchedule: "4 cheques",
    paymentMethod: "Cheque",
  });
  const link = await sendOfferToTenant(ctx, offer.id);
  if (state === "awaiting") return;
  const token = link.url.split("/link/")[1];
  const validation = await validateLinkToken(token);
  if (!validation.ok) throw new Error("Could not validate the E2E tenant-offer link.");
  await respondToOfferViaLink(validation.link, { action: "ACCEPT" });
  if (state === "completed") {
    const tenancy = await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } });
    await mintRenewedTenancy(ctx, {
      renewalCaseId: renewalCase.id,
      startDate: new Date(tenancy.endDate.getTime() + 86_400_000),
      endDate: new Date(tenancy.endDate.getTime() + 366 * 86_400_000),
      annualRent: 84_000,
      paymentTermsNote: "4 cheques",
      chequeCount: 4,
    });
  }
}

export async function resetAndSeedE2E(baseURL: string) {
  await mkdir(authDir, { recursive: true });
  await resetTestDatabase();
  await runSeed({ adminEmail: "operator@example.com" });

  const workspace = await prisma.workspace.findFirstOrThrow({ where: { name: "Example", type: "FIDUCIARY" } });
  const client = await prisma.clientPrincipal.findFirstOrThrow({
    where: { workspaceId: workspace.id, displayName: "Al Noor Family Office" },
  });
  const tenantContact = await prisma.contact.findFirstOrThrow({
    where: { workspaceId: workspace.id, name: "Ricardo Fernandes" },
  });
  const landlordContact = await prisma.contact.findFirstOrThrow({
    where: { workspaceId: workspace.id, name: "Yusuf Haddad" },
  });

  const agent = await ensureMembership(workspace.id, "agent-e2e@example.com", "AGENT");
  const partner = await ensureMembership(workspace.id, "licensed-partner-e2e@example.com", "LICENSED_PARTNER");
  const tenant = await ensureMembership(workspace.id, "tenant-e2e@example.com", "TENANT", {
    subjectContactId: tenantContact.id,
  });

  const operator = await prisma.user.findUniqueOrThrow({ where: { email: "operator@example.com" } });
  const operatorMembership = await prisma.membership.findFirstOrThrow({
    where: { workspaceId: workspace.id, userId: operator.id, role: "WORKSPACE_ADMIN", revokedAt: null },
  });
  const ctx = contextFromMembership(operator, operatorMembership);

  const workflow = await createRenewalTenancy(
    workspace.id, client.id, tenantContact.id, landlordContact.id, "Workflow", 100,
  );
  const sourceMissing = await createRenewalTenancy(
    workspace.id, client.id, tenantContact.id, landlordContact.id, "Source Missing", 105,
  );
  const provisional = await createRenewalTenancy(
    workspace.id, client.id, tenantContact.id, landlordContact.id, "Provisional", 108,
  );
  const pending = await createRenewalTenancy(
    workspace.id, client.id, tenantContact.id, landlordContact.id, "Pending Evidence", 110,
  );
  const awaiting = await createRenewalTenancy(
    workspace.id, client.id, tenantContact.id, landlordContact.id, "Awaiting Tenant", 115,
  );
  const ready = await createRenewalTenancy(
    workspace.id, client.id, tenantContact.id, landlordContact.id, "Ready", 120,
  );
  const completed = await createRenewalTenancy(
    workspace.id, client.id, tenantContact.id, landlordContact.id, "Completed", 125,
  );
  const stale = await createRenewalTenancy(
    workspace.id, client.id, tenantContact.id, landlordContact.id, "Stale Offer", 130,
  );
  await captureRentIndex(ctx, {
    tenancyId: provisional.id,
    marketRentAvg: 98_000,
    capturedAt: day(-1),
    indexSource: "MANUAL_CONCIERGE",
    sourceRef: { reference: "E2E provisional concierge estimate" },
  });
  await advanceRenewal(ctx, pending.id, "pending");
  await advanceRenewal(ctx, awaiting.id, "awaiting");
  await advanceRenewal(ctx, ready.id, "ready");
  await advanceRenewal(ctx, completed.id, "completed");

  await captureRentIndex(ctx, {
    tenancyId: stale.id,
    marketRentAvg: 100_000,
    capturedAt: day(-1),
    indexSource: "SMART_RENTAL_INDEX_2025",
    sourceRef: { reference: "https://dubailand.gov.ae/e2e-stale-offer" },
  });
  const staleCase = await openRenewalCase(ctx, stale.id);
  await serveRenewalNotice(ctx, {
    renewalCaseId: staleCase.id,
    serviceMethod: "EMAIL",
    serviceRef: "E2E-stale-offer-delivery",
  });
  const staleOffer = await proposeOffer(ctx, {
    renewalCaseId: staleCase.id,
    party: "LANDLORD",
    annualRent: 83_000,
    paymentSchedule: "4 cheques",
  });
  const staleOfferToken = "e2e-stale-tenant-offer-release-gate";
  await prisma.secureLink.create({
    data: {
      workspaceId: workspace.id,
      purpose: "TENANT_OFFER",
      scopeType: "OFFER",
      scopeId: staleOffer.id,
      contactId: tenantContact.id,
      tokenHash: sha256Hex(staleOfferToken),
      expiresAt: day(14),
      maxUses: 2,
      createdById: operator.id,
    },
  });
  await proposeOffer(ctx, {
    renewalCaseId: staleCase.id,
    party: "LANDLORD",
    annualRent: 84_000,
    paymentSchedule: "4 cheques",
  });

  const proofRequest = await prisma.proofRequest.create({
    data: {
      workspaceId: workspace.id,
      scopeType: "TENANCY",
      scopeId: workflow.id,
      title: "E2E proof of delivery",
      requiredEvidence: "Upload the delivery receipt used by the browser release gate.",
      assignedContactId: tenantContact.id,
      dueAt: day(7),
      status: "SENT",
      createdById: operator.id,
    },
  });
  const rawTokens = {
    validProof: "e2e-valid-proof-token-release-gate",
    expiredProof: "e2e-expired-proof-token-release-gate",
    exhaustedProof: "e2e-exhausted-proof-token-release-gate",
  };
  await prisma.secureLink.createMany({
    data: [
      {
        workspaceId: workspace.id,
        purpose: "PROOF_UPLOAD",
        scopeType: "PROOF_REQUEST",
        scopeId: proofRequest.id,
        contactId: tenantContact.id,
        tokenHash: sha256Hex(rawTokens.validProof),
        expiresAt: day(14),
        maxUses: 3,
        createdById: operator.id,
      },
      {
        workspaceId: workspace.id,
        purpose: "PROOF_UPLOAD",
        scopeType: "PROOF_REQUEST",
        scopeId: proofRequest.id,
        contactId: tenantContact.id,
        tokenHash: sha256Hex(rawTokens.expiredProof),
        expiresAt: day(-1),
        maxUses: 3,
        createdById: operator.id,
      },
      {
        workspaceId: workspace.id,
        purpose: "PROOF_UPLOAD",
        scopeType: "PROOF_REQUEST",
        scopeId: proofRequest.id,
        contactId: tenantContact.id,
        tokenHash: sha256Hex(rawTokens.exhaustedProof),
        expiresAt: day(14),
        maxUses: 1,
        useCount: 1,
        createdById: operator.id,
      },
    ],
  });

  const users = {
    workspaceAdmin: operator,
    fiduciary: await prisma.user.findUniqueOrThrow({ where: { email: "farina@example.com" } }),
    manager: await prisma.user.findUniqueOrThrow({ where: { email: "manager@example.com" } }),
    agent: agent.user,
    managingAgent: await prisma.user.findUniqueOrThrow({ where: { email: "managing-agent@example.com" } }),
    licensedPartner: partner.user,
    clientViewer: await prisma.user.findUniqueOrThrow({ where: { email: "absentee-owner@example.com" } }),
    auditor: await prisma.user.findUniqueOrThrow({ where: { email: "auditor@example.com" } }),
    orgAdmin: await prisma.user.findUniqueOrThrow({ where: { email: "org-admin@example.com" } }),
    tenant: tenant.user,
    landlord: await prisma.user.findUniqueOrThrow({ where: { email: "owner@example.com" } }),
    platformAdmin: await prisma.user.findUniqueOrThrow({ where: { email: "staff@seneschal.example" } }),
  };
  for (const key of Object.keys(authState) as (keyof typeof authState)[]) {
    await writeStorageState(
      authState[key],
      users[key].id,
      key === "platformAdmin" ? null : workspace.id,
      baseURL,
    );
  }

  const manifest: E2EManifest = {
    workspaceId: workspace.id,
    workflowTenancyId: workflow.id,
    sourceMissingTenancyId: sourceMissing.id,
    provisionalTenancyId: provisional.id,
    pendingEvidenceTenancyId: pending.id,
    awaitingTenantTenancyId: awaiting.id,
    readyToCompleteTenancyId: ready.id,
    completedTenancyId: completed.id,
    proofRequestId: proofRequest.id,
    links: {
      validProof: `${baseURL}/link/${rawTokens.validProof}`,
      expiredProof: `${baseURL}/link/${rawTokens.expiredProof}`,
      exhaustedProof: `${baseURL}/link/${rawTokens.exhaustedProof}`,
      staleOffer: `${baseURL}/link/${staleOfferToken}`,
    },
  };
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  await prisma.$disconnect();
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = String(config.projects[0]?.use.baseURL ?? "http://127.0.0.1:3000");
  await resetAndSeedE2E(baseURL);
}
