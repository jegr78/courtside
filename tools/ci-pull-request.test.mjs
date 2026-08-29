import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveRunPullRequest } from "./ci-pull-request.mjs";

const sha = "a".repeat(40);
const baseSha = "b".repeat(40);

function run(overrides = {}) {
  return {
    event: "pull_request",
    head_branch: "feat/example",
    head_sha: sha,
    repository: { full_name: "example/courtside" },
    head_repository: { full_name: "example/courtside" },
    ...overrides,
  };
}

function pull(overrides = {}) {
  return {
    number: 123,
    base: { sha: baseSha, repo: { full_name: "example/courtside" } },
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
  assert.equal(result, candidate);
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
