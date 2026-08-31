import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;

const catalog = JSON.parse(readFileSync(new URL("../security/assessment-catalog.json", import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync(
  new URL("../security/manual-assessment-evidence.schema.json", import.meta.url), "utf8"));
const validateShape = new Ajv({ strict: true, strictRequired: false, allErrors: true }).compile(schema);
const profileRank = new Map([["safe", 0], ["active", 1], ["destructive", 2]]);
const procedureProfiles = new Map([
  ["MAN-ARCH-001", "safe"], ["MAN-DATA-001", "safe"], ["MAN-COMMS-001", "safe"],
  ["MAN-INPUT-001", "active"], ["MAN-IDENTITY-001", "active"], ["MAN-SESSION-001", "active"],
  ["MAN-AUTHZ-001", "active"], ["MAN-BUSINESS-001", "active"], ["MAN-CLIENT-001", "safe"],
  ["MAN-CRYPTO-001", "safe"], ["MAN-OPS-001", "safe"], ["MAN-EXTERNAL-001", "safe"]
]);
const sensitiveText = /(?:authorization|bearer|cookie|csrf|password|secret|session(?:id)?|api[-_ ]?key)\s*[:=]\s*\S+/i;

function fail(message) {
  throw new Error(`Invalid manual assessment evidence: ${message}`);
}

function catalogControls() {
  return new Map(catalog.controlCoverage.flatMap(({ controls }) => controls)
    .filter(({ manualProcedureId }) => manualProcedureId)
    .map((control) => [control.id, control]));
}

function requireSafeText(value, field) {
  const values = Array.isArray(value) ? value : [value];
  if (values.some((entry) => sensitiveText.test(entry))) fail(`${field} contains credential-like material`);
}

function requireRealDate(value, field) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${field} is not a real date`);
  }
}

export function validateManualAssessmentEvidence(evidence, assessmentDate = new Date()) {
  if (!validateShape(evidence)) fail(JSON.stringify(validateShape.errors));
  if (evidence.catalogVersion !== catalog.catalogVersion) fail("catalogVersion does not match the current catalog");
  if (!Number.isFinite(Date.parse(evidence.recordedAt))) fail("recordedAt is not a real timestamp");
  const authorizationExpiry = Date.parse(evidence.authorization.expiresAt);
  if (!Number.isFinite(authorizationExpiry)) fail("authorization expiry is not a real timestamp");
  if (authorizationExpiry < assessmentDate.getTime()) fail("authorization has expired");
  if (evidence.authorization.profile !== evidence.profile) fail("authorization profile differs from the run profile");
  if (evidence.authorization.targetFingerprint !== evidence.targetFingerprint) fail("authorization target differs from the run target");
  if (evidence.authorization.targetImageDigest !== evidence.targetImageDigest) fail("authorization image differs from the run image");
  if (evidence.authorization.origin !== evidence.targetOrigin) fail("authorization origin differs from the run target");

  const controls = catalogControls();
  const selected = new Set(evidence.selectedControlIds);
  const observed = new Set();
  const procedureIds = new Set();
  for (const procedure of evidence.procedures) {
    if (procedureIds.has(procedure.procedureId)) fail(`duplicate procedure ${procedure.procedureId}`);
    procedureIds.add(procedure.procedureId);
    if (!procedureProfiles.has(procedure.procedureId)) fail(`unknown procedure ${procedure.procedureId}`);
    if (!evidence.authorization.procedureIds.includes(procedure.procedureId)) {
      fail(`procedure ${procedure.procedureId} is outside the authorization`);
    }
    if (profileRank.get(evidence.profile) < profileRank.get(procedureProfiles.get(procedure.procedureId))) {
      fail(`procedure ${procedure.procedureId} requires ${procedureProfiles.get(procedure.procedureId)}`);
    }
    if (procedure.tester !== evidence.tester || procedure.recordedAt !== evidence.recordedAt
        || procedure.targetImageDigest !== evidence.targetImageDigest) {
      fail(`procedure ${procedure.procedureId} provenance differs from the run`);
    }
    requireSafeText(procedure.prerequisites, `${procedure.procedureId} prerequisites`);
    const procedureControls = new Set();
    for (const outcome of procedure.controls) {
      const controlId = outcome.controlId;
      const control = controls.get(controlId);
      if (!control || control.manualProcedureId !== procedure.procedureId) {
        fail(`${controlId} is not assigned to ${procedure.procedureId}`);
      }
      if (!selected.has(controlId)) fail(`${controlId} was not selected`);
      if (procedureControls.has(controlId) || observed.has(controlId)) fail(`duplicate outcome for ${controlId}`);
      procedureControls.add(controlId);
      observed.add(controlId);
      for (const reference of outcome.redactedEvidenceReferences) {
        requireRealDate(reference.expiresOn, `evidence ${reference.id} expiry`);
        if (reference.expiresOn < assessmentDate.toISOString().slice(0, 10)) {
          fail(`evidence ${reference.id} has expired`);
        }
      }
      requireSafeText(outcome.stepsPerformed, `${controlId} steps`);
      requireSafeText(outcome.expectedSecureOutcome, `${controlId} expected outcome`);
      requireSafeText(outcome.observedResult, `${controlId} observed result`);
      if (outcome.rationale) requireSafeText(outcome.rationale, `${controlId} rationale`);
      if (outcome.owner) requireSafeText(outcome.owner, `${controlId} owner`);
      if (outcome.trackingReference) requireSafeText(outcome.trackingReference, `${controlId} tracking reference`);
    }
  }
  if (observed.size !== selected.size || [...selected].some((id) => !observed.has(id))) {
    fail("selected controls do not have exactly one outcome");
  }
  if (procedureIds.size !== evidence.authorization.procedureIds.length
      || evidence.authorization.procedureIds.some((id) => !procedureIds.has(id))) {
    fail("executed procedures differ from the authorized procedures");
  }
  return evidence;
}
