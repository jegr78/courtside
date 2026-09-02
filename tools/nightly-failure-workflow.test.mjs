import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const directory = new URL("../.github/workflows/", import.meta.url);
const workflow = readFileSync(new URL("nightly-failure-tracking.yml", directory), "utf8");
const tracker = yaml.load(workflow);
const release = readFileSync(new URL("release.yml", directory), "utf8");

function scheduledWorkflowNames() {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".yml"))
    .map((entry) => yaml.load(readFileSync(new URL(entry, directory), "utf8")))
    .filter((definition) => definition?.on?.schedule)
    .map((definition) => definition.name)
    .sort();
}

test("given a workflow that runs on a schedule, when tracking is wired, then it is watched like the build", () => {
  // given / when
  const watched = [...tracker.on.workflow_run.workflows].sort();

  // then
  assert.deepEqual(watched, scheduledWorkflowNames());
});

test("given a completed run, when tracking it, then only scheduled first-attempt evidence is fetched", () => {
  assert.match(workflow, /types: \[completed\]/);
  assert.match(workflow, /fromJSON\('\["schedule", "workflow_dispatch"\]'\), github\.event\.workflow_run\.event/);
  assert.match(workflow, /attempts\/1\/jobs/);
});

test("given evidence of a workflow other than the build, when it is read, then its own history is fetched", () => {
  assert.match(workflow, /WORKFLOW_ID: \$\{\{ github\.event\.workflow_run\.workflow_id \}\}/);
  assert.match(workflow, /actions\/workflows\/\$\{WORKFLOW_ID\}\/runs/);
  assert.doesNotMatch(workflow, /actions\/workflows\/[a-z-]+\.yml/);
});

test("given an unresolved nightly failure, when a release starts, then publication fails before building", () => {
  assert.match(release, /issues: read/);
  assert.match(release, /Refuse unresolved nightly failures/);
  assert.match(release, /courtside-nightly-fingerprint/);
});

test("given two watched workflows completing together, when issues are updated, then neither displaces the other", () => {
  // given — GitHub keeps one pending run per group, so a shared group discards the second completion
  assert.match(workflow, /group: nightly-failure-tracking-\$\{\{ github\.event\.workflow_run\.workflow_id \}\}/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test("given issue writes, when permissions are declared, then only required read and issue scopes are granted", () => {
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /issues: write/);
  assert.doesNotMatch(workflow, /pull-requests: write|security-events: write/);
});
