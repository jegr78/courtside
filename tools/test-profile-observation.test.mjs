import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createObservationInventory, createProfileObservation, profileObservationReport,
  summarizeProfileObservations } from "./test-profile-observation.mjs";
import { bindPlanToRun } from "./test-profile-classifier.mjs";
import { profilePolicyFingerprint } from "./test-profile-contract.mjs";

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
    { name: "docs", outcome: "success" },
    { name: "backend", outcome: "success" },
    { name: "frontend", outcome: "success" },
    { name: "tooling", outcome: "success" },
    { name: "security", outcome: "success" }
  ]
};

test("given a first attempt and its bound plan, when observing coverage, then selected and actual jobs remain distinct", () => {
  // when
  const observation = createProfileObservation(plan, timing);

  // then
  assert.equal(validate(observation), true, JSON.stringify(validate.errors));
  assert.deepEqual(observation.proposedJobs, ["backend", "security"]);
  assert.deepEqual(observation.jobsOutsideProposal, ["docs", "frontend", "tooling"]);
  assert.deepEqual(observation.failuresOutsideProposal, []);
  assert.equal(observation.classificationOutcome, "no-observed-miss");
});

test("given an admitted contract plan, when observing coverage, then active and proposed selections remain distinct", () => {
  // given
  const admittedPlan = bindPlanToRun({
    schemaVersion: 1,
    profiles: ["backend"],
    isFull: false,
    reasons: plan.reasons
  }, {
    runId: 101,
    attempt: 1,
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40)
  }, "admitted", {
    schemaVersion: 2,
    admittedPolicyFingerprint: profilePolicyFingerprint(),
    evidence: {
      runId: 101,
      attempt: 1,
      artifact: "profile-evidence-101-1",
      assessedAt: "2026-08-31T10:00:00Z",
      expiresOn: "2026-09-30",
      status: "ready-for-review",
      qualifyingFirstAttempts: 20,
      backendPlans: 2,
      frontendPlans: 1,
      toolingPlans: 1,
      candidateMisses: 0,
      classificationErrors: 0,
      incompleteObservations: 0
    }
  });

  // when
  const observation = createProfileObservation(admittedPlan, timing);

  // then
  assert.deepEqual(observation.activeProfiles, ["backend"]);
  assert.deepEqual(observation.proposedProfiles, ["backend"]);
  assert.deepEqual(observation.activeJobs, ["backend", "security"]);
  assert.equal(observation.admissionOutcome, "matched");
  assert.equal(observation.schemaVersion, 2);
  assert.equal(validate(observation), true, JSON.stringify(validate.errors));
});

test("given a version four plan, when active evidence is missing or contradictory, then it fails closed", () => {
  // given
  const admittedPlan = bindPlanToRun({
    schemaVersion: 1,
    profiles: ["backend"],
    isFull: false,
    reasons: plan.reasons
  }, {
    runId: 101,
    attempt: 1,
    baseCommit: "a".repeat(40),
    headCommit: "b".repeat(40)
  }, "admitted", {
    schemaVersion: 2,
    admittedPolicyFingerprint: profilePolicyFingerprint(),
    evidence: {
      runId: 101,
      attempt: 1,
      artifact: "profile-evidence-101-1",
      assessedAt: "2026-08-31T10:00:00Z",
      expiresOn: "2026-09-30",
      status: "ready-for-review",
      qualifyingFirstAttempts: 20,
      backendPlans: 2,
      frontendPlans: 1,
      toolingPlans: 1,
      candidateMisses: 0,
      classificationErrors: 0,
      incompleteObservations: 0
    }
  });

  // when / then
  assert.throws(() => createProfileObservation({ ...admittedPlan, activeLocalTasks: [] }, timing),
    /coverage/);
  assert.throws(() => createProfileObservation({ ...admittedPlan, proposedLocalTasks: [] }, timing),
    /coverage/);
  assert.throws(() => createProfileObservation({
    ...admittedPlan,
    admissionOutcome: "stale",
    activePolicyFingerprint: null
  }, timing), /coverage/);

  const observation = createProfileObservation(admittedPlan, timing);
  const missingActive = structuredClone(observation);
  delete missingActive.activeJobs;
  assert.equal(validate(missingActive), false);
});

test("given an unselected job fails, when observing coverage, then it becomes an under classification candidate", () => {
  // given
  const failed = { ...timing, outcome: "failure", jobs: timing.jobs.map((job) =>
    job.name === "frontend" ? { ...job, outcome: "failure" } : job) };

  // when
  const observation = createProfileObservation(plan, failed);

  // then
  assert.deepEqual(observation.failuresOutsideProposal, [{ name: "frontend", outcome: "failure" }]);
  assert.equal(observation.classificationOutcome, "candidate-miss");
});

test("given an unselected job is skipped, when observing coverage, then the reduced attempt is complete", () => {
  // given
  const reduced = { ...timing, jobs: timing.jobs.map((job) =>
    ["frontend", "tooling"].includes(job.name) ? { ...job, outcome: "skipped" } : job) };

  // when
  const observation = createProfileObservation(plan, reduced);

  // then
  assert.deepEqual(observation.jobsOutsideProposal, ["docs", "frontend", "tooling"]);
  assert.deepEqual(observation.incompleteJobs, []);
  assert.equal(observation.classificationOutcome, "no-observed-miss");
});

test("given an unselected job has no conclusive outcome, when observing coverage, then the attempt is incomplete", () => {
  // given
  const cancelled = { ...timing, outcome: "cancelled", jobs: timing.jobs.map((job) =>
    job.name === "frontend" ? { ...job, outcome: "cancelled" } : job) };

  // when
  const observation = createProfileObservation(plan, cancelled);

  // then
  assert.deepEqual(observation.incompleteJobs, [{ name: "frontend", outcome: "cancelled" }]);
  assert.equal(observation.classificationOutcome, "observation-incomplete");
});

test("given a plan from another run attempt or commit, when observing coverage, then it fails closed", () => {
  // when / then
  assert.throws(() => createProfileObservation({ ...plan, runId: 102 }, timing), /identity/);
  assert.throws(() => createProfileObservation({ ...plan, attempt: 2 }, timing), /identity/);
  assert.throws(() => createProfileObservation({ ...plan, headCommit: "c".repeat(40) }, timing), /identity/);
  assert.throws(() => createProfileObservation(plan, { ...timing, isFirstAttempt: false }), /first-attempt/);
});

test("given a rerun and its exact plan, when observing coverage, then it remains visible but cannot count as qualification", () => {
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

test("given a classifier fallback, when observing coverage, then the classification error remains visible", () => {
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
  assert.deepEqual(observation.proposedJobs, ["backend", "docs", "frontend", "security", "tooling"]);
  assert.throws(() => createProfileObservation({
    ...fallback,
    plannerOutcome: "passed"
  }, timing), /outcome/);
  assert.throws(() => createProfileObservation({
    ...fallback,
    reasons: [{ code: "classifier-error", path: "raw-error", profile: "full", status: null }]
  }, timing), /fallback/);
});

test("given a selected job does not reach a result, when observing coverage, then the attempt is incomplete not missed", () => {
  // given
  const cancelled = { ...timing, outcome: "cancelled", jobs: timing.jobs.map((job) =>
    job.name === "backend" ? { ...job, outcome: "cancelled" } : job) };

  // when
  const observation = createProfileObservation(plan, cancelled);

  // then
  assert.deepEqual(observation.failuresOutsideProposal, []);
  assert.deepEqual(observation.incompleteJobs, [{ name: "backend", outcome: "cancelled" }]);
  assert.equal(observation.classificationOutcome, "observation-incomplete");
});

test("given a selected job fails, when observing coverage, then the attempt cannot qualify", () => {
  // given
  const failed = { ...timing, outcome: "failure", jobs: timing.jobs.map((job) =>
    job.name === "backend" ? { ...job, outcome: "failure" } : job) };

  // when
  const observation = createProfileObservation(plan, failed);

  // then
  assert.deepEqual(observation.incompleteJobs, [{ name: "backend", outcome: "failure" }]);
  assert.equal(observation.classificationOutcome, "observation-incomplete");
});

test("given historical first attempts, when summarizing, then sample limits and misses stay visible", () => {
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
  assert.equal(summary.fullProfileCount, 20);
  assert.equal(summary.fullProfileRate, 1);
  assert.equal(summary.candidateMissCount, 1);
  assert.equal(summary.status, "under-classification-observed");
  assert.equal(validateSummary(summary), true, JSON.stringify(validateSummary.errors));
  assert.deepEqual(summary.limitations, [
    "Observations cover GitHub-hosted pull-request runs only.",
    "A completed reduced run proves its selected gates, not the completeness of the classifier.",
    "Candidate misses require rule correction and a new qualifying observation window."
  ]);
});

test("given reruns or contradictory records, when summarizing, then they cannot improve the observation", () => {
  // given
  const first = createProfileObservation(plan, timing);
  const rerun = createProfileObservation({ ...plan, attempt: 2 },
    { ...timing, attempt: 2, isFirstAttempt: false });
  const incomplete = {
    ...first,
    runId: 103,
    actualJobs: first.actualJobs.map((job) => job.name === "backend"
      ? { ...job, outcome: "cancelled" } : job),
    incompleteJobs: [{ name: "backend", outcome: "cancelled" }],
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

test("given a qualified summary, when rendering the final report, then sample window and limitations are explicit", () => {
  // given
  const frontendPlan = {
    ...plan, profiles: ["frontend"],
    reasons: [{ code: "prefix:frontend/", path: "frontend/src/App.tsx", profile: "frontend", status: "M" }]
  };
  const toolingPlan = {
    ...plan, profiles: ["tooling"],
    reasons: [{ code: "manifest:tools/mail-check.test.mjs", path: "tools/mail-check.test.mjs",
      profile: "tooling", status: "M" }]
  };
  const backendTiming = { ...timing, jobs: timing.jobs.map((job) =>
    ["docs", "frontend", "tooling"].includes(job.name) ? { ...job, outcome: "skipped" } : job) };
  const frontendTiming = { ...timing, jobs: timing.jobs.map((job) =>
    ["docs", "backend", "tooling"].includes(job.name) ? { ...job, outcome: "skipped" } : job) };
  const toolingTiming = { ...timing, jobs: timing.jobs.map((job) =>
    ["docs", "backend", "frontend"].includes(job.name) ? { ...job, outcome: "skipped" } : job) };
  const observations = Array.from({ length: 20 }, (_, index) => ({
    ...createProfileObservation(index === 0 ? frontendPlan : index === 1 ? toolingPlan : plan,
      index === 0 ? frontendTiming : index === 1 ? toolingTiming : backendTiming),
    runId: 301 + index,
    startedAt: new Date(Date.parse("2026-08-28T10:00:00.000Z") + index * 6 * 60 * 60 * 1000).toISOString()
  }));
  const summary = summarizeProfileObservations(observations, inventoryFor(observations));

  // when
  const report = profileObservationReport(summary);

  // then
  assert.match(report, /First-attempt sample: 20/);
  assert.match(report, /Naturally reduced first attempts: 20/);
  assert.match(report, /Backend-profile first attempts: 18/);
  assert.match(report, /Frontend-profile first attempts: 1/);
  assert.match(report, /Tooling-profile first attempts: 1/);
  assert.match(report, /Observation window: 19 days/);
  assert.match(report, /Full-profile rate: 0\.00%/);
  for (const limitation of summary.limitations) assert.match(report, new RegExp(limitation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("given reduced evidence from only one profile, when summarizing, then the other profile remains unqualified", () => {
  // given
  const reducedTiming = { ...timing, jobs: timing.jobs.map((job) =>
    ["docs", "frontend", "tooling"].includes(job.name) ? { ...job, outcome: "skipped" } : job) };
  const observations = Array.from({ length: 20 }, (_, index) => ({
    ...createProfileObservation(plan, reducedTiming), runId: 501 + index
  }));

  // when
  const summary = summarizeProfileObservations(observations, inventoryFor(observations));

  // then
  assert.equal(summary.profileCounts.backend, 20);
  assert.equal(summary.profileCounts.frontend, 0);
  assert.equal(summary.status, "collecting");
});

test("given a proposed reduced profile runs every job, when summarizing, then it is shadow evidence not natural reduction", () => {
  // given
  const observations = Array.from({ length: 20 }, (_, index) => ({
    ...createProfileObservation(plan, timing), runId: 701 + index
  }));

  // when
  const summary = summarizeProfileObservations(observations, inventoryFor(observations));

  // then
  assert.equal(summary.sampleSize, 20);
  assert.equal(summary.fullProfileCount, 20);
  assert.equal(summary.reducedProfileCount, 0);
  assert.equal(summary.profileCounts.backend, 0);
  assert.equal(summary.status, "collecting");
});

test("given completed reduced profiles with expected skipped jobs, when summarizing, then they qualify", () => {
  // given
  const frontendPlan = {
    ...plan, profiles: ["frontend"],
    reasons: [{ code: "prefix:frontend/", path: "frontend/src/App.tsx", profile: "frontend", status: "M" }]
  };
  const toolingPlan = {
    ...plan, profiles: ["tooling"],
    reasons: [{ code: "manifest:tools/mail-check.test.mjs", path: "tools/mail-check.test.mjs",
      profile: "tooling", status: "M" }]
  };
  const backendTiming = { ...timing, jobs: timing.jobs.map((job) =>
    ["docs", "frontend", "tooling"].includes(job.name) ? { ...job, outcome: "skipped" } : job) };
  const frontendTiming = { ...timing, jobs: timing.jobs.map((job) =>
    ["docs", "backend", "tooling"].includes(job.name) ? { ...job, outcome: "skipped" } : job) };
  const toolingTiming = { ...timing, jobs: timing.jobs.map((job) =>
    ["docs", "backend", "frontend"].includes(job.name) ? { ...job, outcome: "skipped" } : job) };
  const fullPlan = { ...plan, profiles: ["full"], isFull: true };
  const observations = Array.from({ length: 20 }, (_, index) => {
    const selectedPlan = index === 0 ? plan : index === 1 ? frontendPlan : index === 2 ? toolingPlan : fullPlan;
    const selectedTiming = index === 0 ? backendTiming : index === 1 ? frontendTiming
      : index === 2 ? toolingTiming : timing;
    return { ...createProfileObservation(selectedPlan, selectedTiming), runId: 601 + index };
  });

  // when
  const summary = summarizeProfileObservations(observations, inventoryFor(observations));

  // then
  assert.equal(summary.sampleSize, 20);
  assert.equal(summary.reducedProfileCount, 3);
  assert.equal(summary.profileCounts.backend, 1);
  assert.equal(summary.profileCounts.frontend, 1);
  assert.equal(summary.profileCounts.tooling, 1);
  assert.equal(summary.incompleteObservationCount, 0);
  assert.equal(summary.status, "ready-for-review");
});

test("given completed git hub runs, when creating the inventory, then every first attempt in the window is required", () => {
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

test("given only full plans, when the sample threshold is met, then activation still collects reduced evidence", () => {
  // given
  const fullPlan = { ...plan, profiles: ["full"], isFull: true };
  const observations = Array.from({ length: 20 }, (_, index) => ({
    ...createProfileObservation(fullPlan, timing), runId: 401 + index
  }));

  // when
  const summary = summarizeProfileObservations(observations, inventoryFor(observations));

  // then
  assert.equal(summary.sampleSize, 20);
  assert.equal(summary.reducedProfileCount, 0);
  assert.equal(summary.status, "collecting");
});
