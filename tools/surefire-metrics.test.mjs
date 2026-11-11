import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { suiteMetrics } from "./surefire-metrics.mjs";

const fixtures = new URL("./surefire-metrics.fixtures/", import.meta.url);
const reports = readdirSync(fixtures).map((name) => readFileSync(new URL(name, fixtures), "utf8"));

test("given reports from a real CI run, when the metrics are read, then the Flyway probe, the context start and the class time come from Spring's and Surefire's own lines", () => {
  // when
  const metrics = suiteMetrics(reports);
  // then
  assert.equal(metrics.testClasses, 2);
  assert.equal(metrics.contextStarts, 1, "one class started a Spring context");
  assert.equal(metrics.migrationsApplied, 94);
  assert.equal(metrics.msPerMigration, 546 / 94, "the probe divides Flyway's execution time by the migrations it applied");
  assert.equal(metrics.testClassMinutes, (6.129 + 0.002) / 60);
  assert.equal(metrics.normalisedWork, metrics.testClassMinutes / metrics.msPerMigration);
});

test("given contexts on a fast and a slow moment, when the probe is read, then it is the median of the contexts", () => {
  // given
  const flyway = (count, time) => `<testsuite name="T" time="1.0"><system-out>{"message":"Successfully applied ${count} migrations to schema \\"public\\", now at version v${count} (execution time ${time}s)"}</system-out></testsuite>`;
  // when
  const metrics = suiteMetrics([flyway(100, "00:00.400"), flyway(100, "00:00.500"), flyway(100, "00:01.200")]);
  // then
  assert.equal(metrics.msPerMigration, 5, "one slow context does not move the probe");
});

test("given reports without a Flyway line, when the metrics are read, then the probe and the normalised work are unknown rather than zero", () => {
  // when
  const metrics = suiteMetrics([reports.find((report) => !report.includes("Successfully applied"))]);
  // then
  assert.equal(metrics.msPerMigration, null);
  assert.equal(metrics.normalisedWork, null);
  assert.equal(metrics.contextStarts, 0);
});
