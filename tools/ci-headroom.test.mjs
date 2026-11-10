import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { HEADROOM_LIMIT, headroom, timeoutMinutes, verdict, workflowPath } from "./ci-headroom.mjs";

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

test("given measured jobs, when the headroom is reported, then an exceeded job fails scheduled and dispatched runs and only warns elsewhere", () => {
  // given
  const records = [
    { job: "backend-0", ...headroom({ started: 0, now: 20 * 60, timeoutMinutes: 40 }) },
    { job: "backend-1", ...headroom({ started: 0, now: 30 * 60, timeoutMinutes: 40 }) }
  ];
  // when / then
  assert.equal(verdict(records, "schedule").fails, true);
  assert.equal(verdict(records, "workflow_dispatch").fails, true);
  assert.equal(verdict(records, "pull_request").fails, false);
  assert.deepEqual(verdict(records, "schedule").exceeded, ["backend-1 used 30.0 of 40 minutes (75 %), the limit for headroom is 67 %"]);
  assert.equal(verdict([records[0]], "schedule").fails, false);
  assert.equal(verdict([], "schedule").fails, false, "a run whose guarded jobs were skipped has nothing to report");
});

test("given the workflows, when the jobs are read, then every guarded job measures its headroom and one job nothing depends on judges it", () => {
  // given
  const guarded = { "build.yml": ["backend", "browser"], "test-stability.yml": ["varied-order", "browser-order", "browser-compatibility"] };
  for (const [file, jobs] of Object.entries(guarded)) {
    const workflow = yaml.load(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8")).jobs;
    for (const job of jobs) {
      // when
      const steps = workflow[job].steps;
      // then
      assert.match(steps[0]?.run ?? "", /JOB_STARTED=/, `${file} ${job} records its start in its first step`);
      assert.deepEqual(steps.slice(-2).map((step) => step.name), ["Measure timeout headroom", "Upload timeout headroom"], `${file} ${job} ends by measuring`);
    }
    assert.deepEqual(workflow["timeout-headroom"].needs, jobs, `${file} judges every guarded job`);
    assert.match(workflow["timeout-headroom"].steps.at(-1).run, /ci-headroom\.mjs report/);
    const dependents = Object.entries(workflow).filter(([, definition]) => [definition.needs ?? []].flat().includes("timeout-headroom"));
    assert.deepEqual(dependents, [], `${file}: a headroom failure must not hold back another job`);
  }
});
