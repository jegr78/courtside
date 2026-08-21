import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const evidenceSchema = JSON.parse(readFileSync(
  new URL("../security/resource-abuse-evidence.schema.json", import.meta.url), "utf8"));
const validateSchema = new Ajv({ strict: true, allErrors: true }).compile(evidenceSchema);
const script = readFileSync(new URL("../security/resource-abuse.js", import.meta.url));
const gateway = readFileSync(new URL("./security-request-gateway.py", import.meta.url));
const policyFile = readFileSync(new URL("../security/resource-abuse-policy.json", import.meta.url));

export const resourceAbusePolicy = Object.freeze(JSON.parse(readFileSync(
  new URL("../security/resource-abuse-policy.json", import.meta.url), "utf8")));

export function resourceAbusePolicyDigest(policy = resourceAbusePolicy) {
  return `sha256:${createHash("sha256").update(JSON.stringify(policy)).digest("hex")}`;
}

export function resourceAbusePolicyFileDigest() {
  return `sha256:${createHash("sha256").update(policyFile).digest("hex")}`;
}

export function resourceAbuseScriptDigest() {
  return `sha256:${createHash("sha256").update(script).digest("hex")}`;
}

export function resourceAbuseGatewayDigest() {
  return `sha256:${createHash("sha256").update(gateway).digest("hex")}`;
}

const signalProperties = [
  ["app-cpu", "appCpuPercent"],
  ["app-memory", "appMemoryMegabytes"],
  ["db-cpu", "dbCpuPercent"],
  ["db-memory", "dbMemoryMegabytes"],
  ["database-connections", "activeConnections"],
  ["connection-pool-active", "activePoolConnections"],
  ["connection-pool-pending", "pendingPoolConnections"],
  ["database-locks", "waitingLocks"],
  ["session-growth", "sessionRows"],
  ["storage-growth", "storageMegabytes"],
  ["request-latency", "requestP95Milliseconds"],
  ["upstream-errors", "errorRate"]
];

export function evaluateResourceSignals(samples, limits) {
  const counters = new Map();
  for (const sample of samples) {
    for (const [reason, property] of signalProperties) {
      const exceeded = sample[property] > limits.tripThresholds[property];
      const count = exceeded ? (counters.get(reason) ?? 0) + 1 : 0;
      counters.set(reason, count);
      if (count >= limits.consecutiveSamples) {
        return { tripped: true, reason, sampleSequence: sample.sequence };
      }
    }
  }
  return { tripped: false, reason: null, sampleSequence: null };
}

export function evaluateSafetyLimits(samples, limits) {
  for (const sample of samples) {
    for (const [reason, property] of signalProperties) {
      if (sample[property] > limits.safetyLimits[property]) {
        return { violated: true, reason, sampleSequence: sample.sequence };
      }
    }
  }
  return { violated: false, reason: null, sampleSequence: null };
}

export async function runResourceAbuseAssessment(plan, context) {
  assertDestructivePlan(plan, context);
  const execution = await context.runAbuse(plan, {
    policy: resourceAbusePolicy,
    policyDigest: resourceAbusePolicyDigest(),
    maxRequests: context.maxRequests,
    attempt: context.attempt,
    timeoutMilliseconds: Math.max(1, context.deadline.getTime() - Date.now())
  });
  const observedBreaker = evaluateResourceSignals(execution.samples, resourceAbusePolicy.circuitBreakers);
  const observedSafetyViolation = evaluateSafetyLimits(execution.samples, resourceAbusePolicy.circuitBreakers);
  const breakerConsistent = JSON.stringify(observedBreaker) === JSON.stringify(execution.circuitBreaker);
  const safetyConsistent = JSON.stringify(observedSafetyViolation) === JSON.stringify(execution.safetyLimitViolation);
  const recoveryOutcomes = Object.values(execution.recovery);
  const competingObserved = execution.competingWrites.successful + execution.competingWrites.rejected
    + execution.competingWrites.partialOperations > 0;
  const duplicateObserved = execution.competingWrites.duplicateBookings
    + execution.competingWrites.duplicateResponses + execution.competingWrites.duplicateFailures > 0;
  const toctouObserved = execution.competingWrites.toctouCreated + execution.competingWrites.toctouSkipped > 0;
  const artifactBound = execution.scannerImage === resourceAbusePolicy.image
    && execution.scriptDigest === resourceAbuseScriptDigest()
    && execution.mountedPolicyDigest === resourceAbusePolicyFileDigest()
    && execution.gatewayDigest === resourceAbuseGatewayDigest();
  const integrityFailed = competingObserved && (execution.competingWrites.successful !== 1
      || execution.competingWrites.rejected < 1)
    || execution.competingWrites.partialOperations !== 0
    || duplicateObserved && (execution.competingWrites.duplicateBookings !== 1
      || execution.competingWrites.duplicateResponses < 2 || execution.competingWrites.duplicateFailures !== 0)
    || toctouObserved && (execution.competingWrites.toctouCreated !== 0
      || execution.competingWrites.toctouSkipped < 1)
    || observedSafetyViolation.violated
    || execution.stateBefore !== execution.stateAfter
    || execution.scenarios.some(({ outcome }) => outcome === "failed")
    || recoveryOutcomes.includes("failed");
  const incomplete = !execution.runtimeHardened || !artifactBound || !breakerConsistent || !safetyConsistent
    || observedBreaker.tripped
    || execution.requestCount < 1 || execution.requestCount > context.maxRequests
    || execution.generatedDataMegabytes > plan.budgets.generatedDataMegabytes
    || execution.scenarios.some(({ outcome }) => outcome === "incomplete")
    || recoveryOutcomes.includes("incomplete");
  const outcome = integrityFailed ? "failed" : incomplete ? "incomplete" : "passed";
  const evidence = {
    schemaVersion: 1,
    testIds: ["CSA-RES-001"],
    targetFingerprint: plan.targetFingerprint,
    image: resourceAbusePolicy.image,
    policyDigest: resourceAbusePolicyDigest(),
    policyFileDigest: execution.mountedPolicyDigest,
    scriptDigest: execution.scriptDigest,
    gatewayDigest: execution.gatewayDigest,
    attempt: context.attempt,
    scenarios: execution.scenarios,
    samples: execution.samples,
    circuitBreaker: observedBreaker,
    safetyLimitViolation: observedSafetyViolation,
    stateBefore: execution.stateBefore,
    stateAfter: execution.stateAfter,
    competingWrites: execution.competingWrites,
    recovery: execution.recovery,
    requestCount: execution.requestCount,
    generatedDataMegabytes: execution.generatedDataMegabytes,
    runtimeHardened: execution.runtimeHardened,
    outcome
  };
  validateResourceAbuseEvidence(evidence);
  retainEvidence(context.evidenceDirectory, evidence);
  return evidence;
}

export function validateResourceAbuseEvidence(evidence) {
  if (!validateSchema(evidence)) {
    throw new Error(`Resource-abuse evidence is invalid: ${JSON.stringify(validateSchema.errors)}`);
  }
  const expected = resourceAbusePolicy.scenarios.map(({ id }) => id).toSorted();
  const actual = evidence.scenarios.map(({ id }) => id).toSorted();
  if (new Set(actual).size !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Resource-abuse evidence does not cover the complete scenario policy");
  }
  return true;
}

function assertDestructivePlan(plan, context) {
  if (plan.profile !== "destructive" || plan.environment !== "SECURITY"
      || JSON.stringify(plan.selectedTests) !== JSON.stringify(["CSA-RES-001"])) {
    throw new Error("Resource abuse requires the destructive SECURITY plan");
  }
  if (!Number.isSafeInteger(context.maxRequests) || context.maxRequests < 1
      || context.maxRequests > plan.budgets.requests) {
    throw new Error("Resource abuse exceeds the destructive request budget");
  }
}

function retainEvidence(directory, evidence) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "resource-abuse.json");
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
