import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveWorkflowRun } from "./ci-workflow-run.mjs";

const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);

function pullReference(overrides = {}) {
  return {
    number: 17,
    base: { ref: "main", sha: baseSha, repo: { id: 42 } },
    head: { ref: "feat/example", sha: headSha, repo: { id: 84 } },
    ...overrides,
  };
}

function run(overrides = {}) {
  return {
    id: 123,
    run_attempt: 1,
    event: "pull_request",
    name: "build",
    path: ".github/workflows/build.yml",
    head_branch: "feat/example",
    head_sha: headSha,
    repository: { id: 42, full_name: "example/courtside" },
    head_repository: { id: 84, full_name: "contributor/courtside" },
    pull_requests: [],
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    repository: { id: 42, full_name: "example/courtside" },
    workflow_run: { ...run(), pull_requests: [pullReference()] },
    ...overrides,
  };
}

test("given the later API omits pull request references, when resolving, then the triggering event remains authoritative", () => {
  // when
  const result = resolveWorkflowRun(event(), run(), "example/courtside", 123, 1);

  // then
  assert.deepEqual(result, { baseCommit: baseSha, headCommit: headSha, pullRequestNumber: 17 });
});

test("given the same head targets another base, when resolving, then the event selects its exact base", () => {
  // given
  const otherBase = "c".repeat(40);
  const captured = event({
    workflow_run: { ...run(), pull_requests: [pullReference({
      number: 18,
      base: { ref: "release", sha: otherBase, repo: { id: 42 } }
    })] }
  });

  // when
  const result = resolveWorkflowRun(captured, run(), "example/courtside", 123, 1);

  // then
  assert.deepEqual(result, { baseCommit: otherBase, headCommit: headSha, pullRequestNumber: 18 });
});

test("given event and API run identities differ, when resolving, then provenance fails closed", () => {
  // given
  const mismatches = [
    run({ id: 124 }),
    run({ run_attempt: 2 }),
    run({ head_sha: "c".repeat(40) }),
    run({ path: ".github/workflows/other.yml" }),
    run({ head_repository: { id: 85, full_name: "other/courtside" } }),
  ];

  // when / then
  for (const observed of mismatches) {
    assert.throws(() => resolveWorkflowRun(event(), observed, "example/courtside", 123, 1),
      /Workflow run provenance is invalid/);
  }
});

test("given event pull request provenance is missing ambiguous or mismatched, when resolving, then it fails closed", () => {
  // given
  const reference = pullReference();
  const invalid = [
    [],
    [reference, { ...reference }],
    [{ ...reference, head: { ...reference.head, sha: "c".repeat(40) } }],
    [{ ...reference, base: { ...reference.base, repo: { id: 99 } } }],
  ];

  // when / then
  for (const pullRequests of invalid) {
    const captured = event({ workflow_run: { ...run(), pull_requests: pullRequests } });
    assert.throws(() => resolveWorkflowRun(captured, run(), "example/courtside", 123, 1),
      /Workflow run provenance is invalid/);
  }
});
