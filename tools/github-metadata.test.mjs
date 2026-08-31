import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { parse } = require("yaml");

export function validateDependabot(candidate) {
  assert.deepEqual(Object.keys(candidate).sort(), ["updates", "version"]);
  assert.equal(candidate.version, 2);
  assert.ok(Array.isArray(candidate.updates));
  const locations = candidate.updates.map((update) => {
    assert.deepEqual(Object.keys(update).sort(), Object.keys(update).filter((key) =>
      ["directory", "groups", "ignore", "open-pull-requests-limit", "package-ecosystem", "schedule"].includes(key)).sort());
    assert.equal(typeof update["package-ecosystem"], "string");
    assert.equal(typeof update.directory, "string");
    assert.deepEqual(update.schedule, { interval: "weekly" });
    if (update["open-pull-requests-limit"] !== undefined) {
      assert.ok(Number.isInteger(update["open-pull-requests-limit"]));
      assert.ok(update["open-pull-requests-limit"] >= 1 && update["open-pull-requests-limit"] <= 100);
    }
    if (update.groups !== undefined) {
      assert.equal(typeof update.groups, "object");
      assert.ok(update.groups !== null && !Array.isArray(update.groups) && Object.keys(update.groups).length > 0);
      for (const [name, group] of Object.entries(update.groups)) {
        assert.match(name, /^[a-z0-9-]+$/);
        assert.deepEqual(Object.keys(group), ["patterns"]);
        assert.ok(Array.isArray(group.patterns) && group.patterns.length > 0);
        assert.ok(group.patterns.every((pattern) => typeof pattern === "string" && pattern.length > 0));
      }
    }
    if (update.ignore !== undefined) {
      assert.ok(Array.isArray(update.ignore) && update.ignore.length > 0);
      for (const ignored of update.ignore) {
        assert.deepEqual(Object.keys(ignored).sort(), ["dependency-name", "update-types"]);
        assert.equal(typeof ignored["dependency-name"], "string");
        assert.ok(ignored["dependency-name"].length > 0);
        assert.ok(Array.isArray(ignored["update-types"]) && ignored["update-types"].length > 0);
        assert.ok(ignored["update-types"].every((type) =>
          ["version-update:semver-major", "version-update:semver-minor", "version-update:semver-patch"].includes(type)));
      }
    }
    return `${update["package-ecosystem"]}:${update.directory}`;
  });
  assert.deepEqual(locations.sort(), ["docker-compose:/deploy", "docker:/", "github-actions:/", "maven:/", "npm:/frontend"]);
}

export function validatePullRequestTitleWorkflow(candidate) {
  assert.deepEqual(Object.keys(candidate).sort(), ["jobs", "name", "on", "permissions"]);
  assert.deepEqual(candidate.on, { pull_request_target: { types: ["opened", "edited", "reopened", "synchronize"] } });
  assert.deepEqual(candidate.permissions, { "pull-requests": "read" });
  assert.deepEqual(Object.keys(candidate.jobs), ["title"]);
  const title = candidate.jobs.title;
  assert.deepEqual(Object.keys(title).sort(), ["name", "runs-on", "steps"]);
  assert.equal(title["runs-on"], "ubuntu-latest");
  assert.equal(title.steps.length, 1);
  assert.match(title.steps[0].uses, /^amannn\/action-semantic-pull-request@[a-f0-9]{40}$/);
  assert.deepEqual(Object.keys(title.steps[0]).sort(), ["env", "uses"]);
  assert.deepEqual(title.steps[0].env, { GITHUB_TOKEN: "${{ secrets.GITHUB_TOKEN }}" });
}

test("given Dependabot metadata, when validating it, then every supported ecosystem and weekly schedule is explicit", () => {
  // given
  const candidate = parse(readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8"));

  // when / then
  validateDependabot(candidate);
});

test("given Dependabot metadata loses an ecosystem or gains an unknown root field, when validating, then it fails closed", () => {
  // given
  const source = parse(readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8"));
  const missing = structuredClone(source);
  missing.updates.pop();
  const open = { ...structuredClone(source), command: "ignored" };

  // when / then
  assert.throws(() => validateDependabot(missing));
  assert.throws(() => validateDependabot(open));
});

test("given Dependabot nested fields are malformed, when validating, then each fails closed", () => {
  // given
  const source = parse(readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8"));
  const cases = [];
  for (const [field, value] of [["open-pull-requests-limit", "five"], ["groups", "bad"], ["ignore", "bad"]]) {
    const candidate = structuredClone(source);
    candidate.updates[0][field] = value;
    cases.push(candidate);
  }
  const emptyPatterns = structuredClone(source);
  emptyPatterns.updates[0].groups.spring.patterns = [];
  cases.push(emptyPatterns);
  const unknownGroupField = structuredClone(source);
  unknownGroupField.updates[0].groups.spring.command = "ignored";
  cases.push(unknownGroupField);
  const invalidUpdateType = structuredClone(source);
  invalidUpdateType.updates.at(-1).ignore[0]["update-types"] = ["all"];
  cases.push(invalidUpdateType);

  // when / then
  for (const candidate of cases) assert.throws(() => validateDependabot(candidate));
});

test("given the PR title workflow, when validating it, then its event permissions and pinned action are closed", () => {
  // given
  const candidate = parse(readFileSync(new URL("../.github/workflows/pr-title-lint.yml", import.meta.url), "utf8"));

  // when / then
  validatePullRequestTitleWorkflow(candidate);
});

test("given the PR title workflow gains code execution or a floating action, when validating, then it fails closed", () => {
  // given
  const source = parse(readFileSync(new URL("../.github/workflows/pr-title-lint.yml", import.meta.url), "utf8"));
  const executable = structuredClone(source);
  executable.jobs.title.steps.push({ run: "echo unsafe" });
  const floating = structuredClone(source);
  floating.jobs.title.steps[0].uses = "amannn/action-semantic-pull-request@v6";

  // when / then
  assert.throws(() => validatePullRequestTitleWorkflow(executable));
  assert.throws(() => validatePullRequestTitleWorkflow(floating));
});
