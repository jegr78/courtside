import { describe, expect, it } from "vitest";
import { browserFixtureScope, browserIsolationVariant } from "./browser-isolation";

describe("browser isolation", () => {
  it("given no experiment, when resolving isolation, then one browser lives for the project", () => {
    // given / when
    const variant = browserIsolationVariant(undefined);

    // then
    expect(variant).toBe("project");
    expect(browserFixtureScope(variant)).toBe("worker");
  });

  it("given test isolation, when resolving isolation, then one browser lives for each test", () => {
    // given / when
    const variant = browserIsolationVariant("test");

    // then
    expect(variant).toBe("test");
    expect(browserFixtureScope(variant)).toBe("test");
  });

  it("given an unknown isolation, when resolving isolation, then the run fails closed", () => {
    // given / when / then
    expect(() => browserIsolationVariant("context")).toThrow("Unsupported WebKit browser isolation");
  });
});
