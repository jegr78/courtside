import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  assessmentOutcome, createCandidate, createFinding, fingerprintFinding, publicFindingSummary,
  classifyCandidate, recordRetest, retainFindingEvidence, summarizeFindingLifecycle, transitionFinding,
  validateRiskAcceptances
} from "./security-triage.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const schema = JSON.parse(readFileSync(new URL("../security/finding-lifecycle.schema.json", import.meta.url)));
const exceptionSchema = JSON.parse(readFileSync(new URL("../security/exceptions.schema.json", import.meta.url)));
const exceptionPolicy = JSON.parse(readFileSync(new URL("../security/exceptions.json", import.meta.url)));
const documentation = readFileSync(new URL("../docs/security-findings.md", import.meta.url), "utf8");
const digest = `sha256:${"a".repeat(64)}`;

function lifecycle(overrides = {}) {
  return {
    schemaVersion: 1,
    run: {
      runId: "run-0001", attempt: 1, subject: "commit:abcdef0", profile: "safe",
      outcome: "incomplete", targetFingerprint: digest,
      catalogVersion: "1.0.0", recordedAt: "2026-08-20T14:00:00.000Z"
    },
    candidates: [], findings: [], riskAcceptances: [],
    ...overrides
  };
}

function candidate(overrides = {}) {
  return createCandidate({
    scanner: "zap",
    ruleId: "10020",
    normalizedSurface: "POST /api/session",
    parameter: "username",
    attackClass: "authentication-enumeration",
    provenance: {
      tool: "owasp-zap", version: "2.17.0", runId: "run-0001", attempt: 1,
      targetFingerprint: digest, observedAt: "2026-08-20T12:00:00.000Z"
    },
    evidence: [{
      id: "evidence-0001", status: "retained", classification: "protected", digest,
      expiresOn: "2026-09-03"
    }],
    ...overrides
  });
}

function finding(source = candidate(), overrides = {}) {
  return createFinding(source, {
    priority: "P1",
    cvssVector: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:L/VI:N/VA:N/SC:N/SI:N/SA:N",
    mappings: {
      cwe: ["CWE-204"], wstg: ["WSTG-v4.2-ATHN-04"],
      asvs: ["v5.0.0-2.2.1"], apiTop10: ["API2:2023"]
    },
    context: {
      impact: "An anonymous caller can distinguish existing accounts.",
      reachability: "The login route is public in the reference deployment."
    },
    validation: {
      method: "regression-test", reference: "LoginEnumerationTest",
      reproducedAt: "2026-08-20T13:00:00.000Z", actor: "maintainer"
    },
    ...overrides
  });
}

test("given lifecycle records, when validating their schema, then provenance evidence and expiry are mandatory", () => {
  // given
  const validate = new Ajv({ strict: true, allErrors: true, formats: false }).compile(schema);
  const record = {
    schemaVersion: 1,
    run: {
      runId: "run-0001", attempt: 1, subject: "commit:abcdef0", profile: "safe",
      outcome: "incomplete", targetFingerprint: digest,
      catalogVersion: "1.0.0", recordedAt: "2026-08-20T14:00:00.000Z"
    },
    candidates: [candidate()], findings: [finding()], riskAcceptances: []
  };

  // when / then
  assert.equal(validate(record), true, JSON.stringify(validate.errors));
  const withoutProvenance = structuredClone(record);
  delete withoutProvenance.candidates[0].provenance;
  assert.equal(validate(withoutProvenance), false);
  const withoutStatus = structuredClone(record);
  delete withoutStatus.candidates[0].evidence[0].status;
  assert.equal(validate(withoutStatus), false);
  const withoutExpiry = structuredClone(record);
  delete withoutExpiry.candidates[0].evidence[0].expiresOn;
  assert.equal(validate(withoutExpiry), false);
  const invalidVector = structuredClone(record);
  invalidVector.findings[0].cvssVector = "CVSS:4.0/not-a-vector";
  assert.equal(validate(invalidVector), false);
  const emptyMappings = structuredClone(record);
  emptyMappings.findings[0].mappings.cwe = [];
  assert.equal(validate(emptyMappings), false);
});

test("given the shared exception policy, when adding dynamic risk acceptance, then the same closed policy validates it", () => {
  // given
  const validate = new Ajv({ strict: true, allErrors: true, formats: false }).compile(exceptionSchema);

  // when / then
  assert.equal(validate(exceptionPolicy), true, JSON.stringify(validate.errors));
  const unknownField = structuredClone(exceptionPolicy);
  unknownField.riskAcceptances.push({ unexpected: true });
  assert.equal(validate(unknownField), false);
});

test("given protected exploit evidence, when documenting triage, then public and private handling stay distinct", () => {
  // when / then
  assert.match(documentation, /GitHub private vulnerability reporting/);
  assert.match(documentation, /do not belong in repository files, ordinary GitHub issues, CI logs/);
  assert.match(documentation, /One maintainer may perform every step/);
  assert.match(documentation, /P0 findings cannot be accepted/);
});

test("given equivalent scanner observations, when fingerprinting them, then scanner and formatting differences do not split the finding", () => {
  // when
  const first = fingerprintFinding("10020", "POST   /api/session", " Username ", "AUTHENTICATION-ENUMERATION");
  const second = fingerprintFinding("10020", "post /api/session", "username", "authentication-enumeration");

  // then
  assert.equal(first, second);
  assert.match(first, /^sha256:[a-f0-9]{64}$/);
});

test("given an unvalidated scanner candidate, when calculating the assessment outcome, then it is incomplete rather than release-blocking", () => {
  // when
  const result = assessmentOutcome({ candidates: [candidate()], findings: [], riskAcceptances: [] }, "2026-08-20");

  // then
  assert.deepEqual(result, { outcome: "incomplete", reason: "1 candidate awaits reproducible validation" });
});

test("given a scanner candidate, when promoting it without reproducible validation, then promotion is rejected", () => {
  // when / then
  assert.throws(() => createFinding(candidate(), { priority: "P1" }), /reproducible validation/);
});

test("given a disposed candidate, when promoting it, then promotion is rejected", () => {
  // given
  const disposed = classifyCandidate(candidate(), {
    state: "false-positive", rationale: "The response is identical for existing and absent accounts.",
    actor: "maintainer", classifiedAt: "2026-08-20T13:00:00.000Z", reference: "LoginEnumerationTest"
  });

  // when / then
  assert.throws(() => finding(disposed), /Only an untriaged candidate can be validated/);
});

test("given a scanner candidate, when rejecting or deduplicating it, then an auditable disposition is required", () => {
  // given
  const source = candidate();

  // when / then
  assert.throws(() => classifyCandidate(source, { state: "false-positive" }), /disposition requires rationale/);
  const rejected = classifyCandidate(source, {
    state: "false-positive", rationale: "The response is identical for existing and absent accounts.",
    actor: "maintainer", classifiedAt: "2026-08-20T13:00:00.000Z", reference: "LoginEnumerationTest"
  });
  assert.equal(rejected.state, "false-positive");
  assert.equal(assessmentOutcome({ candidates: [rejected], findings: [], riskAcceptances: [] }, "2026-08-20").outcome,
    "passed");
  assert.throws(() => classifyCandidate(rejected, {
    state: "duplicate", rationale: "Already tracked.", actor: "maintainer",
    classifiedAt: "2026-08-20T14:00:00.000Z", reference: "private-advisory"
  }), /Only an untriaged candidate can be classified/);
});

test("given a validated finding, when remediation changes its state, then the transition remains in its history", () => {
  // given
  const validated = finding();

  // when
  const remediating = transitionFinding(validated, {
    state: "remediation-in-progress", actor: "maintainer",
    changedAt: "2026-08-20T14:00:00.000Z", reference: "private-advisory"
  });

  // then
  assert.equal(remediating.state, "remediation-in-progress");
  assert.deepEqual(remediating.transitions.map((transition) => transition.state),
    ["validated", "remediation-in-progress"]);
});

test("given a finding, when skipping lifecycle states, then the transition is rejected", () => {
  // given
  const validated = finding();

  // when / then
  assert.throws(() => transitionFinding(validated, {
    state: "fixed", actor: "maintainer", changedAt: "2026-08-20T14:00:00.000Z", reference: "private-advisory"
  }), /Invalid finding transition from validated to fixed/);
  assert.throws(() => recordRetest(validated, {
    outcome: "passed", testedAt: "2026-08-20T14:00:00.000Z", actor: "maintainer",
    reference: "LoginEnumerationTest"
  }), /Only a fixed finding can be retested/);
});

test("given a passed retest, when the same finding returns, then it is marked as a regression", () => {
  // given
  const remediating = transitionFinding(finding(), {
    state: "remediation-in-progress", actor: "maintainer",
    changedAt: "2026-08-20T13:30:00.000Z", reference: "private-advisory"
  });
  const fixed = transitionFinding(remediating, {
    state: "fixed", actor: "maintainer", changedAt: "2026-08-20T13:45:00.000Z", reference: "private-advisory"
  });
  const closed = recordRetest(fixed, {
    outcome: "passed", testedAt: "2026-08-20T14:00:00.000Z", actor: "maintainer",
    reference: "LoginEnumerationTest"
  });

  // when
  const returned = createCandidate({ ...candidate(), priorFindings: [closed] });

  // then
  assert.equal(closed.state, "retest-passed");
  assert.equal(returned.regression, true);
});

test("given adversarial evidence, when retaining its safe projection, then secrets and personal fields never survive", () => {
  // given
  const raw = {
    method: "POST",
    statusCode: 401,
    problemType: "urn:courtside:error:bad-credentials",
    observationCode: "unexpected-problem",
    observedHeaders: ["content-type", "authorization", "set-cookie"]
  };

  // when
  const retained = retainFindingEvidence(raw);
  const serialized = JSON.stringify(retained);

  // then
  assert.doesNotMatch(serialized, /abcdef|jane\.doe|abc\.def\.ghi|SESSION=|hunter2|key-value|Jane|sessionId/i);
  assert.deepEqual(Object.keys(retained),
    ["method", "statusCode", "problemType", "observationCode", "observedHeaders"]);
  assert.deepEqual(retained.observedHeaders, ["content-type"]);
});

test("given untrusted evidence fields, when retaining evidence, then the closed projection rejects them", () => {
  // given
  const valid = {
    method: "GET", statusCode: 200,
    problemType: "urn:courtside:error:court-unknown", observationCode: "unexpected-problem", observedHeaders: []
  };

  // when / then
  for (const input of [
    { ...valid, method: "TOKEN=secret" },
    { ...valid, statusCode: { token: "secret" } },
    { ...valid, problemType: "https://example.invalid/error?token=secret" },
    { ...valid, observation: "memberNumber=4711 dateOfBirth=2001-02-03" },
    { ...valid, unknown: "secret" },
    { ...valid, path: "/api/password-reset/opaque-secret" },
    { ...valid, observedHeaders: [42] }
  ]) {
    assert.throws(() => retainFindingEvidence(input), /Invalid retained evidence/);
  }
});

test("given schema-valid but forged lifecycle relationships, when summarizing, then evaluation fails closed", () => {
  // given
  const validated = finding();
  const closed = recordRetest(transitionFinding(transitionFinding(validated, {
    state: "remediation-in-progress", actor: "maintainer",
    changedAt: "2026-08-20T13:30:00.000Z", reference: "private-advisory"
  }), {
    state: "fixed", actor: "maintainer", changedAt: "2026-08-20T13:45:00.000Z", reference: "private-advisory"
  }), {
    outcome: "passed", testedAt: "2026-08-20T14:00:00.000Z", actor: "maintainer",
    reference: "LoginEnumerationTest"
  });
  const cases = [
    [{ ...finding(), fingerprint: digest }, /fingerprint/],
    [finding(candidate({ provenance: { ...candidate().provenance, runId: "run-9999" } })), /provenance/],
    [finding(candidate({ evidence: [{ ...candidate().evidence[0], expiresOn: "2026-08-19" }] })), /current retained evidence/],
    [{ ...closed, retests: [] }, /transition history/],
    [{ ...validated, state: "retest-passed" }, /current state/],
    [{ ...closed, transitions: closed.transitions.map((transition, index) => index === 1
      ? { ...transition, changedAt: "2026-08-20T12:30:00.000Z" }
      : transition) }, /chronology/]
  ];

  // when / then
  for (const [record, message] of cases) {
    assert.throws(() => summarizeFindingLifecycle(lifecycle({ findings: [record] }), exceptionPolicy, "2026-08-20"), message);
  }
});

test("given accepted risk, when its owner rationale control or expiry is absent or stale, then assessment fails closed", () => {
  // given
  const acceptance = {
    id: "acceptance-0001", fingerprint: candidate().fingerprint, owner: "maintainer",
    rationale: "The affected endpoint is disabled.", compensatingControl: "The proxy rejects the route.",
    expiresOn: "2026-09-01", acceptedAt: "2026-08-20T14:00:00.000Z", independentReview: false
  };

  // when / then
  assert.doesNotThrow(() => validateRiskAcceptances([acceptance], "2026-08-20"));
  assert.throws(() => validateRiskAcceptances([{ ...acceptance, owner: "" }], "2026-08-20"), /requires owner/);
  assert.throws(() => validateRiskAcceptances([{ ...acceptance, expiresOn: "2026-08-19" }], "2026-08-20"), /expired/);
});

test("given risk acceptance, when it is stale or targets P0, then it cannot make an assessment pass", () => {
  // given
  const acceptance = {
    id: "acceptance-0001", fingerprint: candidate().fingerprint, owner: "maintainer",
    rationale: "The affected endpoint is disabled.", compensatingControl: "The proxy rejects the route.",
    expiresOn: "2026-09-01", acceptedAt: "2026-08-20T14:00:00.000Z", independentReview: false
  };

  // when / then
  assert.throws(() => assessmentOutcome({ candidates: [], findings: [], riskAcceptances: [acceptance] }, "2026-08-20"),
    /does not match an accepted finding/);
  const acceptedP0 = transitionFinding(finding(candidate(), { priority: "P0" }), {
    state: "accepted-risk", actor: "maintainer", changedAt: "2026-08-20T14:00:00.000Z",
    reference: "acceptance-0001"
  });
  assert.throws(() => assessmentOutcome({
    candidates: [], findings: [acceptedP0],
    riskAcceptances: [acceptance]
  }, "2026-08-20"), /P0 finding cannot be accepted/);
  assert.throws(() => validateRiskAcceptances([acceptance, {
    ...acceptance, id: "acceptance-0002"
  }], "2026-08-20"), /Duplicate risk acceptance for fingerprint/);
});

test("given accepted risk, when acceptance is future-dated or misreferenced, then lifecycle validation fails closed", () => {
  // given
  const source = candidate();
  const accepted = transitionFinding(finding(source), {
    state: "accepted-risk", actor: "maintainer", changedAt: "2026-08-20T13:30:00.000Z",
    reference: "acceptance-0001"
  });
  const acceptance = {
    id: "acceptance-0001", fingerprint: source.fingerprint, owner: "maintainer",
    rationale: "The affected endpoint is disabled.", compensatingControl: "The proxy rejects the route.",
    expiresOn: "2026-09-01", acceptedAt: "2026-08-20T13:00:00.000Z", independentReview: false
  };

  // when / then
  assert.throws(() => summarizeFindingLifecycle(lifecycle({ findings: [accepted] }), {
    ...exceptionPolicy, riskAcceptances: [{ ...acceptance, acceptedAt: "2026-08-20T13:45:00.000Z" }]
  }, "2026-08-20"), /inconsistent risk acceptance/);
  const misreferenced = { ...accepted, transitions: accepted.transitions.map((transition, index) => index === 1
    ? { ...transition, reference: "acceptance-9999" }
    : transition) };
  assert.throws(() => summarizeFindingLifecycle(lifecycle({ findings: [misreferenced] }), {
    ...exceptionPolicy, riskAcceptances: [acceptance]
  }, "2026-08-20"), /inconsistent risk acceptance/);
  const expiredTransition = { ...accepted, transitions: accepted.transitions.map((transition, index) => index === 1
    ? { ...transition, changedAt: "2026-09-02T13:30:00.000Z" }
    : transition) };
  assert.throws(() => summarizeFindingLifecycle(lifecycle({
    run: { ...lifecycle().run, recordedAt: "2026-09-02T14:00:00.000Z" }, findings: [expiredTransition]
  }), { ...exceptionPolicy, riskAcceptances: [acceptance] }, "2026-08-20"), /inconsistent risk acceptance/);
});

test("given a fixed or accepted finding, when calculating the outcome, then retest and precise acceptance govern it", () => {
  // given
  const source = candidate();
  const acceptance = {
    id: "acceptance-0001", fingerprint: source.fingerprint, owner: "maintainer",
    rationale: "The affected endpoint is disabled.", compensatingControl: "The proxy rejects the route.",
    expiresOn: "2026-09-01", acceptedAt: "2026-08-20T14:00:00.000Z", independentReview: false
  };

  // when / then
  const remediating = transitionFinding(finding(source), {
    state: "remediation-in-progress", actor: "maintainer",
    changedAt: "2026-08-20T14:00:00.000Z", reference: "private-advisory"
  });
  const fixed = transitionFinding(remediating, {
    state: "fixed", actor: "maintainer", changedAt: "2026-08-20T14:30:00.000Z", reference: "private-advisory"
  });
  const accepted = transitionFinding(finding(source), {
    state: "accepted-risk", actor: "maintainer", changedAt: "2026-08-20T14:00:00.000Z",
    reference: "acceptance-0001"
  });

  // when / then
  assert.equal(assessmentOutcome({ candidates: [], findings: [fixed], riskAcceptances: [] }, "2026-08-20").outcome,
    "incomplete");
  assert.equal(assessmentOutcome({
    candidates: [], findings: [accepted], riskAcceptances: [acceptance]
  }, "2026-08-20").outcome, "passed");
});

test("given a protected validated finding, when publishing a summary, then exploit detail and evidence locations stay private", () => {
  // given
  const validated = finding(candidate({ evidence: [{
    id: "evidence-0001", status: "retained", classification: "protected", digest,
    expiresOn: "2026-09-03", location: "protected/run-0001/raw-request.json"
  }] }));

  // when
  const summary = publicFindingSummary(validated);

  // then
  assert.deepEqual(Object.keys(summary), ["fingerprint", "state", "priority", "mappings", "regression"]);
  assert.doesNotMatch(JSON.stringify(summary), /raw-request|LoginEnumerationTest|api\/session/);
});

test("given an untriaged lifecycle file, when evaluating it through the CLI, then the private output is incomplete and redacted", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-triage-"));
  const lifecyclePath = join(directory, "lifecycle.json");
  const policyPath = join(directory, "exceptions.json");
  const outputPath = join(directory, "summary.json");
  writeFileSync(lifecyclePath, JSON.stringify({
    schemaVersion: 1,
    run: {
      runId: "run-0001", attempt: 1, subject: "commit:abcdef0", profile: "safe",
      outcome: "passed", targetFingerprint: digest,
      catalogVersion: "1.0.0", recordedAt: "2026-08-20T14:00:00.000Z"
    },
    candidates: [candidate()], findings: [], riskAcceptances: []
  }));
  writeFileSync(policyPath, JSON.stringify(exceptionPolicy));

  try {
    // when
    const result = spawnSync(process.execPath, [new URL("./security-triage.mjs", import.meta.url).pathname,
      "--lifecycle", lifecyclePath, "--exceptions", policyPath, "--output", outputPath,
      "--today", "2026-08-20"]);

    // then
    assert.equal(result.status, 1);
    assert.match(result.stderr.toString(), /assessment is incomplete/);
    const summary = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(summary.run.outcome, "incomplete");
    assert.equal(summary.counts.candidates, 1);
    assert.doesNotMatch(JSON.stringify(summary), /api\/session|username|evidence-0001/);
    assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true });
  }
});
