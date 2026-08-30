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

test("given a closed pull request with a deleted branch, when resolving, then the exact run identity matches", () => {
  // given
  const candidate = pull({ state: "closed", merged_at: "2026-08-29T00:00:00Z" });

  // when
  const result = resolveRunPullRequest(run(), [candidate]);

  // then
  assert.equal(result.number, candidate.number);
  assert.equal(result.runBaseSha, baseSha);
});

test("given candidates with another head, when resolving, then the mismatch is rejected", () => {
  // given
  const candidates = [pull({ head: { ...pull().head, sha: "c".repeat(40) } })];

  // when / then
  assert.throws(() => resolveRunPullRequest(run(), candidates), /exactly one pull request/);
});

test("given candidates from another repository, when resolving, then the mismatch is rejected", () => {
  // given
  const candidates = [pull({ head: { ...pull().head, repo: { full_name: "other/courtside" } } })];

  // when / then
  assert.throws(() => resolveRunPullRequest(run(), candidates), /exactly one pull request/);
});

test("given duplicate exact candidates, when resolving, then ambiguity is rejected", () => {
  // given
  const candidates = [pull(), pull({ number: 124 })];

  // when / then
  assert.throws(() => resolveRunPullRequest(run(), candidates), /exactly one pull request/);
});

test("given a non pull request run, when resolving, then the run is rejected", () => {
  // when / then
  assert.throws(() => resolveRunPullRequest(run({ event: "push" }), [pull()]), /pull_request run/);
});

test("given the current pull request base advanced, when resolving, then the run base remains authoritative", () => {
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

test("given the run has no bound pull request, when resolving, then observation fails closed", () => {
  // when / then
  assert.throws(() => resolveRunPullRequest(run({ pull_requests: [] }), [pull()]),
    /exactly one run-bound pull request/);
});

test("given run bound pull requests are ambiguous, when resolving, then observation fails closed", () => {
  // given
  const bound = run().pull_requests[0];

  // when / then
  assert.throws(() => resolveRunPullRequest(run({ pull_requests: [bound, { ...bound }] }), [pull()]),
    /exactly one run-bound pull request/);
});

test("given run bound identity differs, when resolving, then observation fails closed", () => {
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
