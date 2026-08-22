import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repository = fileURLToPath(new URL("..", import.meta.url));

function git(...args) {
  return execFileSync("git", args, { cwd: repository, encoding: "utf8" });
}

function trackedSymlinks() {
  return git("ls-files", "-s").split("\n").filter(Boolean)
    .map((line) => /^(?<mode>\d{6}) (?<object>[0-9a-f]{40}) \d+\t(?<path>.*)$/.exec(line)?.groups)
    .filter((entry) => entry?.mode === "120000")
    .map((entry) => ({ path: entry.path, target: git("cat-file", "blob", entry.object) }));
}

test("given the tracked files, when one is a symlink, then it points inside this repository", () => {
  // when
  const escaping = trackedSymlinks().filter(({ path, target }) =>
    isAbsolute(target) || relative(repository, resolve(join(repository, path, ".."), target)).startsWith(".."));

  // then
  assert.deepEqual(escaping.map(({ path, target }) => `${path} -> ${target}`), [],
    "A committed symlink that leaves the repository writes one machine's paths into a public "
    + "history and gives dependency resolution somewhere to go that no lockfile governs. "
    + "A .gitignore entry ending in a slash matches directories only and will not stop it.");
});
