import { describe, expect, it } from "vitest";
import { browserFixtureScope, browserIsolationVariant } from "./browser-isolation";

describe("browser isolation", () => {
  it("givenNoExperiment_whenResolvingIsolation_thenOneBrowserLivesForTheProject", () => {
    // given / when
    const variant = browserIsolationVariant(undefined);

    // then
    expect(variant).toBe("project");
    expect(browserFixtureScope(variant)).toBe("worker");
  });

  it("givenTestIsolation_whenResolvingIsolation_thenOneBrowserLivesForEachTest", () => {
    // given / when
    const variant = browserIsolationVariant("test");

    // then
    expect(variant).toBe("test");
    expect(browserFixtureScope(variant)).toBe("test");
  });

  it("givenAnUnknownIsolation_whenResolvingIsolation_thenTheRunFailsClosed", () => {
    // given / when / then
    expect(() => browserIsolationVariant("context")).toThrow("Unsupported WebKit browser isolation");
  });
});
