import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const contractUrl = new URL("../ci/test-profile-contract.json", import.meta.url);

export const semanticPolicySources = [
  "ci/test-profile-contract.json",
  "ci/node-toolchain.json",
  "ci/github-profile-manifest.json",
  "ci/test-profiles.json",
  "ci/tool-profile-manifest.json",
  "frontend/package.json",
  "ci/test-profile-plan.schema.json",
  "ci/test-profile-observation.json",
  "ci/test-profile-observation.schema.json",
  "ci/test-profile-observation-summary.schema.json",
  "ci/test-profile-observation-inventory.schema.json",
  "quality/local-profile-timing.schema.json",
  "quality/local-profile-timing-policy.json",
  ".github/workflows/build.yml",
  ".github/workflows/ci-timing.yml",
  ".github/workflows/profile-evidence.yml",
  "tools/test-profile-contract.mjs",
  "tools/docs-check.mjs",
  "tools/github-metadata.test.mjs",
  "tools/github-template-metadata.test.mjs",
  "tools/test-profile-classifier.mjs",
  "tools/local-check.mjs",
  "tools/local-profile-timing.mjs",
  "tools/node-toolchain.mjs",
  "tools/tool-tests.mjs",
  "tools/workflow-action-pinning.test.mjs",
  "tools/test-profile-observation.mjs",
  "tools/test-profile-replay.mjs",
  "tools/ci-timing.mjs",
  "tools/ci-workflow-run.mjs",
  "tools/ci-base-provenance.mjs",
  "ci/ci-timing.schema.json"
];

export function loadProfileContract() {
  const contract = JSON.parse(readFileSync(contractUrl, "utf8"));
  validateContract(contract);
  return contract;
}

export function ciJobsForProfiles(contract, profiles) {
  return coverageForProfiles(contract, profiles, "ciJobs", (value) => value);
}

export function localTasksForProfiles(contract, profiles) {
  const labels = coverageForProfiles(contract, profiles, "localTasks", (value) => value);
  return labels.map((label) => ({ label, ...structuredClone(contract.localTaskDefinitions[label]) }));
}

export function activeProfileDecision(proposedProfiles, fingerprint, admission, mode,
    assessedOn = new Date().toISOString().slice(0, 10)) {
  const validAdmission = validateAdmissionRecord(admission, assessedOn, false);
  const admissionOutcome = admission === null ? "missing"
    : !validAdmission ? "invalid"
    : admission.schemaVersion === 3 && admission.admittedPolicyFingerprint === fingerprint ? "matched" : "stale";
  const overrideOutcome = mode === "full" ? "emergency-full"
    : mode === "admitted" ? "admitted" : "invalid-full";
  return {
    activeProfiles: admissionOutcome === "matched" && overrideOutcome === "admitted"
      ? [...proposedProfiles] : ["full"],
    admissionOutcome,
    overrideOutcome
  };
}

export function validateAdmissionRecord(admission, assessedOn = new Date().toISOString().slice(0, 10),
    throwOnInvalid = true) {
  const evidence = admission?.evidence;
  const schemaVersion = admission?.schemaVersion;
  const evidenceFields = schemaVersion === 1 ? 12 : schemaVersion === 2 ? 13 : schemaVersion === 3 ? 18 : -1;
  const valid = admission !== null && typeof admission === "object" && !Array.isArray(admission)
    && Object.keys(admission).sort().join() === ["admittedPolicyFingerprint", "evidence", "schemaVersion"].sort().join()
    && [1, 2, 3].includes(schemaVersion)
    && /^[a-f0-9]{64}$/.test(admission.admittedPolicyFingerprint ?? "")
    && evidence !== null && typeof evidence === "object" && !Array.isArray(evidence)
    && Object.keys(evidence).length === evidenceFields
    && Number.isSafeInteger(evidence.runId) && evidence.runId > 0
    && evidence.attempt === 1
    && typeof evidence.artifact === "string"
    && evidence.artifact === `profile-evidence-${evidence.runId}-${evidence.attempt}`
    && isUtcTimestamp(evidence.assessedAt)
    && isCalendarDate(evidence.assessedAt.slice(0, 10))
    && isCalendarDate(evidence.expiresOn)
    && evidence.status === "ready-for-review"
    && isCalendarDate(assessedOn)
    && evidence.assessedAt.slice(0, 10) <= assessedOn
    && evidence.expiresOn >= evidence.assessedAt.slice(0, 10)
    && evidence.expiresOn >= assessedOn
    && ["qualifyingFirstAttempts", "backendPlans", "frontendPlans",
      ...(schemaVersion >= 2 ? ["toolingPlans"] : []), "candidateMisses",
      "classificationErrors", "incompleteObservations"]
      .every((field) => Number.isSafeInteger(evidence[field]) && evidence[field] >= 0)
    && (schemaVersion === 1 || evidence.qualifyingFirstAttempts >= 20
      && evidence.backendPlans > 0 && evidence.frontendPlans > 0 && evidence.toolingPlans > 0
      && evidence.candidateMisses === 0 && evidence.classificationErrors === 0)
    && (schemaVersion !== 3 || isUtcTimestamp(evidence.windowStartedAt)
      && isUtcTimestamp(evidence.windowEndedAt)
      && Date.parse(evidence.windowStartedAt) < Date.parse(evidence.windowEndedAt)
      && evidence.windowEndedAt === evidence.assessedAt
      && validateCiTiming(evidence.ciTiming, evidence)
      && validateLocalTiming(evidence.localTiming, admission.admittedPolicyFingerprint)
      && validateNightlies(evidence.nightlies, evidence.windowStartedAt, evidence.windowEndedAt));
  if (!valid && throwOnInvalid) throw new Error("Profile admission record is invalid or expired");
  return valid;
}

function validateCiTiming(timing, evidence) {
  const fields = ["observedFirstAttempts", "successfulFirstAttempts", "medianDurationMs", "p95DurationMs",
    "runnerMinutes", "successfulMedianDurationMs", "successfulP95DurationMs", "successfulRunnerMinutes"];
  return closedRecord(timing, fields)
    && ["observedFirstAttempts", "successfulFirstAttempts", "medianDurationMs", "p95DurationMs",
      "successfulMedianDurationMs", "successfulP95DurationMs"]
      .every((field) => Number.isSafeInteger(timing[field]) && timing[field] >= 0)
    && ["runnerMinutes", "successfulRunnerMinutes"]
      .every((field) => Number.isFinite(timing[field]) && timing[field] >= 0)
    && timing.observedFirstAttempts === evidence.qualifyingFirstAttempts + evidence.incompleteObservations
    && timing.successfulFirstAttempts === evidence.qualifyingFirstAttempts
    && timing.successfulRunnerMinutes <= timing.runnerMinutes
    && [evidence.backendPlans, evidence.frontendPlans, evidence.toolingPlans]
      .every((count) => count <= evidence.qualifyingFirstAttempts)
    && timing.p95DurationMs >= timing.medianDurationMs
    && timing.successfulP95DurationMs >= timing.successfulMedianDurationMs;
}

function validateLocalTiming(timing, fingerprint) {
  const fields = ["commit", "policyFingerprint", "status", "firstAttempts", "retries", "interruptedAttempts",
    "docs", "tooling", "backend", "frontend", "combined", "full"];
  return closedRecord(timing, fields)
    && /^[a-f0-9]{40}$/.test(timing.commit ?? "")
    && timing.policyFingerprint === fingerprint
    && timing.status === "qualified"
    && timing.firstAttempts === 18 && timing.retries === 0 && timing.interruptedAttempts === 0
    && [timing.docs, timing.tooling, timing.backend, timing.frontend, timing.combined, timing.full]
      .every(validateTimingCase)
    && timing.docs.medianMs < 30_000
    && timing.tooling.medianMs < 120_000
    && timing.full.medianMs > 0
    && timing.backend.medianMs <= timing.full.medianMs * 0.8
    && timing.frontend.medianMs <= timing.full.medianMs * 0.8;
}

function validateTimingCase(timing) {
  return closedRecord(timing, ["attempts", "medianMs", "maximumMs"])
    && timing.attempts === 3
    && Number.isSafeInteger(timing.medianMs) && timing.medianMs >= 0
    && Number.isSafeInteger(timing.maximumMs) && timing.maximumMs >= timing.medianMs;
}

function validateNightlies(nightlies, windowStartedAt, windowEndedAt) {
  const jobs = ["docs", "backend", "frontend", "tooling", "security"];
  return Array.isArray(nightlies) && nightlies.length === 2
    && new Set(nightlies.map((nightly) => nightly.runId)).size === 2
    && nightlies.every((nightly) => closedRecord(nightly,
      ["runId", "attempt", "event", "commit", "outcome", "jobs", "startedAt"])
      && Number.isSafeInteger(nightly.runId) && nightly.runId > 0
      && nightly.attempt === 1 && nightly.event === "schedule" && nightly.outcome === "success"
      && /^[a-f0-9]{40}$/.test(nightly.commit ?? "")
      && isUtcTimestamp(nightly.startedAt)
      && Date.parse(nightly.startedAt) >= Date.parse(windowStartedAt)
      && Date.parse(nightly.startedAt) <= Date.parse(windowEndedAt)
      && JSON.stringify(nightly.jobs) === JSON.stringify(jobs));
}

function closedRecord(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join() === [...fields].sort().join();
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isUtcTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && isCalendarDate(value.slice(0, 10));
}

export function profilePolicyFingerprint(sources = semanticPolicySources.map((path) =>
  fileURLToPath(new URL(`../${path}`, import.meta.url)))) {
  const hash = createHash("sha256");
  for (const source of sources) {
    const content = Buffer.from(readFileSync(source, "utf8").replaceAll("\r\n", "\n"), "utf8");
    hash.update(String(content.length));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function coverageForProfiles(contract, profiles, field, transform) {
  validateProfiles(contract, profiles);
  const effective = profiles.includes("full") ? ["full"] : profiles;
  const selected = new Set(effective.flatMap((profile) => contract.profiles[profile][field]));
  const order = field === "ciJobs" ? contract.ciJobOrder : Object.keys(contract.localTaskDefinitions);
  return order.filter((value) => selected.has(value)).map(transform);
}

function validateProfiles(contract, profiles) {
  if (!Array.isArray(profiles) || profiles.length < 1 || new Set(profiles).size !== profiles.length
      || profiles.some((profile) => !Object.hasOwn(contract.profiles, profile))) {
    throw new Error("Test profile selection is invalid");
  }
}

export function validateContract(contract) {
  const rootFields = ["schemaVersion", "profileOrder", "ciJobOrder", "profiles",
    "localTaskDefinitions", "coverageDifferences"];
  if (contract === null || typeof contract !== "object" || Array.isArray(contract)
      || contract.schemaVersion !== 1
      || Object.keys(contract).some((field) => !rootFields.includes(field))
      || JSON.stringify(contract.profileOrder) !== JSON.stringify(["docs", "backend", "frontend", "tooling", "full"])
      || JSON.stringify(contract.ciJobOrder) !== JSON.stringify(["docs", "backend", "frontend", "tooling", "security"])
      || Object.keys(contract.profiles ?? {}).length !== contract.profileOrder.length
      || Object.keys(contract.localTaskDefinitions ?? {}).length < 1
      || !Array.isArray(contract.coverageDifferences) || contract.coverageDifferences.length < 1) {
    throw new Error("Test profile contract is invalid");
  }
  const taskLabels = new Set(Object.keys(contract.localTaskDefinitions));
  for (const profile of contract.profileOrder) {
    const coverage = contract.profiles[profile];
    if (coverage === null || typeof coverage !== "object" || Array.isArray(coverage)
        || Object.keys(coverage).some((field) => !["ciJobs", "localTasks"].includes(field))
        || !Array.isArray(coverage.ciJobs) || !Array.isArray(coverage.localTasks)
        || new Set(coverage.ciJobs).size !== coverage.ciJobs.length
        || new Set(coverage.localTasks).size !== coverage.localTasks.length
        || coverage.ciJobs.some((job) => !contract.ciJobOrder.includes(job))
        || coverage.localTasks.some((task) => !taskLabels.has(task))) {
      throw new Error("Test profile coverage is invalid");
    }
  }
  if (JSON.stringify(contract.profiles.full.ciJobs) !== JSON.stringify(contract.ciJobOrder)
      || JSON.stringify(contract.profiles.full.localTasks) !== JSON.stringify(["docs-check", "full"])) {
    throw new Error("Full test profile coverage is incomplete");
  }
  for (const [label, task] of Object.entries(contract.localTaskDefinitions)) {
    if (task === null || typeof task !== "object" || Array.isArray(task)
        || Object.keys(task).some((field) => !["workingDirectory", "executable", "arguments"].includes(field))
        || !["repository", "frontend"].includes(task.workingDirectory)
        || !["maven", "node", "npm"].includes(task.executable)
        || !Array.isArray(task.arguments) || task.arguments.some((argument) => typeof argument !== "string")) {
      throw new Error(`Local task ${label} is invalid`);
    }
  }
  const full = contract.localTaskDefinitions.full;
  if (full.workingDirectory !== "repository" || full.executable !== "maven"
      || JSON.stringify(full.arguments) !== JSON.stringify(["clean", "verify"])) {
    throw new Error("Full local verification task is invalid");
  }
  for (const difference of contract.coverageDifferences) {
    if (difference === null || typeof difference !== "object" || Array.isArray(difference)
        || Object.keys(difference).length !== 3
        || typeof difference.scope !== "string" || difference.scope.length < 1
        || typeof difference.ci !== "string" || difference.ci.length < 1
        || typeof difference.local !== "string" || difference.local.length < 1) {
      throw new Error("Test profile coverage difference is invalid");
    }
  }
}
