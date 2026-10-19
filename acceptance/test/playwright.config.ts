import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: /(measure|settle)\.spec\.ts$/, outputDir: "../../build/acceptance-selftest/results", use: { browserName: "chromium" } });
