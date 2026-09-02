import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

const source = resolve(import.meta.dirname, "..");

test("given an admitted base, when local and CI plan representative changes, then both use the same fail-closed coverage", async () => {
  // given
  const parent = mkdtempSync(join(tmpdir(), "courtside-profile-activation-"));
  const repository = join(parent, "work");
  const remote = join(parent, "remote.git");
  mkdirSync(repository);

  try {
    copyTrackedFiles(repository);
    git(repository, ["init", "--initial-branch=main"]);
    git(repository, ["config", "user.name", "Courtside Test"]);
    git(repository, ["config", "user.email", "test@courtside.invalid"]);
    git(repository, ["config", "commit.gpgsign", "false"]);
    const contract = await import(`${pathToFileURL(join(repository, "tools", "test-profile-contract.mjs")).href}?setup=1`);
    const fingerprint = contract.profilePolicyFingerprint();
    writeFileSync(join(repository, "ci", "test-profile-admission.json"),
      `${JSON.stringify(qualifiedAdmission(fingerprint), null, 2)}\n`);
    git(repository, ["add", "--all"]);
    git(repository, ["commit", "--message", "baseline"]);
    const base = git(repository, ["rev-parse", "HEAD"]).trim();
    execFileSync("git", ["clone", "--bare", "--no-hardlinks", repository, remote], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
    });
    git(repository, ["remote", "add", "origin", remote]);
    symlinkSync(join(source, "frontend", "node_modules"), join(repository, "frontend", "node_modules"),
      dependencyLinkType());

    const cases = [
      { paths: ["docs/design.md"], profiles: ["docs"], jobs: ["docs"], tasks: ["docs-check"] },
      { paths: ["src/main/java/org/courtside/CourtsideApplication.java"], profiles: ["backend"],
        jobs: ["backend", "security"], tasks: ["backend"] },
      { paths: ["frontend/src/App.tsx"], profiles: ["frontend"], jobs: ["frontend", "security"],
        tasks: ["frontend-toolchain", "frontend-lint", "frontend-test", "frontend-build", "frontend-audit",
          "frontend-package", "frontend-e2e"] },
      { paths: ["tools/mail-check.test.mjs"], profiles: ["tooling"], jobs: ["tooling", "security"],
        tasks: ["frontend-toolchain", "tooling-test"] },
      { paths: ["src/main/java/org/courtside/CourtsideApplication.java", "frontend/src/App.tsx"],
        profiles: ["backend", "frontend"], jobs: ["backend", "frontend", "security"],
        tasks: ["backend", "frontend-toolchain", "frontend-lint", "frontend-test", "frontend-build",
          "frontend-audit", "frontend-package", "frontend-e2e"] }
    ];

    // when / then
    let runId = 100;
    for (const candidate of cases) {
      const head = changedCommit(repository, base, candidate.paths);
      const local = localPlan(repository);
      const ci = ciPlan(repository, base, head, ++runId, "admitted");
      assert.deepEqual(local.profiles, candidate.profiles);
      assert.deepEqual(local.tasks, candidate.tasks);
      assert.deepEqual(ci.activeProfiles, candidate.profiles);
      assert.deepEqual(ci.activeCiJobs, candidate.jobs);
      assert.equal(local.admissionOutcome, "matched");
      assert.equal(ci.admissionOutcome, "matched");
    }

    const unknownHead = changedCommit(repository, base, ["unclassified.txt"], true);
    assert.deepEqual(localPlan(repository).profiles, ["full"]);
    assert.deepEqual(ciPlan(repository, base, unknownHead, ++runId, "admitted").activeProfiles, ["full"]);

    const emergencyHead = changedCommit(repository, base, ["docs/design.md"]);
    const localEmergency = localPlan(repository, true);
    const ciEmergency = ciPlan(repository, base, emergencyHead, ++runId, "full");
    assert.deepEqual(localEmergency.profiles, ["full"]);
    assert.equal(localEmergency.overrideOutcome, "emergency-full");
    assert.deepEqual(ciEmergency.activeProfiles, ["full"]);
    assert.equal(ciEmergency.overrideOutcome, "emergency-full");
    const invalidMode = ciPlan(repository, base, emergencyHead, ++runId, "invalid");
    assert.deepEqual(invalidMode.activeProfiles, ["full"]);
    assert.equal(invalidMode.overrideOutcome, "invalid-full");

    git(repository, ["checkout", "main"]);
    writeFileSync(join(repository, "ci", "test-profile-admission.json"),
      `${JSON.stringify(qualifiedAdmission("f".repeat(64)), null, 2)}\n`);
    git(repository, ["add", "ci/test-profile-admission.json"]);
    git(repository, ["commit", "--message", "stale admission"]);
    const staleBase = git(repository, ["rev-parse", "HEAD"]).trim();
    git(repository, ["push", "origin", "main"]);
    const staleHead = changedCommit(repository, staleBase, ["docs/design.md"]);
    const localStale = localPlan(repository);
    const ciStale = ciPlan(repository, staleBase, staleHead, ++runId, "admitted");
    assert.deepEqual(localStale.profiles, ["full"]);
    assert.equal(localStale.admissionOutcome, "stale");
    assert.deepEqual(ciStale.activeProfiles, ["full"]);
    assert.equal(ciStale.admissionOutcome, "stale");
  } finally {
    rmSync(parent, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test("given supported host platforms, when selecting the dependency link, then Windows uses a junction", () => {
  // when / then
  assert.equal(dependencyLinkType("win32"), "junction");
  assert.equal(dependencyLinkType("darwin"), "dir");
  assert.equal(dependencyLinkType("linux"), "dir");
});

function dependencyLinkType(platform = process.platform) {
  return platform === "win32" ? "junction" : "dir";
}

function copyTrackedFiles(target) {
  const paths = execFileSync("git", ["ls-files", "-z"], { cwd: source, encoding: "utf8" })
    .split("\0").filter(Boolean);
  for (const path of paths) {
    const destination = join(target, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(source, path), destination, { recursive: true });
  }
}

function changedCommit(repository, base, paths, added = false) {
  git(repository, ["checkout", "--force", "-B", "feature", base]);
  for (const path of paths) {
    const absolute = join(repository, path);
    if (added) writeFileSync(absolute, "unknown\n");
    else appendFileSync(absolute, "activation-test\n");
  }
  git(repository, ["add", "--all"]);
  git(repository, ["commit", "--message", "candidate"]);
  return git(repository, ["rev-parse", "HEAD"]).trim();
}

function localPlan(repository, forceFull = false) {
  execFileSync(process.execPath, ["tools/courtside.mjs", "check", "--plan", ...(forceFull ? ["--full"] : [])], {
    cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(readFileSync(join(repository, "build", "local-check", "result.json"), "utf8"));
}

function ciPlan(repository, base, head, runId, mode) {
  const output = join(repository, "build", "activation-test", "plan.json");
  const summary = join(repository, "build", "activation-test", "summary.md");
  execFileSync(process.execPath, [
    "tools/test-profile-classifier.mjs", "--base", base, "--head", head, "--labels", "[]",
    "--run-id", String(runId), "--attempt", "1", "--mode", mode, "--output", output,
    "--summary", summary
  ], { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(readFileSync(output, "utf8"));
}

function git(repository, arguments_) {
  return execFileSync("git", arguments_, { cwd: repository, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function qualifiedAdmission(fingerprint) {
  const timingCase = (medianMs, maximumMs) => ({ attempts: 3, medianMs, maximumMs });
  return {
    schemaVersion: 3,
    admittedPolicyFingerprint: fingerprint,
    evidence: {
      runId: 101, attempt: 1, artifact: "profile-evidence-101-1",
      windowStartedAt: "2026-08-28T00:00:00Z", windowEndedAt: "2026-08-31T10:00:00Z",
      assessedAt: "2026-08-31T10:00:00Z", expiresOn: "9999-12-31", status: "ready-for-review",
      qualifyingFirstAttempts: 20, backendPlans: 2, frontendPlans: 1, toolingPlans: 1,
      candidateMisses: 0, classificationErrors: 0, incompleteObservations: 0,
      ciTiming: {
        observedFirstAttempts: 20, successfulFirstAttempts: 20,
        medianDurationMs: 800000, p95DurationMs: 850000, runnerMinutes: 600,
        successfulMedianDurationMs: 800000, successfulP95DurationMs: 850000,
        successfulRunnerMinutes: 600
      },
      localTiming: {
        commit: "c".repeat(40), policyFingerprint: fingerprint, status: "qualified",
        firstAttempts: 18, retries: 0, interruptedAttempts: 0,
        docs: timingCase(200, 250), tooling: timingCase(14000, 15000),
        backend: timingCase(600000, 650000), frontend: timingCase(700000, 720000),
        combined: timingCase(1200000, 1300000), full: timingCase(1300000, 1400000)
      },
      nightlies: [
        { runId: 201, attempt: 1, event: "schedule", commit: "d".repeat(40), outcome: "success",
          startedAt: "2026-08-29T01:00:00Z",
          jobs: ["docs", "backend", "frontend", "tooling", "security"] },
        { runId: 202, attempt: 1, event: "schedule", commit: "e".repeat(40), outcome: "success",
          startedAt: "2026-08-30T01:00:00Z",
          jobs: ["docs", "backend", "frontend", "tooling", "security"] }
      ]
    }
  };
}
