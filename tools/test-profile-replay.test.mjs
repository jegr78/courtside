import assert from "node:assert/strict";
import { test } from "node:test";
import { historicalPullRequest, pullRequestIdentity, replayProfileEvidence,
  runBaseIdentity } from "./test-profile-replay.mjs";
import { classifyChanges } from "./test-profile-classifier.mjs";

const backend = "backend";
const docs = "docs";
const frontend = "frontend";
const security = "security";
const base = "a".repeat(40);
const head = "b".repeat(40);

function run(id, overrides = {}) {
  return {
    id,
    run_attempt: 1,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_sha: head,
    head_branch: "feat/example",
    run_started_at: "2026-09-01T06:00:00Z",
    updated_at: "2026-09-01T06:10:00Z",
    html_url: `https://github.com/jegr78/courtside/actions/runs/${id}`,
    repository: { id: 7, full_name: "jegr78/courtside" },
    head_repository: { id: 7, full_name: "jegr78/courtside" },
    pull_requests: [{
      number: 10,
      base: { ref: "main", sha: base, repo: { id: 7 } },
      head: { ref: "feat/example", sha: head, repo: { id: 7 } }
    }],
    ...overrides
  };
}

function job(id, name, conclusion) {
  const skipped = conclusion === "skipped";
  return {
    id,
    name,
    status: "completed",
    conclusion,
    started_at: skipped ? "2026-09-01T06:00:00Z" : "2026-09-01T06:01:00Z",
    completed_at: skipped ? "2026-09-01T06:00:00Z" : "2026-09-01T06:09:00Z",
    runner_name: skipped ? null : "GitHub Actions 1",
    labels: skipped ? [] : ["ubuntu-latest"],
    steps: []
  };
}

function frontendPlan(identity) {
  return {
    schemaVersion: 3,
    runId: identity.runId,
    attempt: identity.attempt,
    baseCommit: identity.baseCommit,
    headCommit: identity.headCommit,
    policyFingerprint: "c".repeat(64),
    plannerOutcome: "passed",
    profiles: [frontend],
    isFull: false,
    reasons: [{ code: "prefix:frontend/", path: "frontend/src/App.tsx", profile: frontend, status: "M" }]
  };
}

test("given a protected reduced run, when replaying current policy, then the expected skip qualifies", async () => {
  // given
  const source = run(101);
  const jobs = [job(1, docs, "skipped"), job(2, backend, "skipped"),
    job(3, frontend, "success"), job(4, security, "success")];

  // when
  const result = await replayProfileEvidence({
    repository: "jegr78/courtside",
    assessedAt: "2026-09-01T07:00:00Z",
    runSummaries: [source],
    loadAttempt: async () => source,
    loadJobs: async () => jobs,
    classify: async (identity) => frontendPlan(identity)
  });
  // then
  assert.equal(result.summary.sampleSize, 1);
  assert.equal(result.summary.reducedProfileCount, 1);
  assert.equal(result.summary.profileCounts.frontend, 1);
  assert.equal(result.observations[0].classificationOutcome, "no-observed-miss");
  assert.deepEqual(result.observations[0].incompleteJobs, []);
});

test("given historical added e2e evidence, when replaying current policy, then frontend remains attributable", async () => {
  // given
  const source = run(102);
  const jobs = [job(1, docs, "skipped"), job(2, backend, "skipped"),
    job(3, frontend, "success"), job(4, security, "success")];

  // when
  const result = await replayProfileEvidence({
    repository: "jegr78/courtside",
    assessedAt: "2026-09-01T07:00:00Z",
    runSummaries: [source],
    loadAttempt: async () => source,
    loadJobs: async () => jobs,
    classify: async (identity) => {
      const classified = classifyChanges([
        { status: "A", path: "frontend/e2e/new-journey.spec.ts" }
      ], []);
      return { ...frontendPlan(identity), profiles: classified.profiles,
        isFull: classified.isFull, reasons: classified.reasons };
    }
  });
  // then
  assert.deepEqual(result.observations[0].proposedProfiles, ["frontend"]);
  assert.equal(result.observations[0].classificationOutcome, "no-observed-miss");
});

test("given historical added e2e evidence loses a required job, when replaying, then it cannot qualify", async () => {
  // given
  const source = run(103, { conclusion: "failure" });
  const jobs = [job(1, docs, "skipped"), job(2, backend, "skipped"),
    job(3, frontend, "failure"), job(4, security, "success")];

  // when
  const result = await replayProfileEvidence({
    repository: "jegr78/courtside",
    assessedAt: "2026-09-01T07:00:00Z",
    runSummaries: [source],
    loadAttempt: async () => source,
    loadJobs: async () => jobs,
    classify: async (identity) => {
      const classified = classifyChanges([
        { status: "A", path: "frontend/e2e/new-journey.spec.ts" }
      ], []);
      return { ...frontendPlan(identity), profiles: classified.profiles,
        isFull: classified.isFull, reasons: classified.reasons };
    }
  });
  const skippedSecurity = await replayProfileEvidence({
    repository: "jegr78/courtside",
    assessedAt: "2026-09-01T07:00:00Z",
    runSummaries: [source],
    loadAttempt: async () => source,
    loadJobs: async () => [job(1, docs, "skipped"), job(2, backend, "skipped"),
      job(3, frontend, "success"), job(4, security, "skipped")],
    classify: async (identity) => {
      const classified = classifyChanges([
        { status: "A", path: "frontend/e2e/new-journey.spec.ts" }
      ], []);
      return { ...frontendPlan(identity), profiles: classified.profiles,
        isFull: classified.isFull, reasons: classified.reasons };
    }
  });

  // then
  assert.equal(result.observations[0].classificationOutcome, "observation-incomplete");
  assert.deepEqual(result.observations[0].incompleteJobs, [{ name: "frontend", outcome: "failure" }]);
  assert.equal(result.summary.sampleSize, 0);
  assert.deepEqual(skippedSecurity.observations[0].incompleteJobs,
    [{ name: "security", outcome: "skipped" }]);
});

test("given run bound base metadata, when identity matches, then the immutable base is returned", () => {
  // given
  const source = run(101);

  // when
  const identity = runBaseIdentity(source, "jegr78/courtside");

  // then
  assert.deepEqual(identity, { runId: 101, attempt: 1, baseCommit: base, headCommit: head });
});

test("given ambiguous or mismatched run metadata, when resolving base, then replay fails closed", () => {
  // given
  const ambiguous = run(101, { pull_requests: [run(101).pull_requests[0], run(101).pull_requests[0]] });
  const mismatched = run(101, { pull_requests: [{
    ...run(101).pull_requests[0], head: { ...run(101).pull_requests[0].head, sha: "d".repeat(40) }
  }] });

  // when / then
  assert.throws(() => runBaseIdentity(ambiguous, "jegr78/courtside"), /run-bound pull request/);
  assert.throws(() => runBaseIdentity(mismatched, "jegr78/courtside"), /run-bound pull request/);
});

test("given ambiguous head, when reconstructing identity, then replay fails closed", () => {
  // given
  const source = run(101, { pull_requests: [] });
  const match = {
    number: 574,
    base: { sha: base, repo: { full_name: "jegr78/courtside" } },
    head: { sha: head, repo: { full_name: "jegr78/courtside" } }
  };

  // when / then
  assert.throws(() => pullRequestIdentity(source, [match, match], "jegr78/courtside"), /head-bound/);
});

test("given a force pushed historical head, when resolving its branch, then the pull request lifetime binds the run", () => {
  // given
  const source = run(101, { pull_requests: [] });
  const candidate = {
    number: 574,
    created_at: "2026-09-01T05:00:00Z",
    closed_at: "2026-09-01T08:00:00Z",
    base: { repo: { full_name: "jegr78/courtside" } },
    head: { sha: "d".repeat(40), ref: "feat/example", repo: { full_name: "jegr78/courtside" } }
  };
  // when
  const selected = historicalPullRequest(source, [candidate], "jegr78/courtside");

  // then
  assert.equal(selected.number, 574);
  assert.throws(() => historicalPullRequest(source, [{ ...candidate, closed_at: "2026-09-01T05:30:00Z" }],
    "jegr78/courtside"),
    /historical head-bound/);
});

test("given current policy needs an historically skipped job, when replaying, then the miss remains visible", async () => {
  // given
  const source = run(101);
  const jobs = [job(1, docs, "skipped"), job(2, backend, "skipped"),
    job(3, frontend, "success"), job(4, security, "success")];

  // when
  const result = await replayProfileEvidence({
    repository: "jegr78/courtside",
    assessedAt: "2026-09-01T07:00:00Z",
    runSummaries: [source],
    loadAttempt: async () => source,
    loadJobs: async () => jobs,
    classify: async (identity) => ({
      ...frontendPlan(identity), profiles: [backend, frontend],
      reasons: [{ code: "current-policy", path: "src/Main.java", profile: backend, status: "M" }]
    })
  });

  // then
  assert.equal(result.observations[0].classificationOutcome, "observation-incomplete");
  assert.equal(result.summary.sampleSize, 0);
  assert.equal(result.summary.incompleteObservationCount, 1);
});

test("given a replay attempt other than the first, when loading evidence, then it is rejected", async () => {
  // given
  const summary = run(101);
  const secondAttempt = run(101, { run_attempt: 2 });

  // when / then
  await assert.rejects(() => replayProfileEvidence({
    repository: "jegr78/courtside",
    assessedAt: "2026-09-01T07:00:00Z",
    runSummaries: [summary],
    loadAttempt: async () => secondAttempt,
    loadJobs: async () => [job(1, docs, "skipped"), job(2, backend, "skipped"),
      job(3, frontend, "success"), job(4, security, "success")],
    classify: async (identity) => frontendPlan(identity)
  }), /first attempt/);
});
