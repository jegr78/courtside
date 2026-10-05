import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  greenExactBuild,
  pendingReleasePullRequests,
  readCommitFacts,
  releasePullRequestOf,
  selectReleaseCandidate
} from "./release-candidate-selection.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const git = (...arguments_) => execFileSync("git", arguments_, { cwd: repository, encoding: "utf8" }).trim();

const mergeCommit = "b".repeat(40);
const laterCommit = "c".repeat(40);

function workflowRun(overrides = {}) {
  return {
    event: "workflow_run",
    ref: "refs/heads/main",
    rehearsal: "",
    commit: mergeCommit,
    build: { event: "push", headBranch: "main", headRepository: "jegr78/courtside", conclusion: "success",
      runId: 37211926309, runAttempt: 1 },
    repository: "jegr78/courtside",
    onMain: true,
    manifest: "0.1.0",
    parentManifest: "0.1.0-rc.11",
    pomVersion: "0.1.0",
    packageVersion: "0.1.0",
    tagExists: false,
    pendingPullRequests: [
      { number: 1290, title: "chore(main): release 0.1.0", mergeCommit, mergeCommitIsAncestor: true }
    ],
    exactBuild: { runId: 37211926310, runAttempt: 1 },
    ...overrides
  };
}

function dispatch(overrides = {}) {
  return workflowRun({
    event: "workflow_dispatch",
    rehearsal: false,
    commit: laterCommit,
    build: undefined,
    parentManifest: "0.1.0",
    ...overrides
  });
}

test("given a green push build of a release merge on main, when the candidate selects, then it qualifies that commit", () => {
  // when
  const selection = selectReleaseCandidate(workflowRun());

  // then
  assert.deepEqual(selection, {
    release: true, reason: "release-commit", commit: mergeCommit, version: "0.1.0", tag: "v0.1.0",
    rehearsal: false, pendingPullRequest: 1290, build: { runId: 37211926309, runAttempt: 1 }
  }, "a release merge with one pending release pull request and no tag is a candidate");
});

test("given the real 0.1.0 release commit read through git, when the candidate selects, then it qualifies v0.1.0", () => {
  // given
  const commit = git("rev-parse", "b1cd6c3a^{commit}");
  const facts = readCommitFacts(commit, (...arguments_) => git(...arguments_));
  const [, title, number] = /^(.+) \(#(\d+)\)$/.exec(git("log", "-1", "--format=%s", commit));

  // when
  const selection = selectReleaseCandidate(workflowRun({
    commit,
    ...facts,
    tagExists: false,
    pendingPullRequests: [{ number: Number(number), title, mergeCommit: commit, mergeCommitIsAncestor: true }]
  }));

  // then
  assert.deepEqual(facts, { manifest: "0.1.0", parentManifest: "0.1.0-rc.11", pomVersion: "0.1.0",
    packageVersion: "0.1.0" }, "release-please's own merge moves the manifest, the pom and the package together");
  assert.equal(title, "chore(main): release 0.1.0", "release-please titles its pull request this way");
  assert.deepEqual([selection.release, selection.version, selection.tag, selection.pendingPullRequest],
    [true, "0.1.0", "v0.1.0", 1290], "the generator's real release commit is the candidate the selection accepts");
});

test("given a push whose manifest did not change, when the candidate selects, then it skips as an ordinary commit", () => {
  // when
  const selection = selectReleaseCandidate(workflowRun({ parentManifest: "0.1.0", pendingPullRequests: [] }));

  // then
  assert.deepEqual([selection.release, selection.reason], [false, "not-a-release-commit"],
    "every push to main finishes a build, and only a release merge starts a candidate");
});

test("given a build that is not a push to main of this repository, when the candidate selects, then it skips", () => {
  // given
  const builds = [
    { event: "pull_request", headBranch: "main", headRepository: "jegr78/courtside", conclusion: "success" },
    { event: "push", headBranch: "main", headRepository: "someone/courtside", conclusion: "success" },
    { event: "push", headBranch: "feature", headRepository: "jegr78/courtside", conclusion: "success" }
  ];

  // when / then
  for (const build of builds) {
    const selection = selectReleaseCandidate(workflowRun({ build }));
    assert.deepEqual([selection.release, selection.reason], [false, "not-a-main-push"],
      `a ${build.event} build from ${build.headRepository}:${build.headBranch} starts no candidate`);
  }
});

test("given a failed push build, when the candidate selects, then it skips because the commit is not green", () => {
  // when
  const selection = selectReleaseCandidate(workflowRun({
    build: { event: "push", headBranch: "main", headRepository: "jegr78/courtside", conclusion: "failure" }
  }));

  // then
  assert.deepEqual([selection.release, selection.reason], [false, "build-not-green"],
    "a candidate starts only after the exact commit's build is green");
});

test("given a release commit whose tag exists, when the build finishes, then the candidate skips it", () => {
  // when
  const selection = selectReleaseCandidate(workflowRun({ tagExists: true }));

  // then
  assert.deepEqual([selection.release, selection.reason], [false, "already-tagged"],
    "a tag is written once, so a re-run build must not qualify it again");
});

test("given a manifest change without a pending release pull request, when the candidate selects, then the run fails", () => {
  // when / then
  assert.throws(() => selectReleaseCandidate(workflowRun({ pendingPullRequests: [] })),
    /without a pending release pull request/);
});

test("given two pending release pull requests, when the candidate selects, then the run fails", () => {
  // given
  const second = { number: 1291, title: "chore(main): release 0.1.0", mergeCommit, mergeCommitIsAncestor: true };

  // when / then
  assert.throws(() => selectReleaseCandidate(workflowRun({
    pendingPullRequests: [...workflowRun().pendingPullRequests, second]
  })), /more than one pending release/);
});

test("given a pending release pull request for another version, when the candidate selects, then the run fails", () => {
  // when / then
  assert.throws(() => selectReleaseCandidate(workflowRun({
    pendingPullRequests: [{ number: 1290, title: "chore(main): release 0.1.1", mergeCommit, mergeCommitIsAncestor: true }]
  })), /names 0\.1\.1/);
});

test("given a pom or package that disagrees with the manifest, when the candidate selects, then the run fails", () => {
  // when / then
  for (const disagreement of [{ pomVersion: "0.1.0-rc.11" }, { packageVersion: "0.1.0-rc.11" }]) {
    assert.throws(() => selectReleaseCandidate(workflowRun(disagreement)), /records 0\.1\.0-rc\.11/);
    assert.throws(() => selectReleaseCandidate(dispatch({ rehearsal: true, ...disagreement })),
      /records 0\.1\.0-rc\.11/);
  }
});

test("given a later commit on main after a failed candidate, when it is dispatched, then it qualifies the pending release", () => {
  // when
  const selection = selectReleaseCandidate(dispatch());

  // then
  assert.deepEqual(selection, {
    release: true, reason: "re-run", commit: laterCommit, version: "0.1.0", tag: "v0.1.0",
    rehearsal: false, pendingPullRequest: 1290, build: { runId: 37211926310, runAttempt: 1 }
  }, "a fix on main is qualified under the version the pending release pull request records");
});

test("given a dispatched commit older than the release merge, when the candidate selects, then the run fails", () => {
  // when / then
  assert.throws(() => selectReleaseCandidate(dispatch({
    pendingPullRequests: [{ number: 1290, title: "chore(main): release 0.1.0", mergeCommit, mergeCommitIsAncestor: false }]
  })), /precedes the release pull request/);
});

test("given a dispatch that is not a rehearsal, when commit or workflow is not on main, then the run fails", () => {
  // when / then
  assert.throws(() => selectReleaseCandidate(dispatch({ onMain: false })), /not on main/);
  assert.throws(() => selectReleaseCandidate(dispatch({ ref: "refs/heads/ci/release-candidate-rehearsal" })),
    /not on main/);
});

test("given a dispatched release that is already tagged, when the candidate selects, then the run fails", () => {
  // when / then
  assert.throws(() => selectReleaseCandidate(dispatch({ tagExists: true })), /already tagged/);
});

test("given a dispatched commit without a green build on main, when the candidate selects, then the run fails", () => {
  // when / then
  assert.throws(() => selectReleaseCandidate(dispatch({ exactBuild: null })), /no green build/);
});

test("given a rehearsal dispatch on a branch, when the candidate selects, then it qualifies without release preconditions", () => {
  // when
  const selection = selectReleaseCandidate(dispatch({
    rehearsal: "true", ref: "refs/heads/ci/release-candidate-rehearsal", onMain: false, tagExists: true,
    pendingPullRequests: [], exactBuild: null
  }));

  // then
  assert.deepEqual(selection, {
    release: true, reason: "rehearsal", commit: laterCommit, version: "0.1.0", tag: "v0.1.0",
    rehearsal: true, pendingPullRequest: null, build: null
  }, "a rehearsal proves the pipeline without a pending release, a main commit or a free tag");
});

test("given a workflow run without inputs, when rehearsal arrives empty, then it is no rehearsal", () => {
  // when
  const selection = selectReleaseCandidate(workflowRun({ rehearsal: "" }));

  // then
  assert.equal(selection.rehearsal, false, "an empty inputs context must not turn a release into a rehearsal");
});

test("given a commit that is not a full sha, when the candidate selects, then the run fails", () => {
  // when / then
  for (const commit of ["b1cd6c3a", "main", ""]) {
    assert.throws(() => selectReleaseCandidate(dispatch({ commit })), /full 40-character sha/);
  }
});

const recordedIssuePage = [
  { number: 1290, pull_request: { merged_at: "2026-10-04T15:09:05Z" }, title: "chore(main): release 0.1.0" },
  { number: 1288, pull_request: { merged_at: "2026-10-04T11:14:39Z" }, title: "chore(main): release 0.1.0-rc.11" },
  { number: 750, pull_request: { merged_at: null },
    title: "build(deps): bump softprops/action-gh-release from 3.0.2 to 3.0.3" },
  { number: 1270, title: "The series button reads \"Create 1 appointments\"" }
];
const recordedPull = { base: { ref: "main" }, merge_commit_sha: "b1cd6c3a7a05164552a414bc4a88ea2441ebf31e",
  number: 1290, title: "chore(main): release 0.1.0" };

test("given a recorded issues page, when release pull requests are read, then only merged pull requests count", () => {
  // when / then
  assert.deepEqual(pendingReleasePullRequests([recordedIssuePage]), [
    { number: 1290, title: "chore(main): release 0.1.0" },
    { number: 1288, title: "chore(main): release 0.1.0-rc.11" }
  ], "a closed unmerged pull request and a plain issue are not releases");
});

test("given a recorded pull request, when its merge is read, then it names the merge commit on main", () => {
  // when / then
  assert.deepEqual(releasePullRequestOf(recordedPull, true), { number: 1290, title: "chore(main): release 0.1.0",
    mergeCommit: "b1cd6c3a7a05164552a414bc4a88ea2441ebf31e", mergeCommitIsAncestor: true });
  assert.equal(releasePullRequestOf({ ...recordedPull, base: { ref: "release/0.1" } }, true), null,
    "a release pull request into another branch is not this line's release");
  assert.equal(releasePullRequestOf({ ...recordedPull, merge_commit_sha: null }, true).mergeCommitIsAncestor, false);
});

test("given a dispatched commit whose manifest moved past the pending release, when the candidate selects, then the run fails",
  () => {
    // when / then
    assert.throws(() => selectReleaseCandidate(dispatch({ manifest: "0.1.1", parentManifest: "0.1.1",
      pomVersion: "0.1.1", packageVersion: "0.1.1" })), /names 0\.1\.0, but the manifest records 0\.1\.1/);
  });

test("given build runs of a commit, when the exact build is read, then only a green main run of this repository counts", () => {
  // given
  const green = { id: 37211926309, run_attempt: 1, event: "push", head_branch: "main", conclusion: "success",
    head_repository: { full_name: "jegr78/courtside" }, path: ".github/workflows/build.yml" };

  // when / then
  assert.deepEqual(greenExactBuild([{ workflow_runs: [green] }], "jegr78/courtside"),
    { runId: 37211926309, runAttempt: 1 });
  for (const other of [{ head_branch: "feature" }, { event: "pull_request" }, { conclusion: "failure" },
    { head_repository: { full_name: "someone/courtside" } }]) {
    assert.equal(greenExactBuild([{ workflow_runs: [{ ...green, ...other }] }], "jegr78/courtside"), null,
      `${JSON.stringify(other)} is not the exact-sha build on main`);
  }
});

test("given a push build that turned green on its second attempt, when a candidate is selected, then that attempt is recorded",
  () => {
    // given
    const rerun = { id: 37211926309, run_attempt: 2, event: "push", head_branch: "main", conclusion: "success",
      head_repository: { full_name: "jegr78/courtside" } };

    // when
    const exactBuild = greenExactBuild([{ workflow_runs: [rerun] }], "jegr78/courtside");
    const dispatched = selectReleaseCandidate(dispatch({ exactBuild }));
    const finished = selectReleaseCandidate(workflowRun({ build: { ...workflowRun().build, runAttempt: 2 } }));

    // then
    assert.deepEqual([dispatched.build, finished.build],
      [{ runId: 37211926309, runAttempt: 2 }, { runId: 37211926309, runAttempt: 2 }],
      "a green re-run attempt counts and the evidence names it");
  });

test("given a push build whose latest attempt is red, when a candidate is selected, then it is refused", () => {
  // given
  const red = { id: 37211926309, run_attempt: 2, event: "push", head_branch: "main", conclusion: "failure",
    head_repository: { full_name: "jegr78/courtside" } };

  // when / then
  assert.throws(() => selectReleaseCandidate(dispatch({
    exactBuild: greenExactBuild([{ workflow_runs: [red] }], "jegr78/courtside") })), /no green build/);
  assert.equal(selectReleaseCandidate(workflowRun({ build: { ...workflowRun().build, conclusion: "failure",
    runAttempt: 2 } })).reason, "build-not-green");
});
