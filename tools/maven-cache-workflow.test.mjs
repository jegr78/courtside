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

test("given every job that restores the Maven cache, when the jobs run, then all share one key and only the full backend shard saves it", () => {
  // given
  const users = mavenCacheUsers();

  // when
  const keys = new Set(users.map(({ step }) => step.with["cache-dependency-path"]));
  const writers = users.filter(({ step }) => String(step.with["cache-read-only"]) !== "true");

  // then
  assert.ok(users.length > 1, "the workflows restore the Maven cache");
  assert.deepEqual([...keys], ["pom.xml\n.mvn/maven.config\n.mvn/wrapper/maven-wrapper.properties\n"],
    "every job keys the cache on the pom and the Maven wrapper with its configuration");
  assert.deepEqual(writers.map(({ file, job, step }) => `${file} ${job} ${step.with["cache-read-only"]}`),
    ["build.yml backend ${{ strategy.job-index != 0 }}"],
    "only the backend shard that runs every test and integration test saves the cache");
});

test("given the job that saves the Maven cache, when it builds, then it first resolves the plugins of every profile Maven lists", () => {
  // given
  const [writer] = mavenCacheUsers().filter(({ step }) => String(step.with["cache-read-only"]) !== "true");
  const steps = writer.definition.steps;

  // when
  const resolution = steps.findIndex((step) => /dependency:resolve-plugins/.test(step.run ?? ""));
  const build = steps.findIndex((step) => step.name === "Verify backend");

  // then
  assert.ok(resolution > writer.index && resolution < build,
    "the plugins are resolved after the cache is restored and before the build can fail");
  assert.match(steps[resolution].run, /help:all-profiles/, "the profiles come from Maven, not from a list in the workflow");
  assert.doesNotMatch(steps[resolution].run, /-q\b[^\n]*help:all-profiles/, "a quiet Maven prints no profile");
  assert.match(steps[resolution].run, /test -n "\$profiles"/, "an empty profile list fails instead of caching less");
  assert.match(steps[resolution].run, /dependency:resolve-plugins[\s\S]*-P"\$profile"/,
    "each listed profile has its plugins resolved");
});
