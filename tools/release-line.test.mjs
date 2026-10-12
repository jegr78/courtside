import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  forwardPortVerdict,
  main,
  lineVerdict,
  pullRequestVerdicts,
  releasableTypes,
  releaseBranchOf,
  releaseToolingPaths,
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
    assert.throws(() => releaseBranchOf("0.1.1-rc"), /no line releases a patch candidate/,
      "release-please's 0.1.1-rc from main belongs to no branch, so the tag and the line check refuse it alike");
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
      const admit = (tag, sha) => tagAdmission({ git, tag, commit: sha, refOf, published: ["v0.1.0"] })
        .map(({ check, accepted }) => [check, accepted]);

      // when / then
      assert.deepEqual(admit("v0.1.1", patch), [["line", true], ["branch", true], ["manifest", true], ["newest-line", true]],
        "a patch tag on its release branch is admitted");
      assert.deepEqual(admit("v0.1.1", onMain), [["line", true], ["branch", false], ["manifest", false], ["newest-line", true]],
        "a patch tag on main sits outside its line");
      assert.deepEqual(admit("v0.2.0-rc.1", patch), [["line", true], ["branch", false], ["manifest", false], ["newest-line", true]],
        "a candidate tag on the release branch sits outside main");
      assert.deepEqual(admit("v0.1.0", onMain), [["line", true], ["branch", true], ["manifest", true], ["newest-line", true]],
        "v0.1.0 sits on main, where it was cut");
      assert.deepEqual(admit("v0.1.1+build.1", patch), [["line", false]],
        "a tag that names no release version is refused before anything is fetched");
      assert.deepEqual(admit("v0.1.1-rc.1", onMain), [["line", false]],
        "a patch candidate is refused as a tag just as the line check refuses it in a pull request");
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

test("given a ref that shadows the release tag's short name, when the forward port is checked, then the tag still bounds the range",
  () => {
  // given
  const repository = releasedLine();
  const { git } = repository;
  try {
    git("update-ref", "refs/v0.1.0", "release/0.1");

    // when
    const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "release/0.1", mainRef: "main",
      releasable });

    // then
    assert.equal(verdict.accepted, false, "git resolves refs/v0.1.0 before refs/tags/v0.1.0 and would hide every unported fix");
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

test("given a head or tag argument that git could read as an option, when the tool starts, then it refuses before running git",
  () => {
    // given
    const calls = [];
    const git = (...arguments_) => {
      calls.push(arguments_);
      return "";
    };

    // when / then
    assert.throws(() => main(["pull-request", "--base", "main", "--head", "--output=/tmp/x"], git), /--head must name/);
    assert.throws(() => main(["pull-request", "--base", "main", "--head", "main;id"], git), /--head must name/);
    assert.throws(() => main(["admit-tag", "--tag", "v0.1.1", "--commit", "HEAD", "--published-tags", "[]"], git), /full 40-character sha/);
    assert.deepEqual(calls, [], "nothing reached git");
  });

test("given a dispatched admission, when the tag is admitted, then the branch its version belongs to is handed on", () => {
  // given
  const repository = releasedLine();
  const output = join(repository.root, "github-output");
  writeFileSync(output, "");
  const previous = process.cwd();
  try {
    process.chdir(repository.root);

    // when
    const accepted = main(["admit-tag", "--tag", "v0.1.1", "--commit", repository.fix, "--published-tags",
      '["v0.1.0-rc.12","v0.1.0"]', "--github-output", output], repository.git);

    // then
    assert.equal(accepted, false, "release/0.1 records 0.1.0, so the manifest refuses v0.1.1");
    assert.equal(readFileSync(output, "utf8"), "branch=release/0.1\nlatest=true\n",
      "the evidence lookup reads the patch's own branch, and a patch of the newest line moves latest");
  } finally {
    process.chdir(previous);
    repository.remove();
  }
});

test("given published releases, when a tag is admitted, then a patch of an older line is refused and latest names the newest",
  () => {
    // given
    const repository = releasedLine();
    const { git, commit, manifest } = repository;
    try {
      manifest("0.1.1");
      const patch = commit("chore(release/0.1): release 0.1.1", "CHANGELOG.md");
      const verdict = (tag, published) => tagAdmission({ git, tag, commit: patch, refOf, published }).at(-1);

      // when / then
      assert.deepEqual(verdict("v0.1.1", ["v0.1.0", "v0.2.0-rc.1"]), { check: "newest-line", accepted: true, latest: true,
        detail: "no line newer than 0.1 is published" }, "a candidate of the next line does not retire 0.1");
      assert.deepEqual(verdict("v0.1.1", ["v0.1.0", "v0.2.0"]), { check: "newest-line", accepted: false, latest: false,
        detail: "0.1.1 patches 0.1, but 0.2.0 is published and only the newest line is maintained" },
      "latest and the major tag would otherwise jump back to the older line");
      assert.equal(verdict("v0.2.0-rc.2", ["v0.1.0", "v0.2.0-rc.1"]).latest, false, "a candidate never becomes latest");
      assert.equal(verdict("v0.2.0", ["v0.1.0", "v0.1.1"]).latest, true);
      assert.equal(verdict("v0.2.0", ["v0.1.0", "v1.0.0"]).latest, false, "an older minor never takes latest from 1.0.0");
      assert.throws(() => tagAdmission({ git, tag: "v0.1.1", commit: patch, refOf, published: ["main"] }),
        /published tags must be release tags/);
    } finally {
      repository.remove();
    }
  });

test("given a release branch squash that mixes a picked update with its own fix, when the forward port is checked, then the fix "
  + "still needs a port", () => {
  // given
  const repository = releasedLine();
  const { git, commit } = repository;
  try {
    git("switch", "--quiet", "main");
    const update = commit("build(deps): bump the image base", "Dockerfile");
    git("cherry-pick", "-x", repository.fix);
    git("switch", "--quiet", "release/0.1");
    const mixed = commit(`build(deps): bump the image base (#1510)\n\n* build(deps): bump the image base\n\n`
      + `(cherry picked from commit ${update})\n\n* fix: correct the closing hours sentence`, "close.txt");
    const picked = commit(`build(deps): bump the image base again (#1511)\n\n* build(deps): bump the image base again\n\n`
      + `(cherry picked from commit ${update})\n\n* test: adjust the pinned digest`, "pin.txt");

    // when
    const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "release/0.1", mainRef: "main", releasable });

    // then
    assert.deepEqual(verdict.missing, [`${mixed} build(deps): bump the image base (#1510)`],
      "one trailer must not carry an unported fix through the check");
    assert.ok(!verdict.missing.some((entry) => entry.startsWith(picked)), "a hidden test entry beside the pick needs no port");
  } finally {
    repository.remove();
  }
});

test("given a release-branch commit that main already contains, when the forward port is checked, then it is not missing", () => {
  // given
  const repository = releasedLine();
  const { git } = repository;
  try {
    git("switch", "--quiet", "main");
    git("cherry-pick", "-x", repository.fix);
    git("merge", "--quiet", "--no-edit", "--strategy=ours", "release/0.1");

    // when
    const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "release/0.1", mainRef: "main", releasable });

    // then
    assert.equal(verdict.accepted, true, "a commit reachable from main is on main whatever its message says");
  } finally {
    repository.remove();
  }
});

test("given a trailer that is abbreviated or names a commit outside the range, when the forward port is checked, then it is refused",
  () => {
    // given
    const repository = releasedLine();
    const { git, commit } = repository;
    try {
      git("switch", "--quiet", "main");
      commit(`fix: correct the opening hours sentence\n\n(cherry picked from commit ${repository.fix.slice(0, 12)})`, "a.txt");
      commit(`fix: correct the opening hours sentence\n\n(cherry picked from commit ${git("rev-parse", "v0.1.0")})`, "b.txt");

      // when
      const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "release/0.1", mainRef: "main", releasable });

      // then
      assert.equal(verdict.accepted, false, "only a full trailer naming the release branch's own commit is a port");
    } finally {
      repository.remove();
    }
  });

test("given a base whose recorded version was never tagged, when the forward port is checked, then it is refused by name", () => {
  // given
  const repository = releasedLine();
  const { git } = repository;
  try {
    git("tag", "--delete", "v0.1.0");

    // when
    const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "release/0.1", mainRef: "main", releasable });

    // then
    assert.deepEqual(verdict, { check: "forward-port", accepted: false, missing: [],
      detail: "v0.1.0 is not tagged, so the changes since the last release cannot be read" });
  } finally {
    repository.remove();
  }
});

test("given release-please's nested commit markers, when the forward port is checked, then the nested fix needs a port", () => {
  // given
  const repository = releasedLine();
  const { git, commit } = repository;
  try {
    git("switch", "--quiet", "main");
    git("cherry-pick", "-x", repository.fix);
    git("switch", "--quiet", "release/0.1");
    const nested = commit("chore: tidy\n\nBEGIN_NESTED_COMMIT\nfix: correct the closing hours sentence\nEND_NESTED_COMMIT",
      "nested.txt");

    // when
    const verdict = forwardPortVerdict({ git, baseRef: "release/0.1", headRef: "release/0.1", mainRef: "main", releasable });

    // then
    assert.deepEqual(verdict.missing, [`${nested} chore: tidy`], "release-please 17.6 lists a nested commit as its own entry");
  } finally {
    repository.remove();
  }
});

test("given a pull request into a release branch that overrides its commit message, when it is checked, then it is refused", () => {
  // given
  const repository = releasedLine();
  const { git } = repository;
  try {
    git("switch", "--quiet", "--create", "fix/hours", "release/0.1");

    // when
    const verdicts = pullRequestVerdicts({ git, base: "release/0.1", headRef: "HEAD", refOf, releasable,
      body: "Fixes the hours.\n\nBEGIN_COMMIT_OVERRIDE\nchore: nothing\nEND_COMMIT_OVERRIDE" });
    const onMain = pullRequestVerdicts({ git, base: "main", headRef: "main", refOf, releasable,
      body: "BEGIN_COMMIT_OVERRIDE" });

    // then
    assert.deepEqual(verdicts.map(({ check, accepted }) => [check, accepted]), [["override", false], ["release", true]],
      "release-please would read the override from the pull request, which the forward-port check cannot see in git");
    assert.deepEqual(onMain.map(({ check }) => check), ["release"]);
  } finally {
    repository.remove();
  }
});

test("given the workflows a release runs, when their tooling is listed, then every tool they call is named once", () => {
  // when / then
  assert.deepEqual(releaseToolingPaths([
    "run: node tools/release-line.mjs admit-tag\n  node tools/nightly-release-evidence.mjs --find",
    "run: node trusted-source/tools/prerelease-changelog.mjs; node tools/release-line.mjs",
    "path: tools/README.md"
  ]), ["tools/nightly-release-evidence.mjs", "tools/release-line.mjs"]);
});
