import assert from "node:assert/strict";
import test from "node:test";
import { classifyNightlyFailures, planFailureUpdates, planReadyForReview, readyForReview,
  applyIssuePlan, bindCommitRange, trustedCommentText } from "./nightly-failure-tracker.mjs";

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
  assert.throws(() => classifyNightlyFailures({ ...run, name: "" }, jobs), /workflow/);
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

test("given a job the allowlist does not name, when it fails, then the failure is still reported", () => {
  // given — a renamed or added job must not turn a red nightly into no issue at all
  const renamed = [{ name: "backend (postgres 18)", conclusion: "failure", steps: [
    { name: "Verify backend", conclusion: "failure" }
  ] }];

  // when
  const failures = classifyNightlyFailures({ ...run, run_attempt: 1 }, renamed);

  // then
  assert.equal(failures.length, 1);
  assert.equal(failures[0].job, "backend (postgres 18)");
});

test("given a summoned run of the same workflow, when it is classified, then it is tracked like a nightly", () => {
  // when
  const failures = classifyNightlyFailures(
    { ...run, run_attempt: 1, event: "workflow_dispatch" }, jobs);

  // then
  assert.equal(failures.length, 1);
  assert.throws(() => classifyNightlyFailures({ ...run, run_attempt: 1, event: "push" }, jobs),
    /workflow is invalid/);
});

test("given a summoned run, when counting consecutive green nights, then only scheduled ones count", () => {
  // given
  const nights = Array.from({ length: 7 }, () => (
    { event: "schedule", run_attempt: 1, conclusion: "success" }));

  // when / then
  assert.equal(readyForReview(nights), true);
  assert.equal(readyForReview([{ event: "workflow_dispatch", run_attempt: 1, conclusion: "success" },
    ...nights.slice(1)]), false);
});

test("given a comment somebody else wrote, when the tracker reads its own state, then it is ignored", () => {
  // given — a fingerprint is a hash over public values, so a marker can be written by anybody
  const forged = { user: { type: "User", login: "passer-by" },
    body: "<!-- courtside-nightly-occurrence:42:1 -->" };
  const own = { user: { type: "Bot", login: "github-actions[bot]" }, body: "recorded by the tracker" };

  // when
  const trusted = trustedCommentText([forged, own]);

  // then
  assert.equal(trusted.includes("courtside-nightly-occurrence"), false);
  assert.equal(trusted.includes("recorded by the tracker"), true);
});

test("given the same job name in two watched workflows, when both fail, then each keeps its own issue", () => {
  // given
  const [nightly] = classifyNightlyFailures({ ...run, run_attempt: 1 }, jobs);

  // when
  const [smoke] = classifyNightlyFailures({ ...run, run_attempt: 1, name: "mail smoke" }, jobs);

  // then
  assert.equal(smoke.workflow, "mail smoke");
  assert.notEqual(nightly.fingerprint, smoke.fingerprint);
});

test("given issues opened while only the build was watched, when it fails again, then they still match", () => {
  // given — the fingerprint is what those issues carry, so widening the tracker must not move it
  const [failure] = classifyNightlyFailures({ ...run, run_attempt: 1 }, jobs);

  // then
  assert.equal(failure.fingerprint, "2e49949d3997447bf280779525e3fbee36308b1a2bb6e0022dc3070d4816f932");
});

test("given one workflow's green streak, when issues are marked ready, then another's stay untouched", () => {
  // given
  const issues = [
    { number: 1, state: "open", comments: "",
      body: "- Workflow: `build`\n<!-- courtside-nightly-occurrence:1:1 -->" },
    { number: 2, state: "open", comments: "",
      body: "- Workflow: `mail smoke`\n<!-- courtside-nightly-occurrence:2:1 -->" }
  ];

  // when
  const plan = planReadyForReview(issues, "mail smoke");

  // then
  assert.deepEqual(plan.map((item) => item.issueNumber), [2]);
});
