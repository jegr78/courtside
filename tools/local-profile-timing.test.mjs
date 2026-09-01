import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  beginTimingAttempt,
  assertPrivateTimingPlatform,
  completeTimingAttempt,
  createTimingStudy,
  localTimingCases,
  nextTimingAttempt,
  reserveTimingStudy,
  summarizeTimingStudy,
  validateTimingEnvironment
} from "./local-profile-timing.mjs";
import { loadProfileContract } from "./test-profile-contract.mjs";

const frontendRequire = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = frontendRequire("ajv/dist/2020").default;
const schema = JSON.parse(readFileSync(new URL("../quality/local-profile-timing.schema.json", import.meta.url)));
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);

const context = {
  commit: "a".repeat(40),
  policyFingerprint: "b".repeat(64),
  machine: {
    hostFingerprint: "c".repeat(64),
    environmentFingerprint: "d".repeat(64),
    platform: "linux",
    arch: "x64",
    cpuModel: "Example CPU",
    cpuCount: 8,
    totalMemoryBytes: 16_000_000_000,
    nodeVersion: "v26.5.1"
  },
  createdAt: "2026-09-01T00:00:00.000Z"
};

test("given the profile contract, when planning timings, then every required case uses the declared task union", () => {
  // when
  const cases = localTimingCases(loadProfileContract());

  // then
  assert.deepEqual(cases.map(({ id, profiles }) => ({ id, profiles })), [
    { id: "docs", profiles: ["docs"] },
    { id: "tooling", profiles: ["tooling"] },
    { id: "backend", profiles: ["backend"] },
    { id: "frontend", profiles: ["frontend"] },
    { id: "backend-frontend", profiles: ["backend", "frontend"] },
    { id: "full", profiles: ["full"] }
  ]);
  assert.deepEqual(cases.find(({ id }) => id === "backend-frontend").tasks.map(({ label }) => label), [
    "backend", "frontend-toolchain", "frontend-lint", "frontend-test", "frontend-build",
    "frontend-audit", "frontend-package", "frontend-e2e"
  ]);
});

test("given one immutable machine and commit, when creating a study, then three first attempts are required", () => {
  // when
  const study = createTimingStudy(context, loadProfileContract());

  // then
  assert.equal(study.schemaVersion, 1);
  assert.equal(study.commit, context.commit);
  assert.equal(study.policyFingerprint, context.policyFingerprint);
  assert.equal(study.attemptsPerCase, 3);
  assert.match(study.machineFingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(study.attempts, []);
  assert.equal(study.summary.status, "collecting");
  assert.deepEqual(nextTimingAttempt(study), { caseId: "docs", attempt: 1 });
  assert.equal(validate(study), true, JSON.stringify(validate.errors));
});

test("given completed attempts, when summarizing, then median maximum and relative savings remain exact", () => {
  // given
  let study = createTimingStudy(context, loadProfileContract());
  const durations = {
    docs: [10_000, 12_000, 11_000], tooling: [60_000, 70_000, 65_000],
    backend: [300_000, 320_000, 310_000], frontend: [600_000, 620_000, 610_000],
    "backend-frontend": [700_000, 720_000, 710_000], full: [1_000_000, 1_020_000, 1_010_000]
  };
  let cursor = Date.parse("2026-09-01T00:00:00.000Z");
  for (let index = 0; index < 3; index += 1) {
    for (const [caseId, values] of Object.entries(durations)) {
      const durationMs = values[index];
      const startedAt = new Date(cursor).toISOString();
      const completedAt = new Date(cursor + durationMs).toISOString();
      study = beginTimingAttempt(study, caseId, index + 1, startedAt);
      study = completeTimingAttempt(study, "passed", durationMs, completedAt);
      cursor += durationMs + 1_000;
    }
  }

  // when
  const summary = summarizeTimingStudy(study);

  // then
  assert.equal(summary.status, "qualified");
  assert.deepEqual(summary.cases.find(({ id }) => id === "docs"), {
    id: "docs", completedAttempts: 3, medianMs: 11_000, maximumMs: 12_000
  });
  assert.equal(summary.absoluteTargets.docs, true);
  assert.equal(summary.absoluteTargets.tooling, true);
  assert.equal(summary.relativeSavings.backend, 0.6931);
  assert.equal(summary.relativeSavings.frontend, 0.396);
  assert.equal(summary.relativeSavings.backendFrontend, 0.297);
  assert.equal(nextTimingAttempt(study), null);
});

test("given an attempt is running or failed, when continuing, then it cannot be retried as first-attempt evidence", () => {
  // given
  const initial = createTimingStudy(context, loadProfileContract());
  const running = beginTimingAttempt(initial, "docs", 1, "2026-09-01T00:00:00.000Z");
  const failed = completeTimingAttempt(running, "failed", 1_000, "2026-09-01T00:00:01.000Z");
  const passed = completeTimingAttempt(running, "passed", 1_000, "2026-09-01T00:00:01.000Z");

  // when / then
  assert.throws(() => nextTimingAttempt(running), /unfinished/i);
  assert.equal(summarizeTimingStudy(failed).status, "execution-failed");
  assert.throws(() => nextTimingAttempt(failed), /failed/i);
  assert.deepEqual(nextTimingAttempt(passed), { caseId: "tooling", attempt: 1 });
  assert.throws(() => beginTimingAttempt(initial, "tooling", 1, context.createdAt), /next timing attempt/i);
});

test("given completed but insufficient savings, when summarizing, then evidence does not qualify", () => {
  // given
  let study = createTimingStudy(context, loadProfileContract());
  let cursor = Date.parse(context.createdAt);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const { id } of study.cases) {
      const durationMs = id === "docs" ? 10_000 : id === "tooling" ? 20_000 : 90_000;
      study = beginTimingAttempt(study, id, attempt, new Date(cursor).toISOString());
      study = completeTimingAttempt(study, "passed", durationMs, new Date(cursor + durationMs).toISOString());
      cursor += durationMs + 1_000;
    }
  }

  // when
  const summary = summarizeTimingStudy(study);

  // then
  assert.equal(summary.status, "target-failed");
  assert.equal(summary.relativeSavings.backend, 0);
  assert.equal(summary.relativeSavings.frontend, 0);
});

test("given deleted workspace evidence, when reserving a replacement study, then first-attempt identity stays claimed", () => {
  // given
  const reservationRoot = mkdtempSync(join(tmpdir(), "courtside-profile-timing-"));
  const first = createTimingStudy(context, loadProfileContract());
  const replacement = createTimingStudy({
    ...context,
    machine: { ...context.machine, environmentFingerprint: "e".repeat(64) }
  }, loadProfileContract());

  // when / then
  try {
    reserveTimingStudy(first, reservationRoot);
    assert.doesNotThrow(() => reserveTimingStudy(first, reservationRoot));
    assert.throws(() => reserveTimingStudy(replacement, reservationRoot), /another timing study/i);
  } finally {
    rmSync(reservationRoot, { recursive: true, force: true });
  }
});

test("given scope-changing build variables or Windows, when starting a study, then private full coverage fails closed", () => {
  // when / then
  for (const key of ["MAVEN_ARGS", "MAVEN_OPTS", "JDK_JAVA_OPTIONS", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS",
    "NODE_OPTIONS", "npm_config_ignore_scripts", "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"]) {
    assert.throws(() => validateTimingEnvironment({ [key]: "-DskipTests=true" }), /scope-changing/i);
  }
  assert.doesNotThrow(() => validateTimingEnvironment({ MAVEN_OPTS: "" }));
  assert.throws(() => assertPrivateTimingPlatform("win32"), /POSIX owner-only/i);
  assert.doesNotThrow(() => assertPrivateTimingPlatform("linux"));
});

test("given forged calendar or duration evidence, when completing or resuming, then it fails closed", () => {
  // given
  const study = createTimingStudy(context, loadProfileContract());
  const running = beginTimingAttempt(study, "docs", 1, context.createdAt);
  const passed = completeTimingAttempt(running, "passed", 1_000, "2026-09-01T00:00:01.000Z");

  // when / then
  assert.throws(() => beginTimingAttempt(study, "docs", 1, "2026-02-30T00:00:00.000Z"), /start is invalid/i);
  assert.throws(() => completeTimingAttempt(running, "passed", 30_000, "2026-09-01T00:00:01.000Z"),
    /result is invalid/i);
  assert.throws(() => createTimingStudy(context, loadProfileContract(), {
    ...passed,
    attempts: [{ ...passed.attempts[0], durationMs: 30_000 }]
  }), /sequence/i);
});

test("given another commit policy or machine, when resuming, then the study fails closed", () => {
  // given
  const study = createTimingStudy(context, loadProfileContract());

  // when / then
  assert.throws(() => createTimingStudy({ ...context, commit: "c".repeat(40) }, loadProfileContract(), study),
    /identity/i);
  assert.throws(() => createTimingStudy({ ...context, policyFingerprint: "d".repeat(64) },
    loadProfileContract(), study), /identity/i);
  assert.throws(() => createTimingStudy({ ...context, machine: { ...context.machine, cpuCount: 4 } },
    loadProfileContract(), study), /identity/i);
});

test("given forged persisted evidence, when resuming, then shape sequence and summary fail closed", () => {
  // given
  const study = createTimingStudy(context, loadProfileContract());
  const running = beginTimingAttempt(study, "docs", 1, "2026-09-01T00:00:00.000Z");
  const passed = completeTimingAttempt(running, "passed", 1_000, "2026-09-01T00:00:01.000Z");

  // when / then
  assert.throws(() => createTimingStudy(context, loadProfileContract(), { ...study, secret: "value" }),
    /evidence is invalid/i);
  assert.throws(() => createTimingStudy(context, loadProfileContract(), {
    ...passed,
    attempts: [{ ...passed.attempts[0], caseId: "tooling" }]
  }), /sequence/i);
  assert.throws(() => createTimingStudy(context, loadProfileContract(), {
    ...passed,
    summary: { ...passed.summary, status: "passed" }
  }), /summary/i);
});
