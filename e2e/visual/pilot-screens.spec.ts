import { expect, test, type Page } from "@playwright/test";
import { resetAndSeedE2E } from "../fixtures/globalSetup";
import { readManifest } from "../fixtures/manifest";
import { authState } from "../fixtures/paths";

// Linux and Darwin Chromium baselines live in
// e2e/visual/pilot-screens.spec.ts-snapshots/. Dates are masked; the rest is
// the visual contract. Pixel-diff gates re-break on font/browser bumps —
// maxDiffPixelRatio: 0.01 absorbs anti-aliasing, not a Chromium major.

const formattedDate = /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Oct|Nov|Dec) \d{4}\b/;

function dynamicDateMasks(page: Page) {
  return [
    page.locator("time"),
    page.locator('input[type="date"]'),
    page.getByText(formattedDate),
    page.getByText(/\b\d{4}-\d{2}-\d{2}\b/),
  ];
}

/** Wait until the route has painted real content, not the segment skeleton. */
async function settled(page: Page, marker: string | RegExp) {
  await expect(page.getByText(marker).first()).toBeVisible();
}

test.beforeAll(async ({}, testInfo) => {
  await resetAndSeedE2E(String(testInfo.project.use.baseURL ?? "http://127.0.0.1:3000"));
});

test.describe("operator visual contract", () => {
  test.use({ storageState: authState.workspaceAdmin, viewport: { width: 1440, height: 1000 } });

  for (const [name, href, marker] of [
    ["dashboard", "/dashboard", "Seneschal keeps the record"],
    ["renewal-pipeline", "/renewals", "Index-based position"],
    ["evidence-record", "/evidence", "Fiduciary record"],
    ["proof-requests-writer", "/proofs", "Proof requests"],
  ] as const) {
    test(`${name} visual`, async ({ page }) => {
      await page.goto(href);
      await settled(page, marker);
      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: true,
        mask: dynamicDateMasks(page),
      });
    });
  }

  for (const [name, tenancyKey, view] of [
    ["renewal-source-missing", "sourceMissingTenancyId", "case"],
    ["renewal-awaiting-evidence", "pendingEvidenceTenancyId", "case"],
    ["renewal-awaiting-tenant", "awaitingTenantTenancyId", "terms"],
    ["renewal-ready-to-complete", "readyToCompleteTenancyId", "terms"],
    ["renewal-completed", "completedTenancyId", "evidence"],
  ] as const) {
    test(`${name} visual`, async ({ page }) => {
      const manifest = await readManifest();
      const tenancyId = manifest[tenancyKey];
      await page.goto(`/renewals/${tenancyId}?view=${view}`);
      await settled(page, "Renewal case workspace");
      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage: true,
        mask: dynamicDateMasks(page),
      });
    });
  }
});

test("read-only proof layout visual", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    storageState: authState.auditor,
    baseURL,
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/proofs");
  await settled(page, "Proof requests");
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
    await settled(page, name === "tenant-portal" ? "Tenant portal" : "Landlord portal");
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
  await settled(page, "Seneschal keeps the record");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible();
  await expect(page).toHaveScreenshot("mobile-navigation-open.png", { mask: dynamicDateMasks(page) });
  await context.close();
});
