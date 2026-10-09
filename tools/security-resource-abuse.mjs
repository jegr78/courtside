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
    "security-resource-abuse.mjs",
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

const admissionProblemTypes = ["urn:courtside:error:request-rate-limited",
  "urn:courtside:error:operation-capacity-exhausted"];
const raceScenarios = ["competing-court-occupancy", "duplicate-delivery", "participant-capacity"];
const integrityScenarios = [...raceScenarios, "preview-mutation-race"];

function admissionRefusal(operation) {
  return operation.status === 429 && admissionProblemTypes.includes(operation.problemType)
    && Number.isSafeInteger(operation.retryAfterSeconds) && operation.retryAfterSeconds >= 1;
}

function escaped(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scenarioOperations(operations, runId) {
  const id = escaped(runId);
  const keyed = (pattern) => operations.filter((operation) => operation.kind === "createBooking"
    && pattern.test(operation.request?.idempotencyKey ?? ""));
  return {
    "competing-court-occupancy": keyed(new RegExp(`^security-${id}-\\d+-\\d+$`)),
    "duplicate-delivery": keyed(new RegExp(`^security-${id}-duplicate$`)),
    "participant-capacity": keyed(new RegExp(`^security-capacity-${id}-\\d+-\\d+$`)),
    "preview-mutation-race": [...keyed(new RegExp(`^security-${id}-toctou$`)), ...operations.filter((operation) =>
      operation.kind === "createSeries"
      || operation.kind === "previewSeries" && operation.request?.occurrenceCount === 1)],
    "series-and-rule-cost": operations.filter((operation) => operation.kind === "previewSeries"
      && operation.request?.occurrenceCount === 200)
  };
}

function raceExercised(operations) {
  const answered = operations.filter((operation) => operation.status !== 429)
    .map((operation) => [Date.parse(operation.startedAt), Date.parse(operation.endedAt)])
    .toSorted(([left], [right]) => left - right);
  let latestEnd = -Infinity;
  for (const [startedAt, endedAt] of answered) {
    if (startedAt < latestEnd) return true;
    latestEnd = Math.max(latestEnd, endedAt);
  }
  return false;
}

export function resourceAdmissionPolicy(runtime, application) {
  const overrides = (runtime?.Config?.Env ?? []).filter((entry) =>
    /^COURTSIDE_(?:ADMISSION|LOGIN)_/.test(String(entry).split("=")[0]));
  if (overrides.length) throw new Error("The assessed target overrides shipped admission or login defaults");
  return { enforced: application?.courtside?.admission != null };
}

export function resourceCompetingWrites(operations, runId, validatedBookingIdHashes) {
  const newBooking = (operation) => operation.status === 201 && typeof operation.responseBookingId === "string"
    && validatedBookingIdHashes.has(`sha256:${createHash("sha256")
      .update(JSON.stringify(operation.responseBookingId)).digest("hex")}`);
  const byScenario = scenarioOperations(operations, runId);
  const competition = byScenario["competing-court-occupancy"];
  const duplicates = byScenario["duplicate-delivery"];
  const series = operations.filter((operation) => operation.kind === "createSeries");
  return {
    successful: new Set(competition.filter(newBooking).map((operation) => operation.responseBookingId)).size,
    rejected: competition.filter((operation) => [409, 422].includes(operation.status)).length,
    partialOperations: competition.filter((operation) => ![201, 409, 422].includes(operation.status)
      && !admissionRefusal(operation)).length,
    duplicateBookings: new Set(duplicates.filter(newBooking).map((operation) => operation.responseBookingId)).size,
    duplicateResponses: duplicates.filter(newBooking).length,
    duplicateFailures: duplicates.filter((operation) => !newBooking(operation) && !admissionRefusal(operation)).length,
    toctouCreated: series.reduce((count, operation) => count + (operation.seriesResult?.bookingIds?.length ?? 0), 0),
    toctouSkipped: series.reduce((count, operation) => count + (operation.seriesResult?.skipped?.length ?? 0), 0),
    admissionRefused: integrityScenarios.flatMap((id) => byScenario[id]).filter(admissionRefusal).length
  };
}

export function resourceScenarioOutcomes({ scenarios, summary, telemetryComplete, failed, operations, runId,
  admissionEnforced }) {
  const byScenario = scenarioOperations(operations ?? [], runId);
  return scenarios.map(({ id, checks: requiredChecks }) => {
    const checks = summary?.checks?.filter(({ name }) => name.startsWith(`${id}:`)) ?? [];
    const observedNames = new Set(checks.map(({ name }) => name));
    const missingCheck = requiredChecks.some((name) => !observedNames.has(`${id}:${name}`));
    const fixtureFailed = checks.some(({ name, fails }) => name.endsWith(":fixtures-ready") && fails > 0);
    const assertionFailed = checks.some(({ name, fails }) => !name.endsWith(":fixtures-ready") && fails > 0);
    const scenarioOperationsOf = byScenario[id] ?? [];
    const refused = integrityScenarios.includes(id) && scenarioOperationsOf.some(admissionRefusal);
    const raceMissing = raceScenarios.includes(id) && !raceExercised(scenarioOperationsOf);
    const pressureUnrefused = id === "admission-pressure" && admissionEnforced
      && !(summary?.addressAdmissionRefusals > 0);
    const outcome = missingCheck || fixtureFailed || !telemetryComplete || failed ? "incomplete"
      : assertionFailed ? "failed"
        : id === "login-rate-limit-boundary" && !summary.rateLimitedLogins
          || refused || raceMissing || pressureUnrefused ? "incomplete" : "passed";
    return { id, outcome };
  });
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
  const warmUp = execution.warmUp ?? { settled: false, durationSeconds: 0, samples: [] };
  const warmUpSafetyViolation = evaluateSafetyLimits(warmUp.samples, resourceAbusePolicy.circuitBreakers);
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
    || observedSafetyViolation.violated || warmUpSafetyViolation.violated
    || integrityOutcomes.includes("failed")
    || execution.scenarios.some(({ outcome }) => outcome === "failed")
    || recoveryOutcomes.includes("failed");
  const incomplete = !execution.runtimeHardened || !artifactBound || !breakerConsistent || !safetyConsistent
    || observedBreaker.tripped
    || execution.samples.length === 0 || competingIncomplete || duplicateIncomplete || toctouIncomplete
    || execution.requestCount < 1 || execution.requestCount > context.maxRequests
    || execution.generatedDataMegabytes > plan.budgets.generatedDataMegabytes
    || execution.scenarios.some(({ outcome }) => outcome === "incomplete")
    || execution.competingWrites.admissionRefused > 0
    || recoveryOutcomes.includes("incomplete")
    || integrityOutcomes.some((phase) => phase !== "passed")
    || !execution.stateBefore || !execution.stateAfter || !execution.stateAfterCleanup || !execution.stateAfterRecovery;
  const outcome = integrityFailed ? "failed" : incomplete ? "incomplete" : "passed";
  const evidence = {
    schemaVersion: 3,
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
    warmUp,
    warmUpSafetyLimitViolation: warmUpSafetyViolation,
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
