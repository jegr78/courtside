import { defineConfig, devices } from "@playwright/test";

delete process.env.NO_COLOR;
process.env.FORCE_COLOR = "0";

const periodicProjects = process.env.COURTSIDE_PERIODIC_BROWSERS === "true" ? [
  // Firefox keeps its own certificate store, which neither the system store nor a Chromium
  // argument reaches, so it stays on the origin that needs no certificate at all.
  { name: "firefox-periodic", testMatch: /supported-browser\.spec\.ts|browser-security-smoke\.spec\.ts/, metadata: { plainOrigin: true }, use: { ...devices["Desktop Firefox"] } }
] : [];

const projectOrder = process.env.COURTSIDE_PROJECT_ORDER;
if (projectOrder !== undefined && projectOrder !== "configured" && projectOrder !== "reversed") {
  throw new Error(`Unsupported browser project order: ${projectOrder}`);
}

const qualificationProjects = process.env.COURTSIDE_WEBKIT_AXE === "true" ? [
  { name: "webkit-accessibility", testMatch: /accessibility\.spec\.ts/, use: { browserName: "webkit" as const } }
] : [];

const configuredProjects = [
  { name: "chromium", testIgnore: /accessibility\.spec\.ts|responsive-mobile\.spec\.ts|visual-regression\.spec\.ts/, use: { browserName: "chromium" as const } },
  { name: "chromium-accessibility", testMatch: /accessibility\.spec\.ts/, use: { browserName: "chromium" as const } },
  { name: "visual", testMatch: /visual-regression\.spec\.ts/, use: { browserName: "chromium" as const } },
  { name: "webkit-core", testMatch: /supported-browser\.spec\.ts|browser-security-smoke\.spec\.ts/, metadata: { plainOrigin: true }, use: { browserName: "webkit" as const } },
  { name: "webkit-pwa", testMatch: /pwa-browser-compatibility\.spec\.ts/, use: { browserName: "webkit" as const } },
  // Both engines, because a phone layout breaks per engine: the booking dialog was swallowed by a
  // bar on WebKit and the footer was covered on Chromium, each invisible to the other.
  { name: "iphone", testMatch: /responsive-mobile\.spec\.ts/, use: { ...devices["iPhone 15"] } },
  { name: "android", testMatch: /responsive-mobile\.spec\.ts/, use: { ...devices["Pixel 7"] } },
  ...qualificationProjects,
  ...periodicProjects
];

const projects = projectOrder === "reversed"
  ? [...configuredProjects].reverse()
  : configuredProjects;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.005 } },
  // Pinned so nobody reaches "changed" or "all", under which a missing baseline passes silently.
  // "missing" writes the new baseline for collection and still fails the run that needed it.
  updateSnapshots: "missing",
  reporter: [["line"], ["./e2e/browser-gate-reporter.ts"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  // Every project draws its browser from the pinned image and reaches the application through the
  // same reverse proxy a club runs, so a red run means a regression rather than a different host.
  projects,
  globalSetup: "./e2e/global-setup.ts"
});
