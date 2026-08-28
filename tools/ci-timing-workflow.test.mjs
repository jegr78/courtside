import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/ci-timing.yml", import.meta.url), "utf8");

test("whenTheBuildCompletes_thenTimingCollectionCannotMutateRepositoryState", () => {
  // when / then
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /contents:\s*read/);
  assert.doesNotMatch(workflow, /pull-requests:\s*write|issues:\s*write|contents:\s*write/);
});

test("whenTimingEvidenceIsUploaded_thenRetentionAndFirstAttemptIdentityAreExplicit", () => {
  // when / then
  assert.match(workflow, /retention-days:\s*90/);
  assert.match(workflow, /run_attempt/);
  assert.match(workflow, /ci-timing\.schema\.json/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
});

test("givenARunIsRerunWhileCollectionStarts_whenReadingEvidence_thenTheTriggeringAttemptRemainsBound", () => {
  // when / then
  assert.match(workflow, /attempts\/\$\{ATTEMPT\}/);
  assert.doesNotMatch(workflow, /jobs\?filter=latest/);
  assert.match(workflow, /--expected-run-id "\$RUN_ID"/);
  assert.match(workflow, /--expected-attempt "\$ATTEMPT"/);
});

test("givenAnObservedProfilePlan_whenCollectingTheRun_thenProtectedCodeRecomputesIt", () => {
  // when / then
  assert.match(workflow, /ref:\s*\$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.doesNotMatch(workflow, /gh run download|test-profile-plan-\$\{RUN_ID\}/);
  assert.doesNotMatch(workflow, /issues\/\$\{PR_NUMBER\}|LABELS_JSON/);
  assert.match(workflow, /--labels '\[\]'/);
  assert.match(workflow, /commits\/\$\{RUN_HEAD\}\/pulls/);
  assert.match(workflow, /select\(\.head\.sha == \$head\)/);
  assert.match(workflow, /select\(length == 1\)/);
  assert.match(workflow, /git fetch --no-tags origin "\$BASE_REF" "\$HEAD_REF"/);
  assert.doesNotMatch(workflow, /pull\/\$\{PR_NUMBER\}\/head/);
  assert.match(workflow, /test-profile-classifier\.mjs/);
  assert.doesNotMatch(workflow, /pull_requests\[0\]/);
  assert.match(workflow, /test-profile-observation\.mjs/);
  assert.match(workflow, /test-profile-observation\.schema\.json/);
});

test("givenTheProfileClassifierFails_whenTheBuildContinues_thenItsFailClosedPlanIsStillRetained", () => {
  // given
  const build = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");

  // when / then
  assert.match(build, /fallbackPlanToRun|--fallback-on-error/);
  assert.match(build, /name: test-profile-plan-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}[\s\S]+if: always\(\)/);
});
