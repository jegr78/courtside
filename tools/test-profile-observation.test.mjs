import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createObservationInventory, createProfileObservation, profileObservationReport,
  summarizeProfileObservations } from "./test-profile-observation.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const schema = JSON.parse(readFileSync(
  new URL("../ci/test-profile-observation.schema.json", import.meta.url), "utf8"));
const summarySchema = JSON.parse(readFileSync(
  new URL("../ci/test-profile-observation-summary.schema.json", import.meta.url), "utf8"));
const inventorySchema = JSON.parse(readFileSync(
  new URL("../ci/test-profile-observation-inventory.schema.json", import.meta.url), "utf8"));
const validate = new Ajv({ strict: true, formats: { "date-time": true } }).compile(schema);
const validateSummary = new Ajv({ strict: true, formats: { "date-time": true } }).compile(summarySchema);
const validateInventory = new Ajv({ strict: true, formats: { "date-time": true } }).compile(inventorySchema);

const plan = {
  schemaVersion: 3,
  runId: 101,
  attempt: 1,
  plannerOutcome: "passed",
  policyFingerprint: "c".repeat(64),
  baseCommit: "a".repeat(40),
  headCommit: "b".repeat(40),
  profiles: ["backend"],
  isFull: false,
  reasons: [{ code: "prefix:src/", path: "src/main/java/org/courtside/App.java", profile: "backend", status: "M" }]
};

function inventoryFor(observations, overrides = {}) {
  return {
    schemaVersion: 1,
    repository: "example/courtside",
    windowStartedAt: "2026-08-28T00:00:00.000Z",
    windowEndedAt: "2026-09-16T23:59:59.000Z",
    firstAttempts: observations.filter((entry) => entry.isFirstAttempt).map((entry) => ({
      runId: entry.runId,
      commit: entry.commit
    })),
    ...overrides
  };
}

const timing = {
  schemaVersion: 1,
  repository: "example/courtside",
  runId: 101,
  attempt: 1,
  isFirstAttempt: true,
  event: "pull_request",
  commit: "b".repeat(40),
  outcome: "success",
  startedAt: "2026-08-28T10:00:00.000Z",
  completedAt: "2026-08-28T10:10:00.000Z",
  durationMilliseconds: 600_000,
  timeToFirstFailureMilliseconds: null,
  url: "https://github.com/example/courtside/actions/runs/101",
  jobs: [
    { name: "backend", outcome: "success" },
    { name: "frontend", outcome: "success" },
    { name: "security", outcome: "success" }
  ]
};

test("givenAFirstAttemptAndItsBoundPlan_whenObservingCoverage_thenSelectedAndActualJobsRemainDistinct", () => {
  // when
  const observation = createProfileObservation(plan, timing);

  // then
  assert.equal(validate(observation), true, JSON.stringify(validate.errors));
  assert.deepEqual(observation.proposedJobs, ["backend", "security"]);
  assert.deepEqual(observation.jobsOutsideProposal, ["frontend"]);
  assert.deepEqual(observation.failuresOutsideProposal, []);
  assert.equal(observation.classificationOutcome, "no-observed-miss");
});

test("givenAnUnselectedJobFails_whenObservingCoverage_thenItBecomesAnUnderClassificationCandidate", () => {
  // given
  const failed = { ...timing, outcome: "failure", jobs: timing.jobs.map((job) =>
    job.name === "frontend" ? { ...job, outcome: "failure" } : job) };

  // when
  const observation = createProfileObservation(plan, failed);

  // then
  assert.deepEqual(observation.failuresOutsideProposal, [{ name: "frontend", outcome: "failure" }]);
  assert.equal(observation.classificationOutcome, "candidate-miss");
});

test("givenAPlanFromAnotherRunAttemptOrCommit_whenObservingCoverage_thenItFailsClosed", () => {
  // when / then
  assert.throws(() => createProfileObservation({ ...plan, runId: 102 }, timing), /identity/);
  assert.throws(() => createProfileObservation({ ...plan, attempt: 2 }, timing), /identity/);
  assert.throws(() => createProfileObservation({ ...plan, headCommit: "c".repeat(40) }, timing), /identity/);
  assert.throws(() => createProfileObservation(plan, { ...timing, isFirstAttempt: false }), /first-attempt/);
});

test("givenARerunAndItsExactPlan_whenObservingCoverage_thenItRemainsVisibleButCannotCountAsQualification", () => {
  // given
  const rerunPlan = { ...plan, attempt: 2 };
  const rerunTiming = { ...timing, attempt: 2, isFirstAttempt: false };

  // when
  const observation = createProfileObservation(rerunPlan, rerunTiming);

  // then
  assert.equal(validate(observation), true, JSON.stringify(validate.errors));
  assert.equal(observation.isFirstAttempt, false);
  assert.equal(observation.classificationOutcome, "rerun-not-evaluated");
});

test("givenAClassifierFallback_whenObservingCoverage_thenTheClassificationErrorRemainsVisible", () => {
  // given
  const fallback = {
    ...plan,
    plannerOutcome: "failed",
    profiles: ["full"],
    isFull: true,
    reasons: [{ code: "classifier-error", path: null, profile: "full", status: null }]
  };

  // when
  const observation = createProfileObservation(fallback, timing);

  // then
  assert.equal(observation.classificationOutcome, "classification-error");
  assert.deepEqual(observation.proposedJobs, ["backend", "frontend", "security"]);
  assert.throws(() => createProfileObservation({
    ...fallback,
    plannerOutcome: "passed"
  }, timing), /outcome/);
  assert.throws(() => createProfileObservation({
    ...fallback,
    reasons: [{ code: "classifier-error", path: "raw-error", profile: "full", status: null }]
  }, timing), /fallback/);
});

test("givenAFullJobDoesNotReachAResult_whenObservingCoverage_thenTheAttemptIsIncompleteNotMissed", () => {
  // given
  const cancelled = { ...timing, outcome: "cancelled", jobs: timing.jobs.map((job) =>
    job.name === "frontend" ? { ...job, outcome: "cancelled" } : job) };

  // when
  const observation = createProfileObservation(plan, cancelled);

  // then
  assert.deepEqual(observation.failuresOutsideProposal, []);
  assert.deepEqual(observation.incompleteJobs, [{ name: "frontend", outcome: "cancelled" }]);
  assert.equal(observation.classificationOutcome, "observation-incomplete");
});

test("givenTwoWeeksOfFirstAttempts_whenSummarizing_thenSampleLimitsAndMissesStayVisible", () => {
  // given
  const observations = Array.from({ length: 20 }, (_, index) => ({
    ...createProfileObservation(plan, timing),
    runId: 101 + index,
    startedAt: new Date(Date.parse("2026-08-28T10:00:00.000Z") + index * 24 * 60 * 60 * 1000).toISOString()
  }));
  observations[4] = {
    ...observations[4],
    actualJobs: observations[4].actualJobs.map((job) =>
      job.name === "frontend" ? { ...job, outcome: "failure" } : job),
    classificationOutcome: "candidate-miss",
    failuresOutsideProposal: [{ name: "frontend", outcome: "failure" }]
  };

  // when
  const summary = summarizeProfileObservations(observations, inventoryFor(observations));

  // then
  assert.equal(summary.sampleSize, 20);
  assert.equal(summary.observedFirstAttemptCount, 20);
  assert.equal(summary.windowDays, 19);
  assert.equal(summary.fullProfileCount, 0);
  assert.equal(summary.fullProfileRate, 0);
  assert.equal(summary.candidateMissCount, 1);
  assert.equal(summary.status, "under-classification-observed");
  assert.equal(validateSummary(summary), true, JSON.stringify(validateSummary.errors));
  assert.deepEqual(summary.limitations, [
    "Observations cover GitHub-hosted pull-request runs only.",
    "Green jobs outside a proposal show no miss for that attempt; they do not prove classifier completeness.",
    "Candidate misses require rule correction and a new qualifying observation window."
  ]);
});

test("givenRerunsOrContradictoryRecords_whenSummarizing_thenTheyCannotImproveTheObservation", () => {
  // given
  const first = createProfileObservation(plan, timing);
  const rerun = createProfileObservation({ ...plan, attempt: 2 },
    { ...timing, attempt: 2, isFirstAttempt: false });
  const incomplete = {
    ...first,
    runId: 103,
    actualJobs: first.actualJobs.map((job) => job.name === "frontend"
      ? { ...job, outcome: "cancelled" } : job),
    incompleteJobs: [{ name: "frontend", outcome: "cancelled" }],
    classificationOutcome: "observation-incomplete"
  };

  // when
  const records = [first, rerun, incomplete];
  const summary = summarizeProfileObservations(records, inventoryFor(records));

  // then
  assert.equal(summary.sampleSize, 1);
  assert.equal(summary.observedFirstAttemptCount, 2);
  assert.equal(summary.incompleteObservationCount, 1);
  assert.equal(summary.rerunCount, 1);
  assert.equal(summary.status, "collecting");
  assert.throws(() => summarizeProfileObservations([
    { ...first, classificationOutcome: "candidate-miss", failuresOutsideProposal: [] }
  ], inventoryFor([first])), /inconsistent/);
  assert.throws(() => summarizeProfileObservations([
    { ...first, token: "not-retained" }
  ], inventoryFor([first])), /unknown fields/);
  assert.throws(() => summarizeProfileObservations([
    { ...first, repository: "not a repository" }
  ], inventoryFor([first])), /identity/);
  assert.throws(() => summarizeProfileObservations([
    { ...first, proposedProfiles: ["backend", "backend"] }
  ], inventoryFor([first])), /profiles/);
  assert.throws(() => summarizeProfileObservations([
    { ...first, plannerOutcome: "failed", classificationOutcome: "classification-error" }
  ], inventoryFor([first])), /fallback/);
  assert.throws(() => summarizeProfileObservations([first], inventoryFor([first], {
    windowStartedAt: "2026-08-26T10:00:00.000Z",
    windowEndedAt: "2026-08-27T10:00:00.000Z"
  })), /precedes/);
  assert.throws(() => summarizeProfileObservations([first], inventoryFor([])), /inventory/);
  assert.throws(() => summarizeProfileObservations([first], inventoryFor([first], {
    repository: "another/repository"
  })), /repository/);
  assert.throws(() => summarizeProfileObservations([
    first,
    { ...first, runId: 104, policyFingerprint: "d".repeat(64) }
  ], inventoryFor([first, { ...first, runId: 104 }])), /policy/);
});

test("givenAQualifiedSummary_whenRenderingTheFinalReport_thenSampleWindowAndLimitationsAreExplicit", () => {
  // given
  const observations = Array.from({ length: 20 }, (_, index) => ({
    ...createProfileObservation(plan, timing),
    runId: 301 + index,
    startedAt: new Date(Date.parse("2026-08-28T10:00:00.000Z") + index * 24 * 60 * 60 * 1000).toISOString()
  }));
  const summary = summarizeProfileObservations(observations, inventoryFor(observations));

  // when
  const report = profileObservationReport(summary);

  // then
  assert.match(report, /First-attempt sample: 20/);
  assert.match(report, /Observation window: 19 days/);
  assert.match(report, /Full-profile rate: 0\.00%/);
  for (const limitation of summary.limitations) assert.match(report, new RegExp(limitation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("givenCompletedGitHubRuns_whenCreatingTheInventory_thenEveryFirstAttemptInTheWindowIsRequired", () => {
  // given
  const pages = [{ total_count: 3, workflow_runs: [
    { id: 503, event: "pull_request", status: "completed", head_sha: "e".repeat(40),
      created_at: "2026-09-18T10:00:00.000Z" },
    { id: 502, event: "pull_request", status: "completed", head_sha: "d".repeat(40),
      created_at: "2026-09-10T10:00:00.000Z" },
    { id: 501, event: "pull_request", status: "completed", head_sha: "c".repeat(40),
      created_at: "2026-08-20T10:00:00.000Z" }
  ] }];

  // when
  const inventory = createObservationInventory(pages, "example/courtside",
    "2026-08-28T00:00:00.000Z", "2026-09-17T00:00:00.000Z");

  // then
  assert.deepEqual(inventory.firstAttempts, [{ runId: 502, commit: "d".repeat(40) }]);
  assert.equal(validateInventory(inventory), true, JSON.stringify(validateInventory.errors));
  assert.throws(() => createObservationInventory([{ total_count: 200, workflow_runs: pages[0].workflow_runs }],
    "example/courtside", "2026-08-01T00:00:00.000Z", "2026-09-17T00:00:00.000Z"), /incomplete/);
});
