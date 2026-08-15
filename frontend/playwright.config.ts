import { defineConfig } from "@playwright/test";

delete process.env.NO_COLOR;
process.env.FORCE_COLOR = "0";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit-accessibility", testMatch: /accessibility\.spec\.ts/, use: { browserName: "webkit" } }
  ],
  globalSetup: "./e2e/global-setup.ts"
});
