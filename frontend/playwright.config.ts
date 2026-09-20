import { defineConfig, devices } from "@playwright/test";
import type { JourneyOptions } from "./e2e/fixtures";
import { browserProjectGroup } from "./e2e/browser-project-groups";

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

// The catalogue's two tiers: whoever does this at the club with a phone is walked on all three
// devices, whoever does it at a desk on the desktop only.
const EVERY_JOURNEY = /journeys\/.+\.spec\.ts$/;
const WITH_A_PHONE = /journeys\/with-a-phone\/.+\.spec\.ts$/;
const atADesk = { browserName: "chromium" as const, viewport: { width: 1440, height: 900 } };

// The record a release reads, not a gate: video, trace and a screenshot for every journey, which
// no pull request should pay for.
const recorded = { video: "on" as const, trace: "on" as const, screenshot: "on" as const };
const journeyRun = process.env.COURTSIDE_JOURNEY_RUN === "true";

const journeyProjects = journeyRun ? [
  { name: "journey-desktop-de", testMatch: EVERY_JOURNEY, use: { ...atADesk, language: "de" as const, ...recorded } },
  { name: "journey-desktop-en", testMatch: EVERY_JOURNEY, use: { ...atADesk, language: "en" as const, ...recorded } },
  { name: "journey-iphone-de", testMatch: WITH_A_PHONE, use: { ...devices["iPhone 15"], language: "de" as const, ...recorded } },
  { name: "journey-iphone-en", testMatch: WITH_A_PHONE, use: { ...devices["iPhone 15"], language: "en" as const, ...recorded } },
  { name: "journey-android-de", testMatch: WITH_A_PHONE, use: { ...devices["Pixel 7"], language: "de" as const, ...recorded } },
  { name: "journey-android-en", testMatch: WITH_A_PHONE, use: { ...devices["Pixel 7"], language: "en" as const, ...recorded } }
] : [
  // The gate walks the whole catalogue once and records nothing, so a journey that stops working
  // is a red pull request rather than a discovery made while a release is being cut.
  { name: "journey-gate", testMatch: EVERY_JOURNEY, use: { ...atADesk, language: "de" as const } }
];

const configuredProjects = [
  { name: "visual", testMatch: /visual-regression\.spec\.ts/, use: { browserName: "chromium" as const } },
  // The guides' captures are snapshots too, so a surface that moves fails them and the pages that
  // show it are named by site/screenshots/captures.json. They are written where the site reads them.
  { name: "guides-de", testMatch: /guide-screenshots\.spec\.ts/, snapshotPathTemplate: "{testDir}/../../site/screenshots/de/{arg}{ext}", use: { browserName: "chromium" as const, locale: "de-DE" } },
  { name: "guides-en", testMatch: /guide-screenshots\.spec\.ts/, snapshotPathTemplate: "{testDir}/../../site/screenshots/en/{arg}{ext}", use: { browserName: "chromium" as const, locale: "en-GB" } },
  { name: "chromium", testIgnore: /accessibility\.spec\.ts|responsive-mobile\.spec\.ts|visual-regression\.spec\.ts|guide-screenshots\.spec\.ts|journeys\//, use: { browserName: "chromium" as const } },
  { name: "chromium-accessibility", testMatch: /accessibility\.spec\.ts/, use: { browserName: "chromium" as const } },
  { name: "webkit-core", testMatch: /supported-browser\.spec\.ts|browser-security-smoke\.spec\.ts/, use: { browserName: "webkit" as const } },
  { name: "webkit-pwa", testMatch: /pwa-browser-compatibility\.spec\.ts/, use: { browserName: "webkit" as const } },
  // Both engines, because a phone layout breaks per engine: the booking dialog was swallowed by a
  // bar on WebKit and the footer was covered on Chromium, each invisible to the other.
  { name: "iphone", testMatch: /responsive-mobile\.spec\.ts/, use: { ...devices["iPhone 15"] } },
  { name: "android", testMatch: /responsive-mobile\.spec\.ts/, use: { ...devices["Pixel 7"] } },
  ...qualificationProjects,
  ...periodicProjects,
  ...journeyProjects
];

const orderedProjects = projectOrder === "reversed"
  ? [...configuredProjects].reverse()
  : configuredProjects;
const projects = browserProjectGroup(orderedProjects, process.env.COURTSIDE_BROWSER_GROUP);

export default defineConfig<JourneyOptions>({
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
