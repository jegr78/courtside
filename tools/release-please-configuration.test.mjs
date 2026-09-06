import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

const repository = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, repository), "utf8");
const config = JSON.parse(read("release-please-config.json"));
const manifest = JSON.parse(read(".release-please-manifest.json"));
const workflow = yaml.load(read(".github/workflows/release-please.yml"));
const packageEntry = config.packages["."];

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
    const first = execFileSync("git",
      ["rev-list", "--max-parents=0", "HEAD"], { cwd: fileURLToPath(repository) })
      .toString().trim().split("\n").at(-1);

    // when / then
    assert.deepEqual(manifest, { ".": "0.0.0" },
      "a manifest naming a version nobody can pull would claim a release that never happened");
    assert.equal(config["bootstrap-sha"], first,
      "the first changelog covers everything the repository has done, so it stops at the root commit");
    assert.equal(config["last-release-sha"], undefined,
      "that override keeps re-gathering from its commit; bootstrap-sha retires itself after the"
      + " first release, which is why it is the one used here");
  });

test("given the changelog a club reads, when sections are assigned, then internal work stays out", () => {
  // given
  const sections = Object.fromEntries(config["changelog-sections"]
    .map((entry) => [entry.type, entry.hidden === true]));

  // when / then
  for (const type of ["feat", "fix", "perf", "docs", "build"]) {
    assert.equal(sections[type], false, `${type} changes what a club runs or reads`);
  }
  for (const type of ["test", "ci", "refactor", "chore", "style"]) {
    assert.equal(sections[type], true, `${type} answers no question a club asks`);
  }
});

test("given the token can publish under this project's name, when the workflow runs, then it is narrow",
  () => {
    // given
    const triggers = workflow.on ?? workflow[true];
    const [guard, release] = workflow.jobs["release-please"].steps;

    // when / then
    assert.deepEqual(triggers, { push: { branches: ["main"] } },
      "a pull_request trigger would put the token within reach of a fork's code");
    assert.equal(workflow.permissions.actions, undefined);
    assert.deepEqual(Object.keys(workflow.permissions).sort(),
      ["contents", "issues", "pull-requests"]);
    assert.match(guard.if, /RELEASE_PLEASE_TOKEN == ''/,
      "a tag pushed with GITHUB_TOKEN starts no pipeline, so a release without the PAT is refused");
    assert.match(release.with.token, /secrets\.RELEASE_PLEASE_TOKEN/);
    assert.doesNotMatch(release.with.token, /github\.token/,
      "no fallback: the guard above refuses the run rather than cutting a release nothing builds");
  });
