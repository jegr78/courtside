import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

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
