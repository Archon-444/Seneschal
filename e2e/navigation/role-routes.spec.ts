import { expect, test } from "@playwright/test";
import { authState } from "../fixtures/paths";

const operatorRoles = [
  ["workspace admin", authState.workspaceAdmin],
  ["fiduciary", authState.fiduciary],
  ["manager", authState.manager],
  ["agent", authState.agent],
  ["managing agent", authState.managingAgent],
  ["licensed partner", authState.licensedPartner],
  ["client viewer", authState.clientViewer],
  ["auditor", authState.auditor],
  ["org admin", authState.orgAdmin],
] as const;

for (const [role, storageState] of operatorRoles) {
  test(`${role} can open every advertised route`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ storageState, baseURL });
    const page = await context.newPage();
    await page.goto(role === "org admin" ? "/members" : "/dashboard");
    const more = page.getByRole("button", { name: "More" });
    if (await more.isVisible()) await more.click();
    const hrefs = await page.locator("aside:visible nav a").evaluateAll((links) =>
      [...new Set(links.map((link) => (link as HTMLAnchorElement).getAttribute("href")).filter(Boolean))] as string[],
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const response = await page.goto(href);
      expect(response?.status(), `${role}: ${href}`).toBeLessThan(400);
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    }
    await context.close();
  });
}

test.describe("quarantine and shell boundaries", () => {
  test.use({ storageState: authState.workspaceAdmin });

  test("quarantined marketplace routes fail closed and stay out of navigation", async ({ page }) => {
    await page.goto("/dashboard");
    const navigation = await page.locator("aside:visible nav").innerText();
    expect(navigation).not.toMatch(/Listings|Enquiries|Viewings|Passport/);
    for (const href of ["/enquiries", "/viewings"]) {
      const response = await page.goto(href);
      expect(response?.status(), href).toBe(404);
    }
  });
});

for (const [storageState, href] of [
  [authState.landlord, "/portal/listings"],
  [authState.tenant, "/portal/passport"],
] as const) {
  test(`${href} is quarantined inside the matching persona shell`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ storageState, baseURL });
    const page = await context.newPage();
    const response = await page.goto(href);
    expect(response?.status()).toBe(404);
    await context.close();
  });
}

test("people-only org admin is not offered workspace data", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ storageState: authState.orgAdmin, baseURL });
  const page = await context.newPage();
  await page.goto("/members");
  await expect(page.getByRole("link", { name: "Members & access" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Renewals|Properties|Clients|Evidence/ })).toHaveCount(0);
  await context.close();
});

test("platform operator remains on the data-blind console", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ storageState: authState.platformAdmin, baseURL });
  const page = await context.newPage();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: /Platform/ })).toBeVisible();
  await expect(page.getByText("Marina Heights Tower")).toHaveCount(0);
  await context.close();
});

for (const [persona, storageState] of [["tenant", authState.tenant], ["landlord", authState.landlord]] as const) {
  test(`${persona} persona stays on its contact-scoped portal`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ storageState, baseURL });
    const page = await context.newPage();
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const hrefs = await page.locator("aside:visible nav a").evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
    expect(hrefs.every((href) => href.startsWith("/portal"))).toBe(true);
    await context.close();
  });
}
