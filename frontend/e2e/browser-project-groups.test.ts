import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { browserGroupShards, browserProjectGroup, browserShard, regularBrowserProjectGroups } from "./browser-project-groups";

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

  it("given the WebKit axe shard, when it is resolved, then it runs exactly the WebKit accessibility project", () => {
    // when
    const selected = browserProjectGroup(projects, "webkit-accessibility").map(({ name }) => name);

    // then
    expect(selected).toEqual(["webkit-accessibility"]);
    expect(() => browserProjectGroup(projects.filter(({ name }) => name !== "webkit-accessibility"),
      "webkit-accessibility")).toThrow(/does not match/i);
  });

  it("given the Chromium axe sweep, when the groups are resolved, then it runs in a shard of its own", () => {
    // when
    const selected = browserProjectGroup(projects, "chromium-accessibility").map(({ name }) => name);

    // then
    expect(selected, "the axe sweep carries its own job deadline").toEqual(["chromium-accessibility"]);
    expect(browserProjectGroup(projects, "phone-android").map(({ name }) => name), "the phone shard no longer carries the axe sweep")
      .not.toContain("chromium-accessibility");
  });

  it("given an unknown or incomplete group, when it is resolved, then the gate fails closed", () => {
    // when / then
    expect(() => browserProjectGroup(projects, "unknown")).toThrow(/unsupported browser project group/i);
    expect(() => browserProjectGroup(projects.slice(1), "visual")).toThrow(/does not match/i);
  });

  it("given the phone layouts, when the groups are resolved, then each phone runs in a shard of its own", () => {
    // when / then
    expect(browserProjectGroup(projects, "phone-iphone").map(({ name }) => name)).toEqual(["iphone"]);
    expect(browserProjectGroup(projects, "phone-android").map(({ name }) => name)).toEqual(["android"]);
  });

  it("given the build workflow, when its browser matrix is read, then every shard of every group runs exactly once", () => {
    // given
    type MatrixEntry = { label: string; group: string; shard: string };
    const workflow = parse(readFileSync(resolve(import.meta.dirname, "../../.github/workflows/build.yml"), "utf8")) as {
      jobs: { browser: { strategy: { matrix: { include: MatrixEntry[] } } } };
    };
    const entries = workflow.jobs.browser.strategy.matrix.include;
    const expected = Object.keys(regularBrowserProjectGroups).filter((group) => group !== "visual").flatMap((group) => {
      const total = browserGroupShards[group as keyof typeof browserGroupShards];
      return total === undefined ? [`${group}:`]
        : Array.from({ length: total }, (_, index) => `${group}:${index + 1}/${total}`);
    });

    // when
    const scheduled = entries.map(({ group, shard }) => `${group}:${shard}`);

    // then
    expect(scheduled.toSorted(), "a group or shard the matrix leaves out never runs on a pull request").toEqual(expected.toSorted());
    expect(new Set(entries.map(({ label }) => label)).size, "labels name jobs and artifacts, so they must differ").toBe(entries.length);
  });

  it("given a shard, when it is read for its group, then only one of that group's own shards is accepted", () => {
    // when / then
    expect(browserShard("functional", "2/3")).toEqual({ current: 2, total: 3 });
    expect(browserShard("functional", undefined), "a local run without a shard runs the whole group").toBeUndefined();
    expect(browserShard("functional", ""), "an unsharded matrix entry passes an empty value").toBeUndefined();
    expect(() => browserShard("functional", "2/2"), "a total the group does not declare").toThrow(/does not have 2 shards/i);
    expect(() => browserShard("functional", "4/3")).toThrow(/not a shard/i);
    expect(() => browserShard("functional", "0/3")).toThrow(/not a shard/i);
    expect(() => browserShard("functional", "two")).toThrow(/not a shard/i);
    expect(() => browserShard("phone-iphone", "1/2"), "a group without shards").toThrow(/does not have 2 shards/i);
  });
});
