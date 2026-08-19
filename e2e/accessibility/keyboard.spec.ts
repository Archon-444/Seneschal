import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { readManifest } from "../fixtures/manifest";
import { authState } from "../fixtures/paths";

test.describe("mobile navigation dialog", () => {
  test.use({ storageState: authState.workspaceAdmin, viewport: { width: 390, height: 844 } });

  test("contains focus, closes by keyboard/backdrop/navigation, and restores the shell", async ({ page }) => {
    await page.goto("/dashboard");
    const trigger = page.getByRole("button", { name: "Open navigation menu" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Navigation menu" });
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "Close navigation menu" })).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 20; i++) await page.keyboard.press("Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await page.evaluate(() => (document.querySelector("#main-content") as HTMLElement)?.focus());
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");

    await trigger.click();
    await page.mouse.click(360, 400);
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.getByRole("link", { name: "Renewals" }).click();
    await expect(page).toHaveURL(/\/renewals/);
    await expect(dialog).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("crossing the desktop breakpoint removes modal state and scroll lock", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await expect(page.getByRole("dialog", { name: "Navigation menu" })).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.getByRole("dialog", { name: "Navigation menu" })).not.toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  });
});

test.describe("operator keyboard primitives", () => {
  test.use({ storageState: authState.workspaceAdmin });

  test("skip link, search dialog, create menu, and evidence disclosures are operable", async ({ page }) => {
    await page.goto("/dashboard");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();

    const search = page.getByRole("button", { name: /Search/ });
    await search.click();
    await expect(page.getByRole("dialog", { name: "Search records" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: /Search properties/ })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(search).toBeFocused();

    const create = page.getByRole("button", { name: "Create new" });
    await create.click();
    await expect(page.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(create).toBeFocused();

    await page.goto("/evidence");
    const details = page.locator("details").filter({ hasText: "Technical details" }).first();
    const technical = details.locator("summary");
    // Focus can be dropped by hydration reconciling the tree underneath us, so
    // retry until it holds. Without this the key is dispatched to whatever else
    // has focus and the disclosure silently never toggles (see #98 for the same
    // interactive-before-hydrated family). Pressing on the locator keeps this an
    // assertion about keyboard operability rather than a click.
    await expect(async () => {
      await technical.focus();
      await expect(technical).toBeFocused();
    }).toPass({ timeout: 10_000 });
    await technical.press(" ");
    await expect(details).toHaveJSProperty("open", true);
  });

  test("confirmation dialog traps Escape and returns to its trigger", async ({ page }) => {
    const prisma = new PrismaClient();
    const manifest = await readManifest();
    const tenancy = await prisma.tenancy.findUniqueOrThrow({
      where: { id: manifest.workflowTenancyId },
      include: { property: true },
    });
    const payment = await prisma.paymentItem.findFirst({ where: { tenancyId: tenancy.id } });
    const item = payment ?? await prisma.paymentItem.create({
      data: {
        workspaceId: manifest.workspaceId,
        tenancyId: tenancy.id,
        seq: 1,
        dueDate: new Date(),
        amount: 20_000,
        instrument: "CHEQUE",
        chequeNo: "E2E-BOUNCE",
        status: "DEPOSITED",
      },
    });
    if (item.status !== "DEPOSITED") {
      await prisma.paymentItem.update({ where: { id: item.id }, data: { status: "DEPOSITED" } });
    }
    await prisma.$disconnect();

    await page.goto(`/properties/${tenancy.property.id}?tab=payments`);
    const trigger = page.getByRole("button", { name: "Mark bounced" }).first();
    await trigger.click();
    await expect(page.getByRole("alertdialog", { name: "Record cheque as bounced?" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
});
