import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { HEADROOM_LIMIT, headroom, timeoutMinutes, workflowPath } from "./ci-headroom.mjs";

const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");

test("given a job that used two thirds of its limit or less, when the headroom is checked, then it passes and one second more fails", () => {
  // when / then
  assert.equal(HEADROOM_LIMIT, 2 / 3);
  assert.equal(headroom({ started: 0, now: 60 * 60, timeoutMinutes: 90 }).exceeded, false);
  assert.equal(headroom({ started: 0, now: 60 * 60 + 1, timeoutMinutes: 90 }).exceeded, true);
  assert.deepEqual(headroom({ started: 100, now: 100 + 45 * 60, timeoutMinutes: 90 }), { usedMinutes: 45, timeoutMinutes: 90, fraction: 0.5, exceeded: false });
});

test("given the workflow reference GitHub sets, when the workflow file is located, then the path inside the repository is returned", () => {
  // when / then
  assert.equal(workflowPath("jegr78/courtside/.github/workflows/test-stability.yml@refs/heads/main"), ".github/workflows/test-stability.yml");
  assert.throws(() => workflowPath("unexpected"), /GITHUB_WORKFLOW_REF/);
});

test("given this repository's workflows, when each guarded job's limit is read, then it is the timeout-minutes the job declares", () => {
  // given
  const build = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
  const stability = readFileSync(new URL("../.github/workflows/test-stability.yml", import.meta.url), "utf8");
  // when / then
  assert.equal(timeoutMinutes(build, "backend"), 40);
  assert.equal(timeoutMinutes(stability, "varied-order"), 90);
  assert.throws(() => timeoutMinutes(build, "missing"), /missing declares no timeout-minutes/);
});

test("given every job of this repository's workflows, when its limit is read line by line, then it matches what a YAML parser reads", () => {
  // given
  for (const file of readdirSync(new URL("../.github/workflows/", import.meta.url)).filter((name) => name.endsWith(".yml"))) {
    const text = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
    for (const [job, definition] of Object.entries(yaml.load(text).jobs ?? {})) {
      if (typeof definition["timeout-minutes"] !== "number") continue;
      // when / then
      assert.equal(timeoutMinutes(text, job), definition["timeout-minutes"], `${file} ${job}`);
    }
  }
});

test("given the workflows, when the jobs are read, then every guarded job ends with the headroom step and records its start first", () => {
  // given
  const guarded = { "build.yml": ["backend", "browser"], "test-stability.yml": ["varied-order", "browser-order", "browser-compatibility"] };
  for (const [file, jobs] of Object.entries(guarded)) {
    const text = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8");
    for (const job of jobs) {
      // when
      const steps = jobSteps(text, job);
      // then
      assert.match(steps[0]?.run ?? "", /JOB_STARTED=/, `${file} ${job} records its start in its first step`);
      assert.equal(steps.at(-1)?.name, "Check timeout headroom", `${file} ${job} ends with the headroom step`);
    }
  }
});

function jobSteps(text, job) {
  return yaml.load(text).jobs[job].steps;
}
