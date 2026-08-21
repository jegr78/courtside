import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authenticatedZapPolicy,
  authenticatedZapPolicyDigest,
  normalizeAuthenticatedZapAlerts,
  renderAuthenticatedZapPlan,
  runAuthenticatedZapAssessment
} from "./security-authenticated-zap.mjs";
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

test("given the pinned authenticated policy, when rendering role plans, then active rules stay curated", () => {
  // when
  const member = renderAuthenticatedZapPlan("MEMBER", "SESSION=synthetic; XSRF-TOKEN=synthetic");
  const trainer = renderAuthenticatedZapPlan("TRAINER", "SESSION=synthetic; XSRF-TOKEN=synthetic");

  // then
  assert.match(authenticatedZapPolicy.image, /zaproxy\/zap-stable:2\.16\.1@sha256:[a-f0-9]{64}/);
  assert.match(authenticatedZapPolicyDigest(), /^sha256:[a-f0-9]{64}$/);
  assert.match(member, /defaultThreshold: "Off"/);
  for (const ruleId of authenticatedZapPolicy.active.ruleIds) assert.match(member, new RegExp(`id: ${ruleId}`));
  assert.doesNotMatch(trainer, /type: activeScan$/m);
  assert.match(trainer, /authenticated-session-proof/);
  assert.match(trainer, /postForm: false/);
});

test("given ZAP output, when normalizing alerts, then the canary is proven and findings become candidates", () => {
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
  assert.equal(normalized.candidates.length, 2);
  assert.equal(normalized.candidates[0].state, "false-positive");
  assert.equal(normalized.candidates[1].state, "candidate");
  assert.equal(normalized.candidates[1].scanner, "owasp-zap");
  assert.equal(normalized.candidates[1].normalizedSurface, "/api/bookings");
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
      roles: Object.keys(input.sessions), generatedDataMegabytes: 0
    })
  });

  // then
  assert.equal(evidence.outcome, "passed");
  assert.equal(evidence.requestCount, 91);
  assert.equal(evidence.candidates[0].state, "false-positive");
  assert.doesNotMatch(readFileSync(join(evidenceDirectory, "authenticated-zap.json"), "utf8"), /secret-/);
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
