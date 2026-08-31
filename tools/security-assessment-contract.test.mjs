import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validateManualAssessmentEvidence } from "./security-manual-assessment.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const catalog = JSON.parse(readFileSync(new URL("../security/assessment-catalog.json", import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync(new URL("../security/assessment-catalog.schema.json", import.meta.url), "utf8"));
const contract = readFileSync(new URL("../docs/security-assessment.md", import.meta.url), "utf8");
const manualRunbook = readFileSync(new URL("../docs/security-manual-assessment.md", import.meta.url), "utf8");
const manualEvidenceSchema = JSON.parse(readFileSync(
  new URL("../security/manual-assessment-evidence.schema.json", import.meta.url), "utf8"));

test("given the security catalog, when validating it, then every entry satisfies the documented schema", () => {
  // given
  const validate = new Ajv({ strict: true, strictRequired: false, allErrors: true }).compile(schema);

  // when
  const valid = validate(catalog);

  // then
  assert.equal(valid, true, JSON.stringify(validate.errors));
});

test("given an unresolved catalog entry, when validation runs, then ownership and rationale cannot be omitted", () => {
  // given
  const validate = new Ajv({ strict: true, strictRequired: false, allErrors: true }).compile(schema);
  const blocked = catalog.tests.find(({ status }) => status === "blocked");
  const planned = { ...catalog.tests.find(({ status }) => status === "implemented"), status: "planned" };
  const missingControlRationale = structuredClone(catalog);
  const blockedControl = missingControlRationale.controlCoverage.flatMap(({ controls }) => controls)
    .find(({ status }) => status === "blocked");
  delete blockedControl.rationale;
  const missingControlOwner = structuredClone(catalog);
  const plannedControl = missingControlOwner.controlCoverage.flatMap(({ controls }) => controls)
    .find(({ status, manualProcedureId }) => status === "implemented" && manualProcedureId);
  plannedControl.status = "planned";

  // when / then
  assert.equal(validate({ ...catalog, tests: [{ ...blocked, rationale: undefined }] }), false);
  assert.equal(validate({ ...catalog, tests: [{ ...planned, trackingIssue: undefined }] }), false);
  assert.equal(validate(missingControlRationale), false);
  assert.equal(validate(missingControlOwner), false);
});

test("given the shipped attack surface, when reading the catalog, then every actor and surface is covered", () => {
  // given
  const expectedRoles = [
    "ANONYMOUS", "MEMBER", "TRAINER", "SPORT_DIRECTOR", "YOUTH_DIRECTOR", "GROUNDSKEEPER",
    "TREASURER", "ADMIN", "COMPROMISED_ACCOUNT"
  ];

  // when
  const coveredRoles = new Set(catalog.tests.flatMap((entry) => entry.roles));
  const coveredSurfaces = new Set(catalog.tests.map((entry) => entry.surface));

  // then
  assert.deepEqual(catalog.threatModel.roles, expectedRoles);
  assert.deepEqual([...coveredRoles].toSorted(), [...expectedRoles].toSorted());
  assert.deepEqual([...coveredSurfaces].toSorted(), catalog.threatModel.surfaces.map(({ id }) => id).toSorted());
});

test("given stable catalog identities, when maintaining coverage, then identifiers and named surfaces stay unique", () => {
  // given
  const testIds = catalog.tests.map(({ id }) => id);
  const surfaceIds = catalog.threatModel.surfaces.map(({ id }) => id);
  const severityLevels = catalog.severity.map(({ level }) => level);

  // when / then
  assert.equal(new Set(testIds).size, testIds.length);
  assert.equal(new Set(surfaceIds).size, surfaceIds.length);
  assert.deepEqual(severityLevels, ["P0", "P1", "P2", "P3"]);
  assert.equal(catalog.tests.some(({ status }) => status === "blocked"), true);
  assert.equal(catalog.tests.some(({ status }) => status === "implemented"), true);
  assert.equal(catalog.controlCoverage.flatMap(({ controls }) => controls)
    .some(({ status, manualProcedureId }) => status === "implemented" && manualProcedureId), true);
});

test("given pinned standards, when referencing controls, then identifiers are version-qualified", () => {
  // when / then
  assert.deepEqual(catalog.standards, {
    wstg: "4.2",
    asvs: "5.0.0-level-2",
    apiSecurityTop10: "2023",
    owaspTop10: "2025",
    cvss: "4.0"
  });
  for (const entry of catalog.tests) {
    for (const reference of entry.standardReferences.asvs) assert.match(reference, /^v5\.0\.0-\d+\.\d+\.\d+$/);
    for (const reference of entry.standardReferences.wstg) assert.match(reference, /^WSTG-v4\.2-[A-Z]+-\d{2}$/);
  }
});

test("given the pinned OWASP inventories, when classifying controls, then no control is omitted or classified twice", () => {
  // given
  const controls = catalog.controlCoverage.flatMap(({ controls }) => controls);
  const controlIds = controls.map(({ id }) => id);
  const expectedInventories = {
    asvs: {
      commit: "936f29673daa69fe90e6fa706011f89aef201988",
      digest: "b0210d04c05d683bff51b9e7a91be3748c2b300c5ea13d2805d22647b0ceeefa"
    },
    wstg: {
      commit: "dd33419e10edb22b78d89325a6c2aad9f184e3a2",
      digest: "0133170c62fcb231d2cc3437dd4c6397590272885b9ba7cd4e94fceb8b82106b"
    }
  };

  // when / then
  assert.equal(new Set(controlIds).size, controlIds.length);
  assert.equal(controls.every(({ status }) => ["planned", "implemented", "blocked", "not-applicable"].includes(status)), true);
  for (const coverage of catalog.controlCoverage) {
    const digest = createHash("sha256")
      .update(coverage.controls.map(({ id }) => id).toSorted().join("\n"))
      .digest("hex");
    assert.equal(coverage.sourceCommit, expectedInventories[coverage.standard].commit);
    assert.equal(digest, expectedInventories[coverage.standard].digest);
  }
  for (const entry of catalog.tests) {
    for (const reference of [...entry.standardReferences.asvs, ...entry.standardReferences.wstg]) {
      assert.equal(controlIds.includes(reference), true, `${reference} is missing from control coverage`);
    }
  }
});

test("given assessment profiles and outcomes, when authorizing a run, then unsafe ambiguity fails closed", () => {
  // given
  const validate = new Ajv({ strict: true, strictRequired: false, allErrors: true }).compile(schema);

  // when / then
  assert.equal(catalog.profiles.safe.productionAllowed, true);
  assert.equal(catalog.profiles.safe.productionRequiresExplicitAuthorization, true);
  assert.equal(catalog.profiles.active.productionAllowed, false);
  assert.equal(catalog.profiles.destructive.productionAllowed, false);
  assert.equal(catalog.profiles.active.requiresExplicitAuthorization, true);
  assert.equal(catalog.profiles.destructive.requiresExplicitAuthorization, true);
  assert.equal(catalog.outcomes.incomplete.releaseEligible, false);
  assert.equal(catalog.outcomes.failed.releaseEligible, false);
  assert.match(contract, /does not replace an independent penetration test/i);
  assert.match(contract, /docs\/quality-strategy\.md/);
  assert.equal(validate({ ...catalog, profiles: { ...catalog.profiles, active: {
    ...catalog.profiles.active,
    allowedEnvironments: ["EXPLICIT_PRODUCTION"]
  } } }), false);
  assert.equal(validate({ ...catalog, profiles: { ...catalog.profiles, safe: {
    ...catalog.profiles.safe,
    productionRequiresExplicitAuthorization: false
  } } }), false);
});

test("given a single maintainer, when recording a security decision, then independent review is transparent but not mandatory", () => {
  // when / then
  assert.equal(catalog.governance.singleMaintainerMayApprove, true);
  assert.equal(catalog.governance.independentReviewRecorded, true);
  assert.equal(catalog.governance.missingIndependentReviewBlocks, false);
});

test("given non-automated controls, when maintaining the catalog, then each links to a concrete manual procedure", () => {
  // given
  const controls = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ status, manualProcedureId }) => status === "implemented" && manualProcedureId);

  // when / then
  assert.ok(controls.length > 0);
  for (const control of controls) {
    assert.match(control.manualProcedureId, /^MAN-[A-Z]+-[0-9]{3}$/);
    assert.match(manualRunbook, new RegExp(`^### ${control.manualProcedureId}\\b`, "m"));
  }
});

test("given the manual runbook, when an assessment is recorded, then method evidence and outcomes are closed", () => {
  // when / then
  for (const field of ["Prerequisites", "Steps", "Expected secure outcome", "Observed result",
    "Redacted evidence", "Tester", "Timestamp", "Target image digest", "Outcome"]) {
    assert.match(manualRunbook, new RegExp(`\\b${field}\\b`));
  }
  assert.match(manualRunbook, /pass.*fail.*not-applicable.*blocked/is);
  assert.match(manualRunbook, /safe.*active.*destructive/is);
  assert.match(manualRunbook, /private vulnerability reporting/i);
  assert.match(manualRunbook, /independent external tester/i);
});

test("given manual evidence, when its outcome needs action, then schema and CLI validation fail closed", (context) => {
  // given
  const validate = new Ajv({ strict: true, strictRequired: false, allErrors: true })
    .compile(manualEvidenceSchema);
  const digest = `sha256:${"a".repeat(64)}`;
  const evidenceReference = {
    id: "evidence-001",
    digest,
    classification: "restricted-security-evidence",
    expiresOn: "2026-09-21"
  };
  const control = {
    controlId: "v5.0.0-1.1.1",
    stepsPerformed: ["Reviewed the boundary"],
    expectedSecureOutcome: "No undocumented boundary exists.",
    observedResult: "The documented and deployed boundaries agree.",
    redactedEvidenceReferences: [evidenceReference],
    outcome: "pass"
  };
  const procedure = {
    procedureId: "MAN-ARCH-001",
    prerequisites: ["Qualified target"],
    controls: [control],
    tester: "Maintainer",
    recordedAt: "2026-08-21T20:00:00Z",
    targetImageDigest: digest
  };
  const evidence = {
    schemaVersion: 2,
    catalogVersion: catalog.catalogVersion,
    runId: "manual-baseline-1",
    tester: "Maintainer",
    recordedAt: "2026-08-21T20:00:00Z",
    sourceCommit: "a".repeat(40),
    targetImageDigest: digest,
    targetFingerprint: digest,
    targetOrigin: "https://127.0.0.1:8443",
    environment: "SECURITY",
    profile: "safe",
    authorization: {
      id: "protected-record-1",
      origin: "https://127.0.0.1:8443",
      targetFingerprint: digest,
      targetImageDigest: digest,
      profile: "safe",
      procedureIds: ["MAN-ARCH-001"],
      expiresAt: "2026-09-21T20:00:00Z"
    },
    selectedControlIds: ["v5.0.0-1.1.1"],
    independentReview: { performed: false },
    procedures: [procedure]
  };

  // when / then
  assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
  assert.equal(validateManualAssessmentEvidence(evidence, new Date("2026-08-21T20:00:00Z")), evidence);
  const directory = mkdtempSync(join(tmpdir(), "courtside-manual-assessment-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const evidencePath = join(directory, "evidence.json");
  writeFileSync(evidencePath, JSON.stringify(evidence));
  const cli = spawnSync(process.execPath, [join(import.meta.dirname, "security-manual-assessment.mjs"), evidencePath], {
    encoding: "utf8"
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout, "Manual assessment evidence is valid\n");
  const credential = "password=do-not-retain";
  writeFileSync(evidencePath, JSON.stringify({
    ...evidence,
    procedures: [{ ...procedure, controls: [{ ...control, observedResult: credential }] }]
  }));
  const rejectedCli = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "security-manual-assessment.mjs"), evidencePath],
    { encoding: "utf8" }
  );
  assert.equal(rejectedCli.status, 1);
  assert.equal(rejectedCli.stdout, "");
  assert.doesNotMatch(rejectedCli.stderr, /do-not-retain/);
  assert.match(rejectedCli.stderr, /observed result contains credential-like material/);
  const blockedControl = {
    ...control,
    controlId: "v5.0.0-1.1.2",
    outcome: "blocked",
    rationale: "A physical review is not available in this run.",
    owner: "Maintainer",
    trackingReference: "issue-1"
  };
  const expandedEvidence = {
    ...evidence,
    selectedControlIds: [control.controlId, blockedControl.controlId],
    procedures: [{ ...procedure, controls: [control, blockedControl] }]
  };
  assert.equal(validateManualAssessmentEvidence(expandedEvidence,
    new Date("2026-08-21T20:00:00Z")), expandedEvidence);
  assert.throws(() => validateManualAssessmentEvidence({
    ...expandedEvidence,
    procedures: [{ ...procedure, controls: [control, control] }]
  }, new Date("2026-08-21T20:00:00Z")), /duplicate outcome/);
  assert.equal(validate({ ...evidence, procedures: [{ ...procedure,
    controls: [{ ...control, outcome: "blocked" }] }] }), false);
  assert.equal(validate({ ...evidence, procedures: [{ ...procedure,
    controls: [{ ...control, outcome: "fail", rationale: "Mismatch" }] }] }), false);
  assert.equal(validate({ ...evidence, procedures: [{ ...procedure,
    controls: [{ ...control, outcome: "fail", rationale: "Mismatch", findingFingerprint: digest,
      redactedEvidenceReferences: [] }] }] }), false);
  assert.equal(validate({ ...evidence, profile: "active", environment: "UAT" }), false);
  assert.equal(validate({ ...evidence, profile: "destructive", environment: "EXPLICIT_PRODUCTION" }), false);
  assert.equal(validate({ ...evidence, unexpectedRawTraffic: "secret" }), false);
});

test("given schema-valid manual evidence, when catalog and authorization relationships disagree, then validation fails closed", () => {
  // given
  const digest = `sha256:${"a".repeat(64)}`;
  const control = {
    controlId: "v5.0.0-1.1.1",
    stepsPerformed: ["Compared the deployed trust boundary with the pinned requirement"],
    expectedSecureOutcome: "The boundary is explicit.",
    observedResult: "The boundary agrees with the documented model.",
    redactedEvidenceReferences: [{
      id: "evidence-001", digest, classification: "restricted-security-evidence", expiresOn: "2026-09-21"
    }],
    outcome: "pass"
  };
  const procedure = {
    procedureId: "MAN-ARCH-001",
    prerequisites: ["Qualified target"],
    controls: [control],
    tester: "Maintainer",
    recordedAt: "2026-08-21T20:00:00Z",
    targetImageDigest: digest
  };
  const evidence = {
    schemaVersion: 2,
    catalogVersion: catalog.catalogVersion,
    runId: "manual-baseline-1",
    tester: "Maintainer",
    recordedAt: "2026-08-21T20:00:00Z",
    sourceCommit: "a".repeat(40),
    targetImageDigest: digest,
    targetFingerprint: digest,
    targetOrigin: "https://127.0.0.1:8443",
    environment: "SECURITY",
    profile: "safe",
    authorization: {
      id: "protected-record-1",
      origin: "https://127.0.0.1:8443",
      targetFingerprint: digest,
      targetImageDigest: digest,
      profile: "safe",
      procedureIds: ["MAN-ARCH-001"],
      expiresAt: "2026-09-21T20:00:00Z"
    },
    selectedControlIds: ["v5.0.0-1.1.1"],
    independentReview: { performed: false },
    procedures: [procedure]
  };
  const invalidRecords = [
    { ...evidence, catalogVersion: "99.0.0" },
    { ...evidence, selectedControlIds: ["v5.0.0-1.1.2"] },
    { ...evidence, procedures: [procedure, procedure] },
    { ...evidence, procedures: [{ ...procedure,
      controls: [{ ...control, controlId: "v5.0.0-2.1.1" }] }] },
    { ...evidence, procedures: [{ ...procedure, targetImageDigest: `sha256:${"b".repeat(64)}` }] },
    { ...evidence, authorization: { ...evidence.authorization, targetFingerprint: `sha256:${"b".repeat(64)}` } },
    { ...evidence, targetOrigin: "https://127.0.0.1:9443" },
    { ...evidence, authorization: { ...evidence.authorization, expiresAt: "2026-08-20T20:00:00Z" } },
    { ...evidence, authorization: { ...evidence.authorization, expiresAt: "2026-99-21T20:00:00Z" } },
    { ...evidence, authorization: { ...evidence.authorization, expiresAt: "2026-09-31T20:00:00Z" } },
    { ...evidence, recordedAt: "2026-02-30T20:00:00Z",
      procedures: [{ ...procedure, recordedAt: "2026-02-30T20:00:00Z" }] },
    { ...evidence, procedures: [{ ...procedure, controls: [{ ...control,
      redactedEvidenceReferences: [{ ...control.redactedEvidenceReferences[0], expiresOn: "2026-99-21" }]
    }] }] },
    { ...evidence, procedures: [{ ...procedure,
      controls: [{ ...control, observedResult: "cookie=opaque-value" }] }] },
    { ...evidence, procedures: [{ ...procedure,
      controls: [{ ...control, outcome: "blocked", rationale: "Awaiting review", owner: "Maintainer",
        trackingReference: "secret=opaque-value" }] }] }
  ];

  // when / then
  for (const invalidRecord of invalidRecords) {
    assert.throws(() => validateManualAssessmentEvidence(invalidRecord, new Date("2026-08-21T20:00:00Z")));
  }
  assert.throws(() => validateManualAssessmentEvidence({
    ...evidence,
    authorization: { ...evidence.authorization, expiresAt: "2026-10-21T20:00:00Z" }
  }, new Date("2026-09-22T00:00:00Z")), /evidence evidence-001 has expired/);
  assert.throws(() => validateManualAssessmentEvidence(evidence, new Date("invalid")),
    /assessment date is not a real timestamp/);
  assert.throws(() => validateManualAssessmentEvidence(evidence, new Date("2026-08-20T20:00:00Z")),
    /recordedAt is after the assessment date/);
  assert.throws(() => validateManualAssessmentEvidence({
    ...evidence,
    recordedAt: "2026-09-22T20:00:00Z",
    authorization: { ...evidence.authorization, expiresAt: "2026-09-21T20:00:00Z" },
    procedures: [{ ...procedure, recordedAt: "2026-09-22T20:00:00Z",
      controls: [{ ...control, redactedEvidenceReferences: [{
        ...control.redactedEvidenceReferences[0], expiresOn: "2026-10-21"
      }] }] }]
  }, new Date("2026-09-22T20:00:00Z")), /authorization expired before recordedAt/);
  assert.throws(() => validateManualAssessmentEvidence({
    ...evidence,
    recordedAt: "2026-09-22T20:00:00Z",
    authorization: { ...evidence.authorization, expiresAt: "2026-10-21T20:00:00Z" },
    procedures: [{ ...procedure, recordedAt: "2026-09-22T20:00:00Z" }]
  }, new Date("2026-09-22T20:00:00Z")), /evidence evidence-001 expired before recordedAt/);
});

test("given an active-only procedure, when safe or production execution is claimed, then validation fails closed", () => {
  // given
  const digest = `sha256:${"a".repeat(64)}`;
  const control = {
    controlId: "v5.0.0-5.1.1",
    stepsPerformed: ["Compared parser interpretations"],
    expectedSecureOutcome: "Ambiguity is rejected.",
    observedResult: "All layers rejected the ambiguous input.",
    redactedEvidenceReferences: [{
      id: "evidence-001", digest, classification: "restricted-security-evidence", expiresOn: "2026-09-21"
    }],
    outcome: "pass"
  };
  const procedure = {
    procedureId: "MAN-INPUT-001",
    prerequisites: ["Qualified target"],
    controls: [control],
    tester: "Maintainer",
    recordedAt: "2026-08-21T20:00:00Z",
    targetImageDigest: digest
  };
  const evidence = {
    schemaVersion: 2, catalogVersion: catalog.catalogVersion, runId: "manual-baseline-1",
    tester: "Maintainer", recordedAt: "2026-08-21T20:00:00Z", sourceCommit: "a".repeat(40),
    targetImageDigest: digest, targetFingerprint: digest, targetOrigin: "https://127.0.0.1:8443",
    environment: "SECURITY", profile: "safe",
    authorization: {
      id: "protected-record-1", origin: "https://127.0.0.1:8443", targetFingerprint: digest,
      targetImageDigest: digest, profile: "safe", procedureIds: ["MAN-INPUT-001"],
      expiresAt: "2026-09-21T20:00:00Z"
    },
    selectedControlIds: ["v5.0.0-5.1.1"], independentReview: { performed: false }, procedures: [procedure]
  };

  // when / then
  assert.throws(() => validateManualAssessmentEvidence(evidence, new Date("2026-08-21T20:00:00Z")));
  assert.equal(new Ajv({ strict: true, strictRequired: false }).compile(manualEvidenceSchema)({
    ...evidence, environment: "EXPLICIT_PRODUCTION", profile: "active",
    authorization: { ...evidence.authorization, profile: "active" }
  }), false);
});
