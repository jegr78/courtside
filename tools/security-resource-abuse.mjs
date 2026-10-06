import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const evidenceSchema = JSON.parse(readFileSync(
  new URL("../security/resource-abuse-evidence.schema.json", import.meta.url), "utf8"));
let compiled;
function validateSchema(evidence) {
  compiled ??= new (require("ajv/dist/2020").default)({ strict: true, allErrors: true })
      .compile(evidenceSchema);
  const valid = compiled(evidence);
  validateSchema.errors = compiled.errors;
  return valid;
}
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

export function resourceAbuseIntegrityDigest() {
  const hash = createHash("sha256");
  for (const path of ["security-resource-integrity.mjs", "security-resource-cleanup.mjs",
    "security-resource-state.mjs", "security-resource-journal.mjs", "security-mail-observation.mjs",
    "security-mail-capture.mjs", "security-resource-dates.mjs", "security-resource-auth.mjs",
    "security-resource-runtime.mjs", "security-environment.mjs", "security-passive-deployment.mjs",
    "security-startup-diagnostics.mjs",
    "fixture-artifact.mjs", "../Dockerfile.fixtures",
    "../src/main/java/org/courtside/securityassessment/SecuritySessionAttributeProjection.java",
    "../src/main/java/org/courtside/securityassessment/SecurityPublicationPolicyProjection.java"]) {
    hash.update(path).update("\0").update(readFileSync(new URL(`./${path}`, import.meta.url))).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function resourceAbuseReceiptParserDigest() {
  return `sha256:${createHash("sha256").update(readFileSync(new URL("./security-mail-receipt.py", import.meta.url))).digest("hex")}`;
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
  const integrity = execution.integrity ?? { effects: "incomplete", cleanup: "incomplete", recovery: "incomplete" };
  const integrityOutcomes = [integrity.effects, integrity.cleanup, integrity.recovery];
  const competingObserved = execution.competingWrites.successful + execution.competingWrites.rejected
    + execution.competingWrites.partialOperations > 0;
  const duplicateObserved = execution.competingWrites.duplicateBookings
    + execution.competingWrites.duplicateResponses + execution.competingWrites.duplicateFailures > 0;
  const toctouObserved = execution.competingWrites.toctouCreated + execution.competingWrites.toctouSkipped > 0;
  const competingIncomplete = execution.competingWrites.successful !== 1 || execution.competingWrites.rejected < 1;
  const duplicateIncomplete = execution.competingWrites.duplicateBookings !== 1
    || execution.competingWrites.duplicateResponses < 2;
  const toctouIncomplete = execution.competingWrites.toctouCreated !== 0 || execution.competingWrites.toctouSkipped < 1;
  const artifactBound = execution.scannerImage === resourceAbusePolicy.image
    && execution.scriptDigest === resourceAbuseScriptDigest()
    && execution.mountedPolicyDigest === resourceAbusePolicyFileDigest()
    && execution.gatewayDigest === resourceAbuseGatewayDigest()
    && execution.integrityModuleDigest === resourceAbuseIntegrityDigest()
    && execution.receiptParserDigest === resourceAbuseReceiptParserDigest()
    && /^sha256:[a-f0-9]{64}$/.test(execution.journalDigest ?? "")
    && /^sha256:[a-f0-9]{64}$/.test(execution.integrityEvidenceDigest ?? "");
  const integrityFailed = execution.competingWrites.successful > 1
    || !observedBreaker.tripped && competingObserved && competingIncomplete
    || execution.competingWrites.partialOperations !== 0
    || execution.competingWrites.duplicateBookings > 1 || execution.competingWrites.duplicateFailures !== 0
    || !observedBreaker.tripped && duplicateObserved && duplicateIncomplete
    || execution.competingWrites.toctouCreated > 0
    || !observedBreaker.tripped && toctouObserved && toctouIncomplete
    || observedSafetyViolation.violated
    || integrityOutcomes.includes("failed")
    || execution.scenarios.some(({ outcome }) => outcome === "failed")
    || recoveryOutcomes.includes("failed");
  const incomplete = !execution.runtimeHardened || !artifactBound || !breakerConsistent || !safetyConsistent
    || observedBreaker.tripped
    || execution.samples.length === 0 || competingIncomplete || duplicateIncomplete || toctouIncomplete
    || execution.requestCount < 1 || execution.requestCount > context.maxRequests
    || execution.generatedDataMegabytes > plan.budgets.generatedDataMegabytes
    || execution.scenarios.some(({ outcome }) => outcome === "incomplete")
    || recoveryOutcomes.includes("incomplete")
    || integrityOutcomes.some((phase) => phase !== "passed")
    || !execution.stateBefore || !execution.stateAfter || !execution.stateAfterCleanup || !execution.stateAfterRecovery;
  const outcome = integrityFailed ? "failed" : incomplete ? "incomplete" : "passed";
  const evidence = {
    schemaVersion: 2,
    testIds: ["CSA-RES-001"],
    targetFingerprint: plan.targetFingerprint,
    image: resourceAbusePolicy.image,
    policyDigest: resourceAbusePolicyDigest(),
    policyFileDigest: execution.mountedPolicyDigest,
    scriptDigest: execution.scriptDigest,
    gatewayDigest: execution.gatewayDigest,
    integrityModuleDigest: execution.integrityModuleDigest ?? null,
    receiptParserDigest: execution.receiptParserDigest ?? null,
    journalDigest: execution.journalDigest ?? null,
    integrityEvidenceDigest: execution.integrityEvidenceDigest ?? null,
    attempt: context.attempt,
    scenarios: execution.scenarios,
    samples: execution.samples,
    circuitBreaker: observedBreaker,
    safetyLimitViolation: observedSafetyViolation,
    stateBefore: execution.stateBefore ?? null,
    stateAfter: execution.stateAfter ?? null,
    stateAfterCleanup: execution.stateAfterCleanup ?? null,
    stateAfterRecovery: execution.stateAfterRecovery ?? null,
    integrity,
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
