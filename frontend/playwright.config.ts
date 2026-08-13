import { defineConfig } from "@playwright/test";

delete process.env.FORCE_COLOR;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    trace: "off",
    screenshot: "off",
    video: "off"
  },
  globalSetup: "./e2e/global-setup.ts"
});
