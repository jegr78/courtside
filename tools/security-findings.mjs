import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { validateAssessmentGateRecord } from "./security-assessment-gate.mjs";
import { summarizeFindingLifecycle, validateRiskAcceptances } from "./security-triage.mjs";

const requiredExceptionFields = [
  "id", "scope", "scanner", "findingId", "target", "rationale", "owner", "compensatingControl", "expiresOn"
];

export function evaluateSecurityReports({
  reports, exceptions, scope, subject, assessment, assessmentPolicy, baseline,
  today = new Date().toISOString().slice(0, 10)
}) {
  if (!scope || !subject) throw new Error("Security evidence requires a scope and subject");
  if (!["required", "not-applicable"].includes(assessmentPolicy)
    || (assessmentPolicy === "required" && !assessment)
    || (assessmentPolicy === "not-applicable" && assessment)) {
    throw new Error("Security evidence requires a consistent dynamic assessment policy");
  }
  validateExceptions(exceptions, today);
  const scopedExceptions = exceptions.filter((exception) => exception.scope === scope);
  const allFindings = reports.flatMap((report) => report.findings.map((finding) => ({
    scanner: report.scanner,
    ...(report.subject?.startsWith("sha256:") ? { artifactDigest: report.subject } : {}),
    ...finding
  })))
    .toSorted(compareFinding);
  const published = publishedNodes(baseline);
  const preExisting = (finding) => {
    const nodes = published.get(baselineIdentity(finding));
    return Boolean(nodes) && finding.nodes?.length > 0 && finding.nodes.every((node) => nodes.has(node));
  };
  const findings = allFindings.filter(isBlocking);
  const informationalFindings = markedBaseline(deduplicateFindings(allFindings.filter((finding) => !isBlocking(finding))
    .map((finding) => (preExisting(finding) ? { ...finding, inBaseline: true } : finding))));
  const matchedExceptions = new Set();
  const blockingFindings = [];
  const acceptedFindings = [];
  const preExistingFindings = [];
  for (const finding of findings) {
    const exception = scopedExceptions.find((candidate) => matches(candidate, finding));
    if (exception) {
      matchedExceptions.add(exception.id);
      acceptedFindings.push({
        ...finding,
        exceptionId: exception.id,
        exceptionStatus: "active",
        expiresOn: exception.expiresOn,
        exception: {
          id: exception.id, owner: exception.owner, rationale: exception.rationale,
          compensatingControl: exception.compensatingControl, expiresOn: exception.expiresOn,
          independentReview: exception.independentReview
        }
      });
    } else if (preExisting(finding)) {
      preExistingFindings.push(finding);
    } else {
      blockingFindings.push(finding);
    }
  }
  for (const exception of scopedExceptions) {
    if (!matchedExceptions.has(exception.id)) throw new Error(`Security exception ${exception.id} does not match a current finding`);
  }
  const status = blockingFindings.length > 0 || assessment?.outcome.outcome === "failed"
    ? "blocked"
    : assessment?.outcome.outcome === "incomplete"
      ? "incomplete"
      : passedStatus(acceptedFindings, preExistingFindings);
  return {
    schemaVersion: 1, scope, subject, assessmentPolicy, generatedAt: `${today}T00:00:00.000Z`, status,
    evidenceSources: reports.map((report) => ({
      scanner: report.scanner, version: report.version ?? "unknown", status: report.status ?? "completed",
      subject: report.subject ?? subject,
      ...(report.reason ? { reason: report.reason } : {}),
      ...((report.subject ?? subject).startsWith("sha256:") ? { artifactDigest: report.subject ?? subject } : {}),
      findingCount: report.findings.length
    })).toSorted((left, right) => left.scanner.localeCompare(right.scanner)),
    blockingFindings: deduplicateFindings(blockingFindings),
    acceptedFindings: deduplicateFindings(acceptedFindings), informationalFindings,
    preExistingFindings: deduplicateFindings(preExistingFindings),
    ...(baseline ? { baseline: baselineRecord(baseline) } : {}),
    ...(assessment ? { assessment: structuredClone(assessment) } : {})
  };
}

function passedStatus(acceptedFindings, preExistingFindings) {
  if (acceptedFindings.length > 0) return "passed-with-exceptions";
  return preExistingFindings.length > 0 ? "passed-with-baseline" : "passed";
}

function baselineIdentity(finding) {
  if (finding.scanner !== "npm" || !["dev", "prod"].includes(finding.dependencyScope)) return null;
  return `${finding.component}\0${finding.id}\0${finding.dependencyScope}`;
}

// Only observations carry the flag, so a merged finding is pre-existing when all of them are.
function markedBaseline(findings) {
  return findings.map(({ inBaseline, ...finding }) => (finding.observations.every((observation) => observation.inBaseline === true)
    ? { ...finding, inBaseline: true } : finding));
}

function publishedNodes(baseline) {
  const reports = baseline?.release ? baseline.reports ?? [] : [];
  const published = new Map();
  for (const finding of reports.filter((report) => report.scanner === "npm" && report.status === "completed")
    .flatMap((report) => report.findings)) {
    const identity = baselineIdentity({ scanner: "npm", ...finding });
    if (identity) published.set(identity, new Set([...(published.get(identity) ?? []), ...(finding.nodes ?? [])]));
  }
  return published;
}

function baselineRecord(baseline) {
  if (!baseline.release) return { release: null, reason: baseline.reason ?? "no-baseline", ...(baseline.detail ? { detail: baseline.detail } : {}) };
  return {
    release: baseline.release,
    sources: baseline.reports.map((report) => ({
      scanner: report.scanner, version: report.version ?? "unknown", status: report.status ?? "completed",
      subject: report.subject ?? baseline.release, ...(report.reason ? { reason: report.reason } : {}),
      findingCount: report.findings.length
    }))
  };
}

function severityRank(severity) {
  return ({ UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 })[severity] ?? Number(severity) / 2.5;
}

function findingAliases(finding) {
  return new Set(finding.aliases ?? [finding.id]);
}

function canMerge(left, right) {
  if (!left.component || left.component !== right.component) return false;
  const aliases = findingAliases(left);
  return [...findingAliases(right)].some((alias) => aliases.has(alias));
}

function deduplicateFindings(findings) {
  const merged = [];
  for (const finding of findings) {
    const existing = merged.find((candidate) => canMerge(candidate, finding));
    const { observations: priorObservations, ...findingRecord } = structuredClone(finding);
    const observations = priorObservations ?? [findingRecord];
    if (!existing) {
      merged.push({
        ...findingRecord, observations,
        ...(findingRecord.exception ? { exceptions: [findingRecord.exception] } : {})
      });
      continue;
    }
    existing.observations.push(...observations);
    existing.aliases = [...new Set([...findingAliases(existing), ...findingAliases(finding)])].toSorted();
    existing.cwes = [...new Set([...(existing.cwes ?? []), ...(finding.cwes ?? [])])].toSorted();
    if (findingRecord.exception) {
      existing.exceptions = [...(existing.exceptions ?? []), findingRecord.exception];
    }
    if (severityRank(finding.severity) > severityRank(existing.severity)) existing.severity = finding.severity;
  }
  return merged;
}

export function combineSecuritySummaries({
  summaries, scope, subject, sourceSubject, assessmentGates = [], today = new Date().toISOString().slice(0, 10)
}) {
  if (!scope || !subject || summaries.length === 0) throw new Error("Combined security evidence requires summaries, a scope and subject");
  for (const summary of summaries) validateSummary(summary, today);
  if (summaries.some((summary) => summary.status === "incomplete")) {
    throw new Error("Cannot combine incomplete security evidence");
  }
  if (summaries.some((summary) => summary.status === "blocked")) {
    throw new Error("Cannot combine blocked security evidence");
  }
  const sourceScopes = new Set(summaries.map((summary) => summary.scope));
  if (sourceScopes.size !== summaries.length) throw new Error("Combined security evidence requires unique source scopes");
  if (scope === "release") {
    validateReleaseSources(summaries, subject, sourceSubject);
    validateReleaseAssessmentGates(assessmentGates, subject, sourceSubject, today);
  }
  const blockingFindings = deduplicateFindings(summaries.flatMap((summary) => summary.blockingFindings).toSorted(compareFinding));
  const acceptedFindings = deduplicateFindings(summaries.flatMap((summary) => summary.acceptedFindings).toSorted(compareFinding));
  const informationalFindings = markedBaseline(deduplicateFindings(
    summaries.flatMap((summary) => summary.informationalFindings).toSorted(compareFinding)));
  const preExistingFindings = deduplicateFindings(
    summaries.flatMap((summary) => summary.preExistingFindings ?? []).toSorted(compareFinding));
  const assessments = summaries.filter((summary) => summary.assessment).map((summary) => structuredClone(summary.assessment));
  if (blockingFindings.length > 0) throw new Error("Cannot combine blocked security evidence");
  return {
    schemaVersion: 1, scope, subject, generatedAt: `${today}T00:00:00.000Z`,
    status: passedStatus(acceptedFindings, preExistingFindings),
    sources: summaries.map((summary) => ({
      scope: summary.scope, subject: summary.subject, status: summary.status,
      assessmentPolicy: summary.assessmentPolicy,
      evidenceSources: (summary.evidenceSources ?? []).map(releaseEvidenceSource),
      ...(summary.baseline ? { baseline: structuredClone(summary.baseline) } : {})
    })),
    blockingFindings, acceptedFindings, informationalFindings, preExistingFindings,
    ...(assessments.length > 0 ? { assessments } : {}),
    ...(assessmentGates.length > 0 ? { assessmentGates: structuredClone(assessmentGates) } : {})
  };
}

function releaseEvidenceSource(source) {
  return {
    scanner: source.scanner, version: source.version, status: source.status, subject: source.subject,
    ...(source.reason ? { reason: source.reason } : {}),
    ...(source.artifactDigest ? { artifactDigest: source.artifactDigest } : {}),
    ...(Number.isInteger(source.findingCount) ? { findingCount: source.findingCount } : {})
  };
}

function validateReleaseAssessmentGates(gates, imageDigest, sourceSubject, today) {
  if (gates.length !== 1) throw new Error("Release requires exactly one active assessment gate");
  const [gate] = gates;
  validateAssessmentGateRecord(gate);
  const generatedAt = new Date(gate?.generatedAt);
  const assessmentDate = new Date(`${today}T23:59:59.999Z`);
  if (gate?.schemaVersion !== 1 || gate.profile !== "active" || gate.status !== "passed"
      || gate.subject !== imageDigest || gate.sourceCommit !== sourceSubject
      || !/^sha256:[a-f0-9]{64}$/.test(gate.manifestDigest ?? "")
      || Number.isNaN(generatedAt.getTime()) || generatedAt > assessmentDate
      || assessmentDate.getTime() - generatedAt.getTime() > 48 * 60 * 60 * 1000) {
    throw new Error("Release active-assessment evidence is missing, stale, incomplete or bound to another subject");
  }
}

function validateReleaseSources(summaries, imageDigest, sourceSubject) {
  const requiredScopes = ["release-build", "release-image-amd64", "release-image-arm64"];
  if (!sourceSubject || summaries.length !== requiredScopes.length
    || requiredScopes.some((scope) => !summaries.some((summary) => summary.scope === scope))) {
    throw new Error("Release security evidence is incomplete");
  }
  for (const summary of summaries) {
    const expectedSubject = summary.scope === "release-build" ? sourceSubject : imageDigest;
    if (summary.subject !== expectedSubject) throw new Error(`Security evidence subject mismatch for ${summary.scope}`);
    if (!Array.isArray(summary.evidenceSources) || summary.evidenceSources.length === 0
      || summary.evidenceSources.some((source) => source.subject !== expectedSubject)) {
      throw new Error(`Security evidence sources are incomplete for ${summary.scope}`);
    }
  }
}

function validateExceptions(exceptions, today) {
  const ids = new Set();
  for (const exception of exceptions) {
    for (const field of requiredExceptionFields) {
      if (typeof exception[field] !== "string" || exception[field].trim() === "") throw new Error(`Security exception requires ${field}`);
    }
    if (ids.has(exception.id)) throw new Error(`Duplicate security exception ${exception.id}`);
    ids.add(exception.id);
    const expiry = new Date(`${exception.expiresOn}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expiresOn)
      || Number.isNaN(expiry.getTime())
      || expiry.toISOString().slice(0, 10) !== exception.expiresOn) {
      throw new Error(`Security exception ${exception.id} has an invalid expiry`);
    }
    if (exception.expiresOn < today) throw new Error(`Security exception ${exception.id} expired on ${exception.expiresOn}`);
    if (typeof exception.independentReview !== "boolean") throw new Error(`Security exception ${exception.id} requires independentReview`);
  }
}

function validateSummary(summary, today) {
  if (summary?.schemaVersion !== 1 || typeof summary.scope !== "string" || typeof summary.subject !== "string") {
    throw new Error("Unsupported security summary");
  }
  for (const field of ["blockingFindings", "acceptedFindings", "informationalFindings"]) {
    if (!Array.isArray(summary[field])) throw new Error(`Security summary requires ${field}`);
  }
  if (summary.preExistingFindings !== undefined && !Array.isArray(summary.preExistingFindings)) {
    throw new Error("Security summary has invalid preExistingFindings");
  }
  if (!["passed", "passed-with-exceptions", "passed-with-baseline", "blocked", "incomplete"].includes(summary.status)) {
    throw new Error("Security summary has an invalid status");
  }
  const generatedAt = new Date(summary.generatedAt);
  const assessmentDate = new Date(`${today}T23:59:59.999Z`);
  if (Number.isNaN(generatedAt.getTime()) || generatedAt > assessmentDate
    || assessmentDate.getTime() - generatedAt.getTime() > 48 * 60 * 60 * 1000) {
    throw new Error("Security summary is stale or has an invalid generation time");
  }
  if (!["required", "not-applicable"].includes(summary.assessmentPolicy)
    || (summary.assessmentPolicy === "required") !== Boolean(summary.assessment)) {
    throw new Error("Security summary has an inconsistent dynamic assessment policy");
  }
  if (summary.assessment) {
    const outcome = summary.assessment?.outcome?.outcome;
    if (!["passed", "incomplete", "failed"].includes(outcome)) {
      throw new Error("Security summary has an invalid assessment outcome");
    }
    if ((outcome === "incomplete" && summary.status !== "incomplete")
      || (outcome === "failed" && summary.status !== "blocked")) {
      throw new Error("Security summary status contradicts its assessment outcome");
    }
  }
}

function isBlocking(finding) {
  if (finding.scanner === "trivy" || finding.scanner === "npm") {
    return finding.severity === "HIGH" || finding.severity === "CRITICAL";
  }
  if (finding.scanner === "codeql") return Number(finding.severity) >= 7;
  throw new Error(`Unsupported security scanner ${finding.scanner}`);
}

function matches(exception, finding) {
  return exception.scanner === finding.scanner && exception.findingId === finding.id && exception.target === finding.target;
}

function compareFinding(left, right) {
  return `${left.scanner}\0${left.id}\0${left.target}`.localeCompare(`${right.scanner}\0${right.id}\0${right.target}`);
}

function advisoryAliases(finding) {
  const aliases = [finding.VulnerabilityID];
  for (const reference of finding.References ?? []) {
    const match = reference.match(/(?:GHSA-[a-z0-9-]+|CVE-[0-9]{4}-[0-9]+)/i);
    if (match) aliases.push(match[0].toUpperCase());
  }
  return [...new Set(aliases)].toSorted();
}

export function parseTrivyReport(input, metadata = {}) {
  if (!Array.isArray(input?.Results)) throw new Error("Trivy report requires a Results array");
  const findings = input.Results.flatMap((result) => [
    ...(result.Vulnerabilities ?? []).map((finding) => ({
      id: finding.VulnerabilityID,
      severity: finding.Severity,
      target: `${result.Target}:${finding.PkgName}@${finding.InstalledVersion}`,
      component: finding.PkgName,
      advisorySource: finding.PrimaryURL ?? null,
      aliases: advisoryAliases(finding),
      cwes: [...new Set(finding.CweIDs ?? [])].toSorted(),
      reachability: "not-assessed"
    })),
    ...(result.Misconfigurations ?? []).map((finding) => ({
      id: finding.ID, severity: finding.Severity, target: result.Target, component: result.Target,
      advisorySource: finding.PrimaryURL ?? null, aliases: [finding.ID], cwes: [], reachability: "configuration-reachable"
    })),
    ...(result.Secrets ?? []).map((finding) => ({
      id: finding.RuleID, severity: finding.Severity, target: result.Target, component: result.Target,
      advisorySource: null, aliases: [finding.RuleID], cwes: [], reachability: "source-reachable"
    }))
  ]);
  return {
    scanner: "trivy", version: metadata.version ?? "unknown", status: "completed",
    subject: metadata.subject ?? "unknown", findings
  };
}

export function parseNpmReport(input, metadata = {}) {
  if (input?.status === "skipped") {
    if (Object.keys(input).sort().join() !== ["reason", "schemaVersion", "status"].sort().join()
      || input.schemaVersion !== 1
      || !["network-unavailable", "service-unavailable"].includes(input.reason)) {
      throw new Error("npm audit evidence has an invalid skip reason");
    }
    return {
      scanner: "npm", version: metadata.version ?? "unknown", status: "skipped",
      subject: metadata.subject ?? "unknown", reason: input.reason, findings: []
    };
  }
  validateNpmReport(input);
  const findings = Object.entries(input.vulnerabilities).flatMap(([name, finding]) => {
    const dependencyScope = lockfileScope(finding.nodes, metadata.lockfile);
    return finding.via.filter((entry) => typeof entry === "object").map((advisory) => ({
      id: String(advisory.source ?? advisory.url ?? `npm:${name}`),
      severity: String(advisory.severity ?? finding.severity).toUpperCase(),
      target: `${name}@${advisory.range ?? finding.range}`,
      component: name,
      advisorySource: advisory.url ?? null,
      aliases: [...new Set([
        String(advisory.source ?? `npm:${name}`),
        ...(String(advisory.url ?? "").match(/(?:GHSA-[a-z0-9-]+|CVE-[0-9]{4}-[0-9]+)/ig) ?? [])
      ].map((alias) => alias.toUpperCase()))].toSorted(),
      cwes: [...new Set(advisory.cwe ?? [])].toSorted(),
      reachability: "not-assessed",
      dependencyScope,
      nodes: Array.isArray(finding.nodes) ? [...new Set(finding.nodes.map(String))].toSorted() : []
    }));
  });
  return {
    scanner: "npm", version: metadata.version ?? "unknown", status: "completed",
    subject: metadata.subject ?? "unknown", findings
  };
}

function lockfileScope(nodes, lockfile) {
  if (!lockfile?.packages || !Array.isArray(nodes) || nodes.length === 0) return "unknown";
  const entries = nodes.map((node) => lockfile.packages[node]);
  if (entries.some((entry) => !entry || typeof entry !== "object")) return "unknown";
  return entries.every((entry) => entry.dev === true) ? "dev" : "prod";
}

export function validateNpmReport(input) {
  if (input?.auditReportVersion !== 2) throw new Error("npm audit report requires auditReportVersion 2");
  if (!input.vulnerabilities || Array.isArray(input.vulnerabilities) || typeof input.vulnerabilities !== "object") {
    throw new Error("npm audit report requires vulnerabilities");
  }
  const severities = new Set(["info", "low", "moderate", "high", "critical"]);
  for (const [name, finding] of Object.entries(input.vulnerabilities)) {
    if (name.trim() === "" || finding === null || typeof finding !== "object" || Array.isArray(finding)) {
      throw new Error("npm audit vulnerability requires a name and object");
    }
    if (!severities.has(finding.severity)) throw new Error(`npm audit vulnerability ${name} has an invalid severity`);
    if (typeof finding.range !== "string" || finding.range.trim() === "") {
      throw new Error(`npm audit vulnerability ${name} requires a range`);
    }
    if (!Array.isArray(finding.via) || finding.via.some((advisory) =>
      (typeof advisory !== "string" || advisory.trim() === "")
      && (advisory === null || typeof advisory !== "object" || Array.isArray(advisory)
        || (advisory.cwe !== undefined && (!Array.isArray(advisory.cwe)
          || advisory.cwe.some((cwe) => typeof cwe !== "string")))))) {
      throw new Error(`npm audit vulnerability ${name} has invalid via evidence`);
    }
    for (const advisory of finding.via.filter((entry) => typeof entry === "object")) {
      if (!severities.has(advisory.severity)) throw new Error(`npm audit advisory of ${name} has an invalid severity`);
      if (!["number", "string"].includes(typeof advisory.source) || String(advisory.source).trim() === "") {
        throw new Error(`npm audit advisory of ${name} has no source`);
      }
    }
  }
}

function trivyReport(path, metadata) {
  return parseTrivyReport(JSON.parse(readFileSync(path, "utf8")), metadata);
}

function npmReport(path, metadata) {
  return parseNpmReport(JSON.parse(readFileSync(path, "utf8")), metadata);
}

function codeqlReports(directory, metadata) {
  const paths = readdirSync(directory, { recursive: true }).filter((path) => path.endsWith(".sarif"));
  if (paths.length === 0) throw new Error("CodeQL produced no SARIF report");
  return paths.map((path) => {
    const input = JSON.parse(readFileSync(join(directory, path), "utf8"));
    return parseCodeqlReport(input, metadata);
  });
}

function normalizedCwes(tags) {
  return [...new Set((tags ?? []).flatMap((tag) => {
    const match = tag.match(/^external\/cwe\/cwe-0*([1-9][0-9]*)$/i);
    return match ? [`CWE-${match[1]}`] : [];
  }))].toSorted();
}

export function parseCodeqlReport(input, metadata = {}) {
  if (!Array.isArray(input?.runs)) throw new Error("CodeQL SARIF report requires a runs array");
  const findings = input.runs.flatMap((run) => {
      const rules = new Map((run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule]));
      return (run.results ?? []).map((result) => ({
        id: result.ruleId,
        severity: String(rules.get(result.ruleId)?.properties?.["security-severity"] ?? "0"),
        target: result.locations?.[0]?.physicalLocation?.artifactLocation?.uri ?? "unknown",
        component: result.locations?.[0]?.physicalLocation?.artifactLocation?.uri ?? "unknown",
        advisorySource: rules.get(result.ruleId)?.helpUri ?? null,
        aliases: [result.ruleId], cwes: normalizedCwes(rules.get(result.ruleId)?.properties?.tags),
        reachability: "source-reachable"
      }));
  });
  const versions = input.runs.map((run) => run.tool?.driver?.semanticVersion ?? run.tool?.driver?.version).filter(Boolean);
  return {
    scanner: "codeql", version: metadata.version ?? versions[0] ?? "unknown", status: "completed",
    subject: metadata.subject ?? "unknown", findings
  };
}

export function finalizeSupplyChainEvidence(summary, evidence) {
  const digestPattern = /^sha256:[a-f0-9]{64}$/;
  const imageDigest = evidence?.image?.split("@").at(-1);
  if (!digestPattern.test(imageDigest ?? "") || summary.subject !== imageDigest
    || !digestPattern.test(evidence.sbomDigest ?? "")) {
    throw new Error("Supply-chain digest mismatch");
  }
  for (const proof of [evidence.signature, evidence.provenance, evidence.sbom]) {
    if (proof?.status !== "verified" || proof.subjectDigest !== imageDigest) {
      throw new Error("Supply-chain digest mismatch");
    }
  }
  return {
    ...structuredClone(summary),
    supplyChain: {
      image: evidence.image, imageDigest, sbomDigest: evidence.sbomDigest,
      signature: structuredClone(evidence.signature), provenance: structuredClone(evidence.provenance),
      sbom: structuredClone(evidence.sbom)
    }
  };
}

function baselineDirectory(directory) {
  const choice = JSON.parse(readFileSync(join(directory, "baseline.json"), "utf8"));
  if (!choice.release) return { baselineReason: choice.reason ?? "no-baseline", baselineDetail: choice.detail };
  for (const name of ["npm-audit.json", "package-lock.json"]) {
    if (!existsSync(join(directory, name))) throw new Error(`Baseline ${choice.release} has no ${name}`);
  }
  return { baselineRelease: choice.release, baselineNpm: join(directory, "npm-audit.json"),
    baselineNpmLockfile: join(directory, "package-lock.json") };
}

function parseArguments(args) {
  const values = {
    trivy: [], npm: [], npmLockfile: [], codeql: [], summary: [], assessmentGate: [], lifecycle: undefined,
    baselineNpm: undefined, baselineNpmLockfile: undefined, baselineRelease: undefined, baselineReason: undefined, baselineDetail: undefined,
    trivyVersion: undefined, npmVersion: undefined, assessmentPolicy: undefined,
    sourceSubject: undefined, exceptions: undefined, output: undefined, scope: undefined, subject: undefined
  };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${option}`);
    if (option === "--trivy") values.trivy.push(value);
    else if (option === "--trivy-version") values.trivyVersion = value;
    else if (option === "--npm") values.npm.push(value);
    else if (option === "--npm-version") values.npmVersion = value;
    else if (option === "--npm-lockfile") values.npmLockfile.push(value);
    else if (option === "--baseline-from") Object.assign(values, baselineDirectory(value));
    else if (option === "--codeql") values.codeql.push(value);
    else if (option === "--summary") values.summary.push(value);
    else if (option === "--assessment-gate") values.assessmentGate.push(value);
    else if (option === "--lifecycle") values.lifecycle = value;
    else if (option === "--assessment-policy") values.assessmentPolicy = value;
    else if (option === "--exceptions") values.exceptions = value;
    else if (option === "--output") values.output = value;
    else if (option === "--scope") values.scope = value;
    else if (option === "--subject") values.subject = value;
    else if (option === "--source-subject") values.sourceSubject = value;
    else throw new Error(`Unknown option ${option}`);
  }
  if (!values.output) throw new Error("Missing --output");
  if (!values.scope) throw new Error("Missing --scope");
  if (!values.subject) throw new Error("Missing --subject");
  const reportCount = values.trivy.length + values.npm.length + values.codeql.length;
  if (values.summary.length > 0 && reportCount > 0) throw new Error("Summaries and scanner reports cannot be combined in one invocation");
  if (values.summary.length > 0 && values.lifecycle) throw new Error("Lifecycle records cannot be combined directly with summaries");
  if (values.summary.length === 0 && reportCount === 0) throw new Error("At least one security report is required");
  if (reportCount > 0 && !values.exceptions) throw new Error("Missing --exceptions");
  if (values.trivy.length > 0 && !values.trivyVersion) throw new Error("Missing --trivy-version");
  if (values.npm.length > 0 && !values.npmVersion) throw new Error("Missing --npm-version");
  if (values.npmLockfile.length > 0 && values.npmLockfile.length !== values.npm.length) {
    throw new Error("Each --npm report needs its --npm-lockfile");
  }
  if (values.baselineRelease && (values.npm.length === 0 || values.npmLockfile.length !== values.npm.length)) {
    throw new Error("A baseline is compared against npm reports with their lockfiles");
  }
  if (reportCount > 0 && !values.assessmentPolicy) throw new Error("Missing --assessment-policy");
  if (values.assessmentPolicy === "required" && !values.lifecycle) throw new Error("Required lifecycle record is missing");
  if (values.assessmentPolicy === "not-applicable" && values.lifecycle) {
    throw new Error("A not-applicable assessment cannot include a lifecycle record");
  }
  return values;
}

function main(args) {
  const values = parseArguments(args);
  let result;
  if (values.summary.length > 0) {
    const summaries = values.summary.map((path) => JSON.parse(readFileSync(path, "utf8")));
    result = combineSecuritySummaries({
      summaries, scope: values.scope, subject: values.subject, sourceSubject: values.sourceSubject,
      assessmentGates: values.assessmentGate.map((path) => JSON.parse(readFileSync(path, "utf8")))
    });
  } else {
    const policy = JSON.parse(readFileSync(values.exceptions, "utf8"));
    if (policy.schemaVersion !== 1 || !Array.isArray(policy.exceptions)) throw new Error("Unsupported security exception policy");
    validateRiskAcceptances(policy.riskAcceptances ?? []);
    const reports = [
      ...values.trivy.map((path) => trivyReport(path, { version: values.trivyVersion, subject: values.subject })),
      ...values.npm.map((path, index) => npmReport(path, { version: values.npmVersion, subject: values.subject,
        ...(values.npmLockfile[index] ? { lockfile: JSON.parse(readFileSync(values.npmLockfile[index], "utf8")) } : {}) })),
      ...values.codeql.flatMap((path) => codeqlReports(path, { subject: values.subject }))
    ];
    if (reports.some((report) => report.version === "unknown"
      || !["completed", "skipped"].includes(report.status))) {
      throw new Error("Security scanner identity or completion status is missing");
    }
    const baseline = values.baselineRelease
      ? { release: values.baselineRelease, reports: [npmReport(values.baselineNpm, { version: values.npmVersion,
        subject: values.baselineRelease, lockfile: JSON.parse(readFileSync(values.baselineNpmLockfile, "utf8")) })] }
      : values.baselineReason ? { release: null, reason: values.baselineReason, detail: values.baselineDetail } : undefined;
    const skippedReports = [...reports, ...(baseline?.reports ?? [])].filter((report) => report.status === "skipped");
    if (skippedReports.some((report) => report.scanner !== "npm")
      || (skippedReports.length > 0 && !["release-build", "scheduled-npm-audit"].includes(values.scope))) {
      throw new Error("Skipped scanner evidence is not allowed for this scope");
    }
    const assessment = values.lifecycle
      ? summarizeFindingLifecycle(JSON.parse(readFileSync(values.lifecycle, "utf8")), policy)
      : undefined;
    if (assessment && assessment.run.subject !== values.subject) {
      throw new Error("Security lifecycle subject does not match the normalized record subject");
    }
    result = evaluateSecurityReports({
      reports, exceptions: policy.exceptions, scope: values.scope, subject: values.subject,
      assessment, assessmentPolicy: values.assessmentPolicy, baseline
    });
  }
  writeFileSync(values.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  if (result.status === "blocked") {
    const ids = result.blockingFindings.map((finding) => `${finding.scanner}:${finding.id}:${finding.target}`).join(", ");
    const reason = ids || result.assessment?.outcome.reason || "security policy rejected the evidence";
    throw new Error(`Actionable security findings: ${reason}`);
  }
  if (result.status === "incomplete") throw new Error("Security evidence is incomplete");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (failure) {
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = 1;
  }
}
