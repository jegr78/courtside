import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const { parser } = require("@conventional-commits/parser");

const repository = fileURLToPath(new URL("../", import.meta.url));
const git = (...arguments_) =>
  execFileSync("git", arguments_, { cwd: repository, encoding: "utf8" }).trim();

function branchCommits() {
  const base = git("rev-parse", "--verify", "origin/main");
  return git("rev-list", "--no-merges", `${base}..HEAD`).split("\n").filter(Boolean);
}

// release-please reads every commit message on main through this parser and silently drops the ones
// it cannot read — two are missing from this repository's first changelog, and the only trace was a
// line in a workflow log. Running the same parser here is what turns that into a red build instead.
test("given the commits this branch adds, when release-please parses them, then each one is readable",
  () => {
    // given
    const unreadable = branchCommits().flatMap((sha) => {
      try {
        parser(git("log", "-1", "--format=%B", sha));
        return [];
      } catch (rejected) {
        return [`${sha.slice(0, 8)} ${git("log", "-1", "--format=%s", sha)}: ${rejected.message}`];
      }
    });

    // when / then
    assert.deepEqual(unreadable, [],
      "a commit the parser rejects never reaches the changelog; quoting code with an unclosed"
      + " bracket is what did it the two times it happened here");
  });

// A merge commit is skipped above because it carries no conventional type and nothing of it would
// reach the changelog anyway; squash is the only merge method this repository allows.
test("given the base this comparison needs, when it is resolved, then it is not guessed", () => {
  // when / then
  assert.doesNotThrow(() => git("rev-parse", "--verify", "origin/main"),
    "without origin/main this test would silently check nothing, which is how a guard is lost");
});
