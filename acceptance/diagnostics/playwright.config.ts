import { defineConfig } from "@playwright/test";
import { config, RUN } from "../lib/context";
import { PROFILES } from "../lib/profiles";

const targets = {
  "desktop-safari": { path: "/admin/operator-health", testId: "operator-check-backup" },
  ipad: { path: "/admin/appointments", testId: "managed-appointments-page" }
};

export default defineConfig({
  testDir: ".", testMatch: /resize-observer\.spec\.ts$/, workers: 1, retries: 0, timeout: 60_000,
  outputDir: `${RUN}/diagnostic-results`,
  reporter: [["line"], ["json", { outputFile: `${RUN}/diagnostic-results.json` }]],
  use: { baseURL: config.baseUrl, trace: "off", screenshot: "only-on-failure" },
  projects: PROFILES.filter((profile) => profile.name in targets).map((profile) => ({
    name: profile.name, metadata: { ...profile, target: targets[profile.name as keyof typeof targets] },
    use: { ...profile.use, browserName: "webkit", timezoneId: config.timeZone }
  }))
});
