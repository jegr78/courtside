import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/profile-evidence.yml", import.meta.url), "utf8");

test("given protected build evidence, when aggregating profiles, then the workflow replays first attempts from main", () => {
  // when / then
  assert.match(workflow, /workflow_run:\n\s+workflows: \[CI timing\]/);
  assert.match(workflow, /permissions:\n\s+actions: read\n\s+contents: read/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /node tools\/test-profile-replay\.mjs/);
  assert.match(workflow, /profile-evidence-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.doesNotMatch(workflow, /pull_request_target|issues: write|contents: write/);
});
