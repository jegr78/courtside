import assert from "node:assert/strict";
import { test } from "node:test";
import { historicalPullRequest, pullRequestIdentity, replayProfileEvidence,
  runBaseIdentity } from "./test-profile-replay.mjs";

const backend = "backend";
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
    run_started_at: "2026-08-29T06:00:00Z",
    updated_at: "2026-08-29T06:10:00Z",
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
    started_at: skipped ? "2026-08-29T06:00:00Z" : "2026-08-29T06:01:00Z",
    completed_at: skipped ? "2026-08-29T06:00:00Z" : "2026-08-29T06:09:00Z",
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

test("givenAProtectedReducedRun_whenReplayingCurrentPolicy_thenTheExpectedSkipQualifies", async () => {
  // given
  const source = run(101);
  const jobs = [job(1, backend, "skipped"), job(2, frontend, "success"), job(3, security, "success")];

  // when
  const result = await replayProfileEvidence({
    repository: "jegr78/courtside",
    assessedAt: "2026-08-29T07:00:00Z",
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

test("givenRunBoundBaseMetadata_whenIdentityMatches_thenTheImmutableBaseIsReturned", () => {
  // given
  const source = run(101);

  // when
  const identity = runBaseIdentity(source, "jegr78/courtside");

  // then
  assert.deepEqual(identity, { runId: 101, attempt: 1, baseCommit: base, headCommit: head });
});

test("givenAmbiguousOrMismatchedRunMetadata_whenResolvingBase_thenReplayFailsClosed", () => {
  // given
  const ambiguous = run(101, { pull_requests: [run(101).pull_requests[0], run(101).pull_requests[0]] });
  const mismatched = run(101, { pull_requests: [{
    ...run(101).pull_requests[0], head: { ...run(101).pull_requests[0].head, sha: "d".repeat(40) }
  }] });

  // when / then
  assert.throws(() => runBaseIdentity(ambiguous, "jegr78/courtside"), /run-bound pull request/);
  assert.throws(() => runBaseIdentity(mismatched, "jegr78/courtside"), /run-bound pull request/);
});

test("givenAmbiguousHead_whenReconstructingIdentity_thenReplayFailsClosed", () => {
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

test("givenAForcePushedHistoricalHead_whenResolvingItsBranch_thenThePullRequestLifetimeBindsTheRun", () => {
  // given
  const source = run(101, { pull_requests: [] });
  const candidate = {
    number: 574,
    created_at: "2026-08-29T05:00:00Z",
    closed_at: "2026-08-29T08:00:00Z",
    base: { repo: { full_name: "jegr78/courtside" } },
    head: { sha: "d".repeat(40), ref: "feat/example", repo: { full_name: "jegr78/courtside" } }
  };
  // when
  const selected = historicalPullRequest(source, [candidate], "jegr78/courtside");

  // then
  assert.equal(selected.number, 574);
  assert.throws(() => historicalPullRequest(source, [{ ...candidate, closed_at: "2026-08-29T05:30:00Z" }],
    "jegr78/courtside"),
    /historical head-bound/);
});

test("givenCurrentPolicyNeedsAnHistoricallySkippedJob_whenReplaying_thenTheMissRemainsVisible", async () => {
  // given
  const source = run(101);
  const jobs = [job(1, backend, "skipped"), job(2, frontend, "success"), job(3, security, "success")];

  // when
  const result = await replayProfileEvidence({
    repository: "jegr78/courtside",
    assessedAt: "2026-08-29T07:00:00Z",
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

test("givenAReplayAttemptOtherThanTheFirst_whenLoadingEvidence_thenItIsRejected", async () => {
  // given
  const summary = run(101);
  const secondAttempt = run(101, { run_attempt: 2 });

  // when / then
  await assert.rejects(() => replayProfileEvidence({
    repository: "jegr78/courtside",
    assessedAt: "2026-08-29T07:00:00Z",
    runSummaries: [summary],
    loadAttempt: async () => secondAttempt,
    loadJobs: async () => [job(1, backend, "skipped"), job(2, frontend, "success"), job(3, security, "success")],
    classify: async (identity) => frontendPlan(identity)
  }), /first attempt/);
});
