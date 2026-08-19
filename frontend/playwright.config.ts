import { defineConfig, devices } from "@playwright/test";

delete process.env.NO_COLOR;
process.env.FORCE_COLOR = "0";

const periodicProjects = process.env.COURTSIDE_PERIODIC_BROWSERS === "true" ? [
  // Firefox keeps its own certificate store, which neither the system store nor a Chromium
  // argument reaches, so it stays on the origin that needs no certificate at all.
  { name: "firefox-periodic", testMatch: /supported-browser\.spec\.ts/, metadata: { plainOrigin: true }, use: { ...devices["Desktop Firefox"] } },
  { name: "iphone-periodic", testMatch: /responsive-mobile\.spec\.ts/, use: { ...devices["iPhone 15"] } },
  { name: "android-periodic", testMatch: /responsive-mobile\.spec\.ts/, use: { ...devices["Pixel 7"] } }
] : [];

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  // A project's first test also pays for starting its database, application, proxy and browser,
  // measured at around 25 seconds before any assertion runs. Issue #333 wants that cost paid once.
  timeout: 120_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.005 } },
  // Pinned so nobody reaches "changed" or "all", under which a missing baseline passes silently.
  // "missing" writes the new baseline for collection and still fails the run that needed it.
  updateSnapshots: "missing",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  // Every project draws its browser from the pinned image and reaches the application through the
  // same reverse proxy a club runs, so a red run means a regression rather than a different host.
  projects: [
    { name: "chromium", testIgnore: /responsive-mobile\.spec\.ts|visual-regression\.spec\.ts/, use: { browserName: "chromium" } },
    { name: "visual", testMatch: /visual-regression\.spec\.ts/, use: { browserName: "chromium" } },
    { name: "webkit-accessibility", testMatch: /accessibility\.spec\.ts/, use: { browserName: "webkit" } },
    { name: "webkit-core", testMatch: /supported-browser\.spec\.ts/, metadata: { plainOrigin: true }, use: { browserName: "webkit" } },
    ...periodicProjects
  ],
  globalSetup: "./e2e/global-setup.ts"
});
