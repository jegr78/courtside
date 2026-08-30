import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import {
  buildReliabilityRecord,
  comparisonOptions,
  compareIsolationVariants,
  environmentPrerequisites,
  reliabilityOptions,
  retainReliabilityRecord,
  runBoundedProcess,
  summarizeReliability,
  validateReliabilityRecord
} from "./webkit-reliability.mjs";

const frontendRequire = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = frontendRequire("ajv/dist/2020").default;
const schema = JSON.parse(readFileSync(new URL("../quality/webkit-reliability.schema.json", import.meta.url), "utf8"));
const validate = new Ajv({ strict: true, allErrors: true, formats: { "date-time": true } }).compile(schema);

function record(overrides = {}) {
  return buildReliabilityRecord({
    attemptId: "018f47a2-9e4c-7a61-8000-123456789abc",
    sourceCommit: "a".repeat(40),
    sourceTreeState: "clean",
    startedAt: "2026-08-27T08:00:00.000Z",
    finishedAt: "2026-08-27T08:02:00.000Z",
    playwrightVersion: "1.62.1",
    browserImage: "mcr.microsoft.com/playwright:v1.62.1-noble@sha256:" + "b".repeat(64),
    projectOrder: "configured",
    isolationVariant: "fresh-project-browser",
    resourceProfile: "github-hosted-default",
    seedFingerprint: `sha256:${"e".repeat(64)}`,
    host: { provider: "github-hosted", platform: "linux", architecture: "x64", cpuCount: 4, totalMemoryBytes: 16_000_000_000 },
    execution: { exitCode: 0, gateOutcome: { schemaVersion: 1, testPopulation: {
      count: 3, fingerprint: `sha256:${"c".repeat(64)}`
    }, claims: [
      { id: "webkit-core-compatibility", status: "passed" },
      { id: "webkit-axe-qualification", status: "passed" },
      { id: "browser-harness", status: "passed" }
    ] }, browserLifecycle: { schemaVersion: 1, processes: [{
      processId: "browser-1", browserName: "webkit", projectName: "webkit-core",
      startedAt: "2026-08-27T08:00:00.000Z", finishedAt: "2026-08-27T08:02:00.000Z", durationMs: 120_000,
      samples: [
        { recordedAt: "2026-08-27T08:00:01.000Z", testPosition: 1, phase: "start", memoryUsageBytes: 1000, cpuPercent: 1 },
        { recordedAt: "2026-08-27T08:00:02.000Z", testPosition: 1, phase: "end", memoryUsageBytes: 1100, cpuPercent: 2 }
      ], exitState: { exitCode: 137, oomKilled: false, hasError: false }
    }, {
      processId: "browser-2", browserName: "webkit", projectName: "webkit-pwa",
      startedAt: "2026-08-27T08:00:00.000Z", finishedAt: "2026-08-27T08:02:00.000Z", durationMs: 120_000,
      samples: [
        { recordedAt: "2026-08-27T08:00:03.000Z", testPosition: 2, phase: "start", memoryUsageBytes: 1000, cpuPercent: 1 },
        { recordedAt: "2026-08-27T08:00:04.000Z", testPosition: 2, phase: "end", memoryUsageBytes: 1100, cpuPercent: 2 }
      ], exitState: { exitCode: 137, oomKilled: false, hasError: false }
    }, {
      processId: "browser-3", browserName: "webkit", projectName: "webkit-accessibility",
      startedAt: "2026-08-27T08:00:00.000Z", finishedAt: "2026-08-27T08:02:00.000Z", durationMs: 120_000,
      samples: [
        { recordedAt: "2026-08-27T08:00:05.000Z", testPosition: 3, phase: "start", memoryUsageBytes: 1000, cpuPercent: 1 },
        { recordedAt: "2026-08-27T08:00:06.000Z", testPosition: 3, phase: "end", memoryUsageBytes: 1100, cpuPercent: 2 }
      ], exitState: { exitCode: 137, oomKilled: false, hasError: false }
    }] } },
    ...overrides
  });
}

function comparisonRecords(overrides = () => ({})) {
  const experimentId = "018f47a2-9e4c-7a61-8000-999999999999";
  return Array.from({ length: 40 }, (_, index) => {
    const pairIndex = Math.floor(index / 2) + 1;
    const pairPosition = index % 2 === 0 ? "first" : "second";
    const firstIsolation = pairIndex % 2 === 1 ? "fresh-project-browser" : "fresh-test-browser";
    const isolationVariant = pairPosition === "first" ? firstIsolation
      : firstIsolation === "fresh-project-browser" ? "fresh-test-browser" : "fresh-project-browser";
    const startedAt = new Date(Date.UTC(2026, 7, 1, 0, index * 3)).toISOString();
    const finishedAt = new Date(Date.parse(startedAt) + 120_000).toISOString();
    return record({
      attemptId: `018f47a2-9e4c-7a61-8000-${String(index).padStart(12, "0")}`,
      startedAt,
      finishedAt,
      isolationVariant,
      experimentId,
      pairIndex,
      pairPosition,
      ...overrides(index)
    });
  });
}

test("given a completed first attempt, when building its record, then the closed schema accepts only safe metadata", () => {
  // given / when
  const result = record();

  // then
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  assert.equal(JSON.stringify(result).includes("cookie"), false);
  assert.deepEqual(result.outcome.classifications, ["none"]);
  assert.equal(result.durationMs, 120_000);
  assert.equal(result.executionDeadlineMs, 1_500_000);
  assert.equal(result.terminationGraceMs, 10_000);
  assert.equal(result.testPopulation.count, 3);
  assert.equal(result.browserLifecycle.processes.length, 3);
});

test("given a product assertion failure, when building its record, then it remains a product failure", () => {
  // given
  const evidence = record();

  // when
  const result = record({ execution: { exitCode: 1, gateOutcome: { schemaVersion: 1, claims: [
    { id: "webkit-core-compatibility", status: "failed" },
    { id: "webkit-axe-qualification", status: "passed" },
    { id: "browser-harness", status: "passed" }
  ], testPopulation: evidence.testPopulation }, browserLifecycle: evidence.browserLifecycle } });

  // then
  assert.deepEqual(result.outcome, { status: "failed", classifications: ["product"], exitCode: 1 });
});

test("given an incomplete harness or missing execution, when building its record, then the failure class is explicit", () => {
  // given / when
  const harness = record({ execution: { exitCode: 1, gateOutcome: { schemaVersion: 1, claims: [
    { id: "webkit-core-compatibility", status: "not-established" },
    { id: "webkit-axe-qualification", status: "not-established" },
    { id: "browser-harness", status: "incomplete" }
  ] } } });
  const environment = record({ execution: { exitCode: null, environmentFailure: true } });

  // then
  assert.deepEqual(harness.outcome.classifications, ["harness"]);
  assert.deepEqual(environment.outcome.classifications, ["environment"]);
  assert.equal(environment.outcome.status, "incomplete");
});

test("given Docker is unavailable, when checking the environment, then the attempt is classified before playwright starts", async () => {
  // given
  const unavailable = () => ({ status: 1, error: undefined });

  // when
  const result = await environmentPrerequisites(unavailable, true);

  // then
  assert.equal(result.isReady, false);
  assert.equal(result.classification, "environment");
});

test("given a child ignores the graceful signal, when its deadline expires, then the owned process is killed", async () => {
  // given
  const startedAt = Date.now();

  // when
  const result = await runBoundedProcess(process.execPath,
    ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    { cwd: process.cwd(), env: process.env, stdio: "ignore" },
    { deadlineMs: 30, terminationGraceMs: 30 });

  // then
  assert.equal(result.timedOut, true);
  assert.ok(Date.now() - startedAt < 2_000);
});

test("given product and harness failures, when building the record, then neither classification is lost", () => {
  // given / when
  const result = record({ execution: { exitCode: 1, gateOutcome: { schemaVersion: 1, claims: [
    { id: "webkit-core-compatibility", status: "failed" },
    { id: "webkit-axe-qualification", status: "not-established" },
    { id: "browser-harness", status: "incomplete" }
  ] } } });

  // then
  assert.deepEqual(result.outcome, { status: "incomplete", classifications: ["product", "harness"], exitCode: 1 });
});

test("given the deadline expires after passing claims, when building the record, then the harness remains incomplete", () => {
  // given / when
  const result = record({ execution: { exitCode: null, timedOut: true, gateOutcome: { schemaVersion: 1, claims: [
    { id: "webkit-core-compatibility", status: "passed" },
    { id: "webkit-axe-qualification", status: "passed" },
    { id: "browser-harness", status: "passed" }
  ] } } });

  // then
  assert.deepEqual(result.outcome, { status: "incomplete", classifications: ["harness"], exitCode: null });
});

test("given an existing first attempt, when retaining a diagnostic run, then the original cannot be overwritten", () => {
  // given
  const directory = mkdtempSync(resolve(tmpdir(), "courtside-reliability-"));
  const first = record();
  const path = retainReliabilityRecord(first, directory);

  // when / then
  assert.throws(() => retainReliabilityRecord(first, directory), /already exists/);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), first);
});

test("given thirty hosted successes, when summarizing history, then the streak is counted without a statistical claim", () => {
  // given
  const records = Array.from({ length: 30 }, (_, index) => record({
    attemptId: `018f47a2-9e4c-7a61-8000-${String(index).padStart(12, "0")}`,
    startedAt: `2026-08-${String(index + 1).padStart(2, "0")}T08:00:00.000Z`,
    finishedAt: `2026-08-${String(index + 1).padStart(2, "0")}T08:02:00.000Z`
  }));

  // when
  const summary = summarizeReliability(records);

  // then
  assert.equal(summary.consecutiveSuccesses, 30);
  assert.equal(summary.hostedConsecutiveSuccesses, 30);
  assert.equal(summary.firstAttemptFailureRate, 0);
  assert.equal(Object.hasOwn(summary, "provenFailureRateBelowTarget"), false);
});

test("given a closed result schema, when adding sensitive or unknown data, then validation fails", () => {
  // given
  const unsafe = { ...record(), cookie: "session=value" };

  // when / then
  assert.equal(validate(unsafe), false);
});

test("given a schema valid but contradictory outcome, when validating semantics, then it fails closed", () => {
  // given
  const contradictory = record();
  contradictory.outcome = { status: "passed", classifications: ["product"], exitCode: 0 };

  // when / then
  assert.throws(() => validateReliabilityRecord(contradictory), /outcome is contradictory/);
});

test("given toolchain or duration metadata that does not match, when validating semantics, then it fails closed", () => {
  // given
  const wrongDigest = record();
  wrongDigest.toolchain.browserImageDigest = `sha256:${"c".repeat(64)}`;
  const wrongDuration = record();
  wrongDuration.durationMs = 1;

  // when / then
  assert.throws(() => validateReliabilityRecord(wrongDigest), /digest does not match/);
  assert.throws(() => validateReliabilityRecord(wrongDuration), /duration does not match/);
});

test("given both implemented isolation variants, when parsing the run, then they remain explicit", () => {
  // given / when
  const project = reliabilityOptions(["--isolation", "fresh-project-browser"]);
  const testScoped = reliabilityOptions(["--isolation", "fresh-test-browser"]);

  // then
  assert.equal(project.isolation, "fresh-project-browser");
  assert.equal(testScoped.isolation, "fresh-test-browser");
});

test("given an isolation experiment, when selecting its output, then completed attempts cannot be cleared by playwright", () => {
  // given / when
  const options = comparisonOptions(["--pairs", "20"]);

  // then
  assert.match(options.output, /target\/webkit-isolation-experiment$/);
  assert.throws(() => comparisonOptions(["--pairs", "20", "--output", "test-results/experiment"]),
    /outside Playwright test-results/);
});

test("given an unknown isolation or resource profile, when parsing the run, then it cannot be claimed", () => {
  // given / when / then
  assert.throws(() => reliabilityOptions(["--isolation", "shared-browser"]), /Unsupported isolation/);
  assert.throws(() => reliabilityOptions(["--resource-profile", "large-runner"]), /Unsupported option/);
});

test("given lifecycle evidence does not match the declared isolation, when validating, then it fails closed", () => {
  // given
  const wrongProjectCount = record();
  wrongProjectCount.browserLifecycle.processes.pop();
  const wrongTestCount = record({ isolationVariant: "fresh-test-browser" });
  wrongTestCount.browserLifecycle.processes.pop();

  // when / then
  assert.throws(() => validateReliabilityRecord(wrongProjectCount), /contradictory browser lifecycle/);
  assert.throws(() => validateReliabilityRecord(wrongTestCount), /contradictory browser lifecycle/);
});

test("given unsafe or incomplete lifecycle evidence, when the run claims success, then it fails closed", () => {
  // given
  const oom = record();
  oom.browserLifecycle.processes[0].exitState.oomKilled = true;
  const dockerError = record();
  dockerError.browserLifecycle.processes[0].exitState.hasError = true;
  const duplicateStart = record();
  duplicateStart.browserLifecycle.processes[0].samples[1].phase = "start";
  const duplicateProject = record();
  duplicateProject.browserLifecycle.processes[1].projectName = duplicateProject.browserLifecycle.processes[0].projectName;
  const builtEvidence = record();
  builtEvidence.browserLifecycle.processes[0].exitState.oomKilled = true;

  // when
  const built = record({ execution: {
    exitCode: 0,
    gateOutcome: { schemaVersion: 1, testPopulation: builtEvidence.testPopulation, claims: [
      { id: "webkit-core-compatibility", status: "passed" },
      { id: "webkit-axe-qualification", status: "passed" },
      { id: "browser-harness", status: "passed" }
    ] },
    browserLifecycle: builtEvidence.browserLifecycle
  } });

  // then
  assert.deepEqual(built.outcome, { status: "incomplete", classifications: ["harness"], exitCode: 0 });
  assert.throws(() => validateReliabilityRecord(oom), /contradictory browser lifecycle/);
  assert.throws(() => validateReliabilityRecord(dockerError), /contradictory browser lifecycle/);
  assert.throws(() => validateReliabilityRecord(duplicateStart), /contradictory browser lifecycle/);
  assert.throws(() => validateReliabilityRecord(duplicateProject), /contradictory browser lifecycle/);
});

test("given twenty paired attempts per variant, when comparing isolation, then conditions and results stay visible", () => {
  // given
  const records = comparisonRecords();

  // when
  const comparison = compareIsolationVariants(records);

  // then
  assert.equal(comparison.pairs, 20);
  assert.equal(comparison.experimentId, "018f47a2-9e4c-7a61-8000-999999999999");
  assert.equal(comparison.variants["fresh-project-browser"].attemptCount, 20);
  assert.equal(comparison.variants["fresh-test-browser"].attemptCount, 20);
  assert.equal(comparison.selectedVariant, "fresh-project-browser");
});

test("given too few or non comparable attempts, when comparing isolation, then the conclusion is rejected", () => {
  // given
  const tooFew = [record(), record({
    attemptId: "018f47a2-9e4c-7a61-8000-123456789abd",
    isolationVariant: "fresh-test-browser"
  })];
  const differentCommit = comparisonRecords((index) => ({
    sourceCommit: index === 39 ? "d".repeat(40) : "a".repeat(40)
  }));
  const modifiedTree = comparisonRecords((index) => ({
    sourceTreeState: index === 39 ? "modified" : "clean"
  }));
  const unpaired = comparisonRecords();
  unpaired[1].matrix.pairPosition = "first";
  const overlappingPairs = comparisonRecords();
  overlappingPairs[2].startedAt = overlappingPairs[1].startedAt;
  overlappingPairs[2].finishedAt = overlappingPairs[1].finishedAt;

  // when / then
  assert.throws(() => compareIsolationVariants(tooFew), /twenty attempts/);
  assert.throws(() => compareIsolationVariants(differentCommit), /same source commit/);
  assert.throws(() => compareIsolationVariants(modifiedTree), /clean source tree/);
  assert.throws(() => compareIsolationVariants(unpaired), /alternating pair sequence/);
  assert.throws(() => compareIsolationVariants(overlappingPairs), /alternating pair sequence/);
});
