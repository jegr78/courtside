import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  combineSecuritySummaries, evaluateSecurityReports, finalizeSupplyChainEvidence, parseCodeqlReport,
  parseNpmReport, parseTrivyReport
} from "./security-findings.mjs";

const today = "2026-08-15";
const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const releaseDigest = `sha256:${"d".repeat(64)}`;
const releaseCommit = "c".repeat(40);

function activeAssessmentGate(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-15T00:00:00.000Z",
    runId: "release-active-0001",
    attempt: 1,
    profile: "active",
    status: "passed",
    subject: releaseDigest,
    sourceCommit: releaseCommit,
    targetFingerprint: `sha256:${"f".repeat(64)}`,
    catalogVersion: "1.0.0",
    tools: [{ id: "target-identity", version: "1.0.0" }],
    selectedTests: [],
    budgets: {
      durationSeconds: 1800, requests: 10000, concurrency: 10, generatedDataMegabytes: 100,
      cpu: 4, memoryMegabytes: 4096, evidenceMegabytes: 100, expectedDuration: "up to 30 minutes"
    },
    startedAt: "2026-08-15T00:00:00.000Z",
    finishedAt: "2026-08-15T00:01:00.000Z",
    toolResults: [{ id: "target-identity", version: "1.0.0", outcome: "passed" }],
    usage: { requests: 1, generatedDataMegabytes: 0, evidenceBytes: 512 },
    manifestDigest: `sha256:${"a".repeat(64)}`,
    ...overrides
  };
}

test("given actionable Trivy and CodeQL findings, when evaluating reports, then both block the gate", () => {
  // given
  const reports = [
    { scanner: "trivy", findings: [{ id: "CVE-2026-1000", severity: "HIGH", target: "target/courtside.jar" }] },
    { scanner: "codeql", findings: [{ id: "java/sql-injection", severity: "8.8", target: "src/main/java/Example.java" }] }
  ];

  // when
  const result = evaluateSecurityReports({
    reports, exceptions: [], scope: "required-build", subject: "commit", assessmentPolicy: "not-applicable", today
  });

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
  const result = evaluateSecurityReports({
    reports, exceptions: [], scope: "required-build", subject: "commit", assessmentPolicy: "not-applicable", today
  });

  // then
  assert.equal(result.status, "passed");
  assert.equal(result.blockingFindings.length, 0);
  assert.deepEqual(result.informationalFindings.map((finding) => finding.id), [
    "js/weak-cryptographic-algorithm", "CVE-2026-2000"
  ]);
});

test("given an incomplete dynamic assessment, when evaluating scanner reports, then the existing gate is incomplete", () => {
  // given
  const assessment = {
    schemaVersion: 1, run: { runId: "run-0001", attempt: 1, subject: "commit", outcome: "incomplete" },
    outcome: { outcome: "incomplete", reason: "1 candidate awaits reproducible validation" },
    counts: { candidates: 1, findings: 0, regressions: 0 }, candidates: [], findings: []
  };

  // when
  const result = evaluateSecurityReports({
    reports: [], exceptions: [], scope: "required-build", subject: "commit", today,
    assessment, assessmentPolicy: "required"
  });

  // then
  assert.equal(result.status, "incomplete");
  assert.equal(result.assessment.outcome.outcome, "incomplete");
});

test("given a precise active exception, when its finding is present, then acceptance remains visible", () => {
  // given
  const reports = [{ scanner: "trivy", findings: [{ id: "CVE-2026-3000", severity: "CRITICAL", target: "target/courtside.jar" }] }];
  const exceptions = [{
    id: "security-exception-1", scanner: "trivy", findingId: "CVE-2026-3000", target: "target/courtside.jar",
    rationale: "The affected code path is not reachable.", owner: "Security", compensatingControl: "The input is rejected at the proxy.",
    expiresOn: "2026-09-01", independentReview: false, scope: "required-build"
  }];

  // when
  const result = evaluateSecurityReports({
    reports, exceptions, scope: "required-build", subject: "commit", assessmentPolicy: "not-applicable", today
  });

  // then
  assert.equal(result.status, "passed-with-exceptions");
  assert.deepEqual(result.acceptedFindings.map((finding) => finding.exceptionId), ["security-exception-1"]);
  assert.equal(result.acceptedFindings[0].exceptionStatus, "active");
  assert.deepEqual(result.acceptedFindings[0].exception, {
    id: "security-exception-1", owner: "Security", rationale: "The affected code path is not reachable.",
    compensatingControl: "The input is rejected at the proxy.", expiresOn: "2026-09-01", independentReview: false
  });
});

test("given an expired exception, when evaluating reports, then policy validation fails", () => {
  // given
  const reports = [{ scanner: "trivy", findings: [{ id: "CVE-2026-3000", severity: "HIGH", target: "pom.xml" }] }];
  const exceptions = [{
    id: "security-exception-1", scanner: "trivy", findingId: "CVE-2026-3000", target: "pom.xml",
    rationale: "Awaiting an upstream release.", owner: "Security", compensatingControl: "The feature is disabled.",
    expiresOn: "2026-08-14", independentReview: false, scope: "required-build"
  }];

  // when / then
  assert.throws(() => evaluateSecurityReports({
    reports, exceptions, scope: "required-build", subject: "commit", assessmentPolicy: "not-applicable", today
  }), /expired on 2026-08-14/);
});

test("given an impossible exception date, when evaluating reports, then policy validation fails", () => {
  // given
  const exceptions = [{
    id: "security-exception-1", scanner: "trivy", findingId: "CVE-2026-3000", target: "Java:example@1.0",
    rationale: "Awaiting an upstream release.", owner: "Security", compensatingControl: "The feature is disabled.",
    expiresOn: "2026-02-30", independentReview: false, scope: "required-build"
  }];

  // when / then
  assert.throws(() => evaluateSecurityReports({
    reports: [], exceptions, scope: "required-build", subject: "commit", assessmentPolicy: "not-applicable", today
  }), /invalid expiry/);
});

test("given an exception without a current finding, when evaluating reports, then stale suppression fails", () => {
  // given
  const exceptions = [{
    id: "security-exception-1", scanner: "codeql", findingId: "java/path-injection", target: "src/main/java/Example.java",
    rationale: "A constrained path is used.", owner: "Security", compensatingControl: "A fixed base directory is enforced.",
    expiresOn: "2026-09-01", independentReview: true, scope: "required-build"
  }];

  // when / then
  assert.throws(() => evaluateSecurityReports({
    reports: [], exceptions, scope: "required-build", subject: "commit", assessmentPolicy: "not-applicable", today
  }), /does not match a current finding/);
});

test("given an exception for another scan scope, when evaluating reports, then it is not treated as unused", () => {
  // given
  const exceptions = [{
    id: "security-exception-1", scanner: "trivy", findingId: "CVE-2026-3000", target: "image:package@1.0",
    rationale: "Awaiting an upstream release.", owner: "Security", compensatingControl: "The feature is disabled.",
    expiresOn: "2026-09-01", independentReview: false, scope: "release-image-amd64"
  }];

  // when
  const result = evaluateSecurityReports({
    reports: [], exceptions, scope: "required-build", subject: "commit", assessmentPolicy: "not-applicable", today
  });

  // then
  assert.equal(result.status, "passed");
});

test("given structurally incomplete scanner reports, when parsing them, then the gate fails closed", () => {
  // when / then
  assert.throws(() => parseTrivyReport({}), /Results/);
  assert.throws(() => parseNpmReport({ vulnerabilities: {} }), /auditReportVersion/);
  assert.throws(() => parseCodeqlReport({}), /runs/);
});

test("given npm vulnerabilities, when parsing the audit report, then they become policy findings", () => {
  // given
  const input = { auditReportVersion: 2, vulnerabilities: {
    example: { severity: "high", range: "<2.0.0", via: [{
      source: 1234, url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz", cwe: ["CWE-79"]
    }] }
  } };

  // when
  const report = parseNpmReport(input, { version: "11.6.0", subject: "commit:abcdef0" });

  // then
  assert.equal(report.version, "11.6.0");
  assert.equal(report.status, "completed");
  assert.equal(report.subject, "commit:abcdef0");
  assert.deepEqual(report.findings[0], {
    id: "1234", severity: "HIGH", target: "example@<2.0.0", component: "example",
    advisorySource: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
    aliases: ["1234", "GHSA-XXXX-YYYY-ZZZZ"], cwes: ["CWE-79"], reachability: "not-assessed"
  });
});

test("given Trivy and CodeQL reports, when importing them, then scanner provenance and security metadata survive", () => {
  // given
  const trivy = {
    SchemaVersion: 2, Results: [{ Target: "Java", Vulnerabilities: [{
      VulnerabilityID: "CVE-2026-5000", Severity: "HIGH", PkgName: "org.example:example",
      InstalledVersion: "1.0", PrimaryURL: "https://avd.aquasec.com/nvd/cve-2026-5000",
      References: ["https://github.com/advisories/GHSA-xxxx-yyyy-zzzz"], CweIDs: ["CWE-89"]
    }] }]
  };
  const codeql = { runs: [{
    tool: { driver: { name: "CodeQL", semanticVersion: "2.23.0", rules: [{
      id: "java/sql-injection", helpUri: "https://codeql.github.com/codeql-query-help/java/java-sql-injection/",
      properties: { "security-severity": "8.8", tags: ["external/cwe/cwe-089"] }
    }] } },
    results: [{ ruleId: "java/sql-injection", locations: [{ physicalLocation: {
      artifactLocation: { uri: "src/main/java/Example.java" }
    } }] }]
  }] };

  // when
  const trivyReport = parseTrivyReport(trivy, {
    version: "0.69.3", subject: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  });
  const codeqlReport = parseCodeqlReport(codeql, { subject: "commit:abcdef0" });

  // then
  assert.equal(trivyReport.version, "0.69.3");
  assert.deepEqual(trivyReport.findings[0].cwes, ["CWE-89"]);
  assert.deepEqual(trivyReport.findings[0].aliases, ["CVE-2026-5000", "GHSA-XXXX-YYYY-ZZZZ"]);
  assert.equal(codeqlReport.version, "2.23.0");
  assert.deepEqual(codeqlReport.findings[0].cwes, ["CWE-89"]);
  assert.equal(codeqlReport.findings[0].reachability, "source-reachable");
  const result = evaluateSecurityReports({
    reports: [trivyReport], exceptions: [], scope: "release-image-amd64",
    subject: trivyReport.subject, assessmentPolicy: "not-applicable", today
  });
  assert.equal(result.evidenceSources[0].artifactDigest, trivyReport.subject);
  assert.equal(result.blockingFindings[0].artifactDigest, trivyReport.subject);
});

test("given matching npm and Trivy observations, when evaluating them, then one finding retains both scanners", () => {
  // given
  const reports = [
    { scanner: "npm", version: "11.6.0", status: "completed", subject: "commit", findings: [{
      id: "1234", severity: "HIGH", target: "example@<2", component: "example",
      aliases: ["1234", "GHSA-xxxx-yyyy-zzzz"], cwes: ["CWE-79"], advisorySource: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
      reachability: "not-assessed"
    }] },
    { scanner: "trivy", version: "0.69.3", status: "completed", subject: "commit", findings: [{
      id: "CVE-2026-5000", severity: "CRITICAL", target: "node_modules:example@1", component: "example",
      aliases: ["CVE-2026-5000", "GHSA-xxxx-yyyy-zzzz"], cwes: ["CWE-79"], advisorySource: "https://avd.aquasec.com/nvd/cve-2026-5000",
      reachability: "not-assessed"
    }] }
  ];

  // when
  const result = evaluateSecurityReports({
    reports, exceptions: [], scope: "release-build", subject: "commit",
    assessmentPolicy: "not-applicable", today
  });

  // then
  assert.equal(result.blockingFindings.length, 1);
  assert.deepEqual(result.blockingFindings[0].observations.map((finding) => finding.scanner), ["npm", "trivy"]);
  assert.equal(result.blockingFindings[0].severity, "CRITICAL");
  assert.deepEqual(result.evidenceSources.map((source) => source.scanner), ["npm", "trivy"]);
});

test("given a release record and verified supply-chain outputs, when finalizing it, then every proof binds to its digest", () => {
  // given
  const digest = `sha256:${"a".repeat(64)}`;
  const summary = {
    schemaVersion: 1, scope: "release", subject: digest, status: "passed",
    sources: [], blockingFindings: [], acceptedFindings: [], informationalFindings: []
  };

  // when
  const result = finalizeSupplyChainEvidence(summary, {
    image: `ghcr.io/example/courtside@${digest}`, sbomDigest: `sha256:${"b".repeat(64)}`,
    signature: { status: "verified", subjectDigest: digest },
    provenance: { status: "verified", subjectDigest: digest },
    sbom: { status: "verified", subjectDigest: digest }
  });

  // then
  assert.equal(result.supplyChain.imageDigest, digest);
  assert.equal(result.supplyChain.signature.status, "verified");
  assert.equal(result.supplyChain.sbomDigest, `sha256:${"b".repeat(64)}`);
  assert.throws(() => finalizeSupplyChainEvidence(summary, {
    image: `ghcr.io/example/courtside@${digest}`,
    signature: { status: "verified", subjectDigest: `sha256:${"c".repeat(64)}` },
    provenance: { status: "verified", subjectDigest: digest }, sbom: { status: "verified", subjectDigest: digest },
    sbomDigest: `sha256:${"b".repeat(64)}`
  }), /digest mismatch/);
});

test("given normalized build and image evidence, when combining a release record, then all findings remain visible", () => {
  // given
  const summaries = [
    { schemaVersion: 1, scope: "release-build", subject: releaseCommit, assessmentPolicy: "not-applicable", generatedAt: "2026-08-15T00:00:00.000Z",
      status: "passed", evidenceSources: [{ scanner: "npm", subject: releaseCommit }], blockingFindings: [], acceptedFindings: [], informationalFindings: [{
        scanner: "npm", id: "NPM-1", severity: "LOW", target: "example@1", component: "example",
        aliases: ["GHSA-XXXX-YYYY-ZZZZ"]
      }] },
    { schemaVersion: 1, scope: "release-image-amd64", subject: releaseDigest, assessmentPolicy: "not-applicable", generatedAt: "2026-08-15T00:00:00.000Z",
      status: "passed", evidenceSources: [{ scanner: "trivy", subject: releaseDigest }], blockingFindings: [], acceptedFindings: [], informationalFindings: [{
        scanner: "trivy", id: "CVE-1", severity: "MEDIUM", target: "image", component: "example",
        aliases: ["CVE-1", "GHSA-XXXX-YYYY-ZZZZ"]
      }] },
    { schemaVersion: 1, scope: "release-image-arm64", subject: releaseDigest, assessmentPolicy: "not-applicable", generatedAt: "2026-08-15T00:00:00.000Z",
      status: "passed", evidenceSources: [{ scanner: "trivy", subject: releaseDigest }], blockingFindings: [], acceptedFindings: [], informationalFindings: [] }
  ];

  // when
  const result = combineSecuritySummaries({
    summaries, scope: "release", subject: releaseDigest, sourceSubject: releaseCommit, today,
    assessmentGates: [activeAssessmentGate()]
  });

  // then
  assert.equal(result.status, "passed");
  assert.deepEqual(result.informationalFindings.map((finding) => finding.id), ["NPM-1"]);
  assert.deepEqual(result.informationalFindings[0].observations.map((finding) => finding.scanner), ["npm", "trivy"]);
  assert.deepEqual(result.sources.map((source) => source.scope),
    ["release-build", "release-image-amd64", "release-image-arm64"]);
  assert.equal(result.assessmentGates[0].profile, "active");
});

test("given stale or digest-mismatched inputs, when combining release evidence, then publication fails closed", () => {
  // given
  const source = (scope, subject, generatedAt = "2026-08-15T00:00:00.000Z") => ({
    schemaVersion: 1, scope, subject, assessmentPolicy: "not-applicable", generatedAt, status: "passed",
    evidenceSources: [{ scanner: "trivy", subject }],
    blockingFindings: [], acceptedFindings: [], informationalFindings: []
  });
  const summaries = [
    source("release-build", releaseCommit), source("release-image-amd64", releaseDigest),
    source("release-image-arm64", releaseDigest)
  ];
  const assessmentGates = [activeAssessmentGate()];

  // when / then
  assert.throws(() => combineSecuritySummaries({
    summaries: summaries.map((summary, index) => index === 1 ? { ...summary, subject: "other-digest" } : summary),
    scope: "release", subject: releaseDigest, sourceSubject: releaseCommit, today, assessmentGates
  }), /subject mismatch/);
  assert.throws(() => combineSecuritySummaries({
    summaries: summaries.map((summary, index) => index === 0
      ? { ...summary, generatedAt: "2026-08-01T00:00:00.000Z" }
      : summary),
    scope: "release", subject: releaseDigest, sourceSubject: releaseCommit, today, assessmentGates
  }), /stale/);
});

test("given missing or mismatched active assessment evidence, when combining a release, then publication fails closed", () => {
  // given
  const source = (scope, subject) => ({
    schemaVersion: 1, scope, subject, assessmentPolicy: "not-applicable",
    generatedAt: "2026-08-15T00:00:00.000Z", status: "passed",
    evidenceSources: [{ scanner: "trivy", subject }],
    blockingFindings: [], acceptedFindings: [], informationalFindings: []
  });
  const summaries = [source("release-build", releaseCommit), source("release-image-amd64", releaseDigest),
    source("release-image-arm64", releaseDigest)];
  const gate = activeAssessmentGate();

  // when / then
  for (const assessmentGates of [[], [{ ...gate, status: "incomplete", reason: "Scanner unavailable" }],
    [{ ...gate, subject: "other" }],
    [{ ...gate, sourceCommit: "other" }], [{ ...gate, profile: "safe" }]]) {
    assert.throws(() => combineSecuritySummaries({
      summaries, scope: "release", subject: releaseDigest, sourceSubject: releaseCommit, today, assessmentGates
    }), /assessment gate|active-assessment evidence|exactly one active/);
  }
});

test("given an incomplete dynamic assessment, when combining release evidence, then release creation fails closed", () => {
  // given
  const summary = {
    schemaVersion: 1, scope: "release-build", subject: "commit", assessmentPolicy: "required", status: "incomplete",
    generatedAt: "2026-08-15T00:00:00.000Z",
    blockingFindings: [], acceptedFindings: [], informationalFindings: [],
    assessment: { outcome: { outcome: "incomplete", reason: "validation pending" } }
  };

  // when / then
  assert.throws(() => combineSecuritySummaries({ summaries: [summary], scope: "release", subject: "digest", today }),
    /incomplete security evidence/);
});

test("given a passed dynamic assessment, when combining release evidence, then it remains in the release record", () => {
  // given
  const assessment = { outcome: { outcome: "passed", reason: null } };
  const summary = {
    schemaVersion: 1, scope: "release-build", subject: "commit", assessmentPolicy: "required", status: "passed",
    generatedAt: "2026-08-15T00:00:00.000Z",
    blockingFindings: [], acceptedFindings: [], informationalFindings: [], assessment
  };

  // when
  const result = combineSecuritySummaries({ summaries: [summary], scope: "combined-test", subject: "digest", today });

  // then
  assert.deepEqual(result.assessments, [assessment]);
});

test("given a source summary that hides its assessment outcome, when combining it, then release creation fails closed", () => {
  // given
  const summary = {
    schemaVersion: 1, scope: "release-build", subject: "commit", assessmentPolicy: "required", status: "passed",
    generatedAt: "2026-08-15T00:00:00.000Z",
    blockingFindings: [], acceptedFindings: [], informationalFindings: [],
    assessment: { outcome: { outcome: "failed", reason: "validated finding remains unresolved" } }
  };

  // when / then
  assert.throws(() => combineSecuritySummaries({ summaries: [summary], scope: "release", subject: "digest", today }),
    /contradicts its assessment outcome/);
});

test("given duplicate source scopes, when combining a release record, then the gate fails closed", () => {
  // given
  const summary = { schemaVersion: 1, scope: "release-image-amd64", subject: "digest", assessmentPolicy: "not-applicable",
    generatedAt: "2026-08-15T00:00:00.000Z", status: "passed",
    blockingFindings: [], acceptedFindings: [], informationalFindings: [] };

  // when / then
  assert.throws(() => combineSecuritySummaries({ summaries: [summary, summary], scope: "release", subject: "digest", today }),
    /unique source scopes/);
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
      "--trivy", runtime, "--trivy", source, "--exceptions", exceptions,
      "--trivy-version", "0.70.0", "--assessment-policy", "not-applicable", "--scope", "required-build",
      "--subject", "commit", "--output", output]);

    // then
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")).blockingFindings.map((finding) => finding.id),
      ["CVE-2026-4000", "DS-001"]);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("given a dynamic lifecycle, when invoking the existing policy CLI, then one normalized record contains both sources", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-security-"));
  const report = join(directory, "report.json");
  const lifecycle = join(directory, "lifecycle.json");
  const exceptions = join(directory, "exceptions.json");
  const output = join(directory, "summary.json");
  writeFileSync(report, JSON.stringify({ Results: [] }));
  writeFileSync(lifecycle, JSON.stringify({
    schemaVersion: 1,
    run: {
      runId: "run-0001", attempt: 1, subject: "commit", profile: "safe", outcome: "incomplete",
      targetFingerprint: `sha256:${"a".repeat(64)}`,
      catalogVersion: "1.0.0", recordedAt: "2026-08-15T00:00:00.000Z"
    },
    candidates: [], findings: [], riskAcceptances: []
  }));
  writeFileSync(exceptions, JSON.stringify({ schemaVersion: 1, exceptions: [], riskAcceptances: [] }));

  try {
    // when
    const result = spawnSync(process.execPath, [join(toolsDirectory, "security-findings.mjs"),
      "--trivy", report, "--lifecycle", lifecycle, "--exceptions", exceptions,
      "--trivy-version", "0.70.0", "--assessment-policy", "required",
      "--scope", "required-build", "--subject", "commit", "--output", output]);

    // then
    assert.equal(result.status, 0, result.stderr.toString());
    const summary = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(summary.status, "passed");
    assert.equal(summary.assessment.run.runId, "run-0001");
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("given dynamic assessment is required, when its lifecycle is absent, then the existing policy CLI fails closed", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-security-"));
  const report = join(directory, "report.json");
  const exceptions = join(directory, "exceptions.json");
  const output = join(directory, "summary.json");
  writeFileSync(report, JSON.stringify({ Results: [] }));
  writeFileSync(exceptions, JSON.stringify({ schemaVersion: 1, exceptions: [], riskAcceptances: [] }));

  try {
    // when
    const result = spawnSync(process.execPath, [join(toolsDirectory, "security-findings.mjs"),
      "--trivy", report, "--exceptions", exceptions, "--assessment-policy", "required",
      "--trivy-version", "0.70.0",
      "--scope", "required-build", "--subject", "commit", "--output", output]);

    // then
    assert.equal(result.status, 1);
    assert.match(result.stderr.toString(), /Required lifecycle record is missing/);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
