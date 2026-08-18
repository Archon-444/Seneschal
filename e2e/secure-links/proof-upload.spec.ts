import { expect, test } from "@playwright/test";
import { readManifest } from "../fixtures/manifest";

test("valid proof link records a user-visible receipt without exposing its token", async ({ page }) => {
  const manifest = await readManifest();
  await page.goto(manifest.links.validProof);
  await expect(page.getByRole("heading", { name: "E2E proof of delivery" })).toBeVisible();
  await page.getByLabel("Photo or document").setInputFiles({
    name: "delivery-receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 E2E proof fixture"),
  });
  await page.getByLabel("Note (optional)").fill("Received by the concierge desk");
  await page.getByRole("button", { name: "Submit proof" }).click();
  await expect(page.getByText(/file was received and recorded/i)).toBeVisible();
  await expect(page.getByText("delivery-receipt.pdf")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("e2e-valid-proof-token-release-gate");
});

test("expired, exhausted, and stale links fail with the same calm message", async ({ page }) => {
  const manifest = await readManifest();
  for (const href of [manifest.links.expiredProof, manifest.links.exhaustedProof, manifest.links.staleOffer]) {
    await page.goto(href);
    await expect(page.getByRole("heading", { name: "This link is no longer available" })).toBeVisible();
    await expect(page.getByText(/expired, been used already, or been withdrawn/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit proof" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
  }
});
