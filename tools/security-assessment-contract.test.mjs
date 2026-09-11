import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const findingLifecycle = readFileSync(new URL("../docs/security-findings.md", import.meta.url), "utf8");
const manualRunbook = readFileSync(new URL("../docs/security-manual-assessment.md", import.meta.url), "utf8");
const manualEvidenceSchema = JSON.parse(readFileSync(
  new URL("../security/manual-assessment-evidence.schema.json", import.meta.url), "utf8"));
const baseline = readFileSync(new URL("../docs/security-baseline.md", import.meta.url), "utf8");
const controlOutcomes = JSON.parse(readFileSync(
  new URL("../security/manual-baseline-control-outcomes.json", import.meta.url), "utf8"));
const publishedRecords = ["manual-baseline-control-outcomes.json", "manual-anchored-control-outcomes.json"]
  .map((file) => [file, JSON.parse(readFileSync(new URL(`../security/${file}`, import.meta.url), "utf8"))]);
const controlOutcomeSchema = JSON.parse(readFileSync(
  new URL("../security/manual-baseline-control-outcomes.schema.json", import.meta.url), "utf8"));
const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);
const readableFile = (path) => {
  try {
    return statSync(repositoryFile(path)).isFile() ? readFileSync(repositoryFile(path), "utf8") : null;
  } catch {
    return null;
  }
};
const declarationOf = (name) => {
  const literal = name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return [new RegExp(String.raw`\bvoid\s+${literal}\s*\(`), new RegExp(String.raw`\b(?:test|it)\(\s*"${literal}"`)];
};
const findingAnchors = new Set([...findingLifecycle.matchAll(/^### (.+)$/gm)]
  .map(([, heading]) => heading.toLowerCase().replaceAll(/[^a-z0-9 -]/g, "").replaceAll(/ +/g, "-")));

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

test("given a reviewed control with a finding, when validating it, then the reference is narrow and exclusive", () => {
  // given
  const validate = new Ajv({ strict: true, strictRequired: false, allErrors: true }).compile(schema);
  const referenced = structuredClone(catalog);
  const control = referenced.controlCoverage.flatMap(({ controls }) => controls)
    .find(({ id }) => id === "v5.0.0-8.1.1");
  control.findingReference = "docs/security-findings.md#incomplete-authorization-rule-documentation";

  // when / then
  assert.equal(validate(referenced), true, JSON.stringify(validate.errors));
  control.findingReference = "../protected-evidence.md#incomplete-authorization-rule-documentation";
  assert.equal(validate(referenced), false);
  control.findingReference = "docs/security-findings.md#incomplete-authorization-rule-documentation";
  control.controlEvidence = {
    productionPath: "docs/data-model.md",
    falsifyingTest: "tools/data-model-documentation.test.mjs#given the documented schema, when reading migrations, then every table is named"
  };
  assert.equal(validate(referenced), false);
});

test("given control evidence in a workflow, when validating its path, then only the repository workflow root is hidden", () => {
  // given
  const validate = new Ajv({ strict: true, strictRequired: false, allErrors: true }).compile(schema);
  const referenced = structuredClone(catalog);
  const control = referenced.controlCoverage.flatMap(({ controls }) => controls)
    .find(({ controlEvidence }) => controlEvidence);
  assert.notEqual(control, undefined, "no control carries evidence for this rule to bend");

  // when / then
  assert.equal(validate(referenced), true, JSON.stringify(validate.errors));
  control.controlEvidence.productionPath = ".github/workflows/build.yml";
  assert.equal(validate(referenced), true,
    "the repository's own workflow root is hidden and has to stay reachable");
  for (const productionPath of [".secrets/key", "src/.hidden/key", "../outside", "/absolute/path"]) {
    control.controlEvidence.productionPath = productionPath;
    assert.equal(validate(referenced), false, productionPath);
  }
});

test("given a control is not applicable, when validating it, then it cannot also claim evidence or a finding", () => {
  // given
  const validate = new Ajv({ strict: true, strictRequired: false, allErrors: true }).compile(schema);
  const notApplicable = structuredClone(catalog);
  const control = notApplicable.controlCoverage.flatMap(({ controls }) => controls)
    .find(({ id }) => id === "WSTG-v4.2-ATHZ-01");
  control.status = "not-applicable";
  control.rationale = "No request-controlled value reaches a filesystem path.";

  // when / then
  assert.equal(validate(notApplicable), true, JSON.stringify(validate.errors));
  control.findingReference = "docs/security-findings.md#incomplete-sensitive-data-classification";
  assert.equal(validate(notApplicable), false);
  delete control.findingReference;
  control.controlEvidence = {
    productionPath: "src/main/java/org/courtside/dataexchange/SnapshotUpload.java",
    falsifyingTest: "src/test/java/org/courtside/dataexchange/SnapshotUploadTest.java#givenAnUnusableName_whenUploading_thenTheExistingFileNameRefusalStillGoverns"
  };
  assert.equal(validate(notApplicable), false);
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

test("given the ASVS 5 inventory, when assigning manual controls, then each chapter uses its matching procedure", () => {
  // given
  const procedureByChapter = new Map([
    ["1", "MAN-INPUT-001"], ["2", "MAN-BUSINESS-001"], ["3", "MAN-CLIENT-001"],
    ["4", "MAN-INPUT-001"], ["5", "MAN-INPUT-001"], ["6", "MAN-IDENTITY-001"],
    ["7", "MAN-SESSION-001"], ["8", "MAN-AUTHZ-001"], ["9", "MAN-SESSION-001"],
    ["10", "MAN-IDENTITY-001"], ["11", "MAN-CRYPTO-001"], ["12", "MAN-COMMS-001"],
    ["13", "MAN-OPS-001"], ["14", "MAN-DATA-001"], ["15", "MAN-ARCH-001"],
    ["16", "MAN-OPS-001"], ["17", "MAN-COMMS-001"]
  ]);
  const procedureByControl = new Map([
    ["v5.0.0-4.1.2", "MAN-COMMS-001"]
  ]);
  const controls = catalog.controlCoverage.flatMap(({ controls: entries }) => entries)
    .filter(({ id, manualProcedureId }) => id.startsWith("v5.0.0-") && manualProcedureId);

  // when / then
  for (const control of controls) {
    const chapter = control.id.slice("v5.0.0-".length).split(".")[0];
    assert.equal(control.manualProcedureId,
      procedureByControl.get(control.id) ?? procedureByChapter.get(chapter), control.id);
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
    controlId: "v5.0.0-8.3.1",
    stepsPerformed: ["Called an administrative operation as a member"],
    expectedSecureOutcome: "The server refuses the call regardless of what the client renders.",
    observedResult: "The filter chain refused the call before the controller was reached.",
    redactedEvidenceReferences: [evidenceReference],
    outcome: "pass"
  };
  const procedure = {
    procedureId: "MAN-AUTHZ-001",
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
    profile: "active",
    authorization: {
      id: "protected-record-1",
      origin: "https://127.0.0.1:8443",
      targetFingerprint: digest,
      targetImageDigest: digest,
      profile: "active",
      procedureIds: ["MAN-AUTHZ-001"],
      expiresAt: "2026-09-21T20:00:00Z"
    },
    selectedControlIds: ["v5.0.0-8.3.1"],
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
  assert.equal(rejectedCli.stderr, "Manual assessment evidence is invalid\n");
  writeFileSync(evidencePath, `password=malformed-do-not-retain`);
  const malformedCli = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "security-manual-assessment.mjs"), evidencePath],
    { encoding: "utf8" }
  );
  assert.equal(malformedCli.status, 1);
  assert.equal(malformedCli.stdout, "");
  assert.equal(malformedCli.stderr, "Manual assessment evidence is not valid JSON\n");
  assert.doesNotMatch(malformedCli.stderr, /malformed-do-not-retain/);
  writeFileSync(evidencePath, JSON.stringify({ ...evidence, "password=property-do-not-retain": true }));
  const unknownPropertyCli = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "security-manual-assessment.mjs"), evidencePath],
    { encoding: "utf8" }
  );
  assert.equal(unknownPropertyCli.status, 1);
  assert.equal(unknownPropertyCli.stdout, "");
  assert.equal(unknownPropertyCli.stderr, "Manual assessment evidence is invalid\n");
  assert.doesNotMatch(unknownPropertyCli.stderr, /property-do-not-retain/);
  const missingPath = join(directory, "missing-path-do-not-retain.json");
  const unreadableCli = spawnSync(
    process.execPath,
    [join(import.meta.dirname, "security-manual-assessment.mjs"), missingPath],
    { encoding: "utf8" }
  );
  assert.equal(unreadableCli.status, 1);
  assert.equal(unreadableCli.stdout, "");
  assert.equal(unreadableCli.stderr, "Manual assessment evidence could not be read\n");
  assert.doesNotMatch(unreadableCli.stderr, /missing-path-do-not-retain/);
  const blockedControl = {
    ...control,
    controlId: "v5.0.0-8.1.1",
    outcome: "blocked",
    rationale: "No falsifying check reads this rule yet.",
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
    controlId: "v5.0.0-8.3.1",
    stepsPerformed: ["Compared the enforced role boundary with the pinned requirement"],
    expectedSecureOutcome: "Authorization is decided in the server, not in the client.",
    observedResult: "The filter chain decided the boundary without a client-side check.",
    redactedEvidenceReferences: [{
      id: "evidence-001", digest, classification: "restricted-security-evidence", expiresOn: "2026-09-21"
    }],
    outcome: "pass"
  };
  const procedure = {
    procedureId: "MAN-AUTHZ-001",
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
    profile: "active",
    authorization: {
      id: "protected-record-1",
      origin: "https://127.0.0.1:8443",
      targetFingerprint: digest,
      targetImageDigest: digest,
      profile: "active",
      procedureIds: ["MAN-AUTHZ-001"],
      expiresAt: "2026-09-21T20:00:00Z"
    },
    selectedControlIds: ["v5.0.0-8.3.1"],
    independentReview: { performed: false },
    procedures: [procedure]
  };
  const invalidRecords = [
    [{ ...evidence, catalogVersion: "99.0.0" },
      /catalogVersion does not match the current catalog/],
    [{ ...evidence, selectedControlIds: ["v5.0.0-8.1.1"] },
      /v5\.0\.0-8\.3\.1 was not selected/],
    [{ ...evidence, procedures: [procedure, procedure] },
      /duplicate procedure MAN-AUTHZ-001/],
    [{ ...evidence, procedures: [{ ...procedure,
      controls: [{ ...control, controlId: "v5.0.0-2.1.1" }] }] },
      /v5\.0\.0-2\.1\.1 is not assigned to MAN-AUTHZ-001/],
    [{ ...evidence, procedures: [{ ...procedure, targetImageDigest: `sha256:${"b".repeat(64)}` }] },
      /procedure MAN-AUTHZ-001 provenance differs from the run/],
    [{ ...evidence, authorization: { ...evidence.authorization, targetFingerprint: `sha256:${"b".repeat(64)}` } },
      /authorization target differs from the run target/],
    [{ ...evidence, targetOrigin: "https://127.0.0.1:9443" },
      /authorization origin differs from the run target/],
    [{ ...evidence, authorization: { ...evidence.authorization, expiresAt: "2026-08-20T20:00:00Z" } },
      /authorization expired before recordedAt/],
    [{ ...evidence, authorization: { ...evidence.authorization, expiresAt: "2026-99-21T20:00:00Z" } },
      /authorization expiry is not a real timestamp/],
    [{ ...evidence, authorization: { ...evidence.authorization, expiresAt: "2026-09-31T20:00:00Z" } },
      /authorization expiry is not a real timestamp/],
    [{ ...evidence, recordedAt: "2026-02-30T20:00:00Z",
      procedures: [{ ...procedure, recordedAt: "2026-02-30T20:00:00Z" }] },
      /recordedAt is not a real timestamp/],
    [{ ...evidence, procedures: [{ ...procedure, controls: [{ ...control,
      redactedEvidenceReferences: [{ ...control.redactedEvidenceReferences[0], expiresOn: "2026-99-21" }]
    }] }] }, /evidence evidence-001 expiry is not a real date/],
    [{ ...evidence, procedures: [{ ...procedure,
      controls: [{ ...control, observedResult: "cookie=opaque-value" }] }] },
      /v5\.0\.0-8\.3\.1 observed result contains credential-like material/],
    [{ ...evidence, procedures: [{ ...procedure,
      controls: [{ ...control, outcome: "blocked", rationale: "Awaiting review", owner: "Maintainer",
        trackingReference: "secret=opaque-value" }] }] },
      /v5\.0\.0-8\.3\.1 tracking reference contains credential-like material/]
  ];

  // when / then
  for (const [invalidRecord, refusal] of invalidRecords) {
    assert.throws(() => validateManualAssessmentEvidence(invalidRecord,
      new Date("2026-08-21T20:00:00Z")), refusal);
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
  assert.throws(() => validateManualAssessmentEvidence(evidence, new Date("2026-08-21T20:00:00Z")),
    /procedure MAN-INPUT-001 requires active/);
  assert.equal(new Ajv({ strict: true, strictRequired: false }).compile(manualEvidenceSchema)({
    ...evidence, environment: "EXPLICIT_PRODUCTION", profile: "active",
    authorization: { ...evidence.authorization, profile: "active" }
  }), false);
});

test("given every recorded manual run, when reading its outcomes, then its own published count names its controls", () => {
  // given
  const validate = new Ajv({ strict: true, strictRequired: false, allErrors: true })
    .compile(controlOutcomeSchema);
  const catalogControls = new Set(catalog.controlCoverage.flatMap(({ controls }) => controls)
    .map(({ id }) => id));
  const sections = baseline.split(/^## /m);

  // when / then
  assert.equal(publishedRecords.length, 2);
  for (const [file, record] of publishedRecords) {
    const section = sections.find((candidate) => candidate.includes(file));
    const published = Object.fromEntries([...section.matchAll(
      /^\| (pass|not applicable|fail|blocked)[^|]*\| *([0-9]+) \|$/gm)]
      .map(([, outcome, controls]) => [outcome.replace(" ", "-"), Number(controls)]));
    const counted = record.controls.reduce((total, { outcome }) =>
      ({ ...total, [outcome]: total[outcome] + 1 }),
      { pass: 0, fail: 0, "not-applicable": 0, blocked: 0 });

    assert.equal(validate(record), true, `${file}: ${JSON.stringify(validate.errors)}`);
    assert.deepEqual(record.controls.filter(({ id }) => !catalogControls.has(id)), [], file);
    assert.equal(new Set(record.controls.map(({ id }) => id)).size, record.controls.length, file);
    assert.deepEqual(counted, published, file);
    assert.match(section, new RegExp(`${record.controls.length} unique selected controls`));
    assert.match(baseline, new RegExp(`\`${record.run.runId}\``));
    assert.match(baseline, new RegExp(`\`${record.run.sourceCommit}\``));
  }
  assert.equal(new Set(publishedRecords.map(([, record]) => record.run.runId)).size, 2);
});

test("given the architecture controls the first run never anchored, when reading their dispositions, then each names one", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-INFO-01", "v5.0.0-15.3.2"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
    if (control.status === "not-applicable") {
      assert.equal(typeof control.rationale === "string" && control.rationale.length > 120, true,
        `${control.id} carries no control-specific rationale`);
    }
  }
});

test("given the remaining authorization controls the first run never anchored, when reading their dispositions, then each names one", () => {
  // given
  const reviewedIds = new Set([
    "v5.0.0-8.4.1"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
    if (control.status === "not-applicable") {
      assert.equal(typeof control.rationale === "string" && control.rationale.length > 120, true,
        `${control.id} carries no control-specific rationale`);
    }
  }
});

test("given the browser and client controls the first run never anchored, when reading their dispositions, then each names one", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-CLNT-04", "WSTG-v4.2-CLNT-05", "WSTG-v4.2-CLNT-08", "WSTG-v4.2-CLNT-10",
    "WSTG-v4.2-CLNT-11", "v5.0.0-3.5.4", "v5.0.0-3.5.5", "v5.0.0-3.7.2"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
    if (control.status === "not-applicable") {
      assert.equal(typeof control.rationale === "string" && control.rationale.length > 120, true,
        `${control.id} carries no control-specific rationale`);
    }
  }
});

test("given the deployment-boundary controls the first run never anchored, when reading their dispositions, then each names one", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-CONF-08", "WSTG-v4.2-CONF-10", "WSTG-v4.2-CONF-11", "v5.0.0-12.1.3",
    "v5.0.0-17.1.1", "v5.0.0-17.2.1", "v5.0.0-17.2.2", "v5.0.0-17.2.3", "v5.0.0-17.2.4",
    "v5.0.0-17.3.1", "v5.0.0-17.3.2"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
    if (control.status === "not-applicable") {
      assert.equal(typeof control.rationale === "string" && control.rationale.length > 120, true,
        `${control.id} carries no control-specific rationale`);
    }
  }
});

test("given the cryptographic controls the first run never anchored, when reading their dispositions, then each names one", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-CRYP-02"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
    if (control.status === "not-applicable") {
      assert.equal(typeof control.rationale === "string" && control.rationale.length > 120, true,
        `${control.id} carries no control-specific rationale`);
    }
  }
});

test("given the identity and credential controls the first run never anchored, when reading their dispositions, then each names one", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-ATHN-05", "WSTG-v4.2-ATHN-08", "WSTG-v4.2-ATHN-10", "WSTG-v4.2-IDNT-02",
    "v5.0.0-10.1.1", "v5.0.0-10.1.2", "v5.0.0-10.2.1", "v5.0.0-10.2.2", "v5.0.0-10.3.1",
    "v5.0.0-10.3.2", "v5.0.0-10.3.3", "v5.0.0-10.3.4", "v5.0.0-10.4.1", "v5.0.0-10.4.10",
    "v5.0.0-10.4.11", "v5.0.0-10.4.2", "v5.0.0-10.4.3", "v5.0.0-10.4.4", "v5.0.0-10.4.5",
    "v5.0.0-10.4.6", "v5.0.0-10.4.7", "v5.0.0-10.4.8", "v5.0.0-10.4.9", "v5.0.0-10.5.1",
    "v5.0.0-10.5.2", "v5.0.0-10.5.3", "v5.0.0-10.5.4", "v5.0.0-10.5.5", "v5.0.0-10.6.1",
    "v5.0.0-10.6.2", "v5.0.0-10.7.1", "v5.0.0-10.7.2", "v5.0.0-10.7.3", "v5.0.0-6.1.3",
    "v5.0.0-6.3.4", "v5.0.0-6.4.4", "v5.0.0-6.5.1", "v5.0.0-6.5.2", "v5.0.0-6.5.3", "v5.0.0-6.5.4",
    "v5.0.0-6.5.5", "v5.0.0-6.6.1", "v5.0.0-6.6.2", "v5.0.0-6.6.3", "v5.0.0-6.8.1", "v5.0.0-6.8.2",
    "v5.0.0-6.8.3", "v5.0.0-6.8.4"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
    if (control.status === "not-applicable") {
      assert.equal(typeof control.rationale === "string" && control.rationale.length > 120, true,
        `${control.id} carries no control-specific rationale`);
    }
  }
});

test("given the parser and protocol controls the first run never anchored, when reading their dispositions, then each names one", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-APIT-01", "WSTG-v4.2-INPV-06", "WSTG-v4.2-INPV-07", "WSTG-v4.2-INPV-08",
    "WSTG-v4.2-INPV-09", "v5.0.0-1.2.5", "v5.0.0-1.2.6", "v5.0.0-1.2.7", "v5.0.0-1.2.8",
    "v5.0.0-1.2.9", "v5.0.0-1.3.1", "v5.0.0-1.3.10", "v5.0.0-1.3.2", "v5.0.0-1.3.4",
    "v5.0.0-1.3.5", "v5.0.0-1.3.6", "v5.0.0-1.3.7", "v5.0.0-1.3.8", "v5.0.0-1.3.9", "v5.0.0-1.5.1",
    "v5.0.0-4.3.1", "v5.0.0-4.3.2", "v5.0.0-4.4.1", "v5.0.0-4.4.2", "v5.0.0-4.4.3", "v5.0.0-4.4.4",
    "v5.0.0-5.2.3", "v5.0.0-5.3.2", "v5.0.0-5.4.1", "v5.0.0-5.4.2"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
    if (control.status === "not-applicable") {
      assert.equal(typeof control.rationale === "string" && control.rationale.length > 120, true,
        `${control.id} carries no control-specific rationale`);
    }
  }
});

test("given the operational-access controls the first run never anchored, when reading their dispositions, then each names one", () => {
  // given
  const reviewedIds = new Set([
    "v5.0.0-13.2.5"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
    if (control.status === "not-applicable") {
      assert.equal(typeof control.rationale === "string" && control.rationale.length > 120, true,
        `${control.id} carries no control-specific rationale`);
    }
  }
});

test("given the session and token controls the first run never anchored, when reading their dispositions, then each names one", () => {
  // given
  const reviewedIds = new Set([
    "v5.0.0-7.1.3", "v5.0.0-7.6.1", "v5.0.0-9.1.1", "v5.0.0-9.1.2", "v5.0.0-9.1.3", "v5.0.0-9.2.1",
    "v5.0.0-9.2.2", "v5.0.0-9.2.3", "v5.0.0-9.2.4"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
    if (control.status === "not-applicable") {
      assert.equal(typeof control.rationale === "string" && control.rationale.length > 120, true,
        `${control.id} carries no control-specific rationale`);
    }
  }
});

test("given a control-specific anchor, when reading the catalog, then its production path and falsifying test exist", () => {
  // given
  const anchored = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ controlEvidence }) => controlEvidence);

  // when / then
  assert.ok(anchored.length > 0);
  for (const { id, controlEvidence } of anchored) {
    assert.notEqual(readableFile(controlEvidence.productionPath), null,
      `${id} names a production path that is no readable file`);
    const [testPath, testName] = controlEvidence.falsifyingTest.split("#");
    const source = readableFile(testPath);
    assert.notEqual(source, null, `${id} names a test file that is no readable file`);
    const assessment = testPath === "security/assessment-catalog.json"
      ? catalog.tests.find(({ id: assessmentId }) => assessmentId === testName)
      : undefined;
    const declaredAssessment = assessment?.executionMode === "automated"
      && Object.values(assessment.standardReferences).flat().includes(id);
    assert.equal(declaredAssessment || declarationOf(testName).some((declaration) => declaration.test(source)), true,
      `${id} names ${testName}, which ${testPath} declares no test for`);
  }
});

test("given a control-specific finding, when reading the catalog, then its public summary exists", () => {
  // given
  const findings = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ findingReference }) => findingReference);

  // when / then
  for (const { id, findingReference } of findings) {
    const [path, anchor] = findingReference.split("#");
    assert.equal(path, "docs/security-findings.md", `${id} names an unsupported finding document`);
    assert.equal(findingAnchors.has(anchor), true, `${id} names no finding heading`);
  }
});

test("given the data-protection controls were reviewed, when reading their dispositions, then none is left implicit", () => {
  // given
  const reviewedIds = new Set([
    "v5.0.0-14.1.1", "v5.0.0-14.2.1", "v5.0.0-14.2.2", "v5.0.0-14.3.2"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
  }
});

test("given the remaining authorization controls were reviewed, when reading their dispositions, then none is left implicit", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-ATHZ-01", "v5.0.0-8.1.1", "v5.0.0-8.1.2", "v5.0.0-8.2.3", "v5.0.0-8.3.1"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
  }
});

test("given the communications-boundary controls were reviewed, when reading their dispositions, then none is left implicit", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-CONF-03", "WSTG-v4.2-CONF-04", "WSTG-v4.2-CONF-06", "WSTG-v4.2-CONF-09",
    "v5.0.0-12.1.2", "v5.0.0-12.2.1", "v5.0.0-12.2.2", "v5.0.0-12.3.2"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
  }
});

test("given the cryptographic-use controls were reviewed, when reading their dispositions, then none is left implicit", () => {
  // given
  const reviewedIds = new Set([
    "v5.0.0-11.2.1", "v5.0.0-11.2.3", "v5.0.0-11.3.1", "v5.0.0-11.3.2",
    "v5.0.0-11.3.3", "v5.0.0-11.4.1", "v5.0.0-11.4.2", "v5.0.0-11.4.3",
    "v5.0.0-11.4.4", "v5.0.0-11.5.1", "v5.0.0-11.6.1"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
  }
});

test("given the session and concurrent-authority controls were reviewed, when reading their dispositions, then none is left implicit", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-SESS-03", "WSTG-v4.2-SESS-04", "WSTG-v4.2-SESS-05", "WSTG-v4.2-SESS-08",
    "v5.0.0-7.2.1", "v5.0.0-7.2.2", "v5.0.0-7.2.3", "v5.0.0-7.2.4",
    "v5.0.0-7.4.2", "v5.0.0-7.4.3", "v5.0.0-7.4.4", "v5.0.0-7.6.2"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
  }
});

test("given the parser and protocol-ambiguity controls were reviewed, when reading their dispositions, then none is left implicit", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-INPV-02", "WSTG-v4.2-INPV-03", "WSTG-v4.2-INPV-04", "WSTG-v4.2-INPV-05",
    "WSTG-v4.2-INPV-10", "WSTG-v4.2-INPV-11", "WSTG-v4.2-INPV-12", "WSTG-v4.2-INPV-13",
    "WSTG-v4.2-INPV-14", "WSTG-v4.2-INPV-15", "WSTG-v4.2-INPV-16", "WSTG-v4.2-INPV-17",
    "WSTG-v4.2-INPV-18", "WSTG-v4.2-INPV-19", "v5.0.0-1.1.1", "v5.0.0-1.1.2",
    "v5.0.0-1.2.2", "v5.0.0-1.2.3", "v5.0.0-1.2.4", "v5.0.0-1.3.3",
    "v5.0.0-1.3.11", "v5.0.0-1.4.1", "v5.0.0-1.4.2", "v5.0.0-1.4.3",
    "v5.0.0-1.5.2", "v5.0.0-4.2.1", "v5.0.0-5.3.1"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
  }
});

test("given the browser and physical-device controls were reviewed, when reading their dispositions, then none is left implicit", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-CLNT-01", "WSTG-v4.2-CLNT-03", "WSTG-v4.2-CLNT-06",
    "WSTG-v4.2-CLNT-07", "WSTG-v4.2-CLNT-12", "WSTG-v4.2-CLNT-13",
    "v5.0.0-3.2.1", "v5.0.0-3.2.2", "v5.0.0-3.3.2", "v5.0.0-3.3.4",
    "v5.0.0-3.4.1", "v5.0.0-3.4.2", "v5.0.0-3.4.4", "v5.0.0-3.4.5",
    "v5.0.0-3.4.6", "v5.0.0-3.5.1", "v5.0.0-3.5.2", "v5.0.0-3.5.3",
    "v5.0.0-3.7.1"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
  }
});

test("given the identity and credential controls were reviewed, when reading their dispositions, then none is left implicit", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-ATHN-02", "WSTG-v4.2-ATHN-04", "WSTG-v4.2-ATHN-06",
    "WSTG-v4.2-IDNT-01", "WSTG-v4.2-IDNT-03", "WSTG-v4.2-IDNT-04",
    "WSTG-v4.2-IDNT-05", "v5.0.0-6.1.1", "v5.0.0-6.2.1", "v5.0.0-6.2.5",
    "v5.0.0-6.2.6", "v5.0.0-6.2.7", "v5.0.0-6.2.8", "v5.0.0-6.2.9",
    "v5.0.0-6.2.10", "v5.0.0-6.3.2", "v5.0.0-6.4.1", "v5.0.0-6.4.2"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
  }
});

test("given the architecture and threat-boundary controls were reviewed, when reading their dispositions, then none is left implicit", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-INFO-02", "WSTG-v4.2-INFO-03", "WSTG-v4.2-INFO-04",
    "WSTG-v4.2-INFO-05", "WSTG-v4.2-INFO-06", "WSTG-v4.2-INFO-07",
    "WSTG-v4.2-INFO-09", "WSTG-v4.2-INFO-10", "v5.0.0-15.1.3",
    "v5.0.0-15.2.3", "v5.0.0-15.3.3", "v5.0.0-15.3.4",
    "v5.0.0-15.3.5", "v5.0.0-15.3.6", "v5.0.0-15.3.7"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
  }
});

test("given the logging and operational controls were reviewed, when reading their dispositions, then none is left implicit", () => {
  // given
  const reviewedIds = new Set([
    "v5.0.0-13.1.1", "v5.0.0-13.2.3", "v5.0.0-13.2.4", "v5.0.0-13.4.1",
    "v5.0.0-13.4.2", "v5.0.0-13.4.3", "v5.0.0-13.4.4", "v5.0.0-13.4.5",
    "v5.0.0-16.2.1", "v5.0.0-16.2.2", "v5.0.0-16.3.4", "v5.0.0-16.4.1",
    "v5.0.0-16.5.1", "v5.0.0-16.5.2", "v5.0.0-16.5.3"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
  }
});

test("given the business-logic controls were reviewed, when reading their dispositions, then none is left implicit", () => {
  // given
  const reviewedIds = new Set([
    "WSTG-v4.2-BUSL-01", "WSTG-v4.2-BUSL-02", "WSTG-v4.2-BUSL-04",
    "WSTG-v4.2-BUSL-05", "WSTG-v4.2-BUSL-06", "v5.0.0-2.1.1",
    "v5.0.0-2.1.2", "v5.0.0-2.1.3", "v5.0.0-2.2.2", "v5.0.0-2.2.3",
    "v5.0.0-2.3.1", "v5.0.0-2.3.2"
  ]);
  const reviewed = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ id }) => reviewedIds.has(id));

  // when / then
  assert.equal(reviewed.length, reviewedIds.size);
  for (const control of reviewed) {
    const dispositions = [control.controlEvidence !== undefined, control.findingReference !== undefined,
      control.rationale !== undefined, control.status === "not-applicable"].filter(Boolean);
    assert.equal(dispositions.length, 1, `${control.id} has no single review disposition`);
  }
});

test("given the shipped login defenses, when reading their documentation, then rate limits and lockout safety remain explicit", () => {
  // when / then
  assert.match(readme, /`POST \/api\/session` limits attempts by source address/);
  assert.match(readme, /Address counters live in PostgreSQL, survive restarts and apply across\s+application instances/);
  assert.match(readme, /bounds simultaneous Argon2 work in each\s+application instance/);
  assert.match(readme, /successful login\s+clears its address counter/);
  assert.match(readme, /No username or whole instance can be locked independently/);
});

test("given a manual outcome, when its control carries no control-specific evidence, then a pass is refused", () => {
  // given
  const digest = `sha256:${"a".repeat(64)}`;
  const control = {
    controlId: "v5.0.0-8.1.1",
    stepsPerformed: ["Compared the documented rules with the enforced ones"],
    expectedSecureOutcome: "Every operation states who may call it.",
    observedResult: "The document states role rules for one prefix only.",
    redactedEvidenceReferences: [{
      id: "evidence-001", digest, classification: "restricted-security-evidence", expiresOn: "2026-09-21"
    }],
    outcome: "pass"
  };
  const anchored = { ...control, controlId: "v5.0.0-8.3.1" };
  const automated = { ...control, controlId: "v5.0.0-3.3.1" };
  const evidence = {
    schemaVersion: 2, catalogVersion: catalog.catalogVersion, runId: "manual-baseline-1",
    tester: "Maintainer", recordedAt: "2026-08-21T20:00:00Z", sourceCommit: "a".repeat(40),
    targetImageDigest: digest, targetFingerprint: digest, targetOrigin: "https://127.0.0.1:8443",
    environment: "SECURITY", profile: "active",
    authorization: {
      id: "protected-record-1", origin: "https://127.0.0.1:8443", targetFingerprint: digest,
      targetImageDigest: digest, profile: "active", procedureIds: ["MAN-AUTHZ-001"],
      expiresAt: "2026-09-21T20:00:00Z"
    },
    selectedControlIds: [control.controlId], independentReview: { performed: false },
    procedures: [{
      procedureId: "MAN-AUTHZ-001", prerequisites: ["Qualified target"], controls: [control],
      tester: "Maintainer", recordedAt: "2026-08-21T20:00:00Z", targetImageDigest: digest
    }]
  };
  const assessmentDate = new Date("2026-08-21T20:00:00Z");
  const withControls = (controls) => ({
    ...evidence,
    selectedControlIds: controls.map(({ controlId }) => controlId),
    procedures: [{ ...evidence.procedures[0], controls }]
  });

  // when / then
  assert.throws(() => validateManualAssessmentEvidence(evidence, assessmentDate),
    /v5\.0\.0-8\.1\.1 passed without control-specific evidence in the catalog/);
  const blocked = withControls([{ ...control, outcome: "blocked",
    rationale: "No falsifying check names this rule yet.", owner: "Maintainer", trackingReference: "issue-804" }]);
  assert.equal(validateManualAssessmentEvidence(blocked, assessmentDate), blocked);
  const passing = withControls([anchored]);
  assert.equal(validateManualAssessmentEvidence(passing, assessmentDate), passing);
  const onAnAutomatedLink = {
    ...evidence,
    selectedControlIds: [automated.controlId],
    authorization: { ...evidence.authorization, procedureIds: ["MAN-CLIENT-001"] },
    procedures: [{ ...evidence.procedures[0], procedureId: "MAN-CLIENT-001", controls: [automated] }]
  };
  assert.throws(() => validateManualAssessmentEvidence(onAnAutomatedLink, assessmentDate),
    /v5\.0\.0-3\.3\.1 passed without control-specific evidence in the catalog/);
});
