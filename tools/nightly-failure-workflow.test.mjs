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
const trackerSource = readFileSync(new URL("./nightly-failure-tracker.mjs", import.meta.url), "utf8");

function scheduledWorkflowNames() {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
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
  assert.doesNotMatch(workflow, /actions\/workflows\/[A-Za-z0-9._-]+\.ya?ml/);
  assert.match(workflow, /--workflow-id "\$WORKFLOW_ID"/);
});

test("given a second job added to the tracker, when a fork run completes, then it refuses the event too", () => {
  // given — the fork path is closed by a condition, and a job added without it would open it again
  const refusesForeignEvents = /fromJSON\('\["schedule", "workflow_dispatch"\]'\), github\.event\.workflow_run\.event/;
  const jobs = Object.entries(tracker.jobs);

  // then
  assert.ok(jobs.length > 0);
  for (const [name, definition] of jobs) {
    assert.match(`${definition.if ?? ""}`, refusesForeignEvents, `job ${name} accepts any triggering event`);
  }
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

test("given the one label three places share, when any of them names it, then all three name the same one", () => {
  // given
  const declared = trackerSource.match(/export const trackerLabel = "([a-z-]+)";/)?.[1];

  // when / then
  assert.ok(declared !== undefined);
  assert.match(trackerSource, new RegExp(`labels=\\$\\{trackerLabel\\}`));
  assert.match(release, new RegExp(`issues\\?state=open&labels=${declared}&per_page=100`));
});

test("given a tracked failure, when the tracker runs in CI, then it is told whom to assign and what blocks a merge", () => {
  // when / then
  assert.match(workflow, /REPOSITORY_OWNER: \$\{\{ github\.repository_owner \}\}/);
  assert.match(workflow, /--assignee "\$REPOSITORY_OWNER"/);
  assert.match(workflow, /--blocking-workflow build/);
  assert.match(workflow, /issues: write/);
});
