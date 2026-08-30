import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/ci-timing.yml", import.meta.url), "utf8");

test("when the build completes, then timing collection cannot mutate repository state", () => {
  // when / then
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /contents:\s*read/);
  assert.doesNotMatch(workflow, /pull-requests:\s*write|issues:\s*write|contents:\s*write/);
});

test("when timing evidence is uploaded, then retention and first attempt identity are explicit", () => {
  // when / then
  assert.match(workflow, /retention-days:\s*90/);
  assert.match(workflow, /run_attempt/);
  assert.match(workflow, /ci-timing\.schema\.json/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
});

test("given a run is rerun while collection starts, when reading evidence, then the triggering attempt remains bound", () => {
  // when / then
  assert.match(workflow, /attempts\/\$\{ATTEMPT\}/);
  assert.doesNotMatch(workflow, /jobs\?filter=latest/);
  assert.match(workflow, /--expected-run-id "\$RUN_ID"/);
  assert.match(workflow, /--expected-attempt "\$ATTEMPT"/);
});

test("given an observed profile plan, when collecting the run, then its immutable base classifier recomputes it", () => {
  // when / then
  assert.match(workflow, /ref:\s*\$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.doesNotMatch(workflow, /gh run download|test-profile-plan-\$\{RUN_ID\}/);
  assert.doesNotMatch(workflow, /issues\/\$\{PR_NUMBER\}|LABELS_JSON/);
  assert.match(workflow, /--labels '\[\]'/);
  assert.doesNotMatch(workflow, /commits\/\$\{RUN_HEAD\}\/pulls/);
  assert.match(workflow, /-f state=all -f "head=\$\{HEAD_OWNER\}:\$\{HEAD_BRANCH\}"/);
  assert.match(workflow, /ci-pull-request\.mjs/);
  assert.match(workflow, /\.runBaseSha/);
  assert.doesNotMatch(workflow, /BASE_REF=\$\(jq -er '\.base\.sha/);
  assert.match(workflow, /git fetch --no-tags origin "\$BASE_REF" "\$HEAD_REF"/);
  assert.match(workflow,
    /node tools\/ci-base-provenance\.mjs --base "\$BASE_REF" --head "\$HEAD_REF"/);
  assert.match(workflow, /git worktree add --detach "\$PROFILE_ROOT" "\$BASE_REF"/);
  assert.doesNotMatch(workflow, /pull\/\$\{PR_NUMBER\}\/head/);
  assert.match(workflow, /node "\$PROFILE_ROOT\/tools\/test-profile-classifier\.mjs"/);
  assert.doesNotMatch(workflow, /node tools\/test-profile-classifier\.mjs/);
  assert.doesNotMatch(workflow, /pull_requests\[0\]/);
  assert.match(workflow, /node "\$PROFILE_ROOT\/tools\/ci-timing\.mjs"/);
  assert.match(workflow, /node "\$PROFILE_ROOT\/tools\/test-profile-observation\.mjs"/);
  assert.match(workflow,
    /cp "\$PROFILE_ROOT\/ci\/test-profile-observation\.schema\.json" build\/ci-timing\/test-profile-observation\.schema\.json/);
  assert.doesNotMatch(workflow, /node tools\/(?:ci-timing|test-profile-observation)\.mjs/);
  assert.doesNotMatch(workflow, /- name: Record timing/);
  assert.match(workflow,
    /trap cleanup_profile EXIT[\s\S]+git worktree add --detach "\$PROFILE_ROOT" "\$BASE_REF"[\s\S]+node "\$PROFILE_ROOT\/tools\/ci-timing\.mjs"/);
});

test("given the profile classifier fails, when the build continues, then its fail closed plan is still retained", () => {
  // given
  const build = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");

  // when / then
  assert.match(build, /fallbackPlanToRun|--fallback-on-error/);
  assert.match(build, /name: test-profile-plan-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}[\s\S]+if: always\(\)/);
});
