import { expect, test, type Page } from "@playwright/test";
import { resetAndSeedE2E } from "../fixtures/globalSetup";
import { readManifest } from "../fixtures/manifest";
import { authState } from "../fixtures/paths";

const formattedDate = /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Oct|Nov|Dec) \d{4}\b/;

function dynamicDateMasks(page: Page) {
  return [
    page.locator("time"),
    page.locator('input[type="date"]'),
    page.getByText(formattedDate),
    page.getByText(/\b\d{4}-\d{2}-\d{2}\b/),
  ];
}

test.beforeAll(async ({}, testInfo) => {
  await resetAndSeedE2E(String(testInfo.project.use.baseURL ?? "http://127.0.0.1:3000"));
});

test.describe("operator visual contract", () => {
  test.use({ storageState: authState.workspaceAdmin, viewport: { width: 1440, height: 1000 } });

  for (const [name, href] of [
    ["dashboard", "/dashboard"],
    ["renewal-pipeline", "/renewals"],
    ["evidence-record", "/evidence"],
    ["proof-requests-writer", "/proofs"],
  ] as const) {
    test(`${name} visual`, async ({ page }) => {
      await page.goto(href);
      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: true,
        mask: dynamicDateMasks(page),
      });
    });
  }

  test("renewal task states visual", async ({ page }) => {
    const manifest = await readManifest();
    for (const [name, tenancyId, view] of [
      ["renewal-source-missing", manifest.sourceMissingTenancyId, "case"],
      ["renewal-awaiting-evidence", manifest.pendingEvidenceTenancyId, "case"],
      ["renewal-awaiting-tenant", manifest.awaitingTenantTenancyId, "terms"],
      ["renewal-ready-to-complete", manifest.readyToCompleteTenancyId, "terms"],
      ["renewal-completed", manifest.completedTenancyId, "evidence"],
    ] as const) {
      await page.goto(`/renewals/${tenancyId}?view=${view}`);
      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: true,
        mask: dynamicDateMasks(page),
      });
    }
  });
});

test("read-only proof layout visual", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    storageState: authState.auditor,
    baseURL,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/proofs");
  await expect(page).toHaveScreenshot("proof-requests-read-only.png", { fullPage: true, mask: dynamicDateMasks(page) });
  await context.close();
});

for (const [name, storageState] of [["tenant-portal", authState.tenant], ["landlord-portal", authState.landlord]] as const) {
  test(`${name} visual`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      storageState,
      baseURL,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto("/portal");
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, mask: dynamicDateMasks(page) });
    await context.close();
  });
}

test("mobile drawer visual", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    storageState: authState.workspaceAdmin,
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(page).toHaveScreenshot("mobile-navigation-open.png", { mask: dynamicDateMasks(page) });
  await context.close();
});
