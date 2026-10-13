import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { parse } = require("yaml");

const github = join(dirname(fileURLToPath(import.meta.url)), "..", ".github");
const workflows = join(github, "workflows");
const actions = join(github, "actions");

function definitionsIn(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => join(directory, name));
}

function compositeActionDefinitions() {
  if (!existsSync(actions)) {
    return [];
  }
  return readdirSync(actions)
    .map((name) => join(actions, name))
    .filter((path) => statSync(path).isDirectory())
    .flatMap(definitionsIn);
}

function referencesIn(path) {
  return [...readFileSync(path, "utf8").matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)]
    .map((match) => match[1].replace(/^["']|["']$/g, ""));
}

// A tag is a name its owner can move, so a definition naming one runs whatever that name points at
// on the morning somebody moves it — including a fork of the action nobody here reviewed.
function isPinned(reference) {
  return reference.startsWith("./")
    || /@[0-9a-f]{40}$/.test(reference)
    || /^docker:\/\/\S+@sha256:[0-9a-f]{64}$/.test(reference);
}

test("given every workflow and composite action, when it names an action, then that action is pinned", () => {
  // given
  const definitions = [...definitionsIn(workflows), ...compositeActionDefinitions()];

  // when / then
  assert.deepEqual(definitions.flatMap((path) => referencesIn(path)
    .filter((reference) => !isPinned(reference))
    .map((reference) => `${relative(github, path)} names ${reference}`)), []);
});

// The count of references proves that something was read; release.yml alone carries enough of them
// to hide every other workflow going unscanned. Reading each file is what this asserts instead.
test("given a workflow that names no action at all, when the scan reports it, then the scan is not trusted", () => {
  // when / then
  assert.deepEqual(definitionsIn(workflows)
    .filter((path) => referencesIn(path).length === 0)
    .map((path) => relative(github, path)), []);
});

test("given every workflow checkout, when repository code runs, then the GitHub token is not persisted", () => {
  // given
  const definitions = definitionsIn(workflows);

  // when
  const unsafeCheckouts = definitions.flatMap((path) => {
    const workflow = parse(readFileSync(path, "utf8"));
    return Object.entries(workflow.jobs ?? {}).flatMap(([jobName, job]) => (job.steps ?? [])
      .filter((step) => typeof step.uses === "string" && step.uses.startsWith("actions/checkout@"))
      .filter((step) => step.with?.["persist-credentials"] !== false)
      .map(() => `${relative(github, path)}:${jobName}`));
  });

  // then
  assert.deepEqual(unsafeCheckouts, []);
});
