import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  evaluateResourceSignals, resourceAbusePolicy, resourceAbusePolicyDigest,
  runResourceAbuseAssessment, validateResourceAbuseEvidence
} from "./security-resource-abuse.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const plan = {
  profile: "destructive", environment: "SECURITY", selectedTests: ["CSA-RES-001"],
  targetFingerprint: digest, budgets: { requests: 50000, concurrency: 50 }
};

function successfulExecution() {
  return {
    runtimeHardened: true,
    requestCount: 640,
    generatedDataMegabytes: 2,
    scenarios: resourceAbusePolicy.scenarios.map(({ id }) => ({ id, outcome: "passed" })),
    samples: [
      { sequence: 1, appCpuPercent: 42, appMemoryMegabytes: 420, dbCpuPercent: 36,
        dbMemoryMegabytes: 310, activeConnections: 8, activePoolConnections: 3, waitingLocks: 0,
        sessionRows: 18, storageMegabytes: 42, requestP95Milliseconds: 320, errorRate: 0.01 },
      { sequence: 2, appCpuPercent: 71, appMemoryMegabytes: 510, dbCpuPercent: 64,
        dbMemoryMegabytes: 380, activeConnections: 14, activePoolConnections: 5, waitingLocks: 2,
        sessionRows: 25, storageMegabytes: 45, requestP95Milliseconds: 410, errorRate: 0.02 }
    ],
    circuitBreaker: { tripped: false, reason: null, sampleSequence: null },
    stateBefore: digest,
    stateAfter: digest,
    competingWrites: { successful: 1, rejected: 9, partialOperations: 0 },
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
    { ...samples[0], appMemoryMegabytes: 950 },
    { ...samples[1], appMemoryMegabytes: 950 }
  ],
    resourceAbusePolicy.circuitBreakers), {
    tripped: true, reason: "app-memory", sampleSequence: 2
  });
  assert.deepEqual(evaluateResourceSignals([
    { ...samples[0], requestP95Milliseconds: 2500 },
    { ...samples[1], requestP95Milliseconds: 2500 }
  ], resourceAbusePolicy.circuitBreakers), {
    tripped: true, reason: "request-latency", sampleSequence: 2
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
  assert.equal(result.requestCount, 640);
  assert.equal(validateResourceAbuseEvidence(result), true);
  const retained = JSON.parse(readFileSync(join(evidenceDirectory, "resource-abuse.json"), "utf8"));
  assert.equal(retained.policyDigest, resourceAbusePolicyDigest());
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
  execution.competingWrites = { successful: 0, rejected: 0, partialOperations: 0 };
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
  assert.match(script, /participant-members\?query=Member2/);
  assert.match(script, /if \(!failedToken\)[\s\S]*captureCookies\(session, failedSessionCookies\)/);
  assert.match(script, /http\.post\(`\$\{target\}\/api\/session`[\s\S]*captureCookies\(response, failedSessionCookies\)/);
  assert.match(script, /case 0:[\s\S]*competingOccupancy\(\)[\s\S]*case 5:[\s\S]*failedLogin\(\)/);
  assert.match(script, /attackStartsAt: Date\.now\(\) \+ policy\.warmupSeconds \* 1000/);
  assert.match(script, /scenarioFixturesReady\("series-and-rule-cost", \(\) => Boolean\(courtId\)\)/);
  assert.match(script, /if \(__ITER === 0\) \{[\s\S]*authenticate\(\);[\s\S]*loadBookingInputs\(\);[\s\S]*\}[\s\S]*switch \(__ITER/);
  assert.equal(resourceAbusePolicy.stages.at(-1).target, 0);
  assert.equal(resourceAbusePolicy.stages[0].target, 12);
  assert.equal(resourceAbusePolicy.scenarios.length, 7);
  assert.equal(resourceAbusePolicy.scenarios.every(({ checks }) => checks.length > 0), true);
});
