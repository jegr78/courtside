import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  activeProfileDecision, ciJobsForProfiles, loadProfileContract, localTasksForProfiles,
  profilePolicyFingerprint, semanticPolicySources, validateContract
} from "./test-profile-contract.mjs";

test("given the repository toolchain contract, when CI and Maven install Node, then both use the exact versions", () => {
  // given
  const toolchain = JSON.parse(readFileSync(new URL("../ci/node-toolchain.json", import.meta.url), "utf8"));
  const pom = readFileSync(new URL("../pom.xml", import.meta.url), "utf8");

  // when / then
  assert.match(toolchain.node, /^\d+\.\d+\.\d+$/);
  assert.match(toolchain.npm, /^\d+\.\d+\.\d+$/);
  assert.match(pom, new RegExp(`<node\\.version>v${toolchain.node.replaceAll(".", "\\.")}<\\/node\\.version>`));
  assert.match(pom, new RegExp(`<npm\\.version>${toolchain.npm.replaceAll(".", "\\.")}<\\/npm\\.version>`));
});

test("given combined reduced profiles, when resolving coverage, then jobs and tasks form stable unions", () => {
  // given
  const contract = loadProfileContract();

  // when
  const jobs = ciJobsForProfiles(contract, ["backend", "frontend"]);
  const tasks = localTasksForProfiles(contract, ["backend", "frontend"]);

  // then
  assert.deepEqual(jobs, ["backend", "frontend", "security"]);
  assert.equal(tasks[0].label, "backend");
  assert.equal(tasks.at(-1).label, "frontend-e2e");
  assert.equal(new Set(tasks.map((task) => task.label)).size, tasks.length);
});

test("given incomplete full coverage, when validating the contract, then no admitted plan can use it", () => {
  // given
  const partialJobs = structuredClone(loadProfileContract());
  partialJobs.profiles.full.ciJobs = ["backend"];
  const reducedTopology = structuredClone(loadProfileContract());
  reducedTopology.ciJobOrder = ["backend"];
  reducedTopology.profiles.full.ciJobs = ["backend"];
  const emptyTasks = structuredClone(loadProfileContract());
  emptyTasks.profiles.full.localTasks = [];
  const weakenedCommand = structuredClone(loadProfileContract());
  weakenedCommand.localTaskDefinitions.full.arguments = ["verify"];
  const openDifference = structuredClone(loadProfileContract());
  openDifference.coverageDifferences[0].unknown = "value";

  // when / then
  assert.throws(() => validateContract(partialJobs), /full test profile coverage is incomplete/i);
  assert.throws(() => validateContract(reducedTopology), /contract is invalid/i);
  assert.throws(() => validateContract(emptyTasks), /full test profile coverage is incomplete/i);
  assert.throws(() => validateContract(weakenedCommand), /full local verification task is invalid/i);
  assert.throws(() => validateContract(openDifference), /coverage difference is invalid/i);
});

test("given any full profile, when resolving coverage, then only full coverage remains", () => {
  // given
  const contract = loadProfileContract();

  // when
  const jobs = ciJobsForProfiles(contract, ["backend", "full"]);
  const tasks = localTasksForProfiles(contract, ["frontend", "full"]);

  // then
  assert.deepEqual(jobs, ["docs", "backend", "frontend", "tooling", "security"]);
  assert.deepEqual(tasks.map((task) => task.label), ["docs-check", "full"]);
});

test("given admission and override states, when selecting active coverage, then only an exact admission reduces", () => {
  // given
  const fingerprint = "a".repeat(64);
  const evidence = qualifiedEvidence(fingerprint);

  // when / then
  assert.deepEqual(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 3, admittedPolicyFingerprint: fingerprint, evidence
  }, "admitted"), {
    activeProfiles: ["backend"], admissionOutcome: "matched", overrideOutcome: "admitted"
  });
  const { toolingPlans: _toolingPlans, ciTiming: _ciTiming, localTiming: _localTiming,
    nightlies: _nightlies, windowStartedAt: _windowStartedAt, windowEndedAt: _windowEndedAt,
    ...legacyEvidence } = evidence;
  assert.equal(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 1, admittedPolicyFingerprint: fingerprint, evidence: legacyEvidence
  }, "admitted").admissionOutcome, "stale");
  const { ciTiming: _oldCiTiming, localTiming: _oldLocalTiming,
    nightlies: _oldNightlies, windowStartedAt: _oldWindowStartedAt, windowEndedAt: _oldWindowEndedAt,
    ...versionTwoEvidence } = evidence;
  assert.equal(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 2, admittedPolicyFingerprint: fingerprint, evidence: versionTwoEvidence
  }, "admitted").admissionOutcome, "stale");
  assert.equal(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 3, admittedPolicyFingerprint: fingerprint,
    evidence: { ...evidence, toolingPlans: 0 }
  }, "admitted").admissionOutcome, "invalid");
  assert.deepEqual(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 3, admittedPolicyFingerprint: "b".repeat(64), evidence
  }, "admitted").activeProfiles, ["full"]);
  assert.equal(activeProfileDecision(["backend"], fingerprint, null, "admitted").admissionOutcome,
    "missing");
  assert.equal(activeProfileDecision(["backend"], fingerprint, {}, "admitted").admissionOutcome,
    "invalid");
  assert.equal(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 3, admittedPolicyFingerprint: fingerprint, evidence
  }, "full").overrideOutcome, "emergency-full");
  assert.equal(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 3, admittedPolicyFingerprint: fingerprint, evidence
  }, "").overrideOutcome, "invalid-full");
  assert.equal(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 3, admittedPolicyFingerprint: fingerprint, evidence
  }, "admitted", "2026-10-01").admissionOutcome, "invalid");
  assert.equal(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 3, admittedPolicyFingerprint: fingerprint,
    evidence: { ...evidence, artifact: "profile-evidence-999-1" }
  }, "admitted").admissionOutcome, "invalid");
  assert.equal(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 3, admittedPolicyFingerprint: fingerprint,
    evidence: { ...evidence, attempt: 2, artifact: "profile-evidence-101-2" }
  }, "admitted").admissionOutcome, "invalid");
  assert.equal(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 3, admittedPolicyFingerprint: fingerprint,
    evidence: { ...evidence, expiresOn: "2026-02-30" }
  }, "admitted", "2026-02-01").admissionOutcome, "invalid");
  assert.equal(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 3, admittedPolicyFingerprint: fingerprint,
    evidence: { ...evidence, assessedAt: "2026-02-30T10:00:00Z" }
  }, "admitted", "2026-02-01").admissionOutcome, "invalid");
});

test("given insufficient or contradictory admission evidence, when validating it, then reduced coverage stays disabled", () => {
  // given
  const fingerprint = "a".repeat(64);
  const admission = (evidence) => ({ schemaVersion: 3, admittedPolicyFingerprint: fingerprint, evidence });
  const valid = qualifiedEvidence(fingerprint);
  const invalidEvidence = [
    { ...valid, qualifyingFirstAttempts: 19 },
    { ...valid, backendPlans: 0 },
    { ...valid, frontendPlans: 0 },
    { ...valid, toolingPlans: 0 },
    { ...valid, candidateMisses: 1 },
    { ...valid, classificationErrors: 1 },
    { ...valid, ciTiming: { ...valid.ciTiming, successfulFirstAttempts: 19 } },
    { ...valid, ciTiming: { ...valid.ciTiming, observedFirstAttempts: 21 } },
    { ...valid, ciTiming: { ...valid.ciTiming, successfulRunnerMinutes: 700 } },
    { ...valid, backendPlans: 21 },
    { ...valid, localTiming: { ...valid.localTiming, policyFingerprint: "b".repeat(64) } },
    { ...valid, localTiming: { ...valid.localTiming, backend: {
      ...valid.localTiming.backend, medianMs: 1_100_000
    } } },
    { ...valid, localTiming: { ...valid.localTiming, frontend: {
      ...valid.localTiming.frontend, medianMs: 1_100_000
    } } },
    { ...valid, localTiming: { ...valid.localTiming, full: {
      ...valid.localTiming.full, medianMs: 0
    } } },
    { ...valid, windowEndedAt: "2026-08-31T09:59:59Z" },
    { ...valid, nightlies: [valid.nightlies[0]] },
    { ...valid, nightlies: [valid.nightlies[0], valid.nightlies[0]] },
    { ...valid, nightlies: [valid.nightlies[0], { ...valid.nightlies[1], event: "workflow_dispatch" }] },
    { ...valid, nightlies: [valid.nightlies[0], { ...valid.nightlies[1], jobs: ["backend"] }] },
    { ...valid, nightlies: [{ ...valid.nightlies[0], startedAt: "2026-08-27T23:59:59Z" },
      valid.nightlies[1]] },
    { ...valid, nightlies: [valid.nightlies[0],
      { ...valid.nightlies[1], startedAt: "2026-08-31T10:00:01Z" }] }
  ];

  // when / then
  for (const evidence of invalidEvidence) {
    assert.equal(activeProfileDecision(["backend"], fingerprint, admission(evidence), "admitted")
      .admissionOutcome, "invalid");
  }
});

test("given contradictory admission dates, when validating them, then future or empty evidence cannot activate", () => {
  // given
  const fingerprint = "a".repeat(64);
  const valid = qualifiedEvidence(fingerprint);
  const admission = (evidence) => ({ schemaVersion: 3, admittedPolicyFingerprint: fingerprint, evidence });
  const invalidEvidence = [
    { ...valid, windowStartedAt: valid.windowEndedAt },
    { ...valid, windowStartedAt: "2027-01-01T00:00:00Z", windowEndedAt: "2027-01-02T00:00:00Z",
      assessedAt: "2027-01-02T00:00:00Z", expiresOn: "2027-01-31",
      nightlies: valid.nightlies.map((nightly, index) => ({
        ...nightly, startedAt: `2027-01-01T${index === 0 ? "06" : "18"}:00:00Z`
      })) },
    { ...valid, expiresOn: "2026-08-30" }
  ];

  // when / then
  for (const evidence of invalidEvidence) {
    assert.equal(activeProfileDecision(["backend"], fingerprint, admission(evidence), "admitted", "2026-09-02")
      .admissionOutcome, "invalid");
  }
});

test("given semantic sources, when one changes, then the fingerprint changes but admission data does not", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-profile-contract-"));
  const first = join(directory, "first");
  const second = join(directory, "second");
  writeFileSync(first, "one");
  writeFileSync(second, "two");

  try {
    // when
    const original = profilePolicyFingerprint([first, second]);
    writeFileSync(second, "changed");
    const changed = profilePolicyFingerprint([first, second]);

    // then
    assert.notEqual(changed, original);
    assert.equal(readFileSync(first, "utf8"), "one");
    assert.ok(!semanticPolicySources.includes("ci/test-profile-admission.json"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given a policy source, when it cannot change the selection or what a profile runs, then it is not fingerprinted", () => {
  // given
  const deciding = [
    ".github/workflows/build.yml",
    "ci/github-profile-manifest.json",
    "ci/test-profile-contract.json",
    "ci/test-profiles.json",
    "ci/tool-profile-manifest.json",
    "tools/local-check.mjs",
    "tools/test-profile-classifier.mjs",
    "tools/test-profile-contract.mjs",
    "tools/tool-tests.mjs"
  ];
  const frontendPackage = JSON.parse(readFileSync(
    new URL("../frontend/package.json", import.meta.url), "utf8"));

  // then
  assert.deepEqual([...semanticPolicySources].sort(), deciding);
  assert.equal(frontendPackage.scripts["test:tools"], "node ../tools/tool-tests.mjs");
});

test("given equivalent line endings, when fingerprinting policy sources, then checkout style has no effect", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-profile-eol-"));
  const lf = join(directory, "lf");
  const crlf = join(directory, "crlf");
  writeFileSync(lf, "first\nsecond\n");
  writeFileSync(crlf, "first\r\nsecond\r\n");

  try {
    // when / then
    assert.equal(profilePolicyFingerprint([lf]), profilePolicyFingerprint([crlf]));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function qualifiedEvidence(fingerprint) {
  const timingCase = (medianMs, maximumMs) => ({
    attempts: 3,
    medianMs,
    maximumMs
  });
  return {
    runId: 101,
    attempt: 1,
    artifact: "profile-evidence-101-1",
    windowStartedAt: "2026-08-28T00:00:00Z",
    windowEndedAt: "2026-08-31T10:00:00Z",
    assessedAt: "2026-08-31T10:00:00Z",
    expiresOn: "2026-09-30",
    status: "ready-for-review",
    qualifyingFirstAttempts: 20,
    backendPlans: 2,
    frontendPlans: 1,
    toolingPlans: 1,
    candidateMisses: 0,
    classificationErrors: 0,
    incompleteObservations: 2,
    ciTiming: {
      observedFirstAttempts: 22,
      successfulFirstAttempts: 20,
      medianDurationMs: 865000,
      p95DurationMs: 894000,
      runnerMinutes: 661.43,
      successfulMedianDurationMs: 862000,
      successfulP95DurationMs: 894000,
      successfulRunnerMinutes: 599.82
    },
    localTiming: {
      commit: "c".repeat(40),
      policyFingerprint: fingerprint,
      status: "qualified",
      firstAttempts: 18,
      retries: 0,
      interruptedAttempts: 0,
      docs: timingCase(204, 267),
      tooling: timingCase(14412, 14870),
      backend: timingCase(613648, 647435),
      frontend: timingCase(711164, 717124),
      combined: timingCase(1247036, 1310954),
      full: timingCase(1326984, 1390647)
    },
    nightlies: [
      { runId: 201, attempt: 1, event: "schedule", commit: "d".repeat(40), outcome: "success",
        startedAt: "2026-08-29T01:00:00Z",
        jobs: ["docs", "backend", "frontend", "tooling", "security"] },
      { runId: 202, attempt: 1, event: "schedule", commit: "e".repeat(40), outcome: "success",
        startedAt: "2026-08-30T01:00:00Z",
        jobs: ["docs", "backend", "frontend", "tooling", "security"] }
    ]
  };
}
