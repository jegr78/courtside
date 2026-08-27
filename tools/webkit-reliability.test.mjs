import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import {
  buildReliabilityRecord,
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
    host: { provider: "github-hosted", platform: "linux", architecture: "x64", cpuCount: 4, totalMemoryBytes: 16_000_000_000 },
    execution: { exitCode: 0, gateOutcome: { schemaVersion: 1, claims: [
      { id: "webkit-core-compatibility", status: "passed" },
      { id: "webkit-axe-qualification", status: "passed" },
      { id: "browser-harness", status: "passed" }
    ] } },
    ...overrides
  });
}

test("given a completed first attempt_whenBuildingItsRecord_thenTheClosedSchemaAcceptsOnlySafeMetadata", () => {
  // given / when
  const result = record();

  // then
  assert.equal(validate(result), true, JSON.stringify(validate.errors));
  assert.equal(JSON.stringify(result).includes("cookie"), false);
  assert.deepEqual(result.outcome.classifications, ["none"]);
  assert.equal(result.durationMs, 120_000);
  assert.equal(result.executionDeadlineMs, 1_500_000);
  assert.equal(result.terminationGraceMs, 10_000);
});

test("givenAProductAssertionFailure_whenBuildingItsRecord_thenItRemainsAProductFailure", () => {
  // given / when
  const result = record({ execution: { exitCode: 1, gateOutcome: { schemaVersion: 1, claims: [
    { id: "webkit-core-compatibility", status: "failed" },
    { id: "webkit-axe-qualification", status: "passed" },
    { id: "browser-harness", status: "passed" }
  ] } } });

  // then
  assert.deepEqual(result.outcome, { status: "failed", classifications: ["product"], exitCode: 1 });
});

test("givenAnIncompleteHarnessOrMissingExecution_whenBuildingItsRecord_thenTheFailureClassIsExplicit", () => {
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

test("givenDockerIsUnavailable_whenCheckingTheEnvironment_thenTheAttemptIsClassifiedBeforePlaywrightStarts", async () => {
  // given
  const unavailable = () => ({ status: 1, error: undefined });

  // when
  const result = await environmentPrerequisites(unavailable, true);

  // then
  assert.equal(result.isReady, false);
  assert.equal(result.classification, "environment");
});

test("givenAChildIgnoresTheGracefulSignal_whenItsDeadlineExpires_thenTheOwnedProcessIsKilled", async () => {
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

test("givenProductAndHarnessFailures_whenBuildingTheRecord_thenNeitherClassificationIsLost", () => {
  // given / when
  const result = record({ execution: { exitCode: 1, gateOutcome: { schemaVersion: 1, claims: [
    { id: "webkit-core-compatibility", status: "failed" },
    { id: "webkit-axe-qualification", status: "not-established" },
    { id: "browser-harness", status: "incomplete" }
  ] } } });

  // then
  assert.deepEqual(result.outcome, { status: "incomplete", classifications: ["product", "harness"], exitCode: 1 });
});

test("givenTheDeadlineExpiresAfterPassingClaims_whenBuildingTheRecord_thenTheHarnessRemainsIncomplete", () => {
  // given / when
  const result = record({ execution: { exitCode: null, timedOut: true, gateOutcome: { schemaVersion: 1, claims: [
    { id: "webkit-core-compatibility", status: "passed" },
    { id: "webkit-axe-qualification", status: "passed" },
    { id: "browser-harness", status: "passed" }
  ] } } });

  // then
  assert.deepEqual(result.outcome, { status: "incomplete", classifications: ["harness"], exitCode: null });
});

test("givenAnExistingFirstAttempt_whenRetainingADiagnosticRun_thenTheOriginalCannotBeOverwritten", () => {
  // given
  const directory = mkdtempSync(resolve(tmpdir(), "courtside-reliability-"));
  const first = record();
  const path = retainReliabilityRecord(first, directory);

  // when / then
  assert.throws(() => retainReliabilityRecord(first, directory), /already exists/);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), first);
});

test("givenThirtyHostedSuccesses_whenSummarizingHistory_thenTheStreakIsCountedWithoutAStatisticalClaim", () => {
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

test("givenAClosedResultSchema_whenAddingSensitiveOrUnknownData_thenValidationFails", () => {
  // given
  const unsafe = { ...record(), cookie: "session=value" };

  // when / then
  assert.equal(validate(unsafe), false);
});

test("givenASchemaValidButContradictoryOutcome_whenValidatingSemantics_thenItFailsClosed", () => {
  // given
  const contradictory = record();
  contradictory.outcome = { status: "passed", classifications: ["product"], exitCode: 0 };

  // when / then
  assert.throws(() => validateReliabilityRecord(contradictory), /outcome is contradictory/);
});

test("givenToolchainOrDurationMetadataThatDoesNotMatch_whenValidatingSemantics_thenItFailsClosed", () => {
  // given
  const wrongDigest = record();
  wrongDigest.toolchain.browserImageDigest = `sha256:${"c".repeat(64)}`;
  const wrongDuration = record();
  wrongDuration.durationMs = 1;

  // when / then
  assert.throws(() => validateReliabilityRecord(wrongDigest), /digest does not match/);
  assert.throws(() => validateReliabilityRecord(wrongDuration), /duration does not match/);
});

test("givenAnUnimplementedIsolationOrResourceProfile_whenParsingTheRun_thenItCannotBeClaimed", () => {
  // given / when / then
  assert.throws(() => reliabilityOptions(["--isolation", "fresh-test-browser"]), /Unsupported option/);
  assert.throws(() => reliabilityOptions(["--resource-profile", "large-runner"]), /Unsupported option/);
});
