import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: /(measure|settle|full-shot|secret-fill|credential|console-context)\.spec\.ts$/,
  outputDir: "../../build/acceptance-selftest/results",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit-console", testMatch: /console-context\.spec\.ts$/, use: { browserName: "webkit" } }
  ]
});
