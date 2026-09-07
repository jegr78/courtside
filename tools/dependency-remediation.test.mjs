import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  collectDependabotAlerts,
  currentDependencyEvidence,
  dependencyConfigPath,
  evaluateDependencyRemediation,
  runDependencyRemediation,
  skippedDependencyEvidence
} from "./dependency-remediation.mjs";

const policy = JSON.parse(readFileSync(
  fileURLToPath(new URL("../security/dependency-remediation-policy.json", import.meta.url)), "utf8"));

test("given a non-root working directory, when resolving default configuration, then it remains repository-relative", () => {
  assert.equal(dependencyConfigPath(undefined, "security/dependency-remediation-policy.json"),
    fileURLToPath(new URL("../security/dependency-remediation-policy.json", import.meta.url)));
  assert.equal(dependencyConfigPath("custom-policy.json", "security/dependency-remediation-policy.json"),
    "custom-policy.json");
});
const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const baseAlert = {
  number: 17,
  state: "open",
  dependency: {
    package: { ecosystem: "npm", name: "example-package" },
    manifest_path: "frontend/package-lock.json",
    scope: "runtime"
  },
  security_advisory: { ghsa_id: "GHSA-1111-2222-3333", severity: "high" },
  security_vulnerability: {
    vulnerable_version_range: "< 2.0.0",
    first_patched_version: { identifier: "2.0.0" }
  },
  created_at: "2026-08-01T00:00:00Z"
};
const now = new Date("2026-09-07T00:00:00Z");
const identity = '["GHSA-1111-2222-3333","npm","example-package","frontend/package-lock.json"]';

function evaluate(alerts, overrides = {}) {
  const currentFindings = alerts.map((alert) => ({
    aliases: [alert.security_advisory.ghsa_id, alert.security_advisory.cve_id].filter(Boolean),
    component: alert.dependency.package.name,
    ecosystem: alert.dependency.package.ecosystem.toLowerCase(),
    manifestPath: alert.dependency.manifest_path.replace(/^\/+/, ""),
    severity: alert.security_advisory.severity
  }));
  return evaluateDependencyRemediation({
    alerts,
    currentFindings,
    policy,
    exceptions: { schemaVersion: 1, dependencyExceptions: [] },
    assessments: [],
    subject: "a".repeat(40),
    now,
    ...overrides
  });
}

function securitySummary(overrides = {}) {
  return {
    schemaVersion: 1,
    scope: "scheduled-npm-audit",
    subject: "a".repeat(40),
    status: "passed",
    evidenceSources: [{ scanner: "npm", status: "completed", subject: "a".repeat(40) }],
    blockingFindings: [],
    acceptedFindings: [],
    informationalFindings: [{
      scanner: "npm",
      id: "1234",
      severity: "MEDIUM",
      target: "example-package@<2.0.0",
      component: "example-package",
      aliases: ["1234", "GHSA-1111-2222-3333"]
    }],
    ...overrides
  };
}

test("given immutable scanner evidence, when reading current dependencies, then findings retain package provenance", () => {
  const evidence = currentDependencyEvidence([securitySummary()], "a".repeat(40));

  assert.deepEqual(evidence, {
    status: "completed",
    findings: [{
      aliases: ["1234", "GHSA-1111-2222-3333"],
      component: "example-package",
      ecosystem: "npm",
      manifestPath: "frontend/package-lock.json",
      severity: "medium"
    }]
  });
});

test("given stale Dependabot state, when the exact scanner summary disagrees, then the tested commit decides current state", () => {
  const absent = evaluate([baseAlert], { currentFindings: [] });
  const fixedHistory = evaluate([{ ...baseAlert, state: "fixed" }]);

  assert.equal(absent.findings.length, 0);
  assert.equal(absent.releaseReadiness, "ready");
  assert.equal(fixedHistory.findings.length, 1);
  assert.equal(fixedHistory.releaseReadiness, "blocked");
});

test("given a current finding before Dependabot ingests it, when evaluating release readiness, then correlation blocks release", () => {
  const currentFindings = [{
    aliases: ["GHSA-1111-2222-3333"], component: "example-package", ecosystem: "npm",
    manifestPath: "frontend/package-lock.json", severity: "medium"
  }];
  const syntheticIdentity = '["GHSA-1111-2222-3333","npm","example-package","frontend/package-lock.json"]';
  const exceptions = { schemaVersion: 1, dependencyExceptions: [{
    id: "dependency-unknown-2026",
    identity: syntheticIdentity,
    affectedVersionRange: "unknown",
    owner: "maintainer",
    reachabilityAnalysis: "The scanner does not expose a correlated dependency range.",
    riskAnalysis: "The advisory needs Dependabot metadata before an exception can be assessed.",
    compensatingControl: "Release remains blocked until correlation completes.",
    acceptedAt: "2026-09-01T00:00:00Z",
    reviewOn: "2026-09-15"
  }] };
  const result = evaluate([], {
    currentFindings, exceptions, now: new Date("2026-09-01T00:00:00Z")
  });

  assert.equal(result.findings[0].disposition, "pending-alert-correlation");
  assert.equal(result.findings[0].exception, null);
  assert.equal(result.releaseReadiness, "blocked");
});

test("given scanner evidence for another subject or an unavailable scanner, when reading it, then it cannot become successful evidence", () => {
  assert.throws(() => currentDependencyEvidence([
    securitySummary({ subject: "b".repeat(40) })
  ], "a".repeat(40)), /subject mismatch/);

  const unavailable = securitySummary({
    scope: "release-build",
    evidenceSources: [
      { scanner: "npm", status: "skipped", reason: "service-unavailable", subject: "a".repeat(40) },
      { scanner: "trivy", status: "completed", subject: "a".repeat(40) }
    ],
    informationalFindings: [{
      scanner: "trivy",
      id: "CVE-2026-1000",
      severity: "MEDIUM",
      target: "Java:org.example:example-package@1.0.0",
      component: "org.example:example-package",
      aliases: ["CVE-2026-1000", "GHSA-1111-2222-3333"]
    }]
  });
  assert.deepEqual(currentDependencyEvidence([unavailable], "a".repeat(40)), {
    status: "partial",
    reason: "service-unavailable",
    findings: [{
      aliases: ["CVE-2026-1000", "GHSA-1111-2222-3333"],
      component: "org.example:example-package",
      ecosystem: "maven",
      manifestPath: "pom.xml",
      severity: "medium"
    }]
  });
});

test("given later instances of one finding, when evaluating an open alert, then its original discovery starts the clock", () => {
  const reopened = { ...baseAlert, number: 18, created_at: "2026-09-06T00:00:00Z" };
  const oldFixed = { ...baseAlert, state: "fixed", fixed_at: "2026-09-01T00:00:00Z" };

  const result = evaluate([reopened, oldFixed]);

  assert.equal(result.findings[0].firstDetectedAt, "2026-08-01T00:00:00.000Z");
  assert.equal(result.findings[0].remediationDueAt, "2026-08-08T00:00:00.000Z");
  assert.equal(result.releaseReadiness, "blocked");
});

test("given distinct alert identities, when deriving history, then their clocks are not conflated", () => {
  const otherManifest = {
    ...baseAlert,
    state: "fixed",
    created_at: "2026-01-01T00:00:00Z",
    dependency: { ...baseAlert.dependency, manifest_path: "site/package-lock.json" }
  };

  const result = evaluate([baseAlert, otherManifest]);

  assert.equal(result.findings[0].firstDetectedAt, "2026-08-01T00:00:00.000Z");
});

test("given each supported severity, when its boundary is reached, then the documented deadline applies", () => {
  const expectedDays = { critical: 3, high: 7, medium: 30, low: 90 };

  for (const [severity, days] of Object.entries(expectedDays)) {
    const alert = {
      ...baseAlert,
      security_advisory: { ...baseAlert.security_advisory, severity },
      created_at: "2026-09-01T00:00:00Z"
    };
    const result = evaluate([alert], {
      now: new Date(new Date(alert.created_at).valueOf() + days * 86_400_000)
    });
    assert.equal(result.findings[0].remediationState, "due", severity);
  }
  assert.throws(() => evaluate([{ ...baseAlert,
    security_advisory: { ...baseAlert.security_advisory, severity: "unknown" } }]),
  /unsupported severity/);
});

test("given GitHub reports Moderate, when evaluating its policy class, then the Medium deadline applies", () => {
  const alert = {
    ...baseAlert,
    security_advisory: { ...baseAlert.security_advisory, severity: "moderate" },
    created_at: "2026-08-01T00:00:00Z"
  };

  const result = evaluate([alert]);

  assert.equal(result.findings[0].severity, "medium");
  assert.equal(result.findings[0].remediationDueAt, "2026-08-31T00:00:00.000Z");
});

test("given an urgent or unassessed Critical, when 24 hours pass, then containment evidence is required", () => {
  const critical = {
    ...baseAlert,
    security_advisory: { ...baseAlert.security_advisory, severity: "critical" },
    created_at: "2026-09-05T00:00:00Z"
  };

  const unassessed = evaluate([critical]);
  const assessedNotReachable = evaluate([critical], { assessments: [{
    identity,
    directReachable: false,
    activelyExploited: false,
    rationale: "The vulnerable optional parser is not loaded by the application.",
    assessedAt: "2026-09-05T12:00:00Z"
  }] });

  assert.equal(unassessed.findings[0].containmentState, "overdue");
  assert.equal(assessedNotReachable.findings[0].containmentState, "not-required");
});

test("given an exact current exception, when remediation is overdue, then one maintainer can keep release readiness", () => {
  const exceptions = { schemaVersion: 1, dependencyExceptions: [{
    id: "dependency-example-2026",
    identity,
    affectedVersionRange: "< 2.0.0",
    owner: "maintainer",
    reachabilityAnalysis: "Only an authenticated import path can reach the affected parser.",
    riskAnalysis: "Malformed input can stop one import but cannot cross tenant boundaries.",
    compensatingControl: "Imports are restricted to administrators and file size is bounded.",
    acceptedAt: "2026-08-02T00:00:00Z",
    reviewOn: "2026-09-15",
    expiresOn: "2026-09-30"
  }] };

  const accepted = evaluate([baseAlert], { exceptions });
  assert.equal(accepted.releaseReadiness, "ready");
  assert.equal(accepted.findings[0].exception.id, "dependency-example-2026");
  assert.equal(accepted.findings[0].exception.validUntil, "2026-09-15T23:59:59.999Z");

  const expiryOnly = structuredClone(exceptions);
  delete expiryOnly.dependencyExceptions[0].reviewOn;
  assert.equal(evaluate([baseAlert], { exceptions: expiryOnly }).releaseReadiness, "ready");
  const reviewOnly = structuredClone(exceptions);
  delete reviewOnly.dependencyExceptions[0].expiresOn;
  assert.equal(evaluate([baseAlert], { exceptions: reviewOnly }).releaseReadiness, "ready");

  const expired = structuredClone(exceptions);
  expired.dependencyExceptions[0].reviewOn = "2026-09-06";
  expired.dependencyExceptions[0].expiresOn = "2026-09-06";
  assert.equal(evaluate([baseAlert], { exceptions: expired }).releaseReadiness, "blocked");
  const reviewOverdue = structuredClone(exceptions);
  reviewOverdue.dependencyExceptions[0].reviewOn = "2026-09-06";
  assert.equal(evaluate([baseAlert], { exceptions: reviewOverdue }).releaseReadiness, "blocked");
  const impossibleDate = structuredClone(exceptions);
  impossibleDate.dependencyExceptions[0].reviewOn = "2026-02-31";
  assert.throws(() => evaluate([baseAlert], { exceptions: impossibleDate }), /must be a date/);
  assert.throws(() => evaluate([baseAlert], { exceptions: { schemaVersion: 1, dependencyExceptions: [
    ...exceptions.dependencyExceptions, ...exceptions.dependencyExceptions
  ] } }), /duplicate dependency exception/);
});

test("given future or pre-finding judgments, when evaluating them, then they cannot satisfy the gate", () => {
  const futureAssessment = [{
    identity,
    directReachable: false,
    activelyExploited: false,
    rationale: "The affected path is not loaded.",
    assessedAt: "2026-09-08T00:00:00Z"
  }];
  assert.throws(() => evaluate([baseAlert], { assessments: futureAssessment }), /valid time window/);

  const malformed = { ...baseAlert, state: "unknown" };
  assert.throws(() => evaluate([malformed]), /unsupported alert state/);
  assert.throws(() => evaluate([baseAlert], { subject: "main" }), /immutable commit SHA/);
  assert.throws(() => evaluate([{ ...baseAlert, created_at: "2026-09-08T00:00:00Z" }]),
    /future/);
});

test("given committed dependency policy files and generated evidence, when validating them, then their shapes stay closed", () => {
  const ajv = new Ajv({ strict: true, allErrors: true, formats: { "date": true, "date-time": true } });
  const validators = new Map();
  const fixtures = [
    ["dependency-remediation-policy", policy],
    ["dependency-assessments", JSON.parse(readFileSync(new URL("../security/dependency-assessments.json", import.meta.url), "utf8"))],
    ["dependency-remediation-evidence", evaluate([])],
    ["dependency-remediation-evidence", skippedDependencyEvidence({
      reason: "service-unavailable",
      subject: "a".repeat(40),
      now,
      findings: evaluate([baseAlert]).findings,
      blocked: true
    })]
  ];
  for (const [name, value] of fixtures) {
    const schema = JSON.parse(readFileSync(new URL(`../security/${name}.schema.json`, import.meta.url), "utf8"));
    const validate = validators.get(name) ?? ajv.compile(schema);
    validators.set(name, validate);
    assert.equal(validate(value), true, `${name}: ${JSON.stringify(validate.errors)}`);
    const unknown = { ...value, unexpected: true };
    assert.equal(validate(unknown), false, `${name} accepts unknown fields`);
  }
});

test("given open findings, when fix availability differs, then unavailable upstream and unplanned work stay distinct", () => {
  const unavailable = structuredClone(baseAlert);
  unavailable.number = 19;
  unavailable.security_advisory.ghsa_id = "GHSA-4444-5555-6666";
  unavailable.security_vulnerability.first_patched_version = null;

  const result = evaluate([baseAlert, unavailable]);

  assert.deepEqual(result.findings.map(({ disposition }) => disposition).sort(),
    ["unavailable-upstream-fix", "unplanned-update"]);
});

test("given an assessed remediation issue, when a fix exists, then the update is planned rather than unplanned", () => {
  const result = evaluate([baseAlert], { assessments: [{
    identity,
    directReachable: true,
    activelyExploited: false,
    rationale: "The dependency is loaded on the import path.",
    assessedAt: "2026-08-02T00:00:00Z",
    remediationPlan: "#123"
  }] });

  assert.equal(result.findings[0].disposition, "planned-update");
  assert.equal(result.findings[0].remediationPlan, "#123");
});

test("given an inaccurate historical alert, when a reliable alert appears later, then the rejected signal does not start the clock", () => {
  const inaccurate = {
    ...baseAlert,
    state: "dismissed",
    dismissed_reason: "inaccurate",
    created_at: "2026-01-01T00:00:00Z"
  };
  const current = { ...baseAlert, created_at: "2026-09-01T00:00:00Z" };

  assert.equal(evaluate([inaccurate, current]).findings[0].firstDetectedAt,
    "2026-09-01T00:00:00.000Z");
});

test("given a confirmed alert is dismissed without a repository exception, when it is overdue, then release stays blocked", () => {
  for (const [state, dismissed_reason] of [["dismissed", "tolerable_risk"],
    ["dismissed", "not_used"], ["auto_dismissed", null]]) {
    const alert = { ...baseAlert, state, dismissed_reason };
    assert.equal(evaluate([alert]).releaseReadiness, "blocked", `${state}:${dismissed_reason}`);
  }
});

test("given Dependabot availability failures, when collecting alerts, then only proven outages become skipped evidence", async () => {
  const connection = { repository: "example/courtside", token: "secret" };
  const service = await collectDependabotAlerts({ ...connection,
    request: async () => ({ status: 503, headers: new Headers(), json: async () => ({}) }) });
  const rateLimit = await collectDependabotAlerts({ ...connection, request: async () => ({
    status: 403,
    headers: new Headers({ "x-ratelimit-remaining": "0" }),
    json: async () => ({ message: "rate limit" })
  }) });
  assert.deepEqual(service, { status: "skipped", reason: "service-unavailable" });
  assert.deepEqual(rateLimit, { status: "skipped", reason: "rate-limited" });

  await assert.rejects(() => collectDependabotAlerts({ ...connection, request: async () => ({
    status: 403, headers: new Headers(), json: async () => ({ message: "forbidden" })
  }) }), /403/);
  let malformedRequest = 0;
  await assert.rejects(() => collectDependabotAlerts({ ...connection, request: async () => ({
    status: 200,
    headers: new Headers(),
    json: async () => malformedRequest++ === 0 ? { alerts: [] } : []
  }) }), /array/);

  for (const code of ["ENOTFOUND", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"]) {
    const unavailable = await collectDependabotAlerts({ ...connection, request: async () => {
      const error = new Error("connection failed");
      error.cause = { code };
      throw error;
    } });
    assert.deepEqual(unavailable, { status: "skipped", reason: "network-unavailable" }, code);
  }
});

test("given a prior successful artifact, when Dependabot is unavailable, then its age remains visible without a release block", () => {
  const evidence = skippedDependencyEvidence({
    reason: "service-unavailable",
    subject: "a".repeat(40),
    now,
    previousEvidenceAt: "2026-09-05T00:00:00Z"
  });

  assert.equal(evidence.status, "skipped");
  assert.equal(evidence.releaseReadiness, "unknown");
  assert.equal(evidence.lastSuccessfulEvidenceAt, "2026-09-05T00:00:00.000Z");
  assert.equal(evidence.lastSuccessfulEvidenceAgeDays, 2);
});

test("given partial scanner evidence proves an overdue finding, when retaining the outage, then the known block survives", () => {
  const evaluated = evaluate([baseAlert]);
  const evidence = skippedDependencyEvidence({
    reason: "service-unavailable",
    subject: "a".repeat(40),
    now,
    previousEvidenceAt: "2026-09-05T00:00:00Z",
    findings: evaluated.findings,
    blocked: true
  });

  assert.equal(evidence.status, "skipped");
  assert.equal(evidence.releaseReadiness, "blocked");
  assert.equal(evidence.findings.length, 1);
});

test("given prior completed evidence and a current matching finding, when the alert API is unavailable, then its overdue block remains", async () => {
  const directory = mkdtempSync(join(tmpdir(), "courtside-dependency-"));
  const summaryPath = join(directory, "current.json");
  const previousPath = join(directory, "previous.json");
  const outputPath = join(directory, "output.json");
  writeFileSync(summaryPath, JSON.stringify(securitySummary()));
  writeFileSync(previousPath, JSON.stringify(evaluate([baseAlert])));

  try {
    const evidence = await runDependencyRemediation({
      repository: "example/courtside",
      subject: "a".repeat(40),
      "current-summary": [summaryPath],
      "previous-evidence": previousPath,
      output: outputPath,
      token: "secret",
      request: async () => ({ status: 503, headers: new Headers(), json: async () => ({}) })
    });

    assert.equal(evidence.status, "skipped");
    assert.equal(evidence.releaseReadiness, "blocked");
    assert.equal(evidence.findings[0].firstDetectedAt, "2026-08-01T00:00:00.000Z");
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("given paginated alert history, when collecting it, then all states and pages are requested from fixed URLs", async () => {
  const urls = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ ...baseAlert, number: index + 1 }));
  const result = await collectDependabotAlerts({
    repository: "example/courtside",
    apiUrl: "https://api.github.test",
    token: "secret",
    request: async (url) => {
      urls.push(url);
      const headers = new Headers();
      if (urls.length === 1) headers.set("link",
        '<https://api.github.test/repos/example/courtside/dependabot/alerts?state=auto_dismissed%2Copen%2Cdismissed%2Cfixed&per_page=100&after=opaque>; rel="next"');
      const body = urls.length === 1 ? firstPage : [];
      return { status: 200, headers, json: async () => body };
    }
  });

  assert.equal(result.status, "completed");
  assert.equal(result.alerts.length, 100);
  assert.deepEqual(urls, [
    "https://api.github.test/repos/example/courtside/dependabot/alerts?state=auto_dismissed%2Copen%2Cdismissed%2Cfixed&per_page=100",
    "https://api.github.test/repos/example/courtside/dependabot/alerts?state=auto_dismissed%2Copen%2Cdismissed%2Cfixed&per_page=100&after=opaque"
  ]);
});

test("given an untrusted pagination link, when collecting history, then the GitHub token never follows it", async () => {
  let requestNumber = 0;
  await assert.rejects(() => collectDependabotAlerts({
    repository: "example/courtside",
    apiUrl: "https://api.github.test",
    token: "secret",
    request: async () => ({
      status: 200,
      headers: new Headers({
        link: '<https://attacker.test/capture?after=opaque>; rel="next"'
      }),
      json: async () => requestNumber++ === 0 ? [baseAlert] : []
    })
  }), /fixed API boundary/);
});
