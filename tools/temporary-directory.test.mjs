import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { temporaryDirectory } from "./temporary-directory.mjs";

const helper = new URL("temporary-directory.mjs", import.meta.url).href;

function runFixture(t, source) {
  const scratch = mkdtempSync(join(tmpdir(), "courtside-temporary-fixture-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const isolated = join(scratch, "tmp");
  const file = join(scratch, "fixture.test.mjs");
  mkdirSync(isolated);
  writeFileSync(file, source);
  const env = { ...process.env, TMPDIR: isolated, TEMP: isolated, TMP: isolated };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--test", file], { encoding: "utf8", env });
  return { run, left: readdirSync(isolated) };
}

test("given directories made at module level, in a nested helper and in a failing test, when the file ends, then none remains", (t) => {
  // given
  const source = `import { test } from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { temporaryDirectory } from ${JSON.stringify(helper)};
const shared = temporaryDirectory("courtside-module-");
writeFileSync(join(shared, "evidence.json"), "{}");
function harness() { return { directory: temporaryDirectory("courtside-nested-") }; }
test("passes", () => { harness(); });
test("fails", () => { temporaryDirectory("courtside-failing-"); throw new Error("expected failure"); });
`;

  // when
  const { run, left } = runFixture(t, source);

  // then
  assert.equal(run.status, 1, `the failing fixture test must still fail the file:\n${run.stdout}${run.stderr}`);
  assert.match(run.stdout, /expected failure/);
  assert.deepEqual(left, [], "every directory the helper made is removed once the file ends");
});

test("given a directory from the helper, when it is made, then it exists under the temporary root with its prefix", () => {
  // when
  const directory = temporaryDirectory("courtside-helper-probe-");

  // then
  assert.ok(existsSync(directory), "the helper returns a directory that exists");
  assert.ok(directory.startsWith(join(tmpdir(), "courtside-helper-probe-")), directory);
});
