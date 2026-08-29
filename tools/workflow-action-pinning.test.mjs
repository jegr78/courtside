import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const workflows = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows");

// A tag is a name its owner can move, so a workflow naming one runs whatever that name points at on
// the morning somebody moves it — including a fork of the action nobody here reviewed.
test("given every workflow, when it names an action, then the action is pinned to a commit", () => {
  // given
  const references = readdirSync(workflows).filter((name) => name.endsWith(".yml"))
    .flatMap((name) => [...readFileSync(join(workflows, name), "utf8")
      .matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)]
      .map((match) => `${name} names ${match[1]}`));

  // when / then
  assert.ok(references.length > 20, "the workflows name almost no action, so this proves nothing");
  assert.deepEqual(references.filter((reference) => !/@[0-9a-f]{40}$/.test(reference)), []);
});
