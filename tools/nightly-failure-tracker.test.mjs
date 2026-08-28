import assert from "node:assert/strict";
import test from "node:test";
import { classifyNightlyFailures, planFailureUpdates, readyForReview, applyIssuePlan,
  bindCommitRange } from "./nightly-failure-tracker.mjs";

const run = {
  id: 42,
  run_attempt: 2,
  head_sha: "a".repeat(40),
  html_url: "https://github.com/example/courtside/actions/runs/42",
  name: "build",
  event: "schedule"
};

const jobs = [{ name: "backend", conclusion: "failure", steps: [
  { name: "Set up job", conclusion: "success" },
  { name: "Verify backend", conclusion: "failure" }
] }];

test("given a retried nightly, when failures are classified, then the first attempt remains the occurrence", () => {
  const failures = classifyNightlyFailures({ ...run, run_attempt: 1 }, jobs);

  assert.equal(failures[0].attempt, 1);
  assert.equal(failures[0].job, "backend");
  assert.equal(failures[0].step, "Verify backend");
  assert.match(failures[0].fingerprint, /^[a-f0-9]{64}$/);
});

test("given repeated and distinct classes, when updates are planned, then only identical failures share an issue", () => {
  const [backend] = classifyNightlyFailures({ ...run, run_attempt: 1 }, jobs);
  const [frontend] = classifyNightlyFailures({ ...run, run_attempt: 1 }, [
    { name: "frontend", conclusion: "failure", steps: [{ name: "Run browser journeys", conclusion: "failure" }] }
  ]);
  const existing = [{ number: 8, state: "open", title: "[nightly] existing",
    body: `<!-- courtside-nightly-fingerprint:${backend.fingerprint} -->` }];

  const plan = planFailureUpdates([backend, frontend], existing);

  assert.deepEqual(plan.map(({ action, issueNumber }) => [action, issueNumber]), [["comment", 8], ["create", null]]);
});

test("given an occurrence already recorded, when a retry is processed, then no duplicate comment is planned", () => {
  const [failure] = classifyNightlyFailures({ ...run, run_attempt: 1 }, jobs);
  const marker = `<!-- courtside-nightly-occurrence:${failure.runId}:1 -->`;
  const existing = [{ number: 8, state: "open", title: "[nightly] existing",
    body: `<!-- courtside-nightly-fingerprint:${failure.fingerprint} -->\n${marker}` }];

  assert.deepEqual(planFailureUpdates([failure], existing), []);
});

test("given malformed or attacker-controlled evidence, when classified, then it is rejected or encoded", () => {
  assert.throws(() => classifyNightlyFailures({ ...run, name: "other" }, jobs), /workflow/);
  assert.throws(() => classifyNightlyFailures({ ...run, run_attempt: 1, head_sha: "main" }, jobs), /commit/);
  const [failure] = classifyNightlyFailures({ ...run, run_attempt: 1 }, [
    { name: "backend", conclusion: "failure", steps: [{ name: "@team `boom` <tag>", conclusion: "failure" }] }
  ]);
  const [different] = classifyNightlyFailures({ ...run, run_attempt: 1 }, [
    { name: "backend", conclusion: "failure", steps: [{ name: "#team `boom` <tag>", conclusion: "failure" }] }
  ]);
  const [planned] = planFailureUpdates([failure], []);

  assert.doesNotMatch(JSON.stringify(planned), /@team|`boom`|<tag>/);
  assert.notEqual(failure.fingerprint, different.fingerprint);
});

test("given a closed matching issue, when the failure recurs, then the same issue is reopened", () => {
  const [failure] = classifyNightlyFailures({ ...run, run_attempt: 1 }, jobs);
  const existing = [{ number: 8, state: "closed", title: "[nightly] existing",
    body: `<!-- courtside-nightly-fingerprint:${failure.fingerprint} -->` }];

  const [planned] = planFailureUpdates([failure], existing);

  assert.equal(planned.action, "reopen");
  assert.equal(planned.issueNumber, 8);
});

test("given seven consecutive successful first attempts, when reviewing failures, then they become ready for human review", () => {
  const successful = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1, run_attempt: 1, event: "schedule", conclusion: "success"
  }));

  assert.equal(readyForReview(successful), true);
  assert.equal(readyForReview([...successful.slice(0, 6), { ...successful[6], conclusion: "failure" }]), false);
  assert.equal(readyForReview([...successful.slice(0, 6), { ...successful[6], run_attempt: 2 }]), false);
});

test("given a prior green nightly, when a failure is recorded, then its main commit range is retained", () => {
  const [failure] = classifyNightlyFailures({ ...run, run_attempt: 1 }, jobs);
  const ranged = bindCommitRange([failure], [{ id: 41, run_attempt: 1, event: "schedule",
    conclusion: "success", head_sha: "b".repeat(40) }]);
  const [planned] = planFailureUpdates(ranged, []);

  assert.match(planned.body, new RegExp(`${"b".repeat(40)}\\.\\.${"a".repeat(40)}`));
});

test("given the GitHub API rejects a write, when applying the plan, then the tracker fails closed", async () => {
  await assert.rejects(
    applyIssuePlan([{ action: "create", title: "title", body: "body", labels: ["nightly-failure"] }],
      async () => ({ ok: false, status: 403, text: async () => "forbidden" })),
    /GitHub API returned 403/
  );
});
