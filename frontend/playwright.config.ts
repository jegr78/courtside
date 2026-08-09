import { defineConfig } from "@playwright/test";

delete process.env.FORCE_COLOR;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:18080",
    trace: "retain-on-failure"
  },
  globalSetup: "./e2e/global-setup.ts"
});
