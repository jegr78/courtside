import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildAnchoredRun, findingsByControl, readControl } from "./security-anchored-control-run.mjs";
import { validateManualAssessmentEvidence } from "./security-manual-assessment.mjs";

const catalog = JSON.parse(readFileSync(new URL("../security/assessment-catalog.json", import.meta.url), "utf8"));
const findingSummary = JSON.parse(readFileSync(
  new URL("../security/manual-baseline-finding-summary.json", import.meta.url), "utf8"));
const findings = findingsByControl(findingSummary);
const readSource = (path) => {
  try {
    return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  } catch {
    return null;
  }
};

const runInput = () => ({
  catalog,
  findingSummary,
  priorRunId: "manual-baseline-20260906",
  runId: "manual-anchored-20260910",
  recordedAt: "2026-09-10T12:00:00Z",
  tester: "Repository maintainer",
  owner: "Repository maintainer",
  manifest: {
    target: "https://localhost:62545",
    targetFingerprint: `sha256:${"1".repeat(64)}`,
    environment: "SECURITY",
    application: { imageDigest: `sha256:${"2".repeat(64)}`, commit: "45d7919eb6f23d32278e5fb47d8c57f91e3b2c84" }
  },
  verification: { workflow: "build", runId: "34458782775", conclusion: "success" },
  readSource,
  unanchoredTrackingReference: "#923",
  evidenceExpiresOn: "2026-10-10",
  authorizationExpiresAt: "2026-09-17T12:00:00Z"
});

const controlWith = (properties) => ({ id: "v5.0.0-1.1.1", status: "implemented",
  manualProcedureId: "MAN-INPUT-001", ...properties });

test("given a control-specific anchor, when reading the control, then the run records a pass", () => {
  // given
  const control = controlWith({ controlEvidence: {
    productionPath: "src/main/java/org/courtside/dataexchange/internal/SnapshotParser.java",
    falsifyingTest: "src/test/java/org/courtside/dataexchange/SnapshotParserTest.java"
      + "#givenPercentEncodedText_whenParsing_thenItIsNotDecodedAsAnotherInputLayer" } });

  // when
  const reading = readControl(control, findings, readSource, catalog);

  // then
  assert.equal(reading.outcome, "pass");
  assert.equal(reading.disposition, "control-evidence");
});

test("given a control the catalog leaves unanchored, when reading it, then the run records blocked", () => {
  // given
  const control = controlWith({});

  // when
  const reading = readControl(control, findings, readSource, catalog);

  // then
  assert.equal(reading.outcome, "blocked");
  assert.equal(reading.disposition, "unanchored");
});

test("given a control a tracked lifecycle finding maps, when reading it, then the run records that fingerprint", () => {
  // given
  const control = controlWith({ id: "WSTG-v4.2-ATHN-07", manualProcedureId: "MAN-IDENTITY-001" });

  // when
  const reading = readControl(control, findings, readSource, catalog);

  // then
  assert.equal(reading.outcome, "fail");
  assert.equal(reading.disposition, "lifecycle-finding");
  assert.match(reading.findingFingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(reading.findingFingerprint,
    findingSummary.findings.find(({ mappings }) => mappings.wstg.includes("WSTG-v4.2-ATHN-07")).fingerprint);
});

test("given a control mapped by two findings, when reading it, then the recorded fingerprint is the lowest", () => {
  // given
  const control = controlWith({ id: "v5.0.0-3.4.3", manualProcedureId: "MAN-SESSION-001" });
  const fingerprints = findings.get("v5.0.0-3.4.3").map(({ fingerprint }) => fingerprint);

  // when
  const reading = readControl(control, findings, readSource, catalog);

  // then
  assert.equal(fingerprints.length, 2);
  assert.equal(reading.findingFingerprint, fingerprints.toSorted()[0]);
});

test("given a control the catalog rules out, when reading it, then the run records not-applicable with that rationale", () => {
  // given
  const control = controlWith({ id: "WSTG-v4.2-ATHZ-01", status: "not-applicable",
    manualProcedureId: "MAN-AUTHZ-001", rationale: "No request-controlled filesystem path exists." });

  // when
  const reading = readControl(control, findings, readSource, catalog);

  // then
  assert.equal(reading.outcome, "not-applicable");
  assert.equal(reading.rationale, "No request-controlled filesystem path exists.");
});

test("given a control read to a documented finding, when reading it, then the run blocks it against its remediation", () => {
  // given
  const control = controlWith({ id: "v5.0.0-8.1.1", manualProcedureId: "MAN-AUTHZ-001",
    findingReference: "docs/security-findings.md#incomplete-authorization-rule-documentation" });

  // when
  const reading = readControl(control, findings, readSource, catalog);

  // then
  assert.equal(reading.outcome, "blocked");
  assert.equal(reading.disposition, "finding-document");
  assert.equal(reading.trackingReference, control.findingReference);
});

test("given an anchor a lifecycle finding contradicts, when reading the control, then the run refuses to decide", () => {
  // given
  const control = controlWith({ id: "WSTG-v4.2-ATHN-07", manualProcedureId: "MAN-IDENTITY-001",
    controlEvidence: {
      productionPath: "src/main/java/org/courtside/dataexchange/internal/SnapshotParser.java",
      falsifyingTest: "src/test/java/org/courtside/dataexchange/SnapshotParserTest.java"
        + "#givenPercentEncodedText_whenParsing_thenItIsNotDecodedAsAnotherInputLayer" } });

  // when / then
  assert.throws(() => readControl(control, findings, readSource, catalog),
    /WSTG-v4.2-ATHN-07 carries both a control anchor and an open lifecycle finding/);
});

test("given an anchor the assessed commit does not carry, when reading the control, then no pass is recorded", () => {
  // given
  const control = controlWith({ controlEvidence: { productionPath: "src/main/java/Absent.java",
    falsifyingTest: "src/test/java/org/courtside/dataexchange/SnapshotParserTest.java#whenX_thenY" } });

  // when / then
  assert.throws(() => readControl(control, findings, readSource, catalog),
    /names the production path src\/main\/java\/Absent\.java, which the assessed commit does not carry/);
});

test("given a test file without the test the anchor names, when reading the control, then no pass is recorded", () => {
  // given
  const control = controlWith({ controlEvidence: {
    productionPath: "src/main/java/org/courtside/dataexchange/internal/SnapshotParser.java",
    falsifyingTest: "src/test/java/org/courtside/dataexchange/SnapshotParserTest.java#whenNobodyWroteThis_thenNothing" } });

  // when / then
  assert.throws(() => readControl(control, findings, readSource, catalog),
    /which declares no such test at the assessed commit/);
});

test("given a verification that did not succeed, when building the run, then it records nothing", () => {
  // given
  const input = runInput();

  // when / then
  assert.throws(() => buildAnchoredRun({ ...input,
    verification: { ...input.verification, conclusion: "failure" } }),
    /concluded failure, so no control anchor it executed can be read as a pass/);
});

test("given a finding a passed retest closed, when reading the control, then it is not read as failing", () => {
  // given
  const closed = structuredClone(findingSummary);
  for (const finding of closed.findings) finding.state = "retest-passed";

  // when
  const reading = readControl(controlWith({ id: "WSTG-v4.2-ATHN-07",
    manualProcedureId: "MAN-IDENTITY-001" }), findingsByControl(closed), readSource, catalog);

  // then
  assert.equal(reading.outcome, "blocked");
  assert.equal(reading.disposition, "retested-finding");
  assert.match(reading.rationale, /passed its retest/);
});

test("given a fix awaiting its retest, when reading the control, then it is blocked rather than failed", () => {
  // given
  const pending = structuredClone(findingSummary);
  for (const finding of pending.findings) finding.state = "fixed";

  // when
  const reading = readControl(controlWith({ id: "WSTG-v4.2-ATHN-07",
    manualProcedureId: "MAN-IDENTITY-001" }), findingsByControl(pending), readSource, catalog);

  // then
  assert.equal(reading.outcome, "blocked");
  assert.equal(reading.disposition, "lifecycle-finding");
  assert.match(reading.rationale, /awaiting its retest/);
});

test("given an anchor pointing outside the repository, when reading the control, then no pass is recorded", () => {
  // given
  const control = controlWith({ controlEvidence: { productionPath: "../../etc/hosts",
    falsifyingTest: "src/test/java/org/courtside/dataexchange/SnapshotParserTest.java#whenX_thenY" } });

  // when / then
  assert.throws(() => readControl(control, findings, readSource, catalog), /names a path the catalog may not carry/);
});

test("given two controls whose retained readings would share a name, when building the run, then it refuses", () => {
  // given
  const colliding = { schemaVersion: 1, catalogVersion: catalog.catalogVersion, controlCoverage: [{
    controls: [controlWith({ id: "v5.0.0-1.1.1" }), controlWith({ id: "V5.0.0-1.1.1" })] }] };

  // when / then
  assert.throws(() => buildAnchoredRun({ ...runInput(), catalog: colliding }),
    /share one retained reading identifier/);
});

test("given the current catalog, when building the run, then every selected control carries exactly one outcome", () => {
  // given
  const selected = catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ manualProcedureId }) => manualProcedureId);

  // when
  const { evidence, controlOutcomes } = buildAnchoredRun(runInput());

  // then
  assert.equal(controlOutcomes.controls.length, selected.length);
  assert.equal(new Set(controlOutcomes.controls.map(({ id }) => id)).size, selected.length);
  assert.deepEqual(evidence.selectedControlIds.toSorted(), selected.map(({ id }) => id).toSorted());
  assert.deepEqual(controlOutcomes.controls.map(({ id }) => id),
    controlOutcomes.controls.map(({ id }) => id).toSorted());
});

test("given the built run, when validating it, then the manual assessment contract accepts the record", () => {
  // given
  const { evidence } = buildAnchoredRun(runInput());

  // when / then
  assert.equal(validateManualAssessmentEvidence(evidence, new Date("2026-09-10T13:00:00Z")), evidence);
});

test("given a passing control, when reading its evidence, then the reference digests that control's own reading", () => {
  // given
  const { evidence, readings } = buildAnchoredRun(runInput());
  const outcome = evidence.procedures.flatMap(({ controls }) => controls)
    .find(({ controlId }) => controlId === "v5.0.0-1.1.1");
  const reading = readings.find(({ controlId }) => controlId === "v5.0.0-1.1.1");

  // then
  assert.equal(outcome.outcome, "pass");
  assert.equal(outcome.redactedEvidenceReferences.length, 1);
  assert.equal(outcome.redactedEvidenceReferences[0].digest, reading.digest);
  assert.equal(reading.document.controlId, "v5.0.0-1.1.1");
  assert.equal(reading.document.verification.runId, "34458782775");
  assert.notEqual(reading.digest,
    readings.find(({ controlId }) => controlId === "v5.0.0-1.1.2")?.digest);
});

test("given a catalog whose anchor was removed, when building the run, then that control no longer passes", () => {
  // given
  const stripped = structuredClone(catalog);
  const control = stripped.controlCoverage.flatMap(({ controls }) => controls)
    .find(({ id }) => id === "v5.0.0-1.1.1");
  delete control.controlEvidence;

  // when
  const { controlOutcomes } = buildAnchoredRun({ ...runInput(), catalog: stripped });

  // then
  assert.equal(controlOutcomes.controls.find(({ id }) => id === "v5.0.0-1.1.1").outcome, "blocked");
});

test("given the built run, when reading its authorization, then it names exactly the procedures it executed", () => {
  // given
  const { evidence } = buildAnchoredRun(runInput());
  const executed = evidence.procedures.map(({ procedureId }) => procedureId);

  // then
  assert.deepEqual(evidence.authorization.procedureIds.toSorted(), executed.toSorted());
  assert.equal(evidence.profile, "active");
  assert.equal(evidence.environment, "SECURITY");
  assert.equal(evidence.independentReview.performed, false);
});

test("given the built run, when reading a control observation, then it names that control's own artefacts", () => {
  // given
  const { evidence } = buildAnchoredRun(runInput());
  const outcomes = evidence.procedures.flatMap(({ controls }) => controls);
  const anchored = outcomes.find(({ controlId }) => controlId === "v5.0.0-1.1.1");
  const ruledOut = outcomes.find(({ controlId }) => controlId === "WSTG-v4.2-APIT-01");

  // then
  assert.match(anchored.observedResult, /SnapshotParser\.java/);
  assert.match(anchored.observedResult, /givenPercentEncodedText_whenParsing_thenItIsNotDecodedAsAnotherInputLayer/);
  assert.equal(new Set(outcomes.map(({ observedResult }) => observedResult)).size > 200, true);
  assert.equal(ruledOut.outcome, "not-applicable");
  assert.match(ruledOut.rationale, /GraphQL/);
});
