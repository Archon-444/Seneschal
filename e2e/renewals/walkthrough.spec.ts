import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { sha256Hex } from "../../src/server/crypto";
import { readManifest } from "../fixtures/manifest";
import { authState } from "../fixtures/paths";

test.use({ storageState: authState.workspaceAdmin });

test("operator completes the renewal loop and can inspect the successor evidence", async ({ page }) => {
  test.setTimeout(120_000);
  const prisma = new PrismaClient();
  const manifest = await readManifest();
  const tenancyId = manifest.workflowTenancyId;

  await page.goto(`/renewals/${tenancyId}`);
  await expect(page.getByRole("heading", { name: "Capture index source" }).first()).toBeVisible();
  await page.getByLabel("Index average market rent (AED/yr)").fill("100000");
  await page.locator('select[name="indexSource"]').selectOption("SMART_RENTAL_INDEX_2025");
  await page.getByLabel("Source reference (URL / screenshot id)").fill("https://dubailand.gov.ae/e2e-workflow");
  await page.getByRole("button", { name: "Save index figure" }).click();

  await expect(page.getByRole("heading", { name: "Open renewal case" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Open renewal case" }).click();
  await expect(page.getByRole("heading", { name: "Serve notice with proof" }).first()).toBeVisible();
  await page.getByLabel("Delivery reference").fill("E2E-inbox-reference");
  await page.getByRole("button", { name: "Record notice service" }).click();

  await expect(page.getByRole("heading", { name: "Prepare renewal terms" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Open terms workspace" }).click();
  await page.getByLabel("Annual rent (AED)").fill("84000");
  await page.getByLabel("Payment schedule").fill("4 cheques");
  await page.getByLabel("Method").fill("Cheque");
  await page.getByRole("button", { name: "Add terms version" }).click();
  await expect(page.getByRole("button", { name: "Send to tenant" })).toBeVisible();
  await page.getByRole("button", { name: "Send to tenant" }).click();
  await expect(page.getByRole("heading", { name: "Awaiting tenant response" })).toBeVisible();

  const offer = await prisma.offer.findFirstOrThrow({
    where: { tenancyId, status: "SENT" },
    orderBy: { version: "desc" },
  });
  const tenant = await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } });
  const operator = await prisma.user.findUniqueOrThrow({ where: { email: "operator@example.com" } });
  const rawToken = "e2e-workflow-tenant-offer-release-gate";
  await prisma.secureLink.create({
    data: {
      workspaceId: manifest.workspaceId,
      purpose: "TENANT_OFFER",
      scopeType: "OFFER",
      scopeId: offer.id,
      contactId: tenant.tenantContactId,
      tokenHash: sha256Hex(rawToken),
      expiresAt: new Date(Date.now() + 86_400_000),
      maxUses: 1,
      createdById: operator.id,
    },
  });

  await page.goto(`/link/${rawToken}`);
  await expect(page.getByRole("heading", { name: "Renewal proposal" })).toBeVisible();
  await expect(page.getByText("AED 84,000").first()).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText(/acceptance has been recorded/i)).toBeVisible();

  await page.goto(`/renewals/${tenancyId}?view=terms`);
  await expect(page.getByRole("heading", { name: "Complete renewal" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Create successor tenancy" }).click();
  await expect(page.getByRole("heading", { name: "Review completed renewal" }).first()).toBeVisible();
  await page.goto(`/renewals/${tenancyId}?view=evidence`);
  await expect(page.getByRole("heading", { name: "Renewal complete" })).toBeVisible();
  await expect(page.getByText(/successor term/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Successor tenancy created" })).toBeVisible();
  await page.goto(`/renewals/${tenancyId}?view=terms`);
  await expect(page.getByRole("button", { name: "Create successor tenancy" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Review completed renewal" }).first()).toBeVisible();

  const predecessor = await prisma.tenancy.findUniqueOrThrow({ where: { id: tenancyId } });
  const successor = await prisma.tenancy.findFirstOrThrow({ where: { renewsFromTenancyId: tenancyId } });
  expect(predecessor.status).toBe("RENEWED");
  expect(successor.renewsFromTenancyId).toBe(tenancyId);
  expect(Number(successor.annualRent)).toBe(84_000);
  expect(await prisma.evidenceEvent.count({ where: { type: "RENEWAL_COMPLETED", scopeId: offer.renewalCaseId! } })).toBe(1);
  await prisma.$disconnect();
});
