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

test("given a Java project, when a release is cut, then every version moves in the release pull request",
  () => {
    // when / then — what the frontend shows comes from the pom by way of build-info.properties,
    // so a version living anywhere else could disagree with what a club reads in the footer. npm
    // records the root package version twice in its lockfile; leaving either one behind makes a
    // release contain two answers even though npm ci accepts the stale metadata.
    assert.equal(config["release-type"], "maven");
    assert.equal(config["skip-snapshot"], true,
      "a snapshot pull request writes 0.1.0-rc.N-SNAPSHOT into the extra files and the release that"
      + " follows cannot take it back: GenericJson replaces only what its version pattern matches,"
      + " and that pattern ends at the hyphen before SNAPSHOT, so writing 0.1.0-rc.N over"
      + " 0.1.0-rc.N-SNAPSHOT changes nothing and the file drops out of the release pull request");
    assert.deepEqual(packageEntry["extra-files"], [
      { type: "json", path: "frontend/package.json", jsonpath: "$.version" },
      { type: "json", path: "frontend/package-lock.json", jsonpath: "$.version" },
      { type: "json", path: "frontend/package-lock.json", jsonpath: "$.packages[''].version" }
    ]);
  });

test("given frontend package metadata, when a release is proposed, then every root version is owned",
  () => {
    // given
    const packageJson = JSON.parse(read("frontend/package.json"));
    const lock = JSON.parse(read("frontend/package-lock.json"));

    // when / then
    const pomVersion = /<artifactId>courtside<\/artifactId>\s*<version>([^<]+)<\/version>/.exec(read("pom.xml"))?.[1];
    assert.deepEqual([packageJson.version, lock.version, lock.packages[""].version],
      [pomVersion, pomVersion, pomVersion],
      "the pom, package.json and npm's two root lockfile versions must describe the same release");
    assert.equal(manifest["."], pomVersion,
      "with no snapshot transition the release pull request is the only thing that writes either,"
      + " so between releases the manifest and the files name the same released version — a file"
      + " left ahead of the manifest is one the next release pull request will not move");
    assert.deepEqual(new Set(packageEntry["extra-files"]
      .filter((entry) => entry.path === "frontend/package-lock.json")
      .map((entry) => entry.jsonpath)), new Set(["$.version", "$.packages[''].version"]),
    "release-please must update both root package versions; npm ci does not reject stale values");
  });

test("given the first public release line, when its changelog is read, then candidates do not split or invent upgrade history",
  () => {
    // given
    const changelog = read("CHANGELOG.md");
    const releaseLineHeadings = [...changelog.matchAll(/^##\s+(?:\[)?0\.1\.0(?:-[^\]\s(]+)?(?:\])?/gm)];
    const initialSection = changelog.slice(releaseLineHeadings[0]?.index ?? 0,
      changelog.indexOf("\n## ", (releaseLineHeadings[0]?.index ?? 0) + 1) < 0
        ? undefined : changelog.indexOf("\n## ", (releaseLineHeadings[0]?.index ?? 0) + 1));

    // when / then
    assert.equal(releaseLineHeadings.length, 1,
      "release candidates belong to one cumulative 0.1.0 history instead of becoming history boundaries");
    assert.match(releaseLineHeadings[0][0], /^## 0\.1\.0(?:\s|$)/,
      "the cumulative history is named after the release line, not one candidate checkpoint");
    assert.doesNotMatch(initialSection, /^### .*BREAKING CHANGES/m,
      "the first public release has no older published contract that its development history can break");
    assert.match(initialSection, /^### Notable changes$/m,
      "first-release migration and operating details remain visible without claiming an upgrade break");
    assert.match(initialSection, /COURTSIDE_MAIL_TRUST_RELAY_CERTIFICATE=true/);
    assert.match(initialSection, /load a renewed mail certificate.*#779/);
    assert.match(initialSection, /COURTSIDE_MAIL_HOSTNAME/);
    assert.match(initialSection, /have the instance issue and send every credential.*#454/);
    assert.match(initialSection, /validation codes in fieldErrors entries change/);
  });

// Measured against release-please 17: without this, `0.2.0` plus one breaking change becomes
// `1.0.0` rather than `0.3.0`, and 1.0 would be declared by a footer instead of by a decision.
test("given a version below one, when a change is breaking, then it raises the minor", () => {
  // when / then
  assert.equal(config["bump-minor-pre-major"], true);
});

// The guard above governs every release except the one that matters most here. Read in the bundle
// the pinned action ships: with no release to bump from, `buildReleasePullRequest` never asks the
// versioning strategy at all — it returns `initialReleaseVersion()`, which is `1.0.0` unless this
// key says otherwise. The manifest, the breaking changes and the strategy are all bypassed.
test("given no release to bump from, when the first candidate is proposed, then this names it", () => {
  // when / then
  assert.equal(config["initial-version"], "0.1.0-rc.1",
    "the first release pull request proposed 1.0.0 without this, and neither bump-minor-pre-major"
    + " nor the 0.0.0 in the manifest had any say in it; the first production tag must rehearse"
    + " the complete release pipeline as rc.1 before this repository publishes 0.1.0");
});

test("given a candidate is wanted, when the strategy is read, then it can be turned on and graduated",
  () => {
    // when / then
    assert.equal(config.versioning, "prerelease");
    assert.equal(packageEntry["prerelease-type"], "rc");
    assert.equal(config.prerelease, true,
      "the first release is currently a candidate; after rc.1 proves the release path, graduating"
      + " it requires a reviewed change that turns this off and strips the suffix");
  });

test("given release-please writes a candidate delta, when it updates the release PR, then the changelog is normalized before review",
  () => {
    // given
    const steps = workflow.jobs["release-please"].steps;
    const job = workflow.jobs["release-please"];
    const release = steps.find((step) => step.id === "release");
    const validate = steps.find((step) => step.name === "Validate the release pull request branch");
    const trustedCheckout = steps.find((step) => step.name === "Check out the trusted normalizer");
    const checkout = steps.find((step) => step.name === "Check out the release pull request");
    const normalize = steps.find((step) => step.name === "Preserve the cumulative release-line changelog");
    const commit = steps.find((step) => step.name === "Commit the normalized changelog");

    // when / then
    assert.ok(release, "the release step needs an id so later steps consume its exact PR output");
    assert.equal(job.env, undefined,
      "the release PAT must not be inherited by repository code that a later checkout can replace");
    assert.match(job.steps[0].env.RELEASE_PLEASE_TOKEN, /secrets\.RELEASE_PLEASE_TOKEN/);
    assert.ok(steps.indexOf(validate) < steps.indexOf(checkout),
      "the action's branch output must be validated before checkout consumes it");
    assert.match(validate.run, /git check-ref-format --branch "\$RELEASE_PR_BRANCH"/);
    assert.equal(trustedCheckout.with.ref, "${{ github.sha }}");
    assert.equal(trustedCheckout.with.path, "trusted-source");
    assert.equal(trustedCheckout.with["persist-credentials"], false);
    assert.equal(checkout.if, "steps.release.outputs.prs_created == 'true'");
    assert.match(checkout.with.ref, /fromJSON\(steps\.release\.outputs\.pr\)\.headBranchName/);
    assert.equal(checkout.with.path, "release-pr");
    assert.equal(checkout.with["persist-credentials"], false);
    assert.match(normalize.run,
      /node trusted-source\/tools\/prerelease-changelog\.mjs --changelog release-pr\/CHANGELOG\.md/);
    assert.match(commit.env.RELEASE_PR_BRANCH,
      /fromJSON\(steps\.release\.outputs\.pr\)\.headBranchName/);
    assert.equal(commit["working-directory"], "release-pr");
    assert.match(commit.run, /credential\.helper/);
    assert.match(commit.run, /trap .*--unset-all credential\.helper/);
    assert.match(commit.run, /git push origin "HEAD:refs\/heads\/\$RELEASE_PR_BRANCH"/);
  });

test("given a repository that never released, when it bootstraps, then it starts at its first commit",
  () => {
    // given
    assert.equal(git("rev-parse", "--is-shallow-repository"), "false",
      "this test reads the history the configuration claims to cover, so a shallow checkout would"
      + " compare against whatever commit the clone happens to start at and pass on the wrong one");
    const first = git("rev-list", "--max-parents=0", "HEAD").split("\n").at(-1);

    // when / then — the value is release-please's from the first release onwards, and the release
    // pull request is where it changes, so only the shape of this file is ours to hold.
    assert.deepEqual(Object.keys(manifest), ["."],
      "one package, and it is the repository root — a component key would prefix every tag it"
      + " writes and the release workflow answers `v*`");
    assert.match(manifest["."], /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    // `initial-version` is consulted only while this file still reads 0.0.0: release-please treats
    // any other value as a release to bump from, and the first version would come from there again.
    if (manifest["."] !== "0.0.0") {
      const headings = read("CHANGELOG.md").split("\n").filter((line) => /^#{1,3}\s/.test(line));
      const releaseLine = manifest["."].split("-")[0];
      assert.ok(headings.some((heading) => heading.includes(releaseLine)),
        "a manifest naming a release line the changelog does not is a version nobody released");
    }
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
