import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyPath } from "./test-profile-classifier.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const repository = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, repository), "utf8");
const config = JSON.parse(read("release-please-config.json"));
const manifest = JSON.parse(read(".release-please-manifest.json"));
const workflow = yaml.load(read(".github/workflows/release-please.yml"));
const packageEntry = config.packages["."];
const git = (...arguments_) =>
  execFileSync("git", arguments_, { cwd: fileURLToPath(repository) }).toString().trim();

test("given a Java project, when a release is cut, then the pom carries the version and a snapshot follows",
  () => {
    // when / then — what the frontend shows comes from the pom by way of build-info.properties,
    // so a version living anywhere else could disagree with what a club reads in the footer.
    assert.equal(config["release-type"], "maven");
    assert.deepEqual(packageEntry["extra-files"],
      [{ type: "json", path: "frontend/package.json", jsonpath: "$.version" }]);
  });

// Measured against release-please 17: without this, `0.2.0` plus one breaking change becomes
// `1.0.0` rather than `0.3.0`, and 1.0 would be declared by a footer instead of by a decision.
test("given a version below one, when a change is breaking, then it raises the minor", () => {
  // when / then
  assert.equal(config["bump-minor-pre-major"], true);
});

test("given a candidate is wanted, when the strategy is read, then it can be turned on and graduated",
  () => {
    // when / then
    assert.equal(config.versioning, "prerelease");
    assert.equal(packageEntry["prerelease-type"], "rc");
    assert.equal(config.prerelease, false,
      "releases are stable by default; a candidate line is opened by turning this on and closed"
      + " by turning it off, which strips the suffix");
  });

test("given a repository that never released, when it bootstraps, then it starts at its first commit",
  () => {
    // given
    assert.equal(git("rev-parse", "--is-shallow-repository"), "false",
      "this test reads the history the configuration claims to cover, so a shallow checkout would"
      + " compare against whatever commit the clone happens to start at and pass on the wrong one");
    const first = git("rev-list", "--max-parents=0", "HEAD").split("\n").at(-1);

    // when / then
    assert.deepEqual(manifest, { ".": "0.0.0" },
      "a manifest naming a version nobody can pull would claim a release that never happened");
    assert.equal(config["bootstrap-sha"], first,
      "the first changelog covers everything the repository has done, so it stops at the root commit");
    assert.equal(config["last-release-sha"], undefined,
      "that override keeps re-gathering from its commit; bootstrap-sha retires itself after the"
      + " first release, which is why it is the one used here");
  });

// Reaching back to the root commit is only a request: release-please reads at most this many
// commits and truncates the rest without saying so, which would drop the earliest work from the
// one changelog that is supposed to carry everything.
test("given the history the first changelog covers, when it is gathered, then the depth reaches past it",
  () => {
    // given
    const commits = Number(git("rev-list", "--count", "HEAD"));

    // when / then
    assert.ok(commits > 0);
    assert.ok(config["commit-search-depth"] > commits,
      `the configured depth ${config["commit-search-depth"]} no longer reaches the root commit`
      + ` ${commits} commits back — raise it before the next release is cut`);
  });

// The release pull request is the first thing to commit this file, and it is also the pull request
// that has to be green for a release to exist at all.
test("given the changelog release-please writes, when its file is classified, then it is not unknown",
  () => {
    // when / then
    assert.deepEqual(classifyPath("CHANGELOG.md"), { profiles: ["docs"], rule: "exact:CHANGELOG.md" },
      "an unclassified path fails the classifier's own coverage test, and the release pull request"
      + " is where that file first appears");
  });

test("given the changelog a club reads, when sections are assigned, then internal work stays out", () => {
  // given
  const sections = config["changelog-sections"];

  // when / then
  assert.deepEqual(sections.map((entry) => [entry.type, entry.hidden === true]), [
    ["feat", false], ["fix", false], ["perf", false], ["docs", false], ["build", false],
    ["test", true], ["ci", true], ["refactor", true], ["chore", true], ["style", true],
    ["revert", true]
  ], "the visible five change what a club runs or reads and the rest answer no question it asks");
  assert.deepEqual(sections.filter((entry) => entry.section === undefined), [],
    "release-please drops an entry that names no section, hidden or not");
  assert.deepEqual(new Set(git("log", "--format=%s").split("\n")
    .map((subject) => /^([a-z]+)(?:\(|!|:)/.exec(subject)?.[1])
    .filter((type) => type !== undefined)
    .filter((type) => !sections.some((entry) => entry.type === type))), new Set(),
  "a type this repository writes and this file does not place lands in the changelog unsorted");
});

test("given the token can publish under this project's name, when the workflow runs, then it is narrow",
  () => {
    // given
    const triggers = workflow.on ?? workflow[true];
    const [guard, release] = workflow.jobs["release-please"].steps;

    // when / then
    assert.deepEqual(triggers, { push: { branches: ["main"] } },
      "a pull_request trigger would put the token within reach of a fork's code");
    assert.deepEqual(workflow.permissions, {},
      "the action authenticates every call with the PAT, so the run's own token needs nothing —"
      + " and a job that grants itself nothing cannot lend anything to a step added later");
    assert.match(guard.if, /RELEASE_PLEASE_TOKEN == ''/,
      "a tag pushed with GITHUB_TOKEN starts no pipeline, so a release without the PAT is refused");
    assert.match(release.with.token, /secrets\.RELEASE_PLEASE_TOKEN/);
    assert.doesNotMatch(release.with.token, /github\.token/,
      "no fallback: the guard above refuses the run rather than cutting a release nothing builds");
  });

// release-please publishes the release the moment the release pull request is merged, which is
// before build, qualify, the signature and the security record exist. A draft is the only state
// that lets the tag start the pipeline without the release already claiming to be one.
test("given a release nothing has verified yet, when the tag is written, then the release is a draft",
  () => {
    // when / then
    assert.equal(config.draft, true,
      "a published release standing before publish would be indistinguishable from one that passed"
      + " every gate, and it would count as an upgrade origin naming an image nobody pushed");
    assert.equal(config["force-tag-creation"], true,
      "GitHub writes no git tag for a draft release, and without the tag the release workflow"
      + " never starts at all");
  });
