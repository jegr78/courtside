import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const workflows = new URL("../.github/workflows/", import.meta.url);
const loaded = readdirSync(workflows)
  .filter((name) => name.endsWith(".yml"))
  .map((name) => ({ name, document: yaml.load(readFileSync(new URL(name, workflows), "utf8")) }));

const reachesToolingTests = (step) => {
  const run = typeof step?.run === "string" ? step.run : "";
  if (/npm run test:tools|tool-tests\.mjs/.test(run)) {
    return true;
  }
  return /mvnw\b/.test(run) && /\bverify\b/.test(run) && !/-Pjava-only/.test(run);
};

const checkoutSteps = (job) =>
  (job.steps ?? []).filter((step) => typeof step?.uses === "string"
    && step.uses.startsWith("actions/checkout@"));

const jobsReachingToolingTests = loaded.flatMap(({ name, document }) =>
  Object.entries(document.jobs ?? {})
    .filter(([, job]) => (job.steps ?? []).some(reachesToolingTests))
    .map(([id, job]) => ({ workflow: name, id, job })));

test("given a workflow that reaches the tooling tests, when it checks out, then it takes the whole history",
  () => {
    // when / then
    for (const { workflow, id, job } of jobsReachingToolingTests) {
      const checkouts = checkoutSteps(job);
      assert.notEqual(checkouts.length, 0,
        `${workflow}:${id} runs the tooling tests without checking the repository out`);
      for (const checkout of checkouts) {
        assert.equal(checkout.with?.["fetch-depth"], 0,
          `${workflow}:${id} reaches the tooling tests on a shallow clone.`
          + " release-please-configuration.test.mjs refuses to read history it cannot see, so the"
          + " whole job fails rather than the assertion it guards");
      }
    }
  });

test("given the rule, when the workflows are read, then it guards more than the one job that already knew",
  () => {
    // when / then
    assert.ok(jobsReachingToolingTests.length >= 2,
      "a rule matching a single job would pass by describing that job rather than the constraint");
    assert.ok(jobsReachingToolingTests.some(({ workflow }) => workflow !== "build.yml"),
      "the constraint was already honoured inside build.yml; it is the workflows that reach the"
      + " same tests through `mvnw verify` that it exists to catch");
  });
