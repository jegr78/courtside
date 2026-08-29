import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const build = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");
const smoke = readFileSync(new URL("../.github/workflows/post-merge-smoke.yml", import.meta.url), "utf8");
const stability = readFileSync(new URL("../.github/workflows/test-stability.yml", import.meta.url), "utf8");

test("given scheduled verification, when main is checked, then the full build records immutable first-attempt evidence", () => {
  assert.match(build, /cron: '37 0 \* \* \*'/);
  assert.match(build, /github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.match(build, /github\.run_attempt/);
  assert.match(build, /github\.sha/);
  assert.match(build, /nightly-verification-/);
  assert.match(build, /retention-days: 90/);
  assert.match(build, /push\|schedule\|workflow_dispatch\)\s+test "\$PROFILE_PLAN_RESULT" = skipped/);
  assert.match(build, /github\.event_name == 'schedule' && 30 \|\| 14/);
});

test("given specialized periodic checks, when nightly runs, then their existing workflow retains ownership", () => {
  assert.match(stability, /browser-order:/);
  assert.match(stability, /browser-compatibility:/);
  assert.doesNotMatch(build, /browser-compatibility:|surefire\.runOrder/);
});

test("given a merge to main, when smoke runs, then it exercises bounded policy, migration, and application paths", () => {
  assert.match(smoke, /push:\s*\n\s*branches: \[main\]/);
  assert.match(smoke, /timeout-minutes: 5/);
  assert.match(smoke, /group: post-merge-smoke-\$\{\{ github\.sha \}\}/);
  assert.match(smoke, /node --test tools\/post-merge-policy\.test\.mjs/);
  assert.match(smoke, /POLICY_OUTCOME: \$\{\{ steps\.policy\.outcome \}\}/);
  assert.match(smoke, /ConstraintNameTest,HealthEndpointTest,GeneratedApiImplementationTest/);
  assert.match(smoke, /post-merge-smoke-/);
  assert.match(smoke, /retention-days: 90/);
  assert.match(smoke, /target\/surefire-reports\/\*\.xml/);
  assert.match(smoke, /retention-days: 14/);
});
