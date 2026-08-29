import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveRunPullRequest } from "./ci-pull-request.mjs";

const sha = "a".repeat(40);
const baseSha = "b".repeat(40);
const repositoryId = 42;

function run(overrides = {}) {
  return {
    event: "pull_request",
    head_branch: "feat/example",
    head_sha: sha,
    repository: { id: repositoryId, full_name: "example/courtside" },
    head_repository: { id: repositoryId, full_name: "example/courtside" },
    pull_requests: [{
      number: 123,
      base: { sha: baseSha, ref: "main", repo: { id: repositoryId } },
      head: { sha, ref: "feat/example", repo: { id: repositoryId } },
    }],
    ...overrides,
  };
}

function pull(overrides = {}) {
  return {
    number: 123,
    base: { ref: "main", sha: baseSha, repo: { full_name: "example/courtside" } },
    head: {
      ref: "feat/example",
      sha,
      repo: { full_name: "example/courtside" },
    },
    ...overrides,
  };
}

test("givenAClosedPullRequestWithADeletedBranch_whenResolving_thenTheExactRunIdentityMatches", () => {
  // given
  const candidate = pull({ state: "closed", merged_at: "2026-08-29T00:00:00Z" });

  // when
  const result = resolveRunPullRequest(run(), [candidate]);

  // then
  assert.equal(result.number, candidate.number);
  assert.equal(result.runBaseSha, baseSha);
});

test("givenCandidatesWithAnotherHead_whenResolving_thenTheMismatchIsRejected", () => {
  // given
  const candidates = [pull({ head: { ...pull().head, sha: "c".repeat(40) } })];

  // when / then
  assert.throws(() => resolveRunPullRequest(run(), candidates), /exactly one pull request/);
});

test("givenCandidatesFromAnotherRepository_whenResolving_thenTheMismatchIsRejected", () => {
  // given
  const candidates = [pull({ head: { ...pull().head, repo: { full_name: "other/courtside" } } })];

  // when / then
  assert.throws(() => resolveRunPullRequest(run(), candidates), /exactly one pull request/);
});

test("givenDuplicateExactCandidates_whenResolving_thenAmbiguityIsRejected", () => {
  // given
  const candidates = [pull(), pull({ number: 124 })];

  // when / then
  assert.throws(() => resolveRunPullRequest(run(), candidates), /exactly one pull request/);
});

test("givenANonPullRequestRun_whenResolving_thenTheRunIsRejected", () => {
  // when / then
  assert.throws(() => resolveRunPullRequest(run({ event: "push" }), [pull()]), /pull_request run/);
});

test("givenTheCurrentPullRequestBaseAdvanced_whenResolving_thenTheRunBaseRemainsAuthoritative", () => {
  // given
  const currentBase = "c".repeat(40);

  // when
  const result = resolveRunPullRequest(run(), [pull({
    base: { ref: "main", sha: currentBase, repo: { full_name: "example/courtside" } }
  })]);

  // then
  assert.equal(result.runBaseSha, baseSha);
  assert.notEqual(result.runBaseSha, currentBase);
});

test("givenTheRunHasNoBoundPullRequest_whenResolving_thenObservationFailsClosed", () => {
  // when / then
  assert.throws(() => resolveRunPullRequest(run({ pull_requests: [] }), [pull()]),
    /exactly one run-bound pull request/);
});

test("givenRunBoundPullRequestsAreAmbiguous_whenResolving_thenObservationFailsClosed", () => {
  // given
  const bound = run().pull_requests[0];

  // when / then
  assert.throws(() => resolveRunPullRequest(run({ pull_requests: [bound, { ...bound }] }), [pull()]),
    /exactly one run-bound pull request/);
});

test("givenRunBoundIdentityDiffers_whenResolving_thenObservationFailsClosed", () => {
  // given
  const bound = run().pull_requests[0];
  const mismatches = [
    { ...bound, number: 124 },
    { ...bound, base: { ...bound.base, repo: { id: 84 } } },
    { ...bound, head: { ...bound.head, sha: "d".repeat(40) } },
  ];

  // when / then
  for (const reference of mismatches) {
    assert.throws(() => resolveRunPullRequest(run({ pull_requests: [reference] }), [pull()]),
      /exactly one run-bound pull request/);
  }
});
