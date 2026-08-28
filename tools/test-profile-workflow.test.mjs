import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8");

test("givenProfileClassificationIsObservational_whenThePullRequestRuns_thenFullQualityStillControlsTheGate", () => {
  // when / then
  assert.match(workflow, /test-profile-plan:/);
  assert.match(workflow, /test-profile-classifier\.mjs/);
  assert.match(workflow, /cat build\/test-profile\/summary\.md >> "\$GITHUB_STEP_SUMMARY"/);
  assert.match(workflow, /needs: \[quality, assessment-runtime, tool-update-comparison, test-profile-plan\]/);
  assert.match(workflow, /pull_request\) test "\$PROFILE_PLAN_RESULT" = success ;;/);
  assert.match(workflow, /push\) test "\$PROFILE_PLAN_RESULT" = skipped ;;/);
  assert.match(workflow, /name: Build and test\s+run: \.\/mvnw -B verify/);
});
