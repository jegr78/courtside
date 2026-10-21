import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");
const workflows = new URL("../.github/workflows/", import.meta.url);

function mavenCacheUsers() {
  return readdirSync(workflows).filter((file) => file.endsWith(".yml")).flatMap((file) => {
    const workflow = yaml.load(readFileSync(new URL(file, workflows), "utf8"));
    return Object.entries(workflow.jobs ?? {}).flatMap(([job, definition]) => (definition.steps ?? [])
      .map((step, index) => ({ file, job, definition, index, step }))
      .filter(({ step }) => step.uses?.startsWith("actions/setup-java@") && step.with?.cache === "maven"));
  });
}

test("given every job that restores the Maven cache, when the jobs run, then all share one key and one job saves each kind of commit", () => {
  // given
  const users = mavenCacheUsers();

  // when
  const keys = new Set(users.map(({ step }) => step.with["cache-dependency-path"]));
  const writers = users.filter(({ step }) => String(step.with["cache-read-only"]) !== "true");

  // then
  assert.ok(users.length > 1, "the workflows restore the Maven cache");
  assert.deepEqual([...keys], ["pom.xml\n.mvn/maven.config\n.mvn/wrapper/maven-wrapper.properties\n"],
    "every job keys the cache on the pom and the Maven wrapper with its configuration");
  assert.deepEqual(writers.map(({ file, job, step }) => `${file} ${job} ${step.with["cache-read-only"]}`), [
    "build.yml backend ${{ strategy.job-index != 0 }}",
    "release-candidate.yml release-build ${{ needs.select.outputs.branch == 'main' }}"
  ], "the full backend shard saves a main commit's cache and the release build a release branch commit's, whose pom "
    + "no main build keys");
});

const pluginResolution = "./.github/actions/maven-plugins";

// `a != b` for `a == b` and back, so a writer's save condition reads from its read-only flag.
function negated(expression) {
  return expression.replace(/ (!=|==) /, (_, operator) => operator === "!=" ? " == " : " != ");
}

test("given each job that saves the Maven cache, when it misses, then it resolves every plugin before its first build",
  () => {
    // given
    const writers = mavenCacheUsers().filter(({ step }) => String(step.with["cache-read-only"]) !== "true");

    for (const { file, job, definition, index, step } of writers) {
      // when
      const steps = definition.steps;
      const resolution = steps.findIndex((candidate) => candidate.uses === pluginResolution);
      const build = steps.findIndex((candidate) => /\.\/mvnw/.test(candidate.run ?? ""));
      const saving = negated(step.with["cache-read-only"].replace(/^\$\{\{ (.+?) \}\}$/, "$1"));

      // then
      assert.ok(resolution > index && resolution < build,
        `${file} ${job} resolves the plugins after the cache is restored and before Maven first builds`);
      assert.equal(steps[resolution].if, `${saving} && steps.${step.id}.outputs.cache-hit != 'true'`,
        `${file} ${job} resolves exactly when it saves a missed key`);
    }
  });

test("given the plugin resolution, when it runs, then it resolves the plugins of every profile Maven lists", () => {
  // given
  const action = yaml.load(readFileSync(new URL("../.github/actions/maven-plugins/action.yml", import.meta.url), "utf8"));

  // when
  const [resolve] = action.runs.steps;

  // then
  assert.match(resolve.run, /help:all-profiles/, "the profiles come from Maven, not from a list in the workflow");
  assert.doesNotMatch(resolve.run, /-q\b[^\n]*help:all-profiles/, "a quiet Maven prints no profile");
  assert.match(resolve.run, /test -n "\$profiles"/, "an empty profile list fails instead of caching less");
  assert.match(resolve.run, /dependency:resolve-plugins\n/, "the default build has its plugins resolved");
  assert.match(resolve.run, /dependency:resolve-plugins[\s\S]*-P"\$profile"/, "each listed profile has its plugins resolved");
});
