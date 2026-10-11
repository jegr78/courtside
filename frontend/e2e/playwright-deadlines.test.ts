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

  it("given an accessibility test hangs, when its project runs, then the test fails on its own bound long before the job deadline", async () => {
    // given
    const { projects } = await configuredProjects();

    // when
    const bounds = projects
      .filter(({ name }) => name?.endsWith("-accessibility"))
      .map(({ name, timeout }) => ({ name, timeout }));

    // then
    expect(bounds, "both accessibility projects carry a five-minute bound").toEqual([
      { name: "chromium-accessibility", timeout: 5 * 60_000 },
      { name: "webkit-accessibility", timeout: 5 * 60_000 }
    ]);
  });

  it("given a slow but progressing runner, when any other project runs, then Playwright adds no wall-clock deadline", async () => {
    // given
    const { config, projects } = await configuredProjects();

    // when
    const bounded = projects
      .filter(({ name }) => !name?.endsWith("-accessibility"))
      .filter(({ timeout }) => timeout !== undefined)
      .map(({ name }) => name);

    // then
    expect(config.timeout, "the outer hosted job owns the deadline of every other project").toBe(0);
    expect(bounded).toEqual([]);
  });
});
