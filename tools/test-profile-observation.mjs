import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ciJobsForProfiles, loadProfileContract, localTasksForProfiles } from "./test-profile-contract.mjs";

const contract = JSON.parse(readFileSync(
  new URL("../ci/test-profile-observation.json", import.meta.url), "utf8"));
const profileContract = loadProfileContract();
const controlledJobs = profileContract.ciJobOrder;
const outcomes = new Set(["success", "failure", "cancelled", "timed_out", "action_required", "neutral",
  "skipped", "startup_failure", "stale"]);
const failureOutcomes = new Set(["failure", "timed_out", "startup_failure"]);
const utcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validatePlan(plan) {
  const profiles = plan?.schemaVersion === 4 ? plan.proposedProfiles : plan?.profiles;
  const fingerprint = plan?.schemaVersion === 4 ? plan.proposedPolicyFingerprint : plan?.policyFingerprint;
  if (plan === null || typeof plan !== "object" || Array.isArray(plan) || ![3, 4].includes(plan.schemaVersion)
      || !Number.isSafeInteger(plan.runId) || plan.runId < 1
      || !Number.isSafeInteger(plan.attempt) || plan.attempt < 1
      || !/^[a-f0-9]{40}$/.test(plan.baseCommit) || !/^[a-f0-9]{40}$/.test(plan.headCommit)
      || !/^[a-f0-9]{64}$/.test(fingerprint)
      || !Array.isArray(profiles) || profiles.length < 1
      || profiles.some((profile) => !Object.hasOwn(profileContract.profiles, profile))) {
    throw new Error("Profile plan is invalid");
  }
  const expectedFields = new Set(plan.schemaVersion === 4
    ? ["schemaVersion", "runId", "attempt", "baseCommit", "headCommit", "activePolicyFingerprint",
      "proposedPolicyFingerprint", "admissionOutcome", "overrideOutcome", "plannerOutcome",
      "activeProfiles", "proposedProfiles", "activeCiJobs", "proposedCiJobs", "activeLocalTasks",
      "proposedLocalTasks", "isFull", "reasons"]
    : ["schemaVersion", "runId", "attempt", "baseCommit", "headCommit", "policyFingerprint",
      "plannerOutcome", "profiles", "isFull", "reasons"]);
  if (Object.keys(plan).some((field) => !expectedFields.has(field))) throw new Error("Profile plan has unknown fields");
  const activeProfiles = plan.schemaVersion === 4 ? plan.activeProfiles : plan.profiles;
  if (plan.isFull !== activeProfiles.includes("full") || new Set(profiles).size !== profiles.length
      || !Array.isArray(activeProfiles) || activeProfiles.length < 1
      || new Set(activeProfiles).size !== activeProfiles.length
      || activeProfiles.some((profile) => !Object.hasOwn(profileContract.profiles, profile))) {
    throw new Error("Profile plan selection is inconsistent");
  }
  if (!Array.isArray(plan.reasons) || plan.reasons.length < 1 || plan.reasons.length > 1000
      || plan.reasons.some((reason) => reason === null || typeof reason !== "object" || Array.isArray(reason)
        || Object.keys(reason).some((field) => !new Set(["code", "path", "profile", "status"]).has(field))
        || typeof reason.code !== "string" || reason.code.length < 1 || reason.code.length > 300
        || (reason.path !== null && (typeof reason.path !== "string" || reason.path.length > 1000))
        || !Object.hasOwn(profileContract.profiles, reason.profile)
        || (reason.status !== null && (typeof reason.status !== "string" || reason.status.length > 5)))) {
    throw new Error("Profile plan reasons are invalid");
  }
  if (plan.plannerOutcome !== "passed" && plan.plannerOutcome !== "failed") {
    throw new Error("Profile plan outcome is invalid");
  }
  if (plan.plannerOutcome === "passed" && plan.reasons.some((reason) => reason.code === "classifier-error")) {
    throw new Error("Passed profile plan outcome is invalid");
  }
  if (plan.plannerOutcome === "failed" && (activeProfiles.length !== 1 || activeProfiles[0] !== "full"
      || plan.reasons.length !== 1 || plan.reasons[0].code !== "classifier-error"
      || plan.reasons[0].path !== null || plan.reasons[0].profile !== "full"
      || plan.reasons[0].status !== null)) {
    throw new Error("Failed profile planning did not select the closed fallback");
  }
  if (plan.schemaVersion === 4) {
    const expectedActiveJobs = ciJobsForProfiles(profileContract, plan.activeProfiles);
    const expectedProposedJobs = ciJobsForProfiles(profileContract, plan.proposedProfiles);
    const expectedActiveTasks = localTasksForProfiles(profileContract, plan.activeProfiles);
    const expectedProposedTasks = localTasksForProfiles(profileContract, plan.proposedProfiles)
      .map((task) => task.label);
    const isAdmitted = plan.admissionOutcome === "matched" && plan.overrideOutcome === "admitted";
    if (!same(plan.activeCiJobs, expectedActiveJobs)
        || !same(plan.proposedCiJobs, expectedProposedJobs)
        || !same(plan.activeLocalTasks, expectedActiveTasks)
        || !same(plan.proposedLocalTasks, expectedProposedTasks)
        || !["matched", "missing", "stale", "invalid"].includes(plan.admissionOutcome)
        || !["admitted", "emergency-full", "invalid-full"].includes(plan.overrideOutcome)
        || (plan.admissionOutcome === "matched"
          ? plan.activePolicyFingerprint !== plan.proposedPolicyFingerprint
          : plan.activePolicyFingerprint !== null)
        || (isAdmitted ? !same(plan.activeProfiles, plan.proposedProfiles)
          : !same(plan.activeProfiles, ["full"]))) {
      throw new Error("Admitted profile coverage is invalid");
    }
  }
}

function actualControlledJobs(timing) {
  if (!Array.isArray(timing.jobs)) throw new Error("Timing jobs are invalid");
  const selected = timing.jobs.filter((job) => controlledJobs.includes(job.name));
  if (selected.length !== controlledJobs.length
      || new Set(selected.map((job) => job.name)).size !== controlledJobs.length
      || selected.some((job) => !outcomes.has(job.outcome))) {
    throw new Error("The full observation jobs are incomplete");
  }
  return selected.map(({ name, outcome }) => ({ name, outcome }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function createProfileObservation(plan, timing) {
  validatePlan(plan);
  if (timing === null || typeof timing !== "object" || timing.event !== "pull_request"
      || timing.isFirstAttempt !== (timing.attempt === 1)) {
    throw new Error("Profile observation first-attempt identity is inconsistent");
  }
  if (plan.runId !== timing.runId || plan.attempt !== timing.attempt || plan.headCommit !== timing.commit) {
    throw new Error("Profile plan and timing identity do not match");
  }
  const proposedProfiles = plan.schemaVersion === 4 ? plan.proposedProfiles : plan.profiles;
  const proposedJobs = uniqueSorted(ciJobsForProfiles(profileContract, proposedProfiles));
  const actualJobs = actualControlledJobs(timing);
  const jobsOutsideProposal = controlledJobs.filter((job) => !proposedJobs.includes(job));
  const failuresOutsideProposal = actualJobs.filter((job) =>
    jobsOutsideProposal.includes(job.name) && failureOutcomes.has(job.outcome));
  const incompleteJobs = actualJobs.filter((job) => proposedJobs.includes(job.name)
    ? job.outcome !== "success"
    : job.outcome !== "success" && job.outcome !== "skipped" && !failureOutcomes.has(job.outcome));
  return {
    schemaVersion: plan.schemaVersion === 4 ? 2 : 1,
    repository: timing.repository,
    runId: timing.runId,
    attempt: timing.attempt,
    isFirstAttempt: timing.isFirstAttempt,
    commit: timing.commit,
    startedAt: timing.startedAt,
    policyFingerprint: plan.schemaVersion === 4 ? plan.proposedPolicyFingerprint : plan.policyFingerprint,
    plannerOutcome: plan.plannerOutcome,
    proposedProfiles: [...proposedProfiles],
    ...(plan.schemaVersion === 4 ? {
      activePolicyFingerprint: plan.activePolicyFingerprint,
      admissionOutcome: plan.admissionOutcome,
      overrideOutcome: plan.overrideOutcome,
      activeProfiles: [...plan.activeProfiles],
      activeJobs: [...plan.activeCiJobs]
    } : {}),
    proposedJobs,
    actualJobs,
    jobsOutsideProposal,
    failuresOutsideProposal,
    incompleteJobs,
    classificationOutcome: timing.isFirstAttempt === false ? "rerun-not-evaluated"
      : plan.plannerOutcome === "failed" ? "classification-error"
      : failuresOutsideProposal.length > 0 ? "candidate-miss"
      : incompleteJobs.length > 0 ? "observation-incomplete" : "no-observed-miss"
  };
}

function validateObservation(observation) {
  const fields = new Set(["schemaVersion", "repository", "runId", "attempt", "isFirstAttempt", "commit",
    "startedAt", "policyFingerprint", "plannerOutcome", "activePolicyFingerprint", "admissionOutcome",
    "overrideOutcome", "activeProfiles", "activeJobs", "proposedProfiles", "proposedJobs", "actualJobs", "jobsOutsideProposal",
    "failuresOutsideProposal", "incompleteJobs", "classificationOutcome"]);
  if (observation === null || typeof observation !== "object" || Array.isArray(observation)) {
    throw new Error("Observation is not an object");
  }
  const unknown = Object.keys(observation).filter((field) => !fields.has(field));
  if (unknown.length > 0) throw new Error(`Observation has unknown fields: ${unknown.join(", ")}`);
  if (![1, 2].includes(observation.schemaVersion)
      || !Number.isSafeInteger(observation.runId) || observation.runId < 1
      || !Number.isSafeInteger(observation.attempt) || observation.attempt < 1
      || observation.isFirstAttempt !== (observation.attempt === 1)
      || typeof observation.repository !== "string"
      || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(observation.repository)
      || !/^[a-f0-9]{40}$/.test(observation.commit)
      || !/^[a-f0-9]{64}$/.test(observation.policyFingerprint)
      || typeof observation.startedAt !== "string" || !utcTimestamp.test(observation.startedAt)
      || !Number.isFinite(Date.parse(observation.startedAt))
      || !new Set(["passed", "failed"]).has(observation.plannerOutcome)) {
    throw new Error("Observation identity is invalid");
  }
  if (!Array.isArray(observation.proposedProfiles) || observation.proposedProfiles.length < 1
      || new Set(observation.proposedProfiles).size !== observation.proposedProfiles.length
    || observation.proposedProfiles.some((profile) => !Object.hasOwn(profileContract.profiles, profile))) {
    throw new Error("Observation profiles are invalid");
  }
  const admissionFields = ["activePolicyFingerprint", "admissionOutcome", "overrideOutcome",
    "activeProfiles", "activeJobs"];
  const admissionFieldCount = admissionFields.filter((field) => Object.hasOwn(observation, field)).length;
  if ((observation.schemaVersion === 2 && admissionFieldCount !== admissionFields.length)
      || (observation.schemaVersion === 1 && admissionFieldCount !== 0)) {
    throw new Error("Observation active coverage is incomplete");
  }
  const hasAdmission = admissionFieldCount === admissionFields.length;
  if (hasAdmission && ((observation.activePolicyFingerprint !== null
        && !/^[a-f0-9]{64}$/.test(observation.activePolicyFingerprint))
      || !["matched", "missing", "stale", "invalid"].includes(observation.admissionOutcome)
      || !["admitted", "emergency-full", "invalid-full"].includes(observation.overrideOutcome)
      || !Array.isArray(observation.activeProfiles) || observation.activeProfiles.length < 1
      || observation.activeProfiles.some((profile) => !Object.hasOwn(profileContract.profiles, profile))
      || new Set(observation.activeProfiles).size !== observation.activeProfiles.length
      || !same(observation.activeJobs,
        ciJobsForProfiles(profileContract, observation.activeProfiles))
      || (observation.admissionOutcome === "matched"
        ? observation.activePolicyFingerprint !== observation.policyFingerprint
        : observation.activePolicyFingerprint !== null)
      || (observation.admissionOutcome === "matched" && observation.overrideOutcome === "admitted"
        ? !same(observation.activeProfiles, observation.proposedProfiles)
        : !same(observation.activeProfiles, ["full"])))) {
    throw new Error("Observation active coverage is invalid");
  }
  if (observation.plannerOutcome === "failed"
      && (observation.proposedProfiles.length !== 1 || observation.proposedProfiles[0] !== "full")) {
    throw new Error("Observation classifier fallback is invalid");
  }
  const expectedProposed = uniqueSorted(ciJobsForProfiles(profileContract, observation.proposedProfiles));
  const expectedOutside = controlledJobs.filter((job) => !expectedProposed.includes(job));
  if (JSON.stringify(observation.proposedJobs) !== JSON.stringify(expectedProposed)
      || JSON.stringify(observation.jobsOutsideProposal) !== JSON.stringify(expectedOutside)) {
    throw new Error("Observation proposed coverage is inconsistent");
  }
  const actual = actualControlledJobs({ jobs: observation.actualJobs });
  if (JSON.stringify(observation.actualJobs) !== JSON.stringify(actual)) {
    throw new Error("Observation actual jobs are inconsistent");
  }
  const expectedFailures = actual.filter((job) =>
    expectedOutside.includes(job.name) && failureOutcomes.has(job.outcome));
  if (JSON.stringify(observation.failuresOutsideProposal) !== JSON.stringify(expectedFailures)) {
    throw new Error("Observation failures outside the proposal are inconsistent");
  }
  const expectedIncomplete = actual.filter((job) => expectedProposed.includes(job.name)
    ? job.outcome !== "success"
    : job.outcome !== "success" && job.outcome !== "skipped" && !failureOutcomes.has(job.outcome));
  if (JSON.stringify(observation.incompleteJobs) !== JSON.stringify(expectedIncomplete)) {
    throw new Error("Observation incomplete jobs are inconsistent");
  }
  const validOutcome = observation.isFirstAttempt === false
    ? observation.classificationOutcome === "rerun-not-evaluated"
    : observation.plannerOutcome === "failed"
      ? observation.classificationOutcome === "classification-error"
    : expectedFailures.length > 0
      ? observation.classificationOutcome === "candidate-miss"
    : expectedIncomplete.length > 0
      ? observation.classificationOutcome === "observation-incomplete"
      : observation.classificationOutcome === "no-observed-miss";
  if (!validOutcome) {
    throw new Error("Observation classification outcome is inconsistent");
  }
}

export function createObservationInventory(pages, repository, windowStartedAt, windowEndedAt) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 1000
      || typeof repository !== "string"
      || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)
      || !utcTimestamp.test(windowStartedAt) || !utcTimestamp.test(windowEndedAt)
      || Date.parse(windowStartedAt) >= Date.parse(windowEndedAt)) {
    throw new Error("Observation inventory input is invalid");
  }
  const runs = pages.flatMap((page) => {
    if (page === null || typeof page !== "object" || Array.isArray(page)
        || !Number.isSafeInteger(page.total_count) || page.total_count < 0
        || !Array.isArray(page.workflow_runs) || page.workflow_runs.length > 100) {
      throw new Error("GitHub workflow run inventory is invalid");
    }
    return page.workflow_runs;
  });
  if (new Set(runs.map((run) => run?.id)).size !== runs.length) {
    throw new Error("GitHub workflow run inventory contains duplicates");
  }
  for (const run of runs) {
    if (run === null || typeof run !== "object" || Array.isArray(run)
        || !Number.isSafeInteger(run.id) || run.id < 1 || run.event !== "pull_request"
        || run.status !== "completed" || !/^[a-f0-9]{40}$/.test(run.head_sha)
        || typeof run.created_at !== "string" || !utcTimestamp.test(run.created_at)
        || !Number.isFinite(Date.parse(run.created_at))) {
      throw new Error("GitHub workflow run inventory is invalid");
    }
  }
  const fetchedCount = runs.length;
  const totalCount = Math.max(...pages.map((page) => page.total_count));
  const oldestFetched = Math.min(...runs.map((run) => Date.parse(run.created_at)));
  if (fetchedCount < totalCount && oldestFetched > Date.parse(windowStartedAt)) {
    throw new Error("GitHub workflow run inventory is incomplete for the requested window");
  }
  const firstAttempts = runs.filter((run) => Date.parse(run.created_at) >= Date.parse(windowStartedAt)
      && Date.parse(run.created_at) <= Date.parse(windowEndedAt))
    .map((run) => ({ runId: run.id, commit: run.head_sha }))
    .sort((left, right) => left.runId - right.runId);
  return {
    schemaVersion: 2,
    repository,
    windowStartedAt,
    windowEndedAt,
    requiredBaseCommit: contract.requiredBaseCommit,
    firstAttempts,
    incompatibleFirstAttempts: []
  };
}

function validateInventory(inventory) {
  const fields = new Set(["schemaVersion", "repository", "windowStartedAt", "windowEndedAt",
    "requiredBaseCommit", "firstAttempts", "incompatibleFirstAttempts"]);
  if (inventory === null || typeof inventory !== "object" || Array.isArray(inventory)
      || Object.keys(inventory).some((field) => !fields.has(field)) || inventory.schemaVersion !== 2
      || typeof inventory.repository !== "string"
      || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(inventory.repository)
      || !utcTimestamp.test(inventory.windowStartedAt) || !utcTimestamp.test(inventory.windowEndedAt)
      || Date.parse(inventory.windowStartedAt) >= Date.parse(inventory.windowEndedAt)
      || inventory.requiredBaseCommit !== contract.requiredBaseCommit
      || !Array.isArray(inventory.firstAttempts) || inventory.firstAttempts.length > 10_000
      || !Array.isArray(inventory.incompatibleFirstAttempts)
      || inventory.incompatibleFirstAttempts.length > 10_000) {
    throw new Error("Observation inventory is invalid");
  }
  const expectedFields = new Set(["runId", "commit"]);
  if (inventory.firstAttempts.some((entry) => entry === null || typeof entry !== "object" || Array.isArray(entry)
      || Object.keys(entry).some((field) => !expectedFields.has(field))
      || !Number.isSafeInteger(entry.runId) || entry.runId < 1 || !/^[a-f0-9]{40}$/.test(entry.commit))
      || new Set(inventory.firstAttempts.map((entry) => entry.runId)).size !== inventory.firstAttempts.length) {
    throw new Error("Observation inventory attempts are invalid");
  }
  const incompatibleFields = new Set(["runId", "commit", "baseCommit"]);
  if (inventory.incompatibleFirstAttempts.some((entry) => entry === null || typeof entry !== "object"
      || Array.isArray(entry) || Object.keys(entry).some((field) => !incompatibleFields.has(field))
      || !Number.isSafeInteger(entry.runId) || entry.runId < 1
      || !/^[a-f0-9]{40}$/.test(entry.commit) || !/^[a-f0-9]{40}$/.test(entry.baseCommit))
      || new Set(inventory.incompatibleFirstAttempts.map((entry) => entry.runId)).size
        !== inventory.incompatibleFirstAttempts.length
      || inventory.incompatibleFirstAttempts.some((entry) =>
        inventory.firstAttempts.some((compatible) => compatible.runId === entry.runId))) {
    throw new Error("Incompatible observation inventory attempts are invalid");
  }
}

export function summarizeProfileObservations(observations, inventory) {
  if (!Array.isArray(observations) || observations.length < 1 || observations.length > 10_000) {
    throw new Error("Observation summary input is invalid");
  }
  validateInventory(inventory);
  for (const observation of observations) validateObservation(observation);
  const identities = observations.map((entry) => `${entry.runId}:${entry.attempt}`);
  if (new Set(identities).size !== identities.length) throw new Error("Observations contain duplicate attempts");
  if (observations.some((entry) => entry.repository !== inventory.repository)) {
    throw new Error("Observation repository does not match the inventory");
  }
  const policies = new Set(observations.map((entry) => entry.policyFingerprint));
  if (policies.size !== 1) throw new Error("Observations mix test profile policy versions");
  const firstAttempts = observations.filter((entry) => entry.isFirstAttempt);
  const observedFirstAttempts = firstAttempts.map((entry) => ({ runId: entry.runId, commit: entry.commit }))
    .sort((left, right) => left.runId - right.runId);
  const expectedFirstAttempts = [...inventory.firstAttempts].sort((left, right) => left.runId - right.runId);
  if (JSON.stringify(observedFirstAttempts) !== JSON.stringify(expectedFirstAttempts)
      || observations.some((entry) => !expectedFirstAttempts.some((expected) =>
        expected.runId === entry.runId && expected.commit === entry.commit))) {
    throw new Error("Observation records do not cover the exact inventory");
  }
  const qualifyingAttempts = firstAttempts.filter((entry) =>
    entry.classificationOutcome !== "observation-incomplete"
      && entry.classificationOutcome !== "classification-error");
  if (observations.some((entry) => Date.parse(entry.startedAt) < Date.parse(inventory.windowStartedAt)
      || Date.parse(entry.startedAt) > Date.parse(inventory.windowEndedAt))) {
    throw new Error("Assessment time precedes observation evidence");
  }
  const windowDays = Math.floor((Date.parse(inventory.windowEndedAt)
    - Date.parse(inventory.windowStartedAt)) / 86_400_000);
  const candidateMissCount = firstAttempts.filter((entry) => entry.classificationOutcome === "candidate-miss").length;
  const classificationErrorCount = firstAttempts.filter((entry) =>
    entry.classificationOutcome === "classification-error").length;
  const naturalReducedProposals = qualifyingAttempts.filter((entry) => !entry.proposedProfiles.includes("full"));
  const actuallyReducedAttempts = naturalReducedProposals.filter((entry) => entry.jobsOutsideProposal.length > 0
    && entry.jobsOutsideProposal.every((name) =>
      entry.actualJobs.some((job) => job.name === name && job.outcome === "skipped")));
  const fullProposalCount = qualifyingAttempts.length - naturalReducedProposals.length;
  const proposedProfileCounts = Object.fromEntries(Object.keys(profileContract.profiles).map((profile) => [profile,
    profile === "full" ? fullProposalCount
      : naturalReducedProposals.filter((entry) => entry.proposedProfiles.includes(profile)).length]));
  const incompleteObservationCount = firstAttempts.filter((entry) =>
    entry.classificationOutcome === "observation-incomplete").length;
  const enoughEvidence = qualifyingAttempts.length >= contract.minimumFirstAttempts
    && naturalReducedProposals.length >= contract.minimumNaturalReducedProposals
    && contract.requiredNaturalProfiles.every((profile) => proposedProfileCounts[profile] > 0)
    && windowDays >= contract.minimumDays;
  return {
    sampleSize: qualifyingAttempts.length,
    repository: inventory.repository,
    policyFingerprint: [...policies][0],
    windowStartedAt: inventory.windowStartedAt,
    observedFirstAttemptCount: firstAttempts.length,
    rerunCount: observations.length - firstAttempts.length,
    windowDays,
    fullProposalCount,
    naturalReducedProfileCount: naturalReducedProposals.length,
    actualReducedProfileCount: actuallyReducedAttempts.length,
    actualFullProfileRate: qualifyingAttempts.length === 0 ? null
      : Math.round((qualifyingAttempts.length - actuallyReducedAttempts.length)
        / qualifyingAttempts.length * 10_000) / 10_000,
    proposedProfileCounts,
    candidateMissCount,
    classificationErrorCount,
    incompleteObservationCount,
    incompatibleBaseCount: inventory.incompatibleFirstAttempts.length,
    assessedAt: inventory.windowEndedAt,
    limitations: [
      "Observations cover GitHub-hosted pull-request runs only.",
      "Successful shadow evidence proves required jobs and exposes failures outside the proposal, not saved work.",
      "Candidate misses require rule correction and a new qualifying observation window."
    ],
    status: candidateMissCount > 0 || classificationErrorCount > 0 ? "under-classification-observed"
      : enoughEvidence ? "ready-for-review" : "collecting"
  };
}

export function profileObservationReport(summary) {
  const rate = summary.actualFullProfileRate === null ? "not available"
    : `${(summary.actualFullProfileRate * 100).toFixed(2)}%`;
  return [
    "# Test profile observation",
    "",
    `- Status: ${summary.status}`,
    `- Repository: ${summary.repository}`,
    `- Policy fingerprint: ${summary.policyFingerprint}`,
    `- Window start: ${summary.windowStartedAt}`,
    `- First-attempt sample: ${summary.sampleSize}`,
    `- First attempts observed: ${summary.observedFirstAttemptCount}`,
    `- Reruns excluded: ${summary.rerunCount}`,
    `- Observation window: ${summary.windowDays} days`,
    `- Actual full-profile rate: ${rate}`,
    `- Natural reduced-profile proposals: ${summary.naturalReducedProfileCount}`,
    `- Actually reduced first attempts: ${summary.actualReducedProfileCount}`,
    `- Backend-profile first attempts: ${summary.proposedProfileCounts.backend}`,
    `- Frontend-profile first attempts: ${summary.proposedProfileCounts.frontend}`,
    `- Tooling-profile first attempts: ${summary.proposedProfileCounts.tooling}`,
    `- Candidate misses: ${summary.candidateMissCount}`,
    `- Classification errors: ${summary.classificationErrorCount}`,
    `- Incomplete observations excluded: ${summary.incompleteObservationCount}`,
    `- Incompatible-base first attempts excluded: ${summary.incompatibleBaseCount}`,
    "",
    "## Limitations",
    "",
    ...summary.limitations.map((limitation) => `- ${limitation}`),
    ""
  ].join("\n");
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

function main() {
  if (process.argv.includes("--observations")) {
    const observations = JSON.parse(readFileSync(resolve(argument("--observations")), "utf8"));
    const repository = argument("--repository");
    const windowStartedAt = argument("--window-start");
    const assessedAt = argument("--assessed-at");
    const pages = JSON.parse(readFileSync(resolve(argument("--github-runs")), "utf8"));
    const inventory = createObservationInventory(pages, repository, windowStartedAt, assessedAt);
    const aggregate = summarizeProfileObservations(observations, inventory);
    const output = resolve(argument("--output"));
    const summary = resolve(argument("--summary"));
    const inventoryOutput = resolve(argument("--inventory-output"));
    mkdirSync(dirname(output), { recursive: true });
    mkdirSync(dirname(summary), { recursive: true });
    mkdirSync(dirname(inventoryOutput), { recursive: true });
    writeFileSync(output, `${JSON.stringify(aggregate, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(summary, profileObservationReport(aggregate), { mode: 0o600 });
    writeFileSync(inventoryOutput, `${JSON.stringify(inventory, null, 2)}\n`, { mode: 0o600 });
    return;
  }
  const plan = JSON.parse(readFileSync(resolve(argument("--plan")), "utf8"));
  const timing = JSON.parse(readFileSync(resolve(argument("--timing")), "utf8"));
  const observation = createProfileObservation(plan, timing);
  const output = resolve(argument("--output"));
  const summary = resolve(argument("--summary"));
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(dirname(summary), { recursive: true });
  writeFileSync(output, `${JSON.stringify(observation, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(summary,
    `## Observed test profiles\n\n- Proposed: ${observation.proposedProfiles.join(", ")}\n`
    + `- Jobs outside proposal: ${observation.jobsOutsideProposal.join(", ") || "none"}\n`
    + `- Failures outside proposal: ${observation.failuresOutsideProposal.length}\n`
    + `- Classification result: ${observation.classificationOutcome}\n`,
    { mode: 0o600 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
