import { describe, expect, it } from "vitest";
import { browserGateOutcome } from "./browser-gate-reporter";

describe("browser gate reporter", () => {
  it("given successful required projects, when reporting the run, then both product claims pass", () => {
    // given
    const results = [
      { projectName: "chromium-accessibility", status: "passed", errors: [] },
      { projectName: "webkit-core", status: "passed", errors: [] }
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

  it("given a WebKit assertion fails, when reporting the run, then compatibility fails as a product claim", () => {
    // given
    const results = [{
      projectName: "webkit-core",
      status: "failed",
      errors: [{ message: "Error: expect(locator).toBeVisible() failed" }]
    }];

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
    const results = [{ projectName: "webkit-core", status: "failed", errors: [{ message }] }];

    // when
    const outcome = browserGateOutcome(results);

    // then
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "incomplete" });
    expect(outcome.claims).toContainEqual({ id: "webkit-core-compatibility", status: "not-established" });
  });

  it("given an unclassified execution failure, when reporting the run, then it fails closed as an incomplete harness", () => {
    // given
    const results = [{ projectName: "webkit-core", status: "failed", errors: [{ message: "unknown failure" }] }];

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

  it("given a required project is skipped, when reporting the run, then its claim is not established", () => {
    // given
    const results = [{ projectName: "webkit-core", status: "skipped", errors: [] }];

    // when
    const outcome = browserGateOutcome(results);

    // then
    expect(outcome.claims).toContainEqual({ id: "webkit-core-compatibility", status: "not-established" });
    expect(outcome.claims).toContainEqual({ id: "browser-harness", status: "incomplete" });
  });
});
