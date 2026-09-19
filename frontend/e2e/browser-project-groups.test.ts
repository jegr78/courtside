import { describe, expect, it } from "vitest";
import { browserProjectGroup, regularBrowserProjectGroups } from "./browser-project-groups";

const projects = Object.values(regularBrowserProjectGroups).flat().map((name) => ({ name }));

describe("browser project groups", () => {
  it("given the regular gate, when every group is resolved, then projects are complete and non-overlapping", () => {
    // given
    const expected = projects.map(({ name }) => name).sort();

    // when
    const selected = Object.keys(regularBrowserProjectGroups)
      .flatMap((group) => browserProjectGroup(projects, group).map(({ name }) => name));

    // then
    expect(selected.sort()).toEqual(expected);
    expect(new Set(selected).size).toBe(selected.length);
  });

  it("given an unknown or incomplete group, when it is resolved, then the gate fails closed", () => {
    // when / then
    expect(() => browserProjectGroup(projects, "unknown")).toThrow(/unsupported browser project group/i);
    expect(() => browserProjectGroup(projects.slice(1), "visual")).toThrow(/does not match/i);
  });
});
