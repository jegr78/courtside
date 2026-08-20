import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildPassiveDeploymentEvidence, normalizeZapAlerts, passiveDeploymentSummary, runOwnedProcess
} from "./security-passive-deployment.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const schema = JSON.parse(readFileSync(new URL(
  "../security/passive-deployment-evidence.schema.json", import.meta.url)));
const digest = `sha256:${"a".repeat(64)}`;

test("given passing layer observations, when building passive evidence, then only closed redacted facts remain", () => {
  // given
  const observations = [
    { id: "tls-versions", layer: "proxy", passed: true, observation: "tls12-and-tls13-only" },
    { id: "forwarded-boundary", layer: "application", passed: true, observation: "spoofed-values-replaced" },
    { id: "runtime-hardening", layer: "container", passed: true, observation: "runtime-controls-present" }
  ];

  // when
  const evidence = buildPassiveDeploymentEvidence({
    targetFingerprint: digest, imageDigest: digest, observations,
    zapReport: { version: "2.16.1", site: [{ alerts: [] }] }, requestCount: 24
  });

  // then
  const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
  assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
  assert.equal(evidence.outcome, "passed");
  assert.doesNotMatch(JSON.stringify(evidence), /cookie|authorization|password|responseBody/i);
});

test("given a failed required observation, when building passive evidence, then it cannot pass", () => {
  // when
  const evidence = buildPassiveDeploymentEvidence({
    targetFingerprint: digest, imageDigest: digest,
    observations: [{ id: "management-exposure", layer: "proxy", passed: false,
      observation: "management-route-reachable" }],
    zapReport: { version: "2.16.1", site: [{ alerts: [] }] }, requestCount: 1
  });

  // then
  assert.equal(evidence.outcome, "failed");
});

test("given ZAP output, when normalizing it, then URLs and evidence are discarded", () => {
  // given
  const report = { site: [{ alerts: [{ pluginid: "10020", riskcode: "1", confidence: "2",
    instances: [{ uri: "https://localhost/private?token=secret", evidence: "SESSION=secret" }] }] }] };

  // when
  const alerts = normalizeZapAlerts(report);

  // then
  assert.deepEqual(alerts, [{ pluginId: "10020", riskCode: 1, confidence: 2, count: 1 }]);
  assert.doesNotMatch(JSON.stringify(alerts), /localhost|secret|SESSION/);
});

test("given an untriaged ZAP candidate, when building evidence, then the assessment is incomplete", () => {
  // when
  const evidence = buildPassiveDeploymentEvidence({
    targetFingerprint: digest, imageDigest: digest,
    observations: [
      { id: "tls-versions", layer: "proxy", passed: true, observation: "tls12-and-tls13-only" },
      { id: "runtime-hardening", layer: "container", passed: true, observation: "runtime-controls-present" },
      { id: "loopback-publication", layer: "host", passed: true, observation: "proxy-loopback-only" }
    ],
    zapReport: { version: "2.16.1", site: [{ alerts: [{ pluginid: "10010", riskcode: "1",
      confidence: "2", instances: [{ uri: "http://proxy:8080" }] }] }] }, requestCount: 1
  });

  // then
  assert.equal(evidence.outcome, "incomplete");
  assert.doesNotMatch(passiveDeploymentSummary(evidence), /proxy:8080/);
});

test("given a request count above the safe budget, when building evidence, then the run fails closed", () => {
  // when / then
  assert.throws(() => buildPassiveDeploymentEvidence({
    targetFingerprint: digest, imageDigest: digest, observations: [],
    zapReport: { version: "2.16.1", site: [{ alerts: [] }] }, requestCount: 1001
  }), /request budget/);
});

test("given an emergency stop, when an owned scanner is running, then it is killed and cleaned up", async () => {
  // given
  const stopFile = join(mkdtempSync(join(tmpdir(), "courtside-passive-stop-")), "STOP");
  let cleaned = false;
  setTimeout(() => writeFileSync(stopFile, "stop"), 50);

  // when / then
  await assert.rejects(runOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    timeoutMilliseconds: 5_000,
    stopFile,
    cleanup: async () => { cleaned = true; }
  }), /Owned security process failed/);
  assert.equal(cleaned, true);
});

test("given a scanner failure, when the process exits, then transient resources are cleaned up", async () => {
  // given
  let cleaned = false;

  // when / then
  await assert.rejects(runOwnedProcess(process.execPath, ["-e", "process.exit(2)"], {
    timeoutMilliseconds: 5_000,
    stopFile: join(mkdtempSync(join(tmpdir(), "courtside-passive-failure-")), "STOP"),
    cleanup: async () => { cleaned = true; }
  }), /Owned security process failed/);
  assert.equal(cleaned, true);
});
