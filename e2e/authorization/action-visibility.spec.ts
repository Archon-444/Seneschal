import { expect, test } from "@playwright/test";
import { readManifest } from "../fixtures/manifest";
import { authState } from "../fixtures/paths";

test.use({ storageState: authState.workspaceAdmin });

test("read-only renewal roles see records and explanations, not mutation controls", async ({ browser, baseURL }) => {
  const manifest = await readManifest();
  for (const storageState of [authState.agent, authState.licensedPartner, authState.auditor]) {
    const context = await browser.newContext({ storageState, baseURL });
    const page = await context.newPage();
    await page.goto(`/renewals/${manifest.sourceMissingTenancyId}`);
    await expect(page.getByRole("heading", { name: "Capture index source" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save index figure" })).toHaveCount(0);
    await expect(page.getByText(/captured by an authorized renewal operator/i)).toBeVisible();
    await page.goto(`/renewals/${manifest.readyToCompleteTenancyId}?view=terms`);
    await expect(page.getByText(/Terms are accepted\. A fiduciary or manager/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create successor tenancy" })).toHaveCount(0);
    await context.close();
  }
});

test("writer and decision roles see only the active renewal task", async ({ page }) => {
  const manifest = await readManifest();
  await page.goto(`/renewals/${manifest.sourceMissingTenancyId}`);
  await expect(page.getByRole("button", { name: "Save index figure" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open renewal case" })).toHaveCount(0);
  await page.goto(`/renewals/${manifest.provisionalTenancyId}`);
  await expect(page.getByText(/awaiting verification/i).first()).toBeVisible();
  await expect(page.getByText(/provisional concierge estimate/i)).toBeVisible();
  await page.goto(`/renewals/${manifest.pendingEvidenceTenancyId}`);
  await expect(page.getByRole("button", { name: "Confirm service with evidence" })).toBeVisible();
  await expect(page.getByText(/remains awaiting proof/i)).toBeVisible();
  await page.goto(`/renewals/${manifest.readyToCompleteTenancyId}?view=terms`);
  await expect(page.getByRole("button", { name: "Create successor tenancy" })).toBeVisible();
});

test.describe("writer context", () => {
  test.use({ storageState: authState.workspaceAdmin });

  test("proof writer gets scoped creation controls", async ({ page }) => {
    await page.goto("/proofs");
    await expect(page.getByRole("heading", { name: "New proof request" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Create & send secure link/ })).toBeVisible();
  });

  test("risk acknowledgements are shown only to an acknowledger", async ({ page }) => {
    await page.goto("/risk");
    await expect(page.getByRole("button", { name: "Acknowledge" }).first()).toBeVisible();
  });
});

test("proof and risk read-only views load without forbidden actions", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ storageState: authState.auditor, baseURL });
  const page = await context.newPage();
  await page.goto("/proofs");
  await expect(page.getByRole("heading", { name: "Proof requests" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "New proof request" })).toHaveCount(0);
  await page.goto("/risk");
  await expect(page.getByRole("heading", { name: "Risk flags" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Acknowledge" })).toHaveCount(0);
  await expect(page.getByText(/can be acknowledged by an authorized/i)).toBeVisible();
  await context.close();
});
