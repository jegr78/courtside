import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { parse } = require("yaml");

const read = (name) => parse(readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8"));

test("given the merge queue, when a group requests its checks, then every required check reports on it by name", () => {
  // given
  const required = ["build", "Validate PR title", "release line"];
  const workflows = ["build.yml", "merge-group.yml", "pr-title-lint.yml", "release-line.yml"].map(read);

  // when
  const reported = workflows.filter((workflow) => workflow.on.merge_group)
    .flatMap((workflow) => Object.entries(workflow.jobs).map(([id, job]) => job.name ?? id));

  // then
  for (const check of required) {
    assert.ok(reported.includes(check), `a merge group must report the required check "${check}" or the queue never merges`);
  }
});

test("given the merge-group answer for the per-pull-request checks, when it runs, then it holds no permission and executes no code from the group", () => {
  // given
  const workflow = read("merge-group.yml");

  // when
  const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);

  // then
  assert.deepEqual(workflow.on, { merge_group: { types: ["checks_requested"] } });
  assert.deepEqual(workflow.permissions, {}, "the answer needs no token");
  for (const step of steps) {
    assert.deepEqual(Object.keys(step), ["run"], "no checkout, action or environment reaches the group's code");
    assert.match(step.run, /^echo "::notice::[^"$`]+"$/, "a step only records a notice");
  }
});
