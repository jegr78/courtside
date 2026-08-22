import assert from "node:assert/strict";
import { test } from "node:test";
import { assessmentGateRecord } from "./security-assessment-gate.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const sourceCommit = "b".repeat(40);

function manifest(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    runId: "scheduled-safe-0001",
    attempt: 1,
    status: "finished",
    outcome: "passed",
    profile: "safe",
    target: "https://127.0.0.1:8443",
    environment: "SECURITY",
    application: { imageDigest: digest, commit: sourceCommit },
    targetFingerprint: digest,
    seedFingerprint: digest,
    instanceFingerprint: digest,
    catalogVersion: "1.2.0",
    tools: [
      { id: "target-identity", version: "1.0.0", testIds: [] },
      { id: "passive-deployment", version: "1.0.0", testIds: ["CSA-DEPLOY-001"] }
    ],
    selectedTests: ["CSA-DEPLOY-001"],
    budgets: {
      durationSeconds: 600, requests: 1000, concurrency: 4, generatedDataMegabytes: 0,
      cpu: 2, memoryMegabytes: 1024, evidenceMegabytes: 25, expectedDuration: "up to 10 minutes"
    },
    startedAt: "2026-08-22T00:00:00.000Z",
    finishedAt: "2026-08-22T00:01:00.000Z",
    toolResults: [
      { id: "target-identity", version: "1.0.0", outcome: "passed" },
      { id: "passive-deployment", version: "1.0.0", outcome: "passed" }
    ],
    reason: null,
    usage: { requests: 1, generatedDataMegabytes: 0, evidenceBytes: 0 },
    ...overrides
  });
}

test("given a completed assessment, when creating its gate record, then exact provenance is retained", () => {
  // when
  const record = assessmentGateRecord(manifest(), { profile: "safe", subject: digest, sourceCommit });

  // then
  assert.equal(record.status, "passed");
  assert.equal(record.subject, digest);
  assert.equal(record.sourceCommit, sourceCommit);
  assert.deepEqual(record.selectedTests, ["CSA-DEPLOY-001"]);
  assert.equal(record.toolResults.length, 2);
  assert.equal(record.budgets.requests, 1000);
  assert.equal(record.usage.requests, 1);
  assert.match(record.manifestDigest, /^sha256:[a-f0-9]{64}$/);
});

test("given missing or mismatched assessment evidence, when gating it, then it cannot pass", () => {
  // given
  const expectations = { profile: "safe", subject: digest, sourceCommit };

  // when / then
  assert.throws(() => assessmentGateRecord(manifest({ status: "running", finishedAt: null }), expectations));
  assert.throws(() => assessmentGateRecord(manifest({ profile: "active" }), expectations));
  assert.throws(() => assessmentGateRecord(manifest({ application: { imageDigest: `sha256:${"c".repeat(64)}`, commit: sourceCommit } }), expectations));
  assert.throws(() => assessmentGateRecord(manifest({ application: { imageDigest: digest, commit: "c".repeat(40) } }), expectations));
  assert.throws(() => assessmentGateRecord(manifest({
    toolResults: [{ id: "target-identity", version: "1.0.0", outcome: "incomplete" }]
  }), expectations));
  assert.throws(() => assessmentGateRecord(manifest({ selectedTests: [] }), expectations));
  assert.throws(() => assessmentGateRecord(manifest({ catalogVersion: "1.0.0" }), expectations));
  assert.throws(() => assessmentGateRecord(manifest({ tools: JSON.parse(manifest()).tools.slice(0, 1) }), expectations));
  assert.throws(() => assessmentGateRecord(manifest({ finishedAt: "2026-08-21T23:59:00.000Z" }), expectations));
  assert.throws(() => assessmentGateRecord("{}", expectations));
});

test("given an incomplete scanner run, when creating evidence, then the outage stays incomplete", () => {
  // when
  const record = assessmentGateRecord(manifest({
    outcome: "incomplete",
    reason: "Scanner unavailable",
    toolResults: [{ id: "target-identity", version: "1.0.0", outcome: "passed" }]
  }), {
    profile: "safe", subject: digest, sourceCommit
  });

  // then
  assert.equal(record.status, "incomplete");
  assert.equal(record.reason, "Scanner unavailable");
});
