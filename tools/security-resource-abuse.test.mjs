import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  evaluateResourceSignals, evaluateSafetyLimits, resourceAbuseGatewayDigest, resourceAbusePolicy,
  resourceAbusePolicyDigest, resourceAbusePolicyFileDigest, resourceAbuseScriptDigest,
  resourceAbuseIntegrityDigest, resourceAbuseReceiptParserDigest,
  resourceAdmissionPolicy, resourceCompetingWrites, resourceScenarioOutcomes,
  runResourceAbuseAssessment, validateResourceAbuseEvidence
} from "./security-resource-abuse.mjs";

const digest = `sha256:${"a".repeat(64)}`;

test("given the integrity implementation graph, when binding evidence, then native decoding dates and orchestration contribute to its identity", () => {
  // given
  const paths = ["security-resource-integrity.mjs", "security-resource-cleanup.mjs",
    "security-resource-state.mjs", "security-resource-journal.mjs", "security-mail-observation.mjs",
    "security-mail-capture.mjs", "security-resource-dates.mjs", "security-resource-auth.mjs",
    "security-resource-runtime.mjs", "security-environment.mjs", "security-passive-deployment.mjs",
    "security-resource-abuse.mjs",
    "security-startup-diagnostics.mjs",
    "fixture-artifact.mjs", "../Dockerfile.fixtures",
    "../src/main/java/org/courtside/securityassessment/SecuritySessionAttributeProjection.java",
    "../src/main/java/org/courtside/securityassessment/SecurityPublicationPolicyProjection.java"];
  const hash = createHash("sha256");
  for (const path of paths) hash.update(path).update("\0").update(readFileSync(new URL(`./${path}`, import.meta.url))).update("\0");
  // when
  const actual = resourceAbuseIntegrityDigest();
  // then
  assert.equal(actual, `sha256:${hash.digest("hex")}`);
});

test("given missing actual snapshot capture, when retaining an incomplete execution, then keep null instead of inventing a fingerprint", async () => {
  // given
  const execution = successfulExecution();
  execution.stateBefore = null;
  execution.stateAfter = null;
  execution.integrity = { effects: "incomplete", cleanup: "incomplete", recovery: "incomplete" };
  execution.stateAfterCleanup = null;
  execution.stateAfterRecovery = null;
  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000, attempt: 1, deadline: new Date(Date.now() + 60000), runAbuse: async () => execution
  });
  // then
  assert.equal(result.outcome, "incomplete");
  assert.equal(result.stateBefore, null);
  assert.equal(result.stateAfter, null);
  assert.throws(() => validateResourceAbuseEvidence({ ...result, outcome: "passed",
    integrity: { effects: "passed", cleanup: "passed", recovery: "passed" },
    stateAfterCleanup: digest, stateAfterRecovery: digest }));
});
const plan = {
  profile: "destructive", environment: "SECURITY", selectedTests: ["CSA-RES-001"],
  targetFingerprint: digest, budgets: { requests: 50000, concurrency: 50, generatedDataMegabytes: 500 }
};

function warmUpSample(sequence, appCpuPercent) {
  return { sequence, appCpuPercent, appMemoryMegabytes: 400, dbCpuPercent: 10, dbMemoryMegabytes: 300,
    activeConnections: 4, activePoolConnections: 1, pendingPoolConnections: 0, poolMaxConnections: 10,
    waitingLocks: 0, sessionRows: 2, storageMegabytes: 40, requestP95Milliseconds: 120, errorRate: 0 };
}

function successfulExecution() {
  return {
    runtimeHardened: true,
    requestCount: 640,
    generatedDataMegabytes: 2,
    scenarios: resourceAbusePolicy.scenarios.map(({ id }) => ({ id, outcome: "passed" })),
    samples: [
      { sequence: 1, appCpuPercent: 42, appMemoryMegabytes: 420, dbCpuPercent: 36,
        dbMemoryMegabytes: 310, activeConnections: 8, activePoolConnections: 3,
        pendingPoolConnections: 0, poolMaxConnections: 10, waitingLocks: 0,
        sessionRows: 18, storageMegabytes: 42, requestP95Milliseconds: 320, errorRate: 0.01 },
      { sequence: 2, appCpuPercent: 71, appMemoryMegabytes: 510, dbCpuPercent: 64,
        dbMemoryMegabytes: 380, activeConnections: 14, activePoolConnections: 5,
        pendingPoolConnections: 0, poolMaxConnections: 10, waitingLocks: 2,
        sessionRows: 25, storageMegabytes: 45, requestP95Milliseconds: 410, errorRate: 0.02 }
    ],
    circuitBreaker: { tripped: false, reason: null, sampleSequence: null },
    safetyLimitViolation: { violated: false, reason: null, sampleSequence: null },
    warmUp: { settled: true, durationSeconds: 34, samples: [warmUpSample(1, 30)] },
    stateBefore: digest,
    stateAfter: digest,
    stateAfterCleanup: digest,
    stateAfterRecovery: digest,
    integrity: { effects: "passed", cleanup: "passed", recovery: "passed" },
    integrityModuleDigest: resourceAbuseIntegrityDigest(),
    receiptParserDigest: resourceAbuseReceiptParserDigest(),
    journalDigest: digest,
    integrityEvidenceDigest: digest,
    competingWrites: { successful: 1, rejected: 9, partialOperations: 0,
      duplicateBookings: 1, duplicateResponses: 9, duplicateFailures: 0,
      toctouCreated: 0, toctouSkipped: 1, admissionRefused: 0 },
    scannerImage: resourceAbusePolicy.image,
    scriptDigest: resourceAbuseScriptDigest(),
    mountedPolicyDigest: resourceAbusePolicyFileDigest(),
    gatewayDigest: resourceAbuseGatewayDigest(),
    recovery: { health: "passed", restart: "passed", database: "passed", domainIntegrity: "passed" }
  };
}

test("given bounded resource samples, when evaluating them, then every declared safety limit is enforced", () => {
  // given
  const samples = successfulExecution().samples;

  // when
  const result = evaluateResourceSignals(samples, resourceAbusePolicy.circuitBreakers);

  // then
  assert.deepEqual(result, { tripped: false, reason: null, sampleSequence: null });
  assert.deepEqual(evaluateResourceSignals([
    { ...samples[0], appMemoryMegabytes: 910 },
    { ...samples[1], appMemoryMegabytes: 910 }
  ],
    resourceAbusePolicy.circuitBreakers), {
    tripped: true, reason: "app-memory", sampleSequence: 2
  });
  assert.deepEqual(evaluateResourceSignals([
    { ...samples[0], requestP95Milliseconds: 1700 },
    { ...samples[1], requestP95Milliseconds: 1700 }
  ], resourceAbusePolicy.circuitBreakers), {
    tripped: true, reason: "request-latency", sampleSequence: 2
  });
  assert.deepEqual(evaluateSafetyLimits([
    samples[0], { ...samples[1], appMemoryMegabytes: 990 }
  ], resourceAbusePolicy.circuitBreakers), {
    violated: true, reason: "app-memory", sampleSequence: 2
  });
});

test("given a complete destructive execution, when retaining evidence, then recovery and integrity decide success", async () => {
  // given
  const evidenceDirectory = mkdtempSync(join(tmpdir(), "courtside-resource-abuse-"));

  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory,
    maxRequests: 1000,
    attempt: 1,
    deadline: new Date(Date.now() + 60_000),
    runAbuse: async () => successfulExecution()
  });

  // then
  assert.equal(result.outcome, "passed");
  assert.equal(result.schemaVersion, 3);
  assert.equal(result.requestCount, 640);
  assert.equal(validateResourceAbuseEvidence(result), true);
  const retained = JSON.parse(readFileSync(join(evidenceDirectory, "resource-abuse.json"), "utf8"));
  assert.equal(retained.policyDigest, resourceAbusePolicyDigest());
});

test("given causally proven booking effects, when the complete snapshot changed, then judge protected integrity instead of whole-dump equality", async () => {
  // given
  const execution = successfulExecution();
  execution.stateAfter = `sha256:${"b".repeat(64)}`;
  execution.integrity = { effects: "passed", cleanup: "passed", recovery: "passed" };
  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000, attempt: 1, deadline: new Date(Date.now() + 60000),
    runAbuse: async () => execution
  });
  // then
  assert.equal(result.outcome, "passed");
});

test("given missing phase proof or a protected mutation, when evaluating a bounded execution, then neither unchanged dumps nor a breaker can produce approval", async () => {
  // given
  const executions = [successfulExecution(), successfulExecution(), successfulExecution()];
  delete executions[0].integrity;
  executions[1].integrity = { effects: "incomplete", cleanup: "incomplete", recovery: "incomplete" };
  executions[2].integrity = { effects: "failed", cleanup: "incomplete", recovery: "incomplete" };
  // when
  const results = [];
  for (const execution of executions) results.push(await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000, attempt: 1, deadline: new Date(Date.now() + 60000),
    runAbuse: async () => execution
  }));
  // then
  assert.deepEqual(results.map(({ outcome }) => outcome), ["incomplete", "incomplete", "failed"]);
});

test("given forged passing phase evidence, when validating its schema, then reject missing snapshots and incomplete or failed phases", async () => {
  // given
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000, attempt: 1, deadline: new Date(Date.now() + 60000),
    runAbuse: async () => successfulExecution()
  });
  const forgeries = [
    { ...result, stateAfterCleanup: null },
    { ...result, stateAfterRecovery: null },
    { ...result, integrity: { ...result.integrity, effects: "incomplete" } },
    { ...result, integrity: { ...result.integrity, cleanup: "failed" } },
    { ...result, integrity: { ...result.integrity, recovery: "incomplete" } }
  ];
  // when / then
  for (const forged of forgeries) assert.throws(() => validateResourceAbuseEvidence(forged), /invalid/);
});

test("given unbound integrity artifacts, when evaluating apparently passing phases, then withhold approval", async () => {
  // given
  const executions = [successfulExecution(), successfulExecution(), successfulExecution()];
  executions[0].integrityModuleDigest = `sha256:${"b".repeat(64)}`;
  executions[1].receiptParserDigest = `sha256:${"b".repeat(64)}`;
  delete executions[2].journalDigest;
  // when
  const results = [];
  for (const execution of executions) results.push(await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000, attempt: 1, deadline: new Date(Date.now() + 60000),
    runAbuse: async () => execution
  }));
  // then
  assert.deepEqual(results.map(({ outcome }) => outcome), ["incomplete", "incomplete", "incomplete"]);
});

test("given inconsistent competing writes, when evaluating the run, then the assessment fails", async () => {
  // given
  const execution = successfulExecution();
  execution.competingWrites.successful = 2;

  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000,
    attempt: 1,
    deadline: new Date(Date.now() + 60_000),
    runAbuse: async () => execution
  });

  // then
  assert.equal(result.outcome, "failed");
});

test("given no rejected competing write, when evaluating the run, then the assessment fails", async () => {
  // given
  const execution = successfulExecution();
  execution.competingWrites.rejected = 0;

  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000,
    attempt: 1,
    deadline: new Date(Date.now() + 60_000),
    runAbuse: async () => execution
  });

  // then
  assert.equal(result.outcome, "failed");
});

test("given broken duplicate or stale-preview handling, when evaluating the run, then the assessment fails", async () => {
  // given
  const duplicateExecution = successfulExecution();
  duplicateExecution.competingWrites.duplicateBookings = 2;
  const toctouExecution = successfulExecution();
  toctouExecution.competingWrites.toctouCreated = 1;
  toctouExecution.competingWrites.toctouSkipped = 0;
  const context = (execution) => ({
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000,
    attempt: 1,
    deadline: new Date(Date.now() + 60_000),
    runAbuse: async () => execution
  });

  // when
  const duplicate = await runResourceAbuseAssessment(plan, context(duplicateExecution));
  const toctou = await runResourceAbuseAssessment(plan, context(toctouExecution));

  // then
  assert.equal(duplicate.outcome, "failed");
  assert.equal(toctou.outcome, "failed");
});

test("given an unbounded tool result, when evaluating the run, then the assessment is incomplete", async () => {
  // given
  const execution = successfulExecution();
  execution.runtimeHardened = false;
  execution.generatedDataMegabytes = 501;

  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000,
    attempt: 1,
    deadline: new Date(Date.now() + 60_000),
    runAbuse: async () => execution
  });

  // then
  assert.equal(result.outcome, "incomplete");
  assert.equal(result.runtimeHardened, false);
});

test("given a JVM that warmed above the trip thresholds before the breaker armed, when evaluating, then the warm-up trips nothing and stays on record", async () => {
  // given
  const execution = successfulExecution();
  execution.warmUp = { settled: true, durationSeconds: 41, samples: [warmUpSample(1, 98), warmUpSample(2, 101),
    warmUpSample(3, 40)] };
  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000, attempt: 1, deadline: new Date(Date.now() + 60000), runAbuse: async () => execution
  });
  // then
  assert.equal(result.circuitBreaker.tripped, false, "only the armed window may trip the breaker");
  assert.equal(result.outcome, "passed");
  assert.deepEqual(result.warmUp.samples.map(({ appCpuPercent }) => appCpuPercent), [98, 101, 40],
    "the warm-up samples are retained apart from the measured window");
});

test("given a warm-up sample beyond a safety limit, when evaluating, then the run failed", async () => {
  // given
  const execution = successfulExecution();
  execution.warmUp = { settled: false, durationSeconds: 12, samples: [warmUpSample(1, 115)] };
  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000, attempt: 1, deadline: new Date(Date.now() + 60000), runAbuse: async () => execution
  });
  // then
  assert.equal(result.outcome, "failed", "a safety limit binds before the breaker is armed as well");
  assert.equal(result.warmUpSafetyLimitViolation.violated, true);
});

test("given breached resource limits, when the tool omits the breaker, then the run is incomplete", async () => {
  // given
  const execution = successfulExecution();
  execution.samples[0].activeConnections = 31;
  execution.samples[1].activeConnections = 31;

  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000,
    attempt: 1,
    deadline: new Date(Date.now() + 60_000),
    runAbuse: async () => execution
  });

  // then
  assert.equal(result.outcome, "incomplete");
  assert.equal(result.circuitBreaker.reason, "database-connections");
});

test("given a circuit breaker stops before competing writes, when evaluating the run, then it is incomplete", async () => {
  // given
  const execution = successfulExecution();
  execution.samples[0].appCpuPercent = 95;
  execution.samples[1].appCpuPercent = 96;
  execution.circuitBreaker = { tripped: true, reason: "app-cpu", sampleSequence: 2 };
  execution.competingWrites = { successful: 0, rejected: 0, partialOperations: 0,
    duplicateBookings: 0, duplicateResponses: 0, duplicateFailures: 0,
    toctouCreated: 0, toctouSkipped: 0, admissionRefused: 0 };
  execution.scenarios = execution.scenarios.map((scenario) => ({ ...scenario, outcome: "incomplete" }));

  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000,
    attempt: 1,
    deadline: new Date(Date.now() + 60_000),
    runAbuse: async () => execution
  });

  // then
  assert.equal(result.outcome, "incomplete");
});

test("given an early breaker after one winning write, when no loser or duplicate replay was observed yet, then clean partial coverage is incomplete", async () => {
  // given
  const execution = successfulExecution();
  execution.samples[0].appCpuPercent = 85;
  execution.samples[1].appCpuPercent = 86;
  execution.circuitBreaker = { tripped: true, reason: "app-cpu", sampleSequence: 2 };
  execution.competingWrites.rejected = 0;
  execution.competingWrites.duplicateResponses = 1;
  execution.scenarios = execution.scenarios.map((scenario) => ({ ...scenario, outcome: "incomplete" }));
  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")), maxRequests: 1000,
    attempt: 1, deadline: new Date(Date.now() + 60_000), runAbuse: async () => execution
  });
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given interruption before any request or resource sample, when retaining evidence, then represent the missing coverage without losing the attempt", async () => {
  // given
  const execution = successfulExecution();
  execution.requestCount = 0;
  execution.samples = [];
  execution.competingWrites = { successful: 0, rejected: 0, partialOperations: 0,
    duplicateBookings: 0, duplicateResponses: 0, duplicateFailures: 0, toctouCreated: 0, toctouSkipped: 0, admissionRefused: 0 };
  execution.scenarios = execution.scenarios.map((scenario) => ({ ...scenario, outcome: "incomplete" }));
  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")), maxRequests: 1000,
    attempt: 1, deadline: new Date(Date.now() + 60_000), runAbuse: async () => execution
  });
  // then
  assert.equal(result.outcome, "incomplete");
  assert.equal(result.requestCount, 0);
  assert.deepEqual(result.samples, []);
  assert.equal(validateResourceAbuseEvidence(result), true);
  assert.throws(() => validateResourceAbuseEvidence({ ...result, outcome: "passed" }), /invalid/);
});

test("given passing scenario labels without observed race coverage, when evaluating the run, then never qualify an unobserved scenario", async () => {
  // given
  const execution = successfulExecution();
  execution.competingWrites = { successful: 0, rejected: 0, partialOperations: 0,
    duplicateBookings: 0, duplicateResponses: 0, duplicateFailures: 0, toctouCreated: 0, toctouSkipped: 0, admissionRefused: 0 };
  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")), maxRequests: 1000,
    attempt: 1, deadline: new Date(Date.now() + 60_000), runAbuse: async () => execution
  });
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a breaker and a proven integrity violation, when evaluating the run, then the assessment fails", async () => {
  // given
  const execution = successfulExecution();
  execution.samples[0].appCpuPercent = 85;
  execution.samples[1].appCpuPercent = 86;
  execution.circuitBreaker = { tripped: true, reason: "app-cpu", sampleSequence: 2 };
  execution.competingWrites.successful = 2;

  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000,
    attempt: 1,
    deadline: new Date(Date.now() + 60_000),
    runAbuse: async () => execution
  });

  // then
  assert.equal(result.outcome, "failed");
});

test("given a hard safety limit was crossed, when evaluating the run, then the assessment fails", async () => {
  // given
  const execution = successfulExecution();
  execution.samples[1].appMemoryMegabytes = 990;
  execution.safetyLimitViolation = { violated: true, reason: "app-memory", sampleSequence: 2 };

  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000,
    attempt: 1,
    deadline: new Date(Date.now() + 60_000),
    runAbuse: async () => execution
  });

  // then
  assert.equal(result.outcome, "failed");
});

test("given changed executable test bytes, when evaluating the run, then the assessment cannot pass", async () => {
  // given
  const execution = successfulExecution();
  execution.scriptDigest = `sha256:${"b".repeat(64)}`;

  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000,
    attempt: 1,
    deadline: new Date(Date.now() + 60_000),
    runAbuse: async () => execution
  });

  // then
  assert.equal(result.outcome, "incomplete");
});

test("given missing recovery evidence, when the assessment concludes, then it cannot pass", async () => {
  // given
  const execution = successfulExecution();
  execution.recovery.restart = "incomplete";

  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")),
    maxRequests: 1000,
    attempt: 1,
    deadline: new Date(Date.now() + 60_000),
    runAbuse: async () => execution
  });

  // then
  assert.equal(result.outcome, "incomplete");
});

test("given an active or unbounded plan, when resource abuse is requested, then execution is rejected", async () => {
  // when / then
  await assert.rejects(() => runResourceAbuseAssessment({ ...plan, profile: "active" }, {
    evidenceDirectory: ".", maxRequests: 1000, attempt: 1,
    deadline: new Date(Date.now() + 60_000), runAbuse: async () => successfulExecution()
  }), /destructive SECURITY plan/);
  await assert.rejects(() => runResourceAbuseAssessment(plan, {
    evidenceDirectory: ".", maxRequests: 50001, attempt: 1,
    deadline: new Date(Date.now() + 60_000), runAbuse: async () => successfulExecution()
  }), /request budget/);
});

const runId = "run-example";
const refusal = { status: 429, problemType: "urn:courtside:error:request-rate-limited", retryAfterSeconds: 1 };

function bookingOperation(id, key, startedAt, endedAt, answer) {
  return { id, kind: "createBooking", startedAt, endedAt, request: { idempotencyKey: key },
    responseBookingId: null, ...answer };
}

function raceOperations() {
  return [
    bookingOperation("1:1", `security-${runId}-1-0`, "2026-10-08T10:00:00.000Z", "2026-10-08T10:00:00.300Z",
      { status: 201, responseBookingId: "30000000-0000-0000-0000-000000000001" }),
    bookingOperation("2:1", `security-${runId}-2-0`, "2026-10-08T10:00:00.010Z", "2026-10-08T10:00:00.200Z",
      { status: 409, problemType: "urn:courtside:error:court-unavailable" }),
    bookingOperation("3:1", `security-${runId}-duplicate`, "2026-10-08T10:00:00.000Z", "2026-10-08T10:00:00.300Z",
      { status: 201, responseBookingId: "30000000-0000-0000-0000-000000000002" }),
    bookingOperation("4:1", `security-${runId}-duplicate`, "2026-10-08T10:00:00.020Z", "2026-10-08T10:00:00.310Z",
      { status: 201, responseBookingId: "30000000-0000-0000-0000-000000000002" }),
    bookingOperation("5:1", `security-capacity-${runId}-5-0`, "2026-10-08T10:00:00.000Z", "2026-10-08T10:00:00.100Z",
      { status: 400, problemType: "urn:courtside:error:participants-invalid" }),
    bookingOperation("6:1", `security-capacity-${runId}-6-0`, "2026-10-08T10:00:00.050Z", "2026-10-08T10:00:00.150Z",
      { status: 400, problemType: "urn:courtside:error:participants-invalid" })
  ];
}

function scenarioInput(operations, admissionEnforced = false) {
  return { scenarios: resourceAbusePolicy.scenarios, runId, admissionEnforced, telemetryComplete: true,
    failed: false, operations,
    summary: { rateLimitedLogins: 3, checks: resourceAbusePolicy.scenarios.flatMap(({ id, checks }) =>
      checks.map((check) => ({ name: `${id}:${check}`, passes: 1, fails: 0 }))) } };
}

function outcomeOf(outcomes, id) {
  return outcomes.find((scenario) => scenario.id === id).outcome;
}

test("given overlapping integrity requests and no refusal, when judging scenarios, then every scenario passes", () => {
  // when
  const outcomes = resourceScenarioOutcomes(scenarioInput(raceOperations()));

  // then
  assert.deepEqual(outcomes.filter(({ outcome }) => outcome !== "passed"), []);
});

test("given an admission refusal inside an integrity scenario, when judging scenarios, then only that scenario is incomplete", () => {
  // given
  const operations = raceOperations();
  operations.push(bookingOperation("7:1", `security-${runId}-duplicate`, "2026-10-08T10:00:01.000Z",
    "2026-10-08T10:00:01.010Z", refusal));

  // when
  const outcomes = resourceScenarioOutcomes(scenarioInput(operations));

  // then
  assert.equal(outcomeOf(outcomes, "duplicate-delivery"), "incomplete",
    "a refused replay never reached the code whose integrity the scenario judges");
  assert.equal(outcomeOf(outcomes, "competing-court-occupancy"), "passed");
});

test("given integrity requests that never overlapped, when judging scenarios, then the race was not exercised", () => {
  // given
  const operations = raceOperations();
  operations[1] = { ...operations[1], startedAt: "2026-10-08T10:00:02.000Z", endedAt: "2026-10-08T10:00:02.100Z" };

  // when
  const outcomes = resourceScenarioOutcomes(scenarioInput(operations));

  // then
  assert.equal(outcomeOf(outcomes, "competing-court-occupancy"), "incomplete",
    "sequential competitors prove a conflict check, not a race");
});

test("given enforced admission, when the address pressure saw no typed refusal, then it is incomplete", () => {
  // given
  const refusedInput = (count, enforced) => {
    const input = scenarioInput(raceOperations(), enforced);
    input.summary.addressAdmissionRefusals = count;
    return input;
  };

  // when / then
  assert.equal(outcomeOf(resourceScenarioOutcomes(refusedInput(0, false)), "admission-pressure"), "passed",
    "a target without admission control has nothing to refuse");
  assert.equal(outcomeOf(resourceScenarioOutcomes(refusedInput(0, true)), "admission-pressure"), "incomplete",
    "address pressure that was never refused never went over the budget it is sized to exceed");
  assert.equal(outcomeOf(resourceScenarioOutcomes(refusedInput(3, true)), "admission-pressure"), "passed");
});

test("given enforced admission, when the series cost pressure was never refused, then its typed answers suffice", () => {
  // given
  const operations = [...raceOperations(), { id: "9:1", kind: "previewSeries", status: 200,
    startedAt: "2026-10-08T10:00:30.000Z", endedAt: "2026-10-08T10:00:30.200Z", request: { occurrenceCount: 200 } }];
  const input = scenarioInput(operations, true);
  input.summary.addressAdmissionRefusals = 1;

  // when / then
  assert.equal(outcomeOf(resourceScenarioOutcomes(input), "series-and-rule-cost"), "passed",
    "a principal's queued series requests spend tokens only as fast as they finish, so a refusal is not owed");
});

test("given a failing integrity assertion, when judging scenarios, then the scenario fails", () => {
  // given
  const input = scenarioInput(raceOperations());
  input.summary.checks.find(({ name }) => name === "competing-court-occupancy:serialized").fails = 1;

  // when / then
  assert.equal(outcomeOf(resourceScenarioOutcomes(input), "competing-court-occupancy"), "failed");
});

test("given a failing integrity assertion beside a refusal and a missed race, when judging scenarios, then the failure wins", () => {
  // given
  const operations = raceOperations();
  operations[5] = { ...operations[5], startedAt: "2026-10-08T10:00:02.000Z", endedAt: "2026-10-08T10:00:02.100Z" };
  operations.push(bookingOperation("7:1", `security-capacity-${runId}-7-0`, "2026-10-08T10:00:03.000Z",
    "2026-10-08T10:00:03.010Z", refusal));
  const input = scenarioInput(operations);
  input.summary.checks.find(({ name }) => name === "participant-capacity:card-unavailable").fails = 1;

  // when / then
  assert.equal(outcomeOf(resourceScenarioOutcomes(input), "participant-capacity"), "failed",
    "an overbooked card is an integrity failure whatever else the race met");
  input.telemetryComplete = false;
  assert.equal(outcomeOf(resourceScenarioOutcomes(input), "participant-capacity"), "incomplete",
    "missing telemetry still means nothing about the run can be judged");
});

test("given refused integrity writes, when counting competing writes, then they are neither partial nor duplicate failures", () => {
  // given
  const operations = [...raceOperations(),
    bookingOperation("7:1", `security-${runId}-7-0`, "2026-10-08T10:00:01.000Z", "2026-10-08T10:00:01.010Z", refusal),
    bookingOperation("8:1", `security-${runId}-duplicate`, "2026-10-08T10:00:01.000Z", "2026-10-08T10:00:01.010Z",
      { ...refusal, problemType: "urn:courtside:error:operation-capacity-exhausted" }),
    bookingOperation("9:1", `security-${runId}-9-0`, "2026-10-08T10:00:01.000Z", "2026-10-08T10:00:01.010Z",
      { status: 429, problemType: null, retryAfterSeconds: null })];
  const validated = new Set(["30000000-0000-0000-0000-000000000001", "30000000-0000-0000-0000-000000000002"]
    .map((id) => `sha256:${createHash("sha256").update(JSON.stringify(id)).digest("hex")}`));

  // when
  const writes = resourceCompetingWrites(operations, runId, validated);

  // then
  assert.deepEqual(writes, { successful: 1, rejected: 1, partialOperations: 1, duplicateBookings: 1,
    duplicateResponses: 2, duplicateFailures: 0, toctouCreated: 0, toctouSkipped: 0, admissionRefused: 2 },
  "a typed refusal is counted apart, while a bare 429 stays a partial operation");
});

test("given refused competing writes, when evaluating the run, then the assessment is incomplete and never blames integrity", async () => {
  // given
  const execution = successfulExecution();
  execution.competingWrites.admissionRefused = 3;

  // when
  const result = await runResourceAbuseAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-resource-abuse-")), maxRequests: 1000,
    attempt: 1, deadline: new Date(Date.now() + 60_000), runAbuse: async () => execution
  });

  // then
  assert.equal(result.outcome, "incomplete");
  assert.equal(result.competingWrites.admissionRefused, 3);
});

test("given the assessed target, when it overrides shipped login or admission defaults, then the run refuses to qualify it", () => {
  // given
  const runtime = (...entries) => ({ Config: { Env: ["COURTSIDE_COOKIE_SECURE=true", ...entries] } });

  // when / then
  assert.deepEqual(resourceAdmissionPolicy(runtime(), { courtside: { admission: { account: {} } } }), { enforced: true });
  assert.deepEqual(resourceAdmissionPolicy(runtime(), { courtside: {} }), { enforced: false });
  for (const override of ["COURTSIDE_LOGIN_ADDRESS_MAX_FAILURES=5", "COURTSIDE_LOGIN_GLOBAL_THRESHOLD=20",
    "COURTSIDE_ADMISSION_ACCOUNT_BURST=100000"]) {
    assert.throws(() => resourceAdmissionPolicy(runtime(override), { courtside: {} }), /shipped/,
      `${override} would qualify a configuration no club installs`);
  }
});

test("given the destructive k6 profile, when inspecting it, then every curated abuse class stays gateway-bound", () => {
  // given
  const script = readFileSync(new URL("../security/resource-abuse.js", import.meta.url), "utf8");

  // when / then
  assert.match(script, /http:\/\/scanner-gateway:8090/);
  assert.doesNotMatch(script, /https?:\/\/(?!scanner-gateway:8090)/);
  assert.match(script, /"x"\.repeat\(2_000_001\)/);
  assert.match(script, /occurrenceCount: 200/);
  assert.match(script, /urn:courtside:error:court-unavailable/);
  assert.match(script, /booking\.participants\.cardUnavailable/);
  assert.match(script, /duplicate-delivery:replay-returns-original/);
  assert.match(script, /\/api\/booking-series-preview/);
  assert.match(script, /\/api\/booking-series`/);
  assert.match(script, /confirmedStarts/);
  assert.match(script,
    /journalPost\(`\$\{target\}\/api\/public\/participant-members`[\s\S]*?query: "Member2"[\s\S]*?"X-XSRF-TOKEN": token/);
  assert.match(script, /if \(!failedToken\)[\s\S]*captureCookies\(session, failedSessionCookies\)/);
  assert.match(script, /journalPost\(`\$\{target\}\/api\/session`[\s\S]*captureCookies\(response, failedSessionCookies\)/);
  assert.match(script, /export function addressPressure\(\) \{[\s\S]*\/api\/public\/booking-grid[\s\S]*jar: new http\.CookieJar\(\)/);
  assert.match(script, /const clock = slotPlan\.clock/);
  assert.match(script, /resourceSlotPlan\(__ENV\.COURTSIDE_SECURITY_DATE_PLAN\)/);
  assert.doesNotMatch(script, /const clock = Date\.now\(\)/);
  assert.match(script, /attackStartsAt: Date\.now\(\) \+ policy\.warmupSeconds \* 1000/);
  assert.match(script, /scenarioFixturesReady\("series-and-rule-cost", \(\) => Boolean\(courtId\)\)/);
  assert.match(script, /export function resourceAbuse\(run\) \{[\s\S]*useSetupSession\(run, null\);[\s\S]*failedLogin\(\);/);
  assert.equal(resourceAbusePolicy.stages.at(-1).target, 0);
  assert.equal(resourceAbusePolicy.stages[0].target, 12);
  assert.equal(resourceAbusePolicy.scenarios.length, 9);
  assert.equal(resourceAbusePolicy.scenarios.every(({ checks }) => checks.length > 0), true);
  for (const [name, trip] of Object.entries(resourceAbusePolicy.circuitBreakers.tripThresholds)) {
    assert.ok(trip < resourceAbusePolicy.circuitBreakers.safetyLimits[name]);
  }
  assert.match(script, /preview_mutation:[\s\S]*exec: "previewMutation"/);
  assert.match(script, /request_body:[\s\S]*exec: "requestBodyLimit"/);
});

test("given the destructive k6 profile, when separating integrity from pressure, then each integrity race has its own session and none shares the pressure", () => {
  // given
  const script = readFileSync(new URL("../security/resource-abuse.js", import.meta.url), "utf8");
  const exported = (name) => new RegExp(`export function ${name}\\(run\\) \\{([\\s\\S]*?)\\n\\}`).exec(script)?.[1] ?? "";

  // when
  const sessions = ["competingOccupancyRace", "duplicateDeliveryRace", "participantCapacityRace", "previewMutation",
    "seriesPressure"].map((name) => /useSetupSession\(run, "([a-z]+)"\)/.exec(exported(name))?.[1]);

  // then
  assert.equal(new Set(sessions).size, 5, `every scenario signs in on its own session: ${sessions}`);
  assert.match(script, /const sessionNames = \[[^\]]*\];/);
  assert.match(exported("resourceAbuse"), /useSetupSession\(run, null\)/, "pressure runs anonymously");
  for (const race of ["competingOccupancyRace", "duplicateDeliveryRace", "participantCapacityRace"]) {
    assert.match(exported(race), /awaitTick\(\);/, `${race} fires on a shared tick so its requests overlap`);
  }
  for (const integrity of ["competingOccupancy", "duplicateDelivery", "participantCapacity"]) {
    const body = new RegExp(`function ${integrity}\\(\\) \\{([\\s\\S]*?)\\n\\}`).exec(script)[1];
    const skip = body.indexOf("if (refusedIntegrityRequest(response)) return;");
    assert.ok(skip >= 0 && skip < body.indexOf("check(response"), `${integrity} must not judge a request admission refused`);
  }
});

test("given the destructive k6 profile, when warming up, then pressure exercises its paths at a low rate instead of sleeping", () => {
  // given
  const script = readFileSync(new URL("../security/resource-abuse.js", import.meta.url), "utf8");

  // when
  const pressure = /export function resourceAbuse\(run\) \{([\s\S]*?)\n\}/.exec(script)[1];

  // then
  assert.doesNotMatch(pressure, /return;/, "no warm-up branch skips the iteration");
  assert.match(pressure, /sleep\(Date\.now\(\) < run\.attackStartsAt \? 1 : 0\.2\);$/);
});

function shippedAdmission() {
  const application = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml").load(
    readFileSync(new URL("../src/main/resources/application.yaml", import.meta.url), "utf8"));
  const shipped = (value, fallback) => Number(/:(\d+)\}$/.exec(String(value ?? ""))?.[1] ?? fallback);
  const admission = application.courtside?.admission;
  return { application,
    account: { burst: shipped(admission?.account?.burst, 200), perSecond: shipped(admission?.account?.["per-second"], 20) },
    address: { burst: shipped(admission?.address?.burst, 600), perSecond: shipped(admission?.address?.["per-second"], 60) } };
}

test("given the shipped account budget, when sizing the integrity races, then they stay within it", () => {
  // given
  const { account } = shippedAdmission();
  const { racers, tickSeconds, rounds } = resourceAbusePolicy.integrity;
  const bookingWriteCost = 2;
  const seriesCost = 10;

  // when
  const integrityPerSecond = 3 * racers * bookingWriteCost / tickSeconds;
  const toctouCost = 2 * seriesCost + bookingWriteCost;

  // then
  assert.ok(integrityPerSecond <= account.perSecond, `${integrityPerSecond} tokens a second must fit ${account.perSecond}`);
  assert.ok(integrityPerSecond * rounds * tickSeconds + toctouCost <= account.burst + account.perSecond * rounds * tickSeconds);
  assert.ok(resourceAbusePolicy.seriesPressure.startSeconds
    >= resourceAbusePolicy.warmupSeconds + rounds * tickSeconds + account.burst / account.perSecond,
  "the account bucket refills between the integrity races and the series cost pressure");
});

test("given the shipped address budget, when the arrival-rate pressure runs, then it is refused by arithmetic that holds under queueing", () => {
  // given
  const { address } = shippedAdmission();
  const { rate, durationSeconds, startSeconds, preAllocatedVUs, maxVUs } = resourceAbusePolicy.addressPressure;
  const readCost = 1;
  const slowAnswerSeconds = 0.15;

  // when
  const offered = rate * durationSeconds * readCost;
  const admittable = address.burst + address.perSecond * durationSeconds;
  const refusedAtLeast = offered - admittable;

  // then
  assert.ok(refusedAtLeast >= 0.25 * offered,
    `${offered} reads against ${admittable} admittable tokens must leave a quarter of them refused`);
  assert.ok(maxVUs * (1 / slowAnswerSeconds) >= rate,
    "the arrival rate holds even when every read takes 150 ms, because the executor starts reads on a clock");
  assert.ok(preAllocatedVUs <= maxVUs);
  assert.ok(startSeconds >= resourceAbusePolicy.stages[0].duration.replace("s", "") * 1,
    "every failed-login VU fetched its anonymous token before the address budget is drained");
  const vus = resourceAbusePolicy.stages[0].target + 3 * resourceAbusePolicy.integrity.racers
    + resourceAbusePolicy.seriesPressure.vus + maxVUs + 2;
  assert.ok(vus <= 50, `${vus} virtual users must fit the journal's VU bound`);
  const pressureSeconds = resourceAbusePolicy.stages.reduce((total, { duration }) => total + Number(duration.replace("s", "")), 0);
  assert.ok(pressureSeconds / 0.2 <= 700, "a failed-login VU stays inside its journal budget");
});

test("given the shipped session limit, when setup signs in its sessions, then it uses exactly as many as one account may hold", () => {
  // given
  const { application } = shippedAdmission();
  const limit = Number(/^\$\{COURTSIDE_SESSION_MAX_CONCURRENT:(\d+)\}$/.exec(application.courtside.session["concurrent-limit"])[1]);
  const script = readFileSync(new URL("../security/resource-abuse.js", import.meta.url), "utf8");

  // when
  const names = JSON.parse(/const sessionNames = (\[[^\]]*\]);/.exec(script)[1]);

  // then
  assert.equal(names.length, limit, "one more session would evict the first, one fewer leaves two scenarios sharing");
  assert.equal(new Set(names).size, names.length);
});

test("given every request the assessment script makes, when it is read against the contract, "
  + "then each one names an operation the document declares with that method", () => {
  // given
  const require = createRequire(new URL("../frontend/package.json", import.meta.url));
  const api = require("js-yaml").load(
    readFileSync(new URL("../src/main/resources/api/openapi.yaml", import.meta.url), "utf8"));
  const script = readFileSync(new URL("../security/resource-abuse.js", import.meta.url), "utf8");
  const declared = new Set(Object.entries(api.paths).flatMap(([path, item]) =>
    Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`)));

  // when
  const issued = [...script.matchAll(/journal(Get|Post)\(`\$\{target\}(\/api\/[^`]*)`/g)]
    .map(([, verb, url]) => ({
      method: verb === "del" ? "DELETE" : verb.toUpperCase(),
      path: url.split("?")[0].replaceAll(/\$\{[^}]*\}/g, "{id}")
    }));

  // then
  assert.ok(issued.length > 0, "the script must issue requests for this to prove anything");
  const undeclared = issued
    .filter(({ method, path }) => !declared.has(`${method} ${path}`)
      && ![...declared].some((operation) => operation.replaceAll(/\{[^}]*\}/g, "{id}")
        === `${method} ${path}`))
    .map(({ method, path }) => `${method} ${path}`);
  assert.deepEqual([...new Set(undeclared)].toSorted(), [],
    "a request the contract does not declare is answered 405 or 404, and the scenario that needs "
      + "its fixture reports incomplete rather than failing where anyone would look");
});
