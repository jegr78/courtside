import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  activeProfileDecision, ciJobsForProfiles, loadProfileContract, localTasksForProfiles,
  profilePolicyFingerprint, semanticPolicySources, validateContract
} from "./test-profile-contract.mjs";

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
  assert.deepEqual(jobs, ["backend", "frontend", "security"]);
  assert.deepEqual(tasks.map((task) => task.label), ["full"]);
});

test("given admission and override states, when selecting active coverage, then only an exact admission reduces", () => {
  // given
  const fingerprint = "a".repeat(64);
  const evidence = {
    runId: 101,
    attempt: 1,
    artifact: "profile-evidence-101-1",
    assessedAt: "2026-08-31T10:00:00Z",
    status: "ready-for-review"
  };

  // when / then
  assert.deepEqual(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 1, admittedPolicyFingerprint: fingerprint, evidence
  }, "admitted"), {
    activeProfiles: ["backend"], admissionOutcome: "matched", overrideOutcome: "admitted"
  });
  assert.deepEqual(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 1, admittedPolicyFingerprint: "b".repeat(64), evidence
  }, "admitted").activeProfiles, ["full"]);
  assert.equal(activeProfileDecision(["backend"], fingerprint, null, "admitted").admissionOutcome,
    "missing");
  assert.equal(activeProfileDecision(["backend"], fingerprint, {}, "admitted").admissionOutcome,
    "invalid");
  assert.equal(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 1, admittedPolicyFingerprint: fingerprint, evidence
  }, "full").overrideOutcome, "emergency-full");
  assert.equal(activeProfileDecision(["backend"], fingerprint, {
    schemaVersion: 1, admittedPolicyFingerprint: fingerprint, evidence
  }, "").overrideOutcome, "invalid-full");
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
    assert.ok(semanticPolicySources.includes(".github/workflows/build.yml"));
    assert.ok(semanticPolicySources.includes("tools/local-check.mjs"));
    assert.ok(semanticPolicySources.includes("tools/test-profile-replay.mjs"));
    assert.ok(semanticPolicySources.includes("ci/test-profile-plan.schema.json"));
    assert.ok(!semanticPolicySources.includes("ci/test-profile-admission.json"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
