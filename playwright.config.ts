import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env.CI);
process.env.TEST_DATABASE_URL ??= "postgresql://seneschal:seneschal@localhost:5432/seneschal_test";
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
process.env.APP_SECRET ??= "e2e-local-secret";
process.env.APP_BASE_URL ??= "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/fixtures/globalSetup.ts",
  fullyParallel: false,
  workers: 1,
  retries: ci ? 1 : 0,
  forbidOnly: ci,
  timeout: 45_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: { animations: "disabled", maxDiffPixelRatio: 0.01 },
  },
  reporter: ci
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}{ext}",
  use: {
    baseURL: process.env.APP_BASE_URL ?? "http://127.0.0.1:3000",
    locale: "en-AE",
    timezoneId: "Asia/Dubai",
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: process.env.E2E_WEB_SERVER_COMMAND ?? "corepack pnpm dev",
    url: process.env.APP_BASE_URL ?? "http://127.0.0.1:3000/login",
    reuseExistingServer: !ci,
    timeout: 120_000,
    env: {
      ...process.env,
      E2E: "1",
      TZ: "Asia/Dubai",
    },
  },
});
