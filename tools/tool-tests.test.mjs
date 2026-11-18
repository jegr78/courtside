import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { assertShiftedClock, declaredToolTests, runToolTests, shiftedClockEnvironment, toolInventory }
  from "./tool-tests.mjs";

test("when inventorying tools, then tracked and untracked files come from Git independently of the manifest", () => {
  // given
  const calls = [];
  const exec = (executable, arguments_, options) => {
    calls.push({ executable, arguments_, options });
    return "tools/direct.test.mjs\0tools/untracked.test.mjs\0";
  };

  // when
  const paths = toolInventory(exec);

  // then
  assert.deepEqual(paths, ["tools/direct.test.mjs", "tools/untracked.test.mjs"]);
  assert.equal(calls[0].executable, "git");
  assert.deepEqual(calls[0].arguments_, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "tools"]);
  assert.equal(Object.hasOwn(calls[0].options, "shell"), false);
});

test("given manifest-declared tests, when planning execution, then nested paths become explicit arguments", () => {
  // given
  const manifest = { schemaVersion: 1, entries: [
    { path: "tools/direct.test.mjs", profiles: ["tooling"], test: true },
    { path: "tools/nested/policy.test.mjs", profiles: ["tooling"], test: true },
    { path: "tools/runner.mjs", profiles: ["full"], test: false }
  ] };

  // when
  const paths = declaredToolTests(manifest, manifest.entries.map((entry) => entry.path));

  // then
  assert.deepEqual(paths, ["tools/direct.test.mjs", "tools/nested/policy.test.mjs"]);
  assert.ok(paths.every((path) => !path.includes("*")));
});

test("given explicit test paths, when running them, then the current Node binary receives every path without a shell", () => {
  // given
  const calls = [];
  const spawn = (executable, arguments_, options) => {
    calls.push({ executable, arguments_, options });
    return { status: 0 };
  };

  // when
  const status = runToolTests(["tools/direct.test.mjs", "tools/nested/policy.test.mjs"], spawn);

  // then
  assert.equal(status, 0);
  assert.equal(calls[0].executable, process.execPath);
  assert.deepEqual(calls[0].arguments_, ["--test", "../tools/direct.test.mjs", "../tools/nested/policy.test.mjs"]);
  assert.equal(Object.hasOwn(calls[0].options, "shell"), false);
});

test("given no declared tests, when planning execution, then a zero-test gate fails closed", () => {
  // given
  const manifest = { schemaVersion: 1, entries: [
    { path: "tools/runner.mjs", profiles: ["full"], test: false }
  ] };

  // when / then
  assert.throws(() => declaredToolTests(manifest, ["tools/runner.mjs"]), /declares no tests/i);
});

test("given a test file disabled in the manifest, when planning execution, then the manifest fails closed", () => {
  // given
  const manifest = { schemaVersion: 1, entries: [
    { path: "tools/policy.test.mjs", profiles: ["full"], test: false }
  ] };

  // when / then
  assert.throws(() => declaredToolTests(manifest, ["tools/policy.test.mjs"]), /manifest is invalid/i);
});

test("given a manifest omits a tool test, when planning execution, then the independent inventory fails closed", () => {
  // given
  const manifest = { schemaVersion: 1, entries: [
    { path: "tools/direct.test.mjs", profiles: ["tooling"], test: true }
  ] };

  // when / then
  assert.throws(
    () => declaredToolTests(manifest, ["tools/direct.test.mjs", "tools/validator.test.mjs"]),
    /inventory is stale/i
  );
});

test("given a clock offset, when the tool tests are spawned, then the child runs under a shifted clock", () => {
  // given
  const calls = [];
  const spawn = (executable, arguments_, options) => {
    calls.push({ executable, arguments_, options });
    return { status: 0 };
  };

  // when
  runToolTests(["tools/direct.test.mjs"], spawn, 400);
  runToolTests(["tools/direct.test.mjs"], spawn);

  // then
  assert.equal(calls[0].options.env.COURTSIDE_CLOCK_OFFSET_DAYS, "400");
  assert.match(calls[0].options.env.NODE_OPTIONS, /--import=file:.*tools\/shift-clock\.mjs$/);
  assert.equal(calls[0].options.env.TMPDIR.length > 0, true, "the shifted run keeps its own temporary root");
  assert.equal(calls[1].options.env.COURTSIDE_CLOCK_OFFSET_DAYS, process.env.COURTSIDE_CLOCK_OFFSET_DAYS);
  assert.equal(shiftedClockEnvironment(400, { NODE_OPTIONS: "--enable-source-maps" }).NODE_OPTIONS
    .startsWith("--enable-source-maps "), true);
  assert.throws(() => shiftedClockEnvironment(0), /Clock offset in days is invalid/);
  assert.throws(() => shiftedClockEnvironment(1.5), /Clock offset in days is invalid/);
});

test("given the preload does not reach the child, when the shifted run starts, then it refuses to report a pass", () => {
  // given — an environment carrying the offset but no preload is what a broken wiring produces
  const unwired = { ...process.env, COURTSIDE_CLOCK_OFFSET_DAYS: "400" };
  delete unwired.NODE_OPTIONS;

  // when / then
  assert.doesNotThrow(() => assertShiftedClock(shiftedClockEnvironment(400), 400));
  assert.throws(() => assertShiftedClock(unwired, 400), /did not reach the child process/);
});

function recordingSpawn(effect = () => {}, status = 0) {
  const calls = [];
  const spawn = (executable, arguments_, options) => {
    calls.push({ executable, arguments_, options });
    effect(options.env);
    return { status };
  };
  return { calls, spawn };
}

test("given a suite that cleans up, when it runs, then it gets its own temporary root and leaves nothing behind", () => {
  // given
  const reports = [];
  const { calls, spawn } = recordingSpawn();

  // when
  const status = runToolTests(["tools/direct.test.mjs"], spawn, 0, (text) => reports.push(text));

  // then
  const { TMPDIR, TEMP, TMP } = calls[0].options.env;
  assert.equal(status, 0);
  assert.notEqual(TMPDIR, process.env.TMPDIR, "the child must not write into the caller's temporary root");
  assert.deepEqual([TEMP, TMP], [TMPDIR, TMPDIR], "every platform's variable names the same root");
  assert.equal(existsSync(TMPDIR), false, "the runner removes its own temporary root");
  assert.deepEqual(reports, []);
});

test("given a suite that leaves directories behind, when it passes, then the run fails and names each one", () => {
  // given
  const reports = [];
  const { calls, spawn } = recordingSpawn((env) => {
    mkdirSync(join(env.TMPDIR, "courtside-runtime-a1B2c3"));
    mkdirSync(join(env.TMPDIR, "backend-shards-d4E5f6"));
  });

  // when
  const status = runToolTests(["tools/direct.test.mjs"], spawn, 0, (text) => reports.push(text));

  // then
  assert.equal(status, 1, "a leaking suite must not report a pass");
  assert.match(reports.join(""), /left 2 entries in their temporary directory/);
  assert.match(reports.join(""), /backend-shards-d4E5f6\ncourtside-runtime-a1B2c3/);
  assert.equal(existsSync(calls[0].options.env.TMPDIR), false, "the runner removes the leftovers it reported");
});

test("given a failing suite that also leaves a directory, when it ends, then its own status survives", () => {
  // given
  const reports = [];
  const { spawn } = recordingSpawn((env) => mkdirSync(join(env.TMPDIR, "courtside-tag-a1B2c3")), 3);

  // when
  const status = runToolTests(["tools/direct.test.mjs"], spawn, 0, (text) => reports.push(text));

  // then
  assert.equal(status, 3, "the leftover report must not mask the suite's own failure");
  assert.match(reports.join(""), /courtside-tag-a1B2c3/);
});

test("given a suite that cannot start, when it fails, then the runner still removes its temporary root", () => {
  // given
  let root;
  const spawn = (executable, arguments_, options) => {
    root = options.env.TMPDIR;
    return { error: new Error("spawn failed") };
  };

  // when / then
  assert.throws(() => runToolTests(["tools/direct.test.mjs"], spawn), /spawn failed/);
  assert.equal(existsSync(root), false, "the runner removes its own temporary root on the error path");
});
