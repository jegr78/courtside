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
