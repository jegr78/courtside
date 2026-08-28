import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/nightly-failure-tracking.yml", import.meta.url), "utf8");
const release = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

test("given a completed nightly, when tracking it, then only scheduled build first-attempt evidence is fetched", () => {
  assert.match(workflow, /workflow_run:[\s\S]*workflows: \[build\][\s\S]*types: \[completed\]/);
  assert.match(workflow, /fromJSON\('\["schedule", "workflow_dispatch"\]'\), github\.event\.workflow_run\.event/);
  assert.match(workflow, /attempts\/1\/jobs/);
});

test("given an unresolved nightly failure, when a release starts, then publication fails before building", () => {
  assert.match(release, /issues: read/);
  assert.match(release, /Refuse unresolved nightly failures/);
  assert.match(release, /courtside-nightly-fingerprint/);
});

test("given concurrent completions, when issues are updated, then one repository-wide writer owns the operation", () => {
  assert.match(workflow, /group: nightly-failure-tracking/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test("given issue writes, when permissions are declared, then only required read and issue scopes are granted", () => {
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /issues: write/);
  assert.doesNotMatch(workflow, /pull-requests: write|security-events: write/);
});
