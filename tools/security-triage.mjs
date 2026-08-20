import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { redactSecurityText } from "./security-runner.mjs";

const safeEvidenceHeaders = new Set([
  "cache-control", "content-security-policy", "content-type", "referrer-policy",
  "strict-transport-security", "x-content-type-options", "x-frame-options"
]);
const evidenceFields = new Set([
  "method", "statusCode", "problemType", "observationCode", "observedHeaders"
]);
const evidenceMethods = new Set(["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
const observationCodes = new Set([
  "expected-problem", "missing-header", "response-difference", "transport-failure",
  "unexpected-header", "unexpected-problem"
]);

function normalized(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

export function fingerprintFinding(ruleId, surface, parameter, attackClass) {
  const identity = [ruleId, surface, parameter, attackClass].map(normalized).join("\0");
  return `sha256:${createHash("sha256").update(identity).digest("hex")}`;
}

export function createCandidate(input) {
  const fingerprint = fingerprintFinding(
    input.ruleId, input.normalizedSurface, input.parameter, input.attackClass);
  const priorFindings = input.priorFindings ?? [];
  const candidate = {
    fingerprint,
    state: "candidate",
    scanner: normalized(input.scanner),
    ruleId: String(input.ruleId).trim(),
    normalizedSurface: normalized(input.normalizedSurface),
    parameter: normalized(input.parameter),
    attackClass: normalized(input.attackClass),
    provenance: structuredClone(input.provenance),
    evidence: structuredClone(input.evidence),
    regression: priorFindings.some((finding) => finding.fingerprint === fingerprint
      && finding.state === "retest-passed")
  };
  return candidate;
}

function requireRecord(value, name, fields) {
  if (!value || typeof value !== "object") throw new Error(`${name} requires a record`);
  for (const field of fields) {
    if (typeof value[field] !== "string" || value[field].trim() === "") {
      throw new Error(`${name} requires ${field}`);
    }
  }
}

export function createFinding(candidate, triage) {
  if (candidate.state !== "candidate") throw new Error("Only an untriaged candidate can be validated");
  requireRecord(triage.validation, "reproducible validation", ["method", "reference", "reproducedAt", "actor"]);
  requireRecord(triage.context, "finding context", ["impact", "reachability"]);
  if (!triage.priority || !triage.cvssVector || !triage.mappings) {
    throw new Error("Finding requires priority, CVSS 4.0 context and OWASP mappings");
  }
  return {
    ...structuredClone(candidate),
    state: "validated",
    priority: triage.priority,
    cvssVector: triage.cvssVector,
    mappings: structuredClone(triage.mappings),
    context: structuredClone(triage.context),
    validation: structuredClone(triage.validation),
    retests: [],
    transitions: [{
      state: "validated", actor: triage.validation.actor,
      changedAt: triage.validation.reproducedAt, reference: triage.validation.reference
    }]
  };
}

export function classifyCandidate(candidate, disposition) {
  if (candidate.state !== "candidate") throw new Error("Only an untriaged candidate can be classified");
  if (disposition?.state !== "false-positive" && disposition?.state !== "duplicate") {
    throw new Error("Candidate disposition requires false-positive or duplicate state");
  }
  requireRecord(disposition, "disposition", ["rationale", "actor", "classifiedAt", "reference"]);
  return {
    ...structuredClone(candidate),
    state: disposition.state,
    disposition: {
      rationale: disposition.rationale,
      actor: disposition.actor,
      classifiedAt: disposition.classifiedAt,
      reference: disposition.reference
    }
  };
}

export function transitionFinding(finding, transition) {
  const allowedTransitions = {
    validated: ["remediation-in-progress", "accepted-risk"],
    "remediation-in-progress": ["fixed", "accepted-risk"],
    "accepted-risk": ["remediation-in-progress"]
  };
  if (!allowedTransitions[finding.state]?.includes(transition?.state)) {
    throw new Error(`Invalid finding transition from ${finding.state} to ${transition?.state}`);
  }
  requireRecord(transition, "transition", ["actor", "changedAt", "reference"]);
  return {
    ...structuredClone(finding),
    state: transition.state,
    transitions: [...finding.transitions, structuredClone(transition)]
  };
}

export function recordRetest(finding, retest) {
  if (finding.state !== "fixed") throw new Error("Only a fixed finding can be retested");
  requireRecord(retest, "retest", ["outcome", "testedAt", "actor", "reference"]);
  if (retest.outcome !== "passed" && retest.outcome !== "failed") throw new Error("Invalid retest outcome");
  const state = retest.outcome === "passed" ? "retest-passed" : "validated";
  return {
    ...structuredClone(finding),
    state,
    regression: retest.outcome === "failed" || finding.regression,
    retests: [...finding.retests, structuredClone(retest)],
    transitions: [...finding.transitions, {
      state, actor: retest.actor, changedAt: retest.testedAt, reference: retest.reference
    }]
  };
}

function validDate(value) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value) {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const canonical = value.includes(".") ? value : value.replace("Z", ".000Z");
  return parsed.toISOString() === canonical;
}

export function validateRiskAcceptances(acceptances, today = new Date().toISOString().slice(0, 10)) {
  const ids = new Set();
  const fingerprints = new Set();
  for (const acceptance of acceptances) {
    for (const field of ["id", "fingerprint", "owner", "rationale", "compensatingControl", "expiresOn", "acceptedAt"]) {
      if (typeof acceptance[field] !== "string" || acceptance[field].trim() === "") {
        throw new Error(`Risk acceptance requires ${field}`);
      }
    }
    if (typeof acceptance.independentReview !== "boolean") {
      throw new Error("Risk acceptance requires independentReview");
    }
    if (ids.has(acceptance.id)) throw new Error(`Duplicate risk acceptance ${acceptance.id}`);
    ids.add(acceptance.id);
    if (fingerprints.has(acceptance.fingerprint)) {
      throw new Error(`Duplicate risk acceptance for fingerprint ${acceptance.fingerprint}`);
    }
    fingerprints.add(acceptance.fingerprint);
    if (!validDate(acceptance.expiresOn)) throw new Error(`Risk acceptance ${acceptance.id} has invalid expiry`);
    if (acceptance.expiresOn < today) throw new Error(`Risk acceptance ${acceptance.id} expired on ${acceptance.expiresOn}`);
    if (!validTimestamp(acceptance.acceptedAt)) throw new Error(`Risk acceptance ${acceptance.id} has invalid timestamp`);
  }
}

export function assessmentOutcome(lifecycle, today = new Date().toISOString().slice(0, 10)) {
  validateRiskAcceptances(lifecycle.riskAcceptances, today);
  const acceptedFindings = new Map(lifecycle.findings
    .filter((finding) => finding.state === "accepted-risk")
    .map((finding) => [finding.fingerprint, finding]));
  for (const acceptance of lifecycle.riskAcceptances) {
    const finding = acceptedFindings.get(acceptance.fingerprint);
    if (!finding) throw new Error(`Risk acceptance ${acceptance.id} does not match an accepted finding`);
    if (finding.priority === "P0") throw new Error("A P0 finding cannot be accepted");
  }
  for (const finding of acceptedFindings.values()) {
    if (!lifecycle.riskAcceptances.some((acceptance) => acceptance.fingerprint === finding.fingerprint)) {
      throw new Error(`Accepted finding ${finding.fingerprint} has no current risk acceptance`);
    }
  }
  const candidates = lifecycle.candidates.filter((candidate) => candidate.state === "candidate");
  if (candidates.length) {
    return {
      outcome: "incomplete",
      reason: `${candidates.length} candidate${candidates.length === 1 ? "" : "s"} await${candidates.length === 1 ? "s" : ""} reproducible validation`
    };
  }
  const unresolved = lifecycle.findings.filter((finding) =>
    ["validated", "remediation-in-progress"].includes(finding.state));
  if (unresolved.length) return { outcome: "failed", reason: `${unresolved.length} validated finding remains unresolved` };
  const awaitingRetest = lifecycle.findings.filter((finding) => finding.state === "fixed");
  if (awaitingRetest.length) return { outcome: "incomplete", reason: `${awaitingRetest.length} fix awaits retest` };
  return { outcome: "passed", reason: null };
}

function requireCurrentEvidence(entry, today) {
  if (entry.evidence.some((evidence) => !validDate(evidence.expiresOn))) {
    throw new Error(`Finding ${entry.fingerprint} has invalid evidence expiry`);
  }
  if (!entry.evidence.some((evidence) => evidence.status === "retained" && evidence.expiresOn >= today)) {
    throw new Error(`Finding ${entry.fingerprint} requires current retained evidence`);
  }
}

function requireProvenance(entry, run, targetFingerprint) {
  if (entry.provenance.runId !== run.runId || entry.provenance.attempt !== run.attempt
    || entry.provenance.targetFingerprint !== targetFingerprint) {
    throw new Error(`Finding ${entry.fingerprint} has inconsistent provenance`);
  }
}

function replayFindingState(finding) {
  const transitions = finding.transitions;
  const initial = transitions[0];
  if (initial.state !== "validated" || initial.actor !== finding.validation.actor
    || initial.changedAt !== finding.validation.reproducedAt || initial.reference !== finding.validation.reference) {
    throw new Error(`Finding ${finding.fingerprint} has inconsistent transition history`);
  }
  const allowed = {
    validated: ["remediation-in-progress", "accepted-risk"],
    "remediation-in-progress": ["fixed", "accepted-risk"],
    "accepted-risk": ["remediation-in-progress"]
  };
  let state = "validated";
  let retestIndex = 0;
  for (const transition of transitions.slice(1)) {
    if (state === "fixed") {
      const retest = finding.retests[retestIndex];
      const expectedState = retest?.outcome === "passed" ? "retest-passed" : "validated";
      if (!retest || transition.state !== expectedState || transition.actor !== retest.actor
        || transition.changedAt !== retest.testedAt || transition.reference !== retest.reference) {
        throw new Error(`Finding ${finding.fingerprint} has inconsistent transition history`);
      }
      retestIndex += 1;
    } else if (!allowed[state]?.includes(transition.state)) {
      throw new Error(`Finding ${finding.fingerprint} has inconsistent transition history`);
    }
    state = transition.state;
  }
  if (retestIndex !== finding.retests.length) {
    throw new Error(`Finding ${finding.fingerprint} has inconsistent transition history`);
  }
  if (state !== finding.state) throw new Error(`Finding ${finding.fingerprint} has inconsistent current state`);
}

function validateLifecycleSemantics(lifecycle, today) {
  if (!validTimestamp(lifecycle.run.recordedAt)) throw new Error("Security lifecycle has invalid run timestamp");
  const entries = [...lifecycle.candidates, ...lifecycle.findings];
  const fingerprints = new Set();
  for (const entry of entries) {
    const expected = fingerprintFinding(entry.ruleId, entry.normalizedSurface, entry.parameter, entry.attackClass);
    if (entry.fingerprint !== expected) throw new Error(`Finding ${entry.fingerprint} has inconsistent fingerprint`);
    if (fingerprints.has(entry.fingerprint)) throw new Error(`Duplicate finding fingerprint ${entry.fingerprint}`);
    fingerprints.add(entry.fingerprint);
    requireProvenance(entry, lifecycle.run, lifecycle.run.targetFingerprint);
    if (!validTimestamp(entry.provenance.observedAt)) {
      throw new Error(`Finding ${entry.fingerprint} has invalid provenance timestamp`);
    }
    requireCurrentEvidence(entry, today);
    if (entry.disposition && !validTimestamp(entry.disposition.classifiedAt)) {
      throw new Error(`Finding ${entry.fingerprint} has invalid disposition timestamp`);
    }
    const terminalTimestamp = entry.disposition?.classifiedAt ?? entry.provenance.observedAt;
    if (entry.provenance.observedAt > terminalTimestamp || terminalTimestamp > lifecycle.run.recordedAt) {
      throw new Error(`Finding ${entry.fingerprint} has inconsistent lifecycle chronology`);
    }
  }
  for (const finding of lifecycle.findings) {
    const timestamps = [finding.validation.reproducedAt,
      ...finding.retests.map((retest) => retest.testedAt),
      ...finding.transitions.map((transition) => transition.changedAt)];
    if (timestamps.some((timestamp) => !validTimestamp(timestamp))) {
      throw new Error(`Finding ${finding.fingerprint} has invalid lifecycle timestamp`);
    }
    const ordered = [finding.provenance.observedAt,
      ...finding.transitions.map((transition) => transition.changedAt)];
    if (ordered.some((timestamp, index) => index > 0 && timestamp < ordered[index - 1])
      || ordered.at(-1) > lifecycle.run.recordedAt) {
      throw new Error(`Finding ${finding.fingerprint} has inconsistent lifecycle chronology`);
    }
    replayFindingState(finding);
    if (finding.state === "accepted-risk") {
      const acceptance = lifecycle.riskAcceptances.find((entry) => entry.fingerprint === finding.fingerprint);
      const transition = finding.transitions.at(-1);
      if (!acceptance || transition.reference !== acceptance.id
        || acceptance.acceptedAt > transition.changedAt
        || transition.changedAt > lifecycle.run.recordedAt
        || acceptance.acceptedAt.slice(0, 10) > acceptance.expiresOn
        || transition.changedAt.slice(0, 10) > acceptance.expiresOn) {
        throw new Error(`Finding ${finding.fingerprint} has inconsistent risk acceptance`);
      }
    }
  }
}

function redactEvidenceText(value) {
  return redactSecurityText(value)
    .replace(/\b(password|token|secret|csrf|sessionid|apikey|credential|clientcertificate|firstname|lastname|displayname|email|iban|address|phone)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED]")
    .replace(/([?&][^=&#]+)=([^&#]*)/g, "$1=[REDACTED]");
}

export function retainFindingEvidence(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((field) => !evidenceFields.has(field))) {
    throw new Error("Invalid retained evidence fields");
  }
  const method = typeof input.method === "string" ? input.method.toUpperCase() : "";
  if (!evidenceMethods.has(method)
    || !Number.isInteger(input.statusCode) || input.statusCode < 100 || input.statusCode > 599
    || (input.problemType !== undefined && (typeof input.problemType !== "string"
      || !/^urn:courtside:error:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.problemType)))
    || !observationCodes.has(input.observationCode)
    || !Array.isArray(input.observedHeaders)
    || input.observedHeaders.some((name) => typeof name !== "string" || name.length > 128)) {
    throw new Error("Invalid retained evidence value");
  }
  const observedHeaders = [...new Set(input.observedHeaders.map((name) => name.toLowerCase())
    .filter((name) => safeEvidenceHeaders.has(name)))].toSorted();
  return {
    method: redactEvidenceText(method),
    statusCode: input.statusCode,
    problemType: input.problemType === undefined ? undefined : redactEvidenceText(input.problemType),
    observationCode: redactEvidenceText(input.observationCode),
    observedHeaders
  };
}

export function publicFindingSummary(finding) {
  return {
    fingerprint: finding.fingerprint,
    state: finding.state,
    priority: finding.priority,
    mappings: structuredClone(finding.mappings),
    regression: finding.regression
  };
}

function schemaValidator(schemaPath) {
  const require = createRequire(new URL("../frontend/package.json", import.meta.url));
  const Ajv = require("ajv/dist/2020").default;
  const schema = JSON.parse(readFileSync(new URL(schemaPath, import.meta.url), "utf8"));
  return new Ajv({ strict: true, allErrors: true, formats: false }).compile(schema);
}

export function summarizeFindingLifecycle(lifecycle, policy, today = new Date().toISOString().slice(0, 10)) {
  const validatePolicy = schemaValidator("../security/exceptions.schema.json");
  if (!validatePolicy(policy)) throw new Error(`Invalid security exception policy: ${JSON.stringify(validatePolicy.errors)}`);
  const completeLifecycle = { ...structuredClone(lifecycle), riskAcceptances: structuredClone(policy.riskAcceptances) };
  const validateLifecycle = schemaValidator("../security/finding-lifecycle.schema.json");
  if (!validateLifecycle(completeLifecycle)) {
    throw new Error(`Invalid security finding lifecycle: ${JSON.stringify(validateLifecycle.errors)}`);
  }
  validateLifecycleSemantics(completeLifecycle, today);
  const outcome = assessmentOutcome(completeLifecycle, today);
  completeLifecycle.run.outcome = outcome.outcome;
  return {
    schemaVersion: 1,
    run: structuredClone(completeLifecycle.run),
    outcome,
    counts: {
      candidates: completeLifecycle.candidates.length,
      findings: completeLifecycle.findings.length,
      regressions: [...completeLifecycle.candidates, ...completeLifecycle.findings]
        .filter((entry) => entry.regression).length
    },
    candidates: completeLifecycle.candidates.map((candidate) => ({
      fingerprint: candidate.fingerprint,
      state: candidate.state,
      regression: candidate.regression
    })),
    findings: completeLifecycle.findings.map(publicFindingSummary)
  };
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${option}`);
    if (option === "--lifecycle") values.lifecycle = value;
    else if (option === "--exceptions") values.exceptions = value;
    else if (option === "--output") values.output = value;
    else if (option === "--today") values.today = value;
    else throw new Error(`Unknown option ${option}`);
  }
  for (const field of ["lifecycle", "exceptions", "output"]) {
    if (!values[field]) throw new Error(`Missing --${field}`);
  }
  return values;
}

function main(args) {
  const values = parseArguments(args);
  const lifecycle = JSON.parse(readFileSync(values.lifecycle, "utf8"));
  const policy = JSON.parse(readFileSync(values.exceptions, "utf8"));
  const summary = summarizeFindingLifecycle(lifecycle, policy, values.today);
  writeFileSync(values.output, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  chmodSync(values.output, 0o600);
  if (summary.outcome.outcome !== "passed") {
    throw new Error(`Security assessment is ${summary.outcome.outcome}: ${summary.outcome.reason}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (failure) {
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = 1;
  }
}
