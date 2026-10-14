import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { BACKEND_SHARDS, backendShard, backendTestClasses, parseShard } from "./backend-test-shards.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const yaml = require("js-yaml");

function sourceTree(files) {
  const root = mkdtempSync(join(tmpdir(), "backend-shards-"));
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}

test("given test sources, when the classes are listed, then exactly the concrete classes Surefire runs by default are included", () => {
  // given
  const root = sourceTree({
    "org/example/BookingTest.java": "class BookingTest {}",
    "org/example/web/RulesTests.java": "public class RulesTests {}",
    "org/example/TestClock.java": "final class TestClock {}",
    "org/example/LegacyTestCase.java": "class LegacyTestCase {}",
    "org/example/AbstractStoreTest.java": "public abstract class AbstractStoreTest {}",
    "org/example/ProductionArtifactIT.java": "class ProductionArtifactIT {}",
    "org/example/testfixture/BookingFixture.java": "class BookingFixture {}"
  });

  // when
  const classes = backendTestClasses(root);

  // then
  assert.deepEqual(classes, [
    "org/example/BookingTest.java",
    "org/example/LegacyTestCase.java",
    "org/example/TestClock.java",
    "org/example/web/RulesTests.java"
  ], "an abstract class never runs, an IT belongs to Failsafe and a fixture is no test");
});

test("given a test whose package differs from its directory, when the classes are listed, then it is named by its package", () => {
  // given
  const root = sourceTree({
    "org/example/demo/SeederTest.java": "package org.example;\n\nclass SeederTest {}",
    "org/example/web/RulesTest.java": "package org.example.web;\nclass RulesTest {}"
  });

  // when
  const classes = backendTestClasses(root);

  // then
  assert.deepEqual(classes, ["org/example/SeederTest.java", "org/example/web/RulesTest.java"],
    "Surefire matches the compiled class, whose path follows the package and not the source directory");
});

test("given the repository's tests, when every shard is taken, then together they run each class exactly once", () => {
  // given
  const classes = backendTestClasses(new URL("../src/test/java", import.meta.url).pathname);

  // when
  const shards = Array.from({ length: BACKEND_SHARDS }, (_, index) => backendShard(classes, index + 1, BACKEND_SHARDS));

  // then
  assert.ok(classes.length > 400, "the listing must see the real test tree");
  assert.deepEqual(shards.flat().toSorted(), classes, "a class in no shard would silently stop running");
  assert.equal(new Set(shards.flat()).size, classes.length, "a class in two shards runs twice");
  assert.ok(shards.every((shard) => shard.length > 0), "every shard carries tests");
  assert.deepEqual(backendShard(classes, 1, BACKEND_SHARDS), shards[0], "the split is stable between runs");
});

test("given a shard argument, when it is parsed, then only one of the declared shards is accepted", () => {
  // when / then
  assert.deepEqual(parseShard(`1/${BACKEND_SHARDS}`), { current: 1, total: BACKEND_SHARDS });
  assert.throws(() => parseShard(`0/${BACKEND_SHARDS}`), /not a backend shard/);
  assert.throws(() => parseShard(`${BACKEND_SHARDS + 1}/${BACKEND_SHARDS}`), /not a backend shard/);
  assert.throws(() => parseShard(`1/${BACKEND_SHARDS + 1}`), /not a backend shard/);
  assert.throws(() => parseShard("one"), /not a backend shard/);
});

test("given the build workflow, when its backend matrix is read, then every backend shard runs exactly once", () => {
  // given
  const workflow = yaml.load(readFileSync(new URL("../.github/workflows/build.yml", import.meta.url), "utf8"));

  // when
  const scheduled = workflow.jobs.backend.strategy.matrix.shard;

  // then
  assert.deepEqual(scheduled, Array.from({ length: BACKEND_SHARDS }, (_, index) => `${index + 1}/${BACKEND_SHARDS}`),
    "a shard the matrix leaves out never runs on a pull request");
});
