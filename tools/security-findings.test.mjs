import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { evaluateSecurityReports } from "./security-findings.mjs";

const today = "2026-08-15";
const toolsDirectory = dirname(fileURLToPath(import.meta.url));

test("given actionable Trivy and CodeQL findings, when evaluating reports, then both block the gate", () => {
  // given
  const reports = [
    { scanner: "trivy", findings: [{ id: "CVE-2026-1000", severity: "HIGH", target: "target/courtside.jar" }] },
    { scanner: "codeql", findings: [{ id: "java/sql-injection", severity: "8.8", target: "src/main/java/Example.java" }] }
  ];

  // when
  const result = evaluateSecurityReports({ reports, exceptions: [], today });

  // then
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockingFindings.map((finding) => finding.id), ["java/sql-injection", "CVE-2026-1000"]);
});

test("given findings below the blocking threshold, when evaluating reports, then the gate passes", () => {
  // given
  const reports = [
    { scanner: "trivy", findings: [{ id: "CVE-2026-2000", severity: "MEDIUM", target: "pom.xml" }] },
    { scanner: "codeql", findings: [{ id: "js/weak-cryptographic-algorithm", severity: "6.9", target: "frontend/src/example.ts" }] }
  ];

  // when
  const result = evaluateSecurityReports({ reports, exceptions: [], today });

  // then
  assert.equal(result.status, "passed");
  assert.equal(result.blockingFindings.length, 0);
  assert.deepEqual(result.informationalFindings.map((finding) => finding.id), [
    "js/weak-cryptographic-algorithm", "CVE-2026-2000"
  ]);
});

test("given a precise active exception, when its finding is present, then acceptance remains visible", () => {
  // given
  const reports = [{ scanner: "trivy", findings: [{ id: "CVE-2026-3000", severity: "CRITICAL", target: "target/courtside.jar" }] }];
  const exceptions = [{
    id: "security-exception-1", scanner: "trivy", findingId: "CVE-2026-3000", target: "target/courtside.jar",
    rationale: "The affected code path is not reachable.", owner: "Security", compensatingControl: "The input is rejected at the proxy.",
    expiresOn: "2026-09-01", independentReview: false
  }];

  // when
  const result = evaluateSecurityReports({ reports, exceptions, today });

  // then
  assert.equal(result.status, "passed-with-exceptions");
  assert.deepEqual(result.acceptedFindings.map((finding) => finding.exceptionId), ["security-exception-1"]);
});

test("given an expired exception, when evaluating reports, then policy validation fails", () => {
  // given
  const reports = [{ scanner: "trivy", findings: [{ id: "CVE-2026-3000", severity: "HIGH", target: "pom.xml" }] }];
  const exceptions = [{
    id: "security-exception-1", scanner: "trivy", findingId: "CVE-2026-3000", target: "pom.xml",
    rationale: "Awaiting an upstream release.", owner: "Security", compensatingControl: "The feature is disabled.",
    expiresOn: "2026-08-14", independentReview: false
  }];

  // when / then
  assert.throws(() => evaluateSecurityReports({ reports, exceptions, today }), /expired on 2026-08-14/);
});

test("given an impossible exception date, when evaluating reports, then policy validation fails", () => {
  // given
  const exceptions = [{
    id: "security-exception-1", scanner: "trivy", findingId: "CVE-2026-3000", target: "Java:example@1.0",
    rationale: "Awaiting an upstream release.", owner: "Security", compensatingControl: "The feature is disabled.",
    expiresOn: "2026-02-30", independentReview: false
  }];

  // when / then
  assert.throws(() => evaluateSecurityReports({ reports: [], exceptions, today }), /invalid expiry/);
});

test("given an exception without a current finding, when evaluating reports, then stale suppression fails", () => {
  // given
  const exceptions = [{
    id: "security-exception-1", scanner: "codeql", findingId: "java/path-injection", target: "src/main/java/Example.java",
    rationale: "A constrained path is used.", owner: "Security", compensatingControl: "A fixed base directory is enforced.",
    expiresOn: "2026-09-01", independentReview: true
  }];

  // when / then
  assert.throws(() => evaluateSecurityReports({ reports: [], exceptions, today }), /does not match a current finding/);
});

test("given separate runtime and source reports, when invoking the policy, then both are evaluated", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-security-"));
  const runtime = join(directory, "runtime.json");
  const source = join(directory, "source.json");
  const exceptions = join(directory, "exceptions.json");
  const output = join(directory, "summary.json");
  writeFileSync(runtime, JSON.stringify({ Results: [{ Target: "Java", Vulnerabilities: [{
    VulnerabilityID: "CVE-2026-4000", Severity: "HIGH", PkgName: "org.example:runtime", InstalledVersion: "1.0"
  }] }] }));
  writeFileSync(source, JSON.stringify({ Results: [{ Target: "Dockerfile", Misconfigurations: [{
    ID: "DS-001", Severity: "CRITICAL"
  }] }] }));
  writeFileSync(exceptions, JSON.stringify({ schemaVersion: 1, exceptions: [] }));

  try {
    // when
    const result = spawnSync(process.execPath, [join(toolsDirectory, "security-findings.mjs"),
      "--trivy", runtime, "--trivy", source, "--exceptions", exceptions, "--output", output]);

    // then
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")).blockingFindings.map((finding) => finding.id),
      ["CVE-2026-4000", "DS-001"]);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
