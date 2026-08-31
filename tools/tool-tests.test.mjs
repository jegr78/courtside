import assert from "node:assert/strict";
import { test } from "node:test";
import { declaredToolTests, runToolTests, toolInventory } from "./tool-tests.mjs";

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
