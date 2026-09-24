import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetAndSeedE2E } from "../fixtures/globalSetup";
import { readManifest } from "../fixtures/manifest";
import { authState } from "../fixtures/paths";

// Linux and Darwin Chromium baselines live in
// e2e/visual/pilot-screens.spec.ts-snapshots/. Dates are rewritten to one fixed
// value and then masked, so neither the values nor their width (en-GB writes
// September as "Sept") can move a layout; the rest is the visual contract.
// Pixel-diff gates re-break on font/browser bumps — maxDiffPixelRatio: 0.01
// absorbs anti-aliasing, not a Chromium major.

const formattedDate = /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Oct|Nov|Dec) \d{4}\b/;

function dynamicDateMasks(page: Page) {
  return [
    page.locator("time"),
    page.locator('input[type="date"]'),
    page.getByText(formattedDate),
    page.getByText(/\b\d{4}-\d{2}-\d{2}\b/),
  ];
}

/** Rewrite every rendered date to one fixed string, so a run's month never
 *  changes text widths, column widths or line wraps. */
async function stableDates(page: Page) {
  await page.evaluate(() => {
    const date = /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec) \d{4}\b/g;
    const iso = /\b\d{4}-\d{2}-\d{2}\b/g;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? "";
      const next = text.replace(date, "01 Jan 2026").replace(iso, "2026-01-01");
      if (next !== text) node.nodeValue = next;
    }
  });
}

/** The visual contract for one screen: stable dates, then masked. */
async function snapshot(page: Page, name: string, options: { fullPage?: boolean } = {}) {
  await stableDates(page);
  await expect(page).toHaveScreenshot(name, { ...options, mask: dynamicDateMasks(page) });
}

// TEMPORARY: print this run's actual renders into the job log so the Linux
// baselines can be refreshed from CI's own browser. Removed in the next commit.
test.afterEach(async ({}, testInfo) => {
  if (testInfo.retry > 0) return;
  for (const attachment of testInfo.attachments) {
    if (!attachment.name.endsWith("-actual.png") || !attachment.path) continue;
    const b64 = readFileSync(attachment.path).toString("base64");
    const size = 50_000;
    const total = Math.ceil(b64.length / size);
    for (let i = 0; i < total; i++) {
      console.log(`@@SNAP ${attachment.name} ${i + 1}/${total} ${b64.slice(i * size, (i + 1) * size)}`);
    }
  }
});

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
    ["dashboard", "/dashboard", "Know what is due"],
    ["renewal-pipeline", "/renewals", "A task-led queue"],
    ["evidence-record", "/evidence", "Fiduciary record"],
    ["proof-requests-writer", "/proofs", "Proof requests"],
  ] as const) {
    test(`${name} visual`, async ({ page }) => {
      await page.goto(href);
      await settled(page, marker);
      await snapshot(page, `${name}.png`, { fullPage: true });
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
      await snapshot(page, `${name}.png`, { fullPage: true });
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
  await snapshot(page, "proof-requests-read-only.png", { fullPage: true });
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
    await snapshot(page, `${name}.png`, { fullPage: true });
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
  await settled(page, "Know what is due");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible();
  await snapshot(page, "mobile-navigation-open.png");
  await context.close();
});
