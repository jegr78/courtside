import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  branchFetchArguments,
  greenExactBuild,
  pendingReleasePullRequests,
  readCommitFacts,
  releasePullRequestOf,
  releaseTitleOf,
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
    onBranch: true,
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
    release: true, reason: "release-commit", commit: mergeCommit, version: "0.1.0", tag: "v0.1.0", branch: "main",
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
    release: true, reason: "re-run", commit: laterCommit, version: "0.1.0", tag: "v0.1.0", branch: "main",
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
  assert.throws(() => selectReleaseCandidate(dispatch({ onBranch: false })), /not on main/);
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
    rehearsal: "true", ref: "refs/heads/ci/release-candidate-rehearsal", onBranch: false, tagExists: true,
    pendingPullRequests: [], exactBuild: null
  }));

  // then
  assert.deepEqual(selection, {
    release: true, reason: "rehearsal", commit: laterCommit, version: "0.1.0", tag: "v0.1.0", branch: "main",
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
    assert.throws(() => selectReleaseCandidate(dispatch({ manifest: "0.2.0-rc.1", parentManifest: "0.2.0-rc.1",
      pomVersion: "0.2.0-rc.1", packageVersion: "0.2.0-rc.1" })), /names 0\.1\.0, but the manifest records 0\.2\.0-rc\.1$/);
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

function patchDispatch(overrides = {}) {
  return dispatch({
    manifest: "0.1.1", parentManifest: "0.1.1", pomVersion: "0.1.1", packageVersion: "0.1.1",
    pendingPullRequests: [
      { number: 1501, title: "chore(release/0.1): release 0.1.1", mergeCommit, mergeCommitIsAncestor: true }
    ],
    exactBuild: { runId: 37311926310, runAttempt: 1 },
    ...overrides
  });
}

test("given a patch release merged on its release branch, when the candidate is dispatched from main, then it qualifies that commit",
  () => {
    // when
    const selection = selectReleaseCandidate(patchDispatch());

    // then
    assert.deepEqual(selection, {
      release: true, reason: "patch-release", commit: laterCommit, version: "0.1.1", tag: "v0.1.1",
      branch: "release/0.1", rehearsal: false, pendingPullRequest: 1501, build: { runId: 37311926310, runAttempt: 1 }
    }, "a patch has no push build, so its one dispatched build on release/0.1 is the exact green build");
  });

test("given a patch release, when its commit is not on its release branch, then the candidate refuses it", () => {
  // when / then
  assert.throws(() => selectReleaseCandidate(patchDispatch({ onBranch: false })), /is not on release\/0\.1/);
});

test("given a patch release, when the pending pull request was titled for main, then the candidate refuses it", () => {
  // when / then
  assert.throws(() => selectReleaseCandidate(patchDispatch({ pendingPullRequests: [
    { number: 1502, title: "chore(main): release 0.1.1", mergeCommit, mergeCommitIsAncestor: true }
  ] })), /names main 0\.1\.1, but the manifest records 0\.1\.1 for release\/0\.1/);
});

test("given a push to main that records a patch version, when the build finishes, then the candidate refuses the line", () => {
  // when / then
  assert.throws(() => selectReleaseCandidate(workflowRun({ manifest: "0.1.1", pomVersion: "0.1.1", packageVersion: "0.1.1",
    pendingPullRequests: [{ number: 1503, title: "chore(main): release 0.1.1", mergeCommit, mergeCommitIsAncestor: true }]
  })), /0\.1\.1 is released from release\/0\.1, not from main/);
});

test("given release-please's title for a release branch, when a pull request is read, then it belongs to that branch only", () => {
  // given
  const patchPull = { ...recordedPull, base: { ref: "release/0.1" }, title: "chore(release/0.1): release 0.1.1" };

  // when / then
  assert.equal(releaseTitleOf("0.1.1", "release/0.1"), "chore(release/0.1): release 0.1.1",
    "release-please 17.6 puts the target branch in the scope");
  assert.equal(releaseTitleOf("0.2.0-rc.1"), "chore(main): release 0.2.0-rc.1");
  assert.deepEqual(releasePullRequestOf(patchPull, true, "release/0.1"), { number: 1290,
    title: "chore(release/0.1): release 0.1.1", mergeCommit: recordedPull.merge_commit_sha, mergeCommitIsAncestor: true });
  assert.equal(releasePullRequestOf(recordedPull, true, "release/0.1"), null, "main's release is not the patch's");
});

test("given build runs of a patch commit, when the exact build is read, then only a green run on its release branch counts", () => {
  // given
  const dispatched = { id: 37311926310, run_attempt: 1, event: "workflow_dispatch", head_branch: "release/0.1",
    conclusion: "success", head_repository: { full_name: "jegr78/courtside" } };

  // when / then
  assert.deepEqual(greenExactBuild([{ workflow_runs: [dispatched] }], "jegr78/courtside", "release/0.1"),
    { runId: 37311926310, runAttempt: 1 });
  assert.equal(greenExactBuild([{ workflow_runs: [dispatched] }], "jegr78/courtside"), null,
    "a release-branch build does not verify a commit on main");
  assert.equal(greenExactBuild([{ workflow_runs: [{ ...dispatched, head_branch: "main" }] }], "jegr78/courtside",
    "release/0.1"), null, "a main build does not verify a patch");
});

test("given the branch a release belongs to, when it is fetched, then a tag of the same name cannot stand in for it", () => {
  // when / then
  assert.deepEqual(branchFetchArguments("release/0.1"),
    ["fetch", "--no-tags", "origin", "+refs/heads/release/0.1:refs/remotes/origin/release/0.1"],
    "git resolves a short name to refs/tags before refs/heads, so a pushed tag release/0.1 would win");
  assert.deepEqual(branchFetchArguments("main"), ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
  for (const branch of ["release/0.1.1", "release/x", "refs/heads/main", "release/0.1 ", "feature/release/0.1"]) {
    assert.throws(() => branchFetchArguments(branch), /not a release target/, `${branch} is not fetched as a release line`);
  }
});
