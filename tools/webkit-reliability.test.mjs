import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const resourceProfileContents = readFileSync(new URL("../quality/browser-resource-profiles.json", import.meta.url));

function resourceEnvironment() {
  const container = (target, id) => {
    const limits = JSON.parse(resourceProfileContents).profiles.normal.targets[target];
    return { containerId: id.repeat(64), memoryBytes: limits.memoryMegabytes * 1024 * 1024,
      nanoCpus: Math.ceil(limits.cpu * 1_000_000_000), pids: limits.pids,
      sharedMemoryBytes: limits.sharedMemoryMegabytes * 1024 * 1024 };
  };
  return {
    schemaVersion: 1,
    profile: "normal",
    profileDigest: `sha256:${createHash("sha256").update(resourceProfileContents).digest("hex")}`,
    docker: { cpuCount: 8, memoryBytes: 16_000_000_000, memoryLimit: true, pidsLimit: true },
    targets: {
      application: { processId: 1234, activeProcessorCount: 3, maxRamMegabytes: 1280, maxRamPercentage: 75 },
      proxy: container("proxy", "a"),
      postgres: container("postgres", "b"),
      browser: [container("browser", "c"), container("browser", "d"), container("browser", "e")]
    }
  };
}

function resourceTimeline() {
  return { schemaVersion: 1, intervalMs: 1_000,
    samples: ["application", "proxy", "postgres", "browser"].flatMap((target) => [1, 2].map((sequence) => ({
      recordedAt: `2026-08-27T08:00:0${sequence}.000Z`, sequence, target,
      ...target === "application" ? { processId: 1234 } : { containerId: String(sequence).repeat(64) },
      ...target === "browser" ? { processId: 77 } : {},
      cpuPercent: 1, memoryUsageBytes: 1_000, pids: 1, sharedMemoryUsageBytes: 0
    }))) };
}

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
    resourceProfile: "normal",
    seedFingerprint: `sha256:${"e".repeat(64)}`,
    host: { provider: "github-hosted", platform: "linux", architecture: "x64", cpuCount: 4, totalMemoryBytes: 16_000_000_000 },
    execution: { exitCode: 0, gateOutcome: { schemaVersion: 1, testPopulation: {
      count: 3, fingerprint: `sha256:${"c".repeat(64)}`
    }, claims: [
      { id: "webkit-core-compatibility", status: "passed" },
      { id: "webkit-axe-qualification", status: "passed" },
      { id: "browser-harness", status: "passed" }
    ] }, browserLifecycle: { schemaVersion: 1, processes: [{
      processId: "c".repeat(64), browserName: "webkit", projectName: "webkit-core",
      startedAt: "2026-08-27T08:00:00.000Z", finishedAt: "2026-08-27T08:02:00.000Z", durationMs: 120_000,
      samples: [
        { recordedAt: "2026-08-27T08:00:01.000Z", testPosition: 1, phase: "start", memoryUsageBytes: 1000, cpuPercent: 1 },
        { recordedAt: "2026-08-27T08:00:02.000Z", testPosition: 1, phase: "end", memoryUsageBytes: 1100, cpuPercent: 2 }
      ], exitState: { exitCode: 137, oomKilled: false, hasError: false }
    }, {
      processId: "d".repeat(64), browserName: "webkit", projectName: "webkit-pwa",
      startedAt: "2026-08-27T08:00:00.000Z", finishedAt: "2026-08-27T08:02:00.000Z", durationMs: 120_000,
      samples: [
        { recordedAt: "2026-08-27T08:00:03.000Z", testPosition: 1, phase: "start", memoryUsageBytes: 1000, cpuPercent: 1 },
        { recordedAt: "2026-08-27T08:00:04.000Z", testPosition: 1, phase: "end", memoryUsageBytes: 1100, cpuPercent: 2 }
      ], exitState: { exitCode: 137, oomKilled: false, hasError: false }
    }, {
      processId: "e".repeat(64), browserName: "webkit", projectName: "webkit-accessibility",
      startedAt: "2026-08-27T08:00:00.000Z", finishedAt: "2026-08-27T08:02:00.000Z", durationMs: 120_000,
      samples: [
        { recordedAt: "2026-08-27T08:00:05.000Z", testPosition: 1, phase: "start", memoryUsageBytes: 1000, cpuPercent: 1 },
        { recordedAt: "2026-08-27T08:00:06.000Z", testPosition: 1, phase: "end", memoryUsageBytes: 1100, cpuPercent: 2 }
      ], exitState: { exitCode: 137, oomKilled: false, hasError: false }
    }] }, resourceTimeline: resourceTimeline(), resourceEnvironment: resourceEnvironment() },
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
  ], testPopulation: evidence.testPopulation }, browserLifecycle: evidence.browserLifecycle,
  resourceTimeline: evidence.resourceTimeline, resourceEnvironment: evidence.resourceEnvironment } });

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
  assert.equal(project.resourceProfile, "normal");
  assert.equal(reliabilityOptions(["--resource-profile", "stress"]).resourceProfile, "stress");
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
  assert.throws(() => reliabilityOptions(["--resource-profile", "large-runner"]), /Unsupported resource profile/);
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
  const duplicateProcess = record();
  duplicateProcess.browserLifecycle.processes[1].processId = duplicateProcess.browserLifecycle.processes[0].processId;
  const projectPositionGap = record();
  projectPositionGap.browserLifecycle.processes[2].samples.forEach((sample) => { sample.testPosition = 2; });
  const interleavedProjectSamples = record();
  interleavedProjectSamples.testPopulation.count = 4;
  const secondPair = structuredClone(interleavedProjectSamples.browserLifecycle.processes[0].samples);
  interleavedProjectSamples.browserLifecycle.processes[0].samples[1].recordedAt = "2026-08-27T08:00:03.000Z";
  secondPair[0].recordedAt = "2026-08-27T08:00:02.000Z";
  secondPair[1].recordedAt = "2026-08-27T08:00:04.000Z";
  secondPair.forEach((sample) => { sample.testPosition = 2; });
  interleavedProjectSamples.browserLifecycle.processes[0].samples = [
    interleavedProjectSamples.browserLifecycle.processes[0].samples[0], secondPair[0],
    interleavedProjectSamples.browserLifecycle.processes[0].samples[1], secondPair[1]
  ];
  const duplicateFreshTestPosition = record();
  duplicateFreshTestPosition.matrix.isolationVariant = "fresh-test-browser";
  duplicateFreshTestPosition.testPopulation.count = 4;
  duplicateFreshTestPosition.browserLifecycle.processes.push(structuredClone(
    duplicateFreshTestPosition.browserLifecycle.processes[0]));
  duplicateFreshTestPosition.browserLifecycle.processes[3].processId = "browser-4";
  const reversedFreshTestProcesses = record();
  reversedFreshTestProcesses.matrix.isolationVariant = "fresh-test-browser";
  reversedFreshTestProcesses.testPopulation.count = 4;
  reversedFreshTestProcesses.browserLifecycle.processes[0].startedAt = "2026-08-27T08:01:00.000Z";
  reversedFreshTestProcesses.browserLifecycle.processes[0].durationMs = 60_000;
  reversedFreshTestProcesses.browserLifecycle.processes[0].samples[0].recordedAt = "2026-08-27T08:01:01.000Z";
  reversedFreshTestProcesses.browserLifecycle.processes[0].samples[1].recordedAt = "2026-08-27T08:01:02.000Z";
  const earlierCore = structuredClone(reversedFreshTestProcesses.browserLifecycle.processes[0]);
  earlierCore.processId = "browser-4";
  earlierCore.startedAt = "2026-08-27T08:00:00.000Z";
  earlierCore.finishedAt = "2026-08-27T08:00:30.000Z";
  earlierCore.durationMs = 30_000;
  earlierCore.samples[0].recordedAt = "2026-08-27T08:00:01.000Z";
  earlierCore.samples[1].recordedAt = "2026-08-27T08:00:02.000Z";
  earlierCore.samples.forEach((sample) => { sample.testPosition = 2; });
  reversedFreshTestProcesses.browserLifecycle.processes.push(earlierCore);
  const missingFreshTestProjects = record();
  missingFreshTestProjects.matrix.isolationVariant = "fresh-test-browser";
  missingFreshTestProjects.browserLifecycle.processes.forEach((process, index) => {
    process.projectName = "webkit-core";
    process.samples.forEach((sample) => { sample.testPosition = index + 1; });
  });
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
    browserLifecycle: builtEvidence.browserLifecycle,
    resourceTimeline: builtEvidence.resourceTimeline,
    resourceEnvironment: builtEvidence.resourceEnvironment
  } });

  // then
  assert.deepEqual(built.outcome, { status: "incomplete", classifications: ["harness"], exitCode: 0 });
  assert.throws(() => validateReliabilityRecord(oom), /contradictory browser lifecycle/);
  assert.throws(() => validateReliabilityRecord(dockerError), /contradictory browser lifecycle/);
  assert.throws(() => validateReliabilityRecord(duplicateStart), /contradictory browser lifecycle/);
  assert.throws(() => validateReliabilityRecord(duplicateProject), /contradictory browser lifecycle/);
  assert.throws(() => validateReliabilityRecord(duplicateProcess), /contradictory browser lifecycle/);
  assert.throws(() => validateReliabilityRecord(projectPositionGap), /contradictory browser lifecycle/);
  assert.throws(() => validateReliabilityRecord(interleavedProjectSamples), /contradictory browser lifecycle/);
  assert.throws(() => validateReliabilityRecord(duplicateFreshTestPosition), /contradictory browser lifecycle/);
  assert.throws(() => validateReliabilityRecord(reversedFreshTestProcesses), /contradictory browser lifecycle/);
  assert.throws(() => validateReliabilityRecord(missingFreshTestProjects), /contradictory browser lifecycle/);
});

test("given claimed resource limits differ from the runtime, when validating, then completion is rejected", () => {
  // given
  const missingBrowser = record();
  missingBrowser.resourceEnvironment.targets.browser.pop();
  const wrongMemory = record();
  wrongMemory.resourceEnvironment.targets.postgres.memoryBytes += 1;
  const staleProfile = record();
  staleProfile.resourceEnvironment.profileDigest = `sha256:${"f".repeat(64)}`;

  // when / then
  assert.throws(() => validateReliabilityRecord(missingBrowser), /resource environment/);
  assert.throws(() => validateReliabilityRecord(wrongMemory), /resource environment/);
  assert.throws(() => validateReliabilityRecord(staleProfile), /resource environment/);
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
