import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  forwardPortVerdict,
  lineVerdict,
  pullRequestVerdicts,
  releasableTypes,
  releaseBranchOf,
  remoteRefOf,
  tagAdmission
} from "./release-line.mjs";

const config = JSON.parse(readFileSync(new URL("../release-please-config.json", import.meta.url), "utf8"));
const releasable = releasableTypes(config);
const refOf = (branch) => branch;

test("given a version, when its release branch is derived, then candidates and minors stay on main and patches go to their line",
  () => {
    // when / then
    assert.equal(releaseBranchOf("0.2.0-rc.1"), "main", "a candidate of the next milestone is cut on main");
    assert.equal(releaseBranchOf("0.2.0"), "main", "a graduated milestone is cut on main");
    assert.equal(releaseBranchOf("1.0.0"), "main");
    assert.equal(releaseBranchOf("0.1.1"), "release/0.1", "a patch is cut on the branch of its line");
    assert.equal(releaseBranchOf("1.12.3"), "release/1.12");
    assert.equal(releaseBranchOf("0.1.1-rc"), "main",
      "release-please's 0.1.1-rc from main is a candidate, which the line check then refuses by base");
  });

test("given a version that is not plain semantic versioning, when its branch is derived, then it is refused", () => {
  // when / then
  for (const version of ["v0.1.1", "0.1", "0.1.1+build.1", "", undefined, "01.1.1"]) {
    assert.throws(() => releaseBranchOf(version), /not a release version/, `${version} names no release`);
  }
});

test("given release-please's changelog sections, when releasable types are read, then exactly the visible ones count", () => {
  // when / then
  assert.deepEqual([...releasable].toSorted(), ["build", "docs", "feat", "fix", "perf"],
    "a commit release-please lists in the patch notes is a commit main must also carry");
});

test("given a release pull request, when its version is checked against its base, then a patch on main is refused", () => {
  // when / then
  assert.deepEqual(lineVerdict({ base: "main", version: "0.1.1" }), {
    check: "line", accepted: false,
    detail: "0.1.1 is a patch of the 0.1 line and is released from release/0.1, not from main"
  });
  assert.equal(lineVerdict({ base: "main", version: "0.1.1-rc" }).accepted, false,
    "the candidate release-please proposes after a lone fix on main is a patch candidate as well");
  assert.equal(lineVerdict({ base: "main", version: "0.2.0-rc.1" }).accepted, true);
  assert.equal(lineVerdict({ base: "main", version: "0.2.0" }).accepted, true);
  assert.equal(lineVerdict({ base: "release/0.1", version: "0.1.1" }).accepted, true);
});

test("given a release branch, when a release pull request proposes another line or a candidate, then it is refused", () => {
  // when / then
  assert.equal(lineVerdict({ base: "release/0.1", version: "0.1.1-rc" }).accepted, false,
    "a release branch configured as a candidate line would propose 0.1.1-rc");
  assert.equal(lineVerdict({ base: "release/0.1", version: "0.2.0-rc.1" }).accepted, false);
  assert.equal(lineVerdict({ base: "release/0.1", version: "0.2.1" }).accepted, false);
  assert.throws(() => lineVerdict({ base: "feat/booking", version: "0.1.1" }), /not a release target/);
});

function gitRepository() {
  const root = mkdtempSync(join(tmpdir(), "courtside-release-line-"));
  const git = (...arguments_) => execFileSync("git", arguments_, { cwd: root, encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "Jane Doe", GIT_AUTHOR_EMAIL: "jane@example.org",
      GIT_COMMITTER_NAME: "Jane Doe", GIT_COMMITTER_EMAIL: "jane@example.org" } }).trim();
  git("init", "--quiet", "--initial-branch=main");
  const commit = (message, file = "notes.txt", text = message) => {
    writeFileSync(join(root, file), `${text}\n`);
    git("add", "--all");
    git("commit", "--quiet", "--message", message);
    return git("rev-parse", "HEAD");
  };
  const manifest = (version) => writeFileSync(join(root, ".release-please-manifest.json"),
    `${JSON.stringify({ ".": version })}\n`);
  return { root, git, commit, manifest, remove: () => rmSync(root, { recursive: true, force: true }) };
}

function releasedLine() {
  const repository = gitRepository();
  const { git, commit, manifest } = repository;
  manifest("0.1.0");
  commit("chore(main): release 0.1.0", "court.txt", "court");
  git("tag", "v0.1.0");
  commit("feat: show the court plan on a phone", "plan.txt");
  git("switch", "--quiet", "--create", "release/0.1", "v0.1.0");
  commit("ci: run release-please on release branches", "workflow.txt");
  const fix = commit("fix: correct the opening hours sentence", "hours.txt");
  return { ...repository, fix };
}

test("given a fix on the release branch without a port on main, when the forward port is checked, then the release is refused",
  () => {
    // given
    const repository = releasedLine();
    try {
      // when
      const verdict = forwardPortVerdict({ git: repository.git, baseRef: "release/0.1",
        headRef: "release/0.1", mainRef: "main", releasable });

      // then
      assert.equal(verdict.accepted, false, "a patch must not ship a fix main does not carry");
      assert.deepEqual(verdict.missing, [`${repository.fix} fix: correct the opening hours sentence`],
        "only the fix needs a port; the ci commit is not released");
    } finally {
      repository.remove();
    }
  });

test("given the fix was cherry-picked to main with -x, when the forward port is checked, then the release is accepted", () => {
  // given
  const repository = releasedLine();
  const { git } = repository;
  try {
    git("switch", "--quiet", "main");
    git("cherry-pick", "-x", repository.fix);

    // when
    const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "release/0.1", mainRef: "main",
      releasable });

    // then
    assert.deepEqual(verdict, { check: "forward-port", accepted: true, missing: [],
      detail: "every released change since v0.1.0 is on main" });
  } finally {
    repository.remove();
  }
});

test("given the port was squash-merged into main, when the forward port is checked, then its concatenated body still counts",
  () => {
    // given
    const repository = releasedLine();
    const { git, commit } = repository;
    try {
      git("switch", "--quiet", "main");
      commit(`fix: correct the opening hours sentence (#1501)\n\n* fix: correct the opening hours sentence\n\n`
        + `(cherry picked from commit ${repository.fix})\n\nCo-authored-by: Jane Doe <jane@example.org>`, "hours.txt");

      // when
      const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "release/0.1", mainRef: "main",
        releasable });

      // then
      assert.equal(verdict.accepted, true, "GitHub's squash keeps every commit message, the trailer included");
    } finally {
      repository.remove();
    }
  });

test("given a port that names another commit or only mentions the subject, when the forward port is checked, then it is refused",
  () => {
    // given
    const repository = releasedLine();
    const { git, commit } = repository;
    try {
      git("switch", "--quiet", "main");
      commit(`fix: correct the opening hours sentence\n\n(cherry picked from commit ${"0".repeat(40)})`, "hours.txt");
      commit("fix: correct the opening hours sentence", "hours.txt", "again");

      // when
      const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "release/0.1", mainRef: "main",
      releasable });

      // then
      assert.equal(verdict.accepted, false, "the trailer has to name the release branch's own commit");
    } finally {
      repository.remove();
    }
  });

test("given a dependency update picked from main to the release branch, when the forward port is checked, then it needs no port back",
  () => {
    // given
    const repository = releasedLine();
    const { git, commit } = repository;
    try {
      git("switch", "--quiet", "main");
      const update = commit("build(deps): bump the image base", "Dockerfile");
      git("cherry-pick", "-x", repository.fix);
      git("switch", "--quiet", "release/0.1");
      git("cherry-pick", "-x", update);

      // when
      const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "release/0.1", mainRef: "main",
      releasable });

      // then
      assert.equal(verdict.accepted, true, "a commit that came from main is already there");
    } finally {
      repository.remove();
    }
  });

test("given a cherry-pick trailer naming a commit main does not have, when the forward port is checked, then it still needs a port",
  () => {
    // given
    const repository = releasedLine();
    const { git, commit } = repository;
    try {
      commit(`fix: correct the closing hours sentence\n\n(cherry picked from commit ${"0".repeat(40)})`, "close.txt");
      git("switch", "--quiet", "main");
      git("cherry-pick", "-x", repository.fix);

      // when
      const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "release/0.1", mainRef: "main",
      releasable });

      // then
      assert.equal(verdict.accepted, false, "only a trailer naming a commit on main exempts a release-branch fix");
      assert.match(verdict.missing.join("\n"), /fix: correct the closing hours sentence/);
    } finally {
      repository.remove();
    }
  });

test("given a release pull request head beyond the branch, when the forward port is checked, then its own commits are counted",
  () => {
    // given
    const repository = releasedLine();
    const { git, commit, manifest } = repository;
    try {
      git("switch", "--quiet", "main");
      git("cherry-pick", "-x", repository.fix);
      git("switch", "--quiet", "--create", "release-please--branches--release/0.1", "release/0.1");
      manifest("0.1.1");
      commit("chore(release/0.1): release 0.1.1", "CHANGELOG.md");
      const breaking = commit("refactor!: rename the opening hours variable", "env.txt");

      // when
      const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "HEAD", mainRef: "main", releasable });

      // then
      assert.deepEqual(verdict.missing, [`${breaking} refactor!: rename the opening hours variable`],
        "a breaking change is released whatever its type, and the release commit itself is not");
    } finally {
      repository.remove();
    }
  });

test("given a release pull request on either branch, when its verdicts are collected, then main gets the line check only",
  () => {
    // given
    const repository = releasedLine();
    const { git, commit, manifest } = repository;
    try {
      git("switch", "--quiet", "--create", "release-please--branches--release/0.1", "release/0.1");
      manifest("0.1.1");
      commit("chore(release/0.1): release 0.1.1", "CHANGELOG.md");

      // when
      const onRelease = pullRequestVerdicts({ git, base: "release/0.1", headRef: "HEAD", refOf, releasable });
      const onMain = pullRequestVerdicts({ git, base: "main", headRef: "HEAD", refOf, releasable });
      git("switch", "--quiet", "--create", "release-please--branches--main", "main");
      manifest("0.2.0-rc.1");
      commit("chore(main): release 0.2.0-rc.1", "CHANGELOG.md");
      const candidate = pullRequestVerdicts({ git, base: "main", headRef: "HEAD", refOf, releasable });
      git("switch", "--quiet", "--create", "feat/plan", "main");
      commit("feat: colour the plan", "colour.txt");
      const ordinary = pullRequestVerdicts({ git, base: "main", headRef: "HEAD", refOf, releasable });

      // then
      assert.deepEqual(onRelease.map(({ check, accepted }) => [check, accepted]),
        [["line", true], ["forward-port", false]], "the patch is on its line, but the fix is not on main yet");
      assert.deepEqual(onMain.map(({ check, accepted }) => [check, accepted]), [["line", false]],
        "0.1.1 proposed into main is refused before anything else is asked");
      assert.deepEqual(candidate.map(({ check, accepted }) => [check, accepted]), [["line", true]],
        "main's own candidates owe no forward port");
      assert.deepEqual(ordinary, [{ check: "release", accepted: true,
        detail: "the manifest does not change, so this is not a release pull request" }]);
    } finally {
      repository.remove();
    }
  });

test("given a tag, when it is admitted, then it must sit on the branch its version belongs to and name the recorded version",
  () => {
    // given
    const repository = releasedLine();
    const { git, commit, manifest } = repository;
    try {
      manifest("0.1.1");
      const patch = commit("chore(release/0.1): release 0.1.1", "CHANGELOG.md");
      git("switch", "--quiet", "main");
      const onMain = git("rev-parse", "HEAD");
      const admit = (tag, sha) => tagAdmission({ git, tag, commit: sha, refOf })
        .map(({ check, accepted }) => [check, accepted]);

      // when / then
      assert.deepEqual(admit("v0.1.1", patch), [["line", true], ["branch", true], ["manifest", true]],
        "a patch tag on its release branch is admitted");
      assert.deepEqual(admit("v0.1.1", onMain), [["line", true], ["branch", false], ["manifest", false]],
        "a patch tag on main sits outside its line");
      assert.deepEqual(admit("v0.2.0-rc.1", patch), [["line", true], ["branch", false], ["manifest", false]],
        "a candidate tag on the release branch sits outside main");
      assert.deepEqual(admit("v0.1.0", onMain), [["line", true], ["branch", true], ["manifest", true]],
        "v0.1.0 sits on main, where it was cut");
      assert.deepEqual(admit("v0.1.1+build.1", patch), [["line", false]],
        "a tag that names no release version is refused before anything is fetched");
    } finally {
      repository.remove();
    }
  });

test("given a branch name, when its remote ref is named, then a tag or a local branch of the same name cannot shadow it", () => {
  // when / then
  assert.equal(remoteRefOf("release/0.1"), "refs/remotes/origin/release/0.1",
    "git resolves origin/release/0.1 to refs/tags/origin/release/0.1 first when such a tag exists");
  assert.throws(() => remoteRefOf("release/0.1/../main"), /not a release target/);
});

test("given a branch named like the release tag, when the forward port is checked, then the tag still bounds the range", () => {
  // given
  const repository = releasedLine();
  const { git } = repository;
  try {
    git("branch", "v0.1.0", "release/0.1");

    // when
    const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "release/0.1", mainRef: "main",
      releasable });

    // then
    assert.equal(verdict.accepted, false, "a branch v0.1.0 at the head would otherwise hide every unported fix");
  } finally {
    repository.remove();
  }
});

test("given a commit whose body release-please splits into a fix, when the forward port is checked, then the fix needs a port",
  () => {
    // given
    const repository = releasedLine();
    const { git, commit } = repository;
    try {
      git("switch", "--quiet", "main");
      git("cherry-pick", "-x", repository.fix);
      git("switch", "--quiet", "release/0.1");
      const nested = commit("ci: tidy the workflow\n\nfix: correct the closing hours sentence", "close.txt");
      const bulleted = commit("ci: tidy the workflow again\n\n* fix: an earlier commit of this branch", "tidy.txt");

      // when
      const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "release/0.1", mainRef: "main",
        releasable });

      // then
      assert.deepEqual(verdict.missing, [`${nested} ci: tidy the workflow`],
        "release-please 17.6 lists a paragraph starting with fix: as its own entry, a bulleted squash line it does not");
      assert.ok(!verdict.missing.some((entry) => entry.startsWith(bulleted)));
    } finally {
      repository.remove();
    }
  });
