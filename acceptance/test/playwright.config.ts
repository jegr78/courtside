import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: /(measure|settle|full-shot|secret-fill)\.spec\.ts$/, outputDir: "../../build/acceptance-selftest/results", use: { browserName: "chromium" } });
