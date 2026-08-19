import { test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "../fixtures/a11y";
import { readManifest } from "../fixtures/manifest";
import { authState } from "../fixtures/paths";

test("public sign-in has no serious accessibility violations", async ({ page }) => {
  await page.goto("/login");
  await expectNoSeriousA11yViolations(page);
});

test("operator pilot pages have no serious accessibility violations", async ({ browser, baseURL }) => {
  const manifest = await readManifest();
  const context = await browser.newContext({ storageState: authState.workspaceAdmin, baseURL });
  const page = await context.newPage();
  for (const href of [
    "/dashboard",
    "/renewals",
    `/renewals/${manifest.pendingEvidenceTenancyId}`,
    "/evidence",
    "/proofs",
  ]) {
    await page.goto(href);
    await expectNoSeriousA11yViolations(page);
  }
  await context.close();
});

for (const [name, storageState, href] of [
  ["tenant portal", authState.tenant, "/portal"],
  ["landlord portal", authState.landlord, "/portal"],
  ["platform console", authState.platformAdmin, "/admin"],
] as const) {
  test(`${name} has no serious accessibility violations`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ storageState, baseURL });
    const page = await context.newPage();
    await page.goto(href);
    await expectNoSeriousA11yViolations(page);
    await context.close();
  });
}

test("open mobile navigation has no serious accessibility violations", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    storageState: authState.workspaceAdmin,
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expectNoSeriousA11yViolations(page);
  await context.close();
});
