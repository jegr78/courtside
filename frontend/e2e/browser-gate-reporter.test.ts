import { describe, expect, it } from "vitest";
import { browserGateOutcome } from "./browser-gate-reporter";

describe("browser gate reporter", () => {
  const webkitPwaPass = { projectName: "webkit-pwa", status: "passed", errors: [] };

  it("given successful required projects, when reporting the run, then both product claims pass", () => {
    // given
    const results = [
      { projectName: "chromium-accessibility", status: "passed", errors: [] },
      { projectName: "webkit-core", status: "passed", errors: [] },
      webkitPwaPass
    ];

    // when
    const outcome = browserGateOutcome(results);

    // then
    expect(outcome.claims).toEqual([
      { id: "accessibility-rule-conformance", status: "passed" },
      { id: "webkit-core-compatibility", status: "passed" },
      { id: "webkit-axe-qualification", status: "not-run" },
      { id: "browser-harness", status: "passed" }
    ]);
  });

  it("given WebKit axe is excluded from a pull request, when reporting the run, then qualification stays not run", () => {
    // given
    const results = [{ projectName: "chromium-accessibility", status: "passed", errors: [] }];

    // when
    const outcome = browserGateOutcome(results);

    // then
    expect(outcome.claims).toContainEqual({ id: "webkit-axe-qualification", status: "not-run" });
  });

  it("given a required project did not run, when reporting the run, then the harness is incomplete", () => {
    // given
    const results = [{ projectName: "chromium-accessibility", status: "passed", errors: [] }];

    // when
    const outcome = browserGateOutcome(results);

    // then
    expect(outcome.claims).toContainEqual({ id: "webkit-core-compatibility", status: "not-established" });
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "incomplete" });
  });

  it("given the WebKit PWA project did not run, when reporting the run, then compatibility is not established", () => {
    // given
    const results = [
      { projectName: "chromium-accessibility", status: "passed", errors: [] },
      { projectName: "webkit-core", status: "passed", errors: [] }
    ];

    // when
    const outcome = browserGateOutcome(results);

    // then
    expect(outcome.claims).toContainEqual({ id: "webkit-core-compatibility", status: "not-established" });
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "incomplete" });
  });

  it("given WebKit axe qualification is requested but absent, when reporting the run, then the harness is incomplete", () => {
    // given
    const results = [
      { projectName: "chromium-accessibility", status: "passed", errors: [] },
      { projectName: "webkit-core", status: "passed", errors: [] },
      webkitPwaPass
    ];

    // when
    const outcome = browserGateOutcome(results, "passed", { webkitAxeRequired: true });

    // then
    expect(outcome.claims).toContainEqual({ id: "webkit-axe-qualification", status: "not-established" });
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "incomplete" });
  });

  it("given a WebKit-only reliability run, when all selected projects pass, then Chromium is not required", () => {
    // given
    const results = [
      { projectName: "webkit-core", status: "passed", errors: [] },
      webkitPwaPass,
      { projectName: "webkit-accessibility", status: "passed", errors: [] }
    ];

    // when
    const outcome = browserGateOutcome(results, "passed", {
      chromiumAccessibilityRequired: false,
      webkitAxeRequired: true
    });

    // then
    expect(outcome.claims).toContainEqual({ id: "accessibility-rule-conformance", status: "not-run" });
    expect(outcome.claims).toContainEqual({ id: "webkit-axe-qualification", status: "passed" });
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "passed" });
  });

  it("given a WebKit assertion fails, when reporting the run, then compatibility fails as a product claim", () => {
    // given
    const results = [{
      projectName: "webkit-core",
      status: "failed",
      errors: [{ message: "Error: expect(locator).toBeVisible() failed" }]
    }, { projectName: "chromium-accessibility", status: "passed", errors: [] }, webkitPwaPass];

    // when
    const outcome = browserGateOutcome(results);

    // then
    expect(outcome.claims).toContainEqual({ id: "webkit-core-compatibility", status: "failed" });
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "passed" });
  });

  it("given the WebKit PWA journey fails, when reporting the run, then compatibility fails as a product claim", () => {
    // given
    const results = [{
      projectName: "webkit-pwa",
      status: "failed",
      errors: [{ message: "Error: expect(locator).toBeVisible() failed" }]
    }, {
      projectName: "webkit-core",
      status: "passed",
      errors: []
    }, { projectName: "chromium-accessibility", status: "passed", errors: [] }];

    // when
    const outcome = browserGateOutcome(results);

    // then
    expect(outcome.claims).toContainEqual({ id: "webkit-core-compatibility", status: "failed" });
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "passed" });
  });

  it.each([
    "page.goto: WebKit encountered an internal error",
    "Target page, context or browser has been closed",
    "Test timeout of 60000ms exceeded"
  ])("given a browser runtime failure, when reporting %s, then the harness is incomplete", (message) => {
    // given
    const results = [{ projectName: "webkit-core", status: "failed", errors: [{ message }] }, webkitPwaPass];

    // when
    const outcome = browserGateOutcome(results);

    // then
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "incomplete" });
    expect(outcome.claims).toContainEqual({ id: "webkit-core-compatibility", status: "not-established" });
  });

  it("given an unclassified execution failure, when reporting the run, then it fails closed as an incomplete harness", () => {
    // given
    const results = [{ projectName: "webkit-core", status: "failed", errors: [{ message: "unknown failure" }] }, webkitPwaPass];

    // when
    const outcome = browserGateOutcome(results);

    // then
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "incomplete" });
  });

  it("given setup stops before a test, when reporting the run, then the harness is not reported as passed", () => {
    // given
    const results: [] = [];

    // when
    const outcome = browserGateOutcome(results, "failed");

    // then
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "incomplete" });
  });

  it("given an unrelated project fails, when reporting the run, then the harness is incomplete", () => {
    // given
    const results = [
      { projectName: "chromium-accessibility", status: "passed", errors: [] },
      { projectName: "webkit-core", status: "passed", errors: [] },
      webkitPwaPass,
      { projectName: "visual", status: "failed", errors: [{ message: "Error: expect(page).toHaveScreenshot() failed" }] }
    ];

    // when
    const outcome = browserGateOutcome(results, "failed");

    // then
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "incomplete" });
  });

  it("given global teardown fails, when reporting the run, then the harness is incomplete", () => {
    // given
    const results = [
      { projectName: "chromium-accessibility", status: "passed", errors: [] },
      { projectName: "webkit-core", status: "passed", errors: [] },
      webkitPwaPass
    ];

    // when
    const outcome = browserGateOutcome(results, "failed", { globalErrors: [{ message: "teardown failed" }] });

    // then
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "incomplete" });
  });

  it("given the run is interrupted after a product failure, when reporting the run, then the harness is incomplete", () => {
    // given
    const results = [
      { projectName: "chromium-accessibility", status: "passed", errors: [] },
      { projectName: "webkit-core", status: "failed", errors: [{ message: "Error: expect(locator).toBeVisible() failed" }] },
      webkitPwaPass
    ];

    // when
    const outcome = browserGateOutcome(results, "interrupted");

    // then
    expect(outcome.claims).toContainEqual({ id: "webkit-core-compatibility", status: "failed" });
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "incomplete" });
  });

  it("given a required project is skipped, when reporting the run, then its claim is not established", () => {
    // given
    const results = [{ projectName: "webkit-core", status: "skipped", errors: [] }, webkitPwaPass];

    // when
    const outcome = browserGateOutcome(results);

    // then
    expect(outcome.claims).toContainEqual({ id: "webkit-core-compatibility", status: "not-established" });
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "incomplete" });
  });
});
