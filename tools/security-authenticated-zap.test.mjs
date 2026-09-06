import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authenticatedZapPolicy,
  authenticatedZapPolicyDigest,
  authenticatedZapPlanDigest,
  authenticatedZapCanaryRetestDetected,
  normalizeAuthenticatedZapAlerts,
  renderAuthenticatedZapCanaryRetestPlan,
  renderAuthenticatedZapPlan,
  runAuthenticatedZapAssessment,
  validateAuthenticatedZapEvidence
} from "./security-authenticated-zap.mjs";
import { zapImage } from "./security-passive-deployment.mjs";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = {
  runId: "run-0001",
  attempt: 1,
  targetFingerprint: `sha256:${"a".repeat(64)}`,
  observedAt: "2026-08-21T08:00:00.000Z",
  expiresOn: "2026-09-20",
  actor: "local-maintainer"
};
const canaryRetestChronology = {
  detectedAt: "2026-08-21T08:00:00.000Z",
  remediationStartedAt: "2026-08-21T08:00:01.000Z",
  fixedAt: "2026-08-21T08:00:02.000Z",
  retestStartedAt: "2026-08-21T08:00:03.000Z",
  retestFinishedAt: "2026-08-21T08:00:04.000Z"
};

test("given the pinned authenticated policy, when rendering role plans, then active rules stay curated", () => {
  // when
  const member = renderAuthenticatedZapPlan("MEMBER", "SESSION=synthetic; XSRF-TOKEN=synthetic");
  const trainer = renderAuthenticatedZapPlan("TRAINER", "SESSION=synthetic; XSRF-TOKEN=synthetic");

  // then
  assert.equal(authenticatedZapPolicy.image, zapImage);
  assert.match(authenticatedZapPolicyDigest(), /^sha256:[a-f0-9]{64}$/);
  assert.match(authenticatedZapPlanDigest(), /^sha256:[a-f0-9]{64}$/);
  assert.match(member, /defaultThreshold: "Off"/);
  assert.match(renderAuthenticatedZapCanaryRetestPlan(), /action: passIfAbsent/);
  assert.match(renderAuthenticatedZapCanaryRetestPlan(), /scanner-canary-remediation-retest/);
  assert.match(renderAuthenticatedZapCanaryRetestPlan(),
    /scanner-canary-remediation-retest\n\s+method: GET\n\s+responseCode: 401/);
  assert.equal(authenticatedZapCanaryRetestDetected({ site: [] }), false);
  assert.throws(() => authenticatedZapCanaryRetestDetected({ site: [{ alerts: [{
    pluginid: "10037", instances: [{ uri: "http://foreign.example/__security/zap-canary" }]
  }] }] }), /outside its isolated target/);
  for (const ruleId of authenticatedZapPolicy.active.ruleIds) assert.match(member, new RegExp(`id: ${ruleId}`));
  assert.doesNotMatch(trainer, /type: activeScan$/m);
  assert.match(trainer, /authenticated-session-proof/);
  assert.match(trainer, /authenticated-session-retention-proof/);
  assert.match(trainer, /postForm: false/);
  assert.ok(trainer.indexOf("authenticated-session-retention-proof") > trainer.indexOf("type: spider"));
  assert.ok(member.indexOf("authenticated-session-retention-proof") > member.lastIndexOf("type: activeScan"));
  assert.ok(member.indexOf("type: report") > member.indexOf("authenticated-session-retention-proof"));
  assert.match(member, /authenticated-session-retention-proof\n\s+method: GET\n\s+responseCode: 200/);
});

test("given ZAP output, when normalizing alerts, then the canary is promoted separately from product candidates", () => {
  // given
  const report = { site: [{ alerts: [
    { pluginid: "10037", name: "Server header", instances: [{
      uri: "http://scanner-gateway:8090/__security/zap-canary", method: "GET"
    }] },
    { pluginid: "40012", name: "Cross Site Scripting", instances: [{
      uri: "http://scanner-gateway:8090/api/bookings?date=2026-08-21", method: "GET", param: "date"
    }] }
  ] }] };

  // when
  const normalized = normalizeAuthenticatedZapAlerts([report], run);

  // then
  assert.equal(normalized.canaryDetected, true);
  assert.equal(normalized.candidates.length, 1);
  assert.equal(normalized.candidates[0].state, "candidate");
  assert.equal(normalized.candidates[0].scanner, "owasp-zap");
  assert.equal(normalized.candidates[0].normalizedSurface, "/api/bookings");
  assert.equal(normalized.lifecycleSeed.normalizedSurface, "/__security/zap-canary");
  assert.doesNotMatch(JSON.stringify(normalized), /\?date=|scanner-gateway/);
});

test("given missing canary or foreign output, when normalizing alerts, then the assessment fails closed", () => {
  // when / then
  assert.throws(() => normalizeAuthenticatedZapAlerts([], run), /did not detect/);
  assert.throws(() => normalizeAuthenticatedZapAlerts([{ site: [{ alerts: [{
    pluginid: "10037", instances: [{ uri: "http://foreign.example/__security/zap-canary" }]
  }] }] }], run), /outside/);
  assert.throws(() => normalizeAuthenticatedZapAlerts([{ site: [{ alerts: [{
    pluginid: "40012", name: "secret", instances: [{
      uri: "http://scanner-gateway:8090/api/bookings", param: "unexpected"
    }]
  }] }] }], run), /closed assessment schema/);
});

test("given isolated role sessions and a canary-only scan, when assessing, then redacted evidence passes", async () => {
  // given
  const evidenceDirectory = mkdtempSync(join(tmpdir(), "courtside-zap-evidence-"));
  const plan = {
    profile: "active", environment: "SECURITY", runId: "run-0001",
    target: "https://localhost:9443", targetFingerprint: run.targetFingerprint,
    selectedTests: ["CSA-AUTHN-001", "CSA-AUTHZ-001", "CSA-DAST-001"]
  };
  const report = { site: [{ alerts: [{ pluginid: "10037", name: "Server header", instances: [{
    uri: "http://scanner-gateway:8090/__security/zap-canary", method: "GET"
  }] }] }] };

  // when
  const evidence = await runAuthenticatedZapAssessment(plan, {
    evidenceDirectory,
    stopFile: join(evidenceDirectory, "STOP"),
    deadline: new Date(Date.now() + 60_000),
    now: () => new Date("2026-08-21T08:00:00.000Z"),
    attempt: 1,
    maxRequests: 1000,
    authenticateRole: async (role) => ({ cookieHeader: `SESSION=secret-${role}`, requestCount: 3 }),
    runZap: async (_selectedPlan, input) => ({
      reports: [report], requestCount: 70, runtimeHardened: true,
      roles: Object.keys(input.sessions), generatedDataMegabytes: 0,
      planDigest: authenticatedZapPlanDigest(),
      canaryRetest: { report: { site: [] }, requestCount: 1, ...canaryRetestChronology }
    })
  });

  // then
  assert.equal(evidence.outcome, "passed");
  assert.equal(evidence.requestCount, 91);
  assert.deepEqual(evidence.candidates, []);
  assert.equal(evidence.lifecycleProof.state, "retest-passed");
  assert.deepEqual(evidence.lifecycleProof.transitions.map(({ state }) => state),
    ["validated", "remediation-in-progress", "fixed", "retest-passed"]);
  assert.deepEqual(evidence.lifecycleProof.transitions.map(({ changedAt }) => changedAt),
    [canaryRetestChronology.detectedAt, canaryRetestChronology.remediationStartedAt,
      canaryRetestChronology.fixedAt, canaryRetestChronology.retestFinishedAt]);
  assert.equal(evidence.canaryRetest.requestCount, 1);
  assert.match(evidence.canaryRetest.reportDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(evidence.lifecycleProof.evidence.at(-1).digest, evidence.canaryRetest.reportDigest);
  const mismatchedProof = structuredClone(evidence);
  mismatchedProof.lifecycleProof.fingerprint = `sha256:${"f".repeat(64)}`;
  assert.throws(() => validateAuthenticatedZapEvidence(mismatchedProof), /lifecycle proof/);
  const forgedTimeline = structuredClone(evidence);
  forgedTimeline.lifecycleProof.transitions.at(-1).reference = "unrelated-retest";
  assert.throws(() => validateAuthenticatedZapEvidence(forgedTimeline), /transition history/);
  const forgedRemediation = structuredClone(evidence);
  forgedRemediation.lifecycleProof.transitions[1].actor = "unrelated-actor";
  assert.throws(() => validateAuthenticatedZapEvidence(forgedRemediation), /lifecycle proof/);
  const forgedRetestDigest = structuredClone(evidence);
  forgedRetestDigest.canaryRetest.reportDigest = `sha256:${"f".repeat(64)}`;
  assert.throws(() => validateAuthenticatedZapEvidence(forgedRetestDigest), /lifecycle proof/);
  const forgedRetestCount = structuredClone(evidence);
  forgedRetestCount.canaryRetest.requestCount = 128;
  assert.throws(() => validateAuthenticatedZapEvidence(forgedRetestCount), /evidence is invalid/);
  const forgedRetestChronology = structuredClone(evidence);
  forgedRetestChronology.canaryRetest.fixedAt = "2026-08-21T07:59:59.000Z";
  assert.throws(() => validateAuthenticatedZapEvidence(forgedRetestChronology), /lifecycle proof/);
  assert.doesNotMatch(readFileSync(join(evidenceDirectory, "authenticated-zap.json"), "utf8"), /secret-/);
});

test("given the seeded canary remains after remediation, when assessing, then the lifecycle proof fails closed", async () => {
  // given
  const plan = {
    profile: "active", environment: "SECURITY", runId: "run-0001",
    target: "https://localhost:9443", targetFingerprint: run.targetFingerprint,
    selectedTests: ["CSA-AUTHN-001", "CSA-AUTHZ-001", "CSA-DAST-001"]
  };
  const report = { site: [{ alerts: [{ pluginid: "10037", instances: [{
    uri: "http://scanner-gateway:8090/__security/zap-canary", method: "GET"
  }] }] }] };

  // when / then
  await assert.rejects(runAuthenticatedZapAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-zap-evidence-")),
    stopFile: join(tmpdir(), "courtside-zap-stop"),
    deadline: new Date(Date.now() + 60_000),
    now: () => new Date("2026-08-21T08:00:00.000Z"),
    attempt: 1,
    maxRequests: 1000,
    authenticateRole: async (role) => ({ cookieHeader: `SESSION=secret-${role}`, requestCount: 3 }),
    runZap: async (_selectedPlan, input) => ({
      reports: [report], requestCount: 70, runtimeHardened: true,
      roles: Object.keys(input.sessions), generatedDataMegabytes: 0,
      planDigest: authenticatedZapPlanDigest(),
      canaryRetest: { report, requestCount: 1, ...canaryRetestChronology }
    })
  }), /canary remediation retest/);
});

test("given a changed executed plan, when assessing, then the evidence fails closed", async () => {
  // given
  const plan = {
    profile: "active", environment: "SECURITY", runId: "run-0001",
    target: "https://localhost:9443", targetFingerprint: run.targetFingerprint,
    selectedTests: ["CSA-AUTHN-001", "CSA-AUTHZ-001", "CSA-DAST-001"]
  };

  // when / then
  await assert.rejects(runAuthenticatedZapAssessment(plan, {
    evidenceDirectory: mkdtempSync(join(tmpdir(), "courtside-zap-evidence-")),
    stopFile: join(tmpdir(), "courtside-zap-stop"),
    deadline: new Date(Date.now() + 60_000),
    attempt: 1,
    maxRequests: 1000,
    authenticateRole: async (role) => ({ cookieHeader: `SESSION=secret-${role}`, requestCount: 3 }),
    runZap: async (_selectedPlan, input) => ({
      reports: [], requestCount: 70, runtimeHardened: true,
      roles: Object.keys(input.sessions), generatedDataMegabytes: 0,
      planDigest: `sha256:${"b".repeat(64)}`,
      canaryRetest: { detected: false, report: { site: [] }, requestCount: 1, ...canaryRetestChronology }
    })
  }), /plan digest/);
});

test("given a scanner budget above policy, when assessing, then execution is rejected", async () => {
  // given
  const plan = {
    profile: "active", environment: "SECURITY", runId: "run-0001",
    target: "https://localhost:9443", targetFingerprint: run.targetFingerprint,
    selectedTests: ["CSA-AUTHN-001", "CSA-AUTHZ-001", "CSA-DAST-001"]
  };

  // when / then
  await assert.rejects(runAuthenticatedZapAssessment(plan, {
    maxRequests: authenticatedZapPolicy.requestLimit + 1
  }), /request budget/);
});
