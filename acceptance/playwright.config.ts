import { defineConfig } from "@playwright/test";
import { PROFILES } from "./lib/profiles";
import { config, RUN, runPath } from "./lib/context";

const ENGINES = ["chromium", "firefox", "webkit"] as const;
const remote = (engine: string) => engine === "firefox" && config.browsers.firefox
  ? { connectOptions: { wsEndpoint: config.browsers.firefox.wsEndpoint } } : {};
const shared = { reducedMotion: "reduce" as const, ...(config.timeZone ? { timezoneId: config.timeZone } : {}) };
const chromium = { metadata: { engine: "chromium", theme: "dark", locale: "de", phone: false }, use: { ...shared, browserName: "chromium" as const } };

export default defineConfig({
  testDir: "./journeys",
  outputDir: `${RUN}/test-results`,
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["line"], ["json", { outputFile: runPath(process.env.ACCEPTANCE_RESULTS ?? "results.json") }]],
  use: { baseURL: config.baseUrl, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    ...ENGINES.map((engine) => ({ name: `setup-${engine}`, testMatch: /journeys\/00-setup\.spec\.ts$/, metadata: { engine }, use: { ...shared, browserName: engine, ...remote(engine) } })),
    { name: "discovery", testMatch: /journeys\/01-discovery\.spec\.ts$/, dependencies: ["setup-chromium"], ...chromium },
    { name: "preflight", testMatch: /journeys\/02-preflight\.spec\.ts$/, dependencies: ["discovery"], ...chromium },
    ...PROFILES.map((profile) => ({
      name: profile.name,
      testMatch: /journeys\/[1-6]\d-[^/]+\.spec\.ts$/,
      dependencies: [`setup-${profile.engine}`, "preflight"],
      metadata: profile,
      use: { ...profile.use, ...shared, browserName: profile.engine, ...remote(profile.engine) }
    })),
    { name: "postflight", testMatch: /journeys\/postflight\.spec\.ts$/, outputDir: `${RUN}/test-results-postflight`, ...chromium }
  ]
});
