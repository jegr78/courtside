import { strict as assert } from "node:assert";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runs = resolve(root, "build", "journeys");

function walkedDirectories() {
  return existsSync(runs) ? readdirSync(runs) : [];
}

test("given a run the browser refuses to start, when it ends, then it announces no report it did not write", () => {
  // given
  const before = walkedDirectories();

  // when
  const run = spawnSync(process.execPath, [resolve(root, "tools", "journey-run.mjs"), "--project=no-such-project"],
    { cwd: root, encoding: "utf8" });
  const written = walkedDirectories().filter((directory) => !before.includes(directory));

  // then
  try {
    assert.notEqual(run.status, 0);
    assert.match(run.stdout, /Journey run: /);
    assert.doesNotMatch(run.stdout, /Report: /);
    assert.equal(written.length, 1);
    assert.equal(existsSync(resolve(runs, written[0], "index.md")), false);
  } finally {
    written.forEach((directory) => rmSync(resolve(runs, directory), { recursive: true, force: true }));
  }
});
