import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: /(measure|settle|full-shot|secret-fill|credential|console-context|comparison-masks)\.spec\.ts$/,
  outputDir: "../../build/acceptance-selftest/results",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "chromium-comparison-dense", testMatch: /comparison-masks\.spec\.ts$/, use: { browserName: "chromium", viewport: { width: 320, height: 480 }, deviceScaleFactor: 3, isMobile: true } },
    { name: "webkit-comparison", testMatch: /comparison-masks\.spec\.ts$/, use: { browserName: "webkit", viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true } },
    { name: "firefox-comparison", testMatch: /comparison-masks\.spec\.ts$/, use: { browserName: "firefox" } },
    { name: "webkit-console", testMatch: /console-context\.spec\.ts$/, use: { browserName: "webkit" } }
  ]
});
