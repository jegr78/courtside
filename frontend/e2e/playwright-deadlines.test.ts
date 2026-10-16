import { afterEach, describe, expect, it, vi } from "vitest";

async function configuredProjects() {
  vi.resetModules();
  vi.stubEnv("COURTSIDE_WEBKIT_AXE", "true");
  vi.stubEnv("COURTSIDE_BROWSER_GROUP", undefined);
  const { default: config } = await import("../playwright.config");
  return { config, projects: config.projects ?? [] };
}

describe("playwright deadlines", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("given a test hangs in any project, when it runs, then it fails on the shared bound long before the job deadline", async () => {
    // given
    const { config, projects } = await configuredProjects();

    // when
    const ownBounds = projects
      .filter(({ timeout }) => timeout !== undefined)
      .map(({ name }) => name);

    // then
    expect(config.timeout, "every test fails on a five-minute bound with its trace instead of the job being cancelled")
      .toBe(5 * 60_000);
    expect(ownBounds, "no project carries a bound of its own beside the shared one").toEqual([]);
  });

  it("given a slow but progressing runner, when a step takes long, then Playwright adds no deadline to the step itself", async () => {
    // given
    const { config } = await configuredProjects();

    // when
    const steps = {
      expect: config.expect?.timeout,
      action: config.use?.actionTimeout,
      navigation: config.use?.navigationTimeout
    };

    // then
    expect(steps, "only a whole test that stops progressing fails, never a slow step").toEqual({
      expect: 0, action: 0, navigation: 0
    });
  });
});
