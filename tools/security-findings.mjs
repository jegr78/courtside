import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { summarizeFindingLifecycle, validateRiskAcceptances } from "./security-triage.mjs";

const requiredExceptionFields = [
  "id", "scope", "scanner", "findingId", "target", "rationale", "owner", "compensatingControl", "expiresOn"
];

export function evaluateSecurityReports({
  reports, exceptions, scope, subject, assessment, assessmentPolicy,
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
  const findings = allFindings.filter(isBlocking);
  const informationalFindings = deduplicateFindings(allFindings.filter((finding) => !isBlocking(finding)));
  const matchedExceptions = new Set();
  const blockingFindings = [];
  const acceptedFindings = [];
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
      : acceptedFindings.length > 0 ? "passed-with-exceptions" : "passed";
  return {
    schemaVersion: 1, scope, subject, assessmentPolicy, generatedAt: `${today}T00:00:00.000Z`, status,
    evidenceSources: reports.map((report) => ({
      scanner: report.scanner, version: report.version ?? "unknown", status: report.status ?? "completed",
      subject: report.subject ?? subject,
      ...((report.subject ?? subject).startsWith("sha256:") ? { artifactDigest: report.subject ?? subject } : {}),
      findingCount: report.findings.length
    })).toSorted((left, right) => left.scanner.localeCompare(right.scanner)),
    blockingFindings: deduplicateFindings(blockingFindings),
    acceptedFindings: deduplicateFindings(acceptedFindings), informationalFindings,
    ...(assessment ? { assessment: structuredClone(assessment) } : {})
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
  summaries, scope, subject, sourceSubject, today = new Date().toISOString().slice(0, 10)
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
  if (scope === "release") validateReleaseSources(summaries, subject, sourceSubject);
  const blockingFindings = deduplicateFindings(summaries.flatMap((summary) => summary.blockingFindings).toSorted(compareFinding));
  const acceptedFindings = deduplicateFindings(summaries.flatMap((summary) => summary.acceptedFindings).toSorted(compareFinding));
  const informationalFindings = deduplicateFindings(
    summaries.flatMap((summary) => summary.informationalFindings).toSorted(compareFinding));
  const assessments = summaries.filter((summary) => summary.assessment).map((summary) => structuredClone(summary.assessment));
  if (blockingFindings.length > 0) throw new Error("Cannot combine blocked security evidence");
  return {
    schemaVersion: 1, scope, subject, generatedAt: `${today}T00:00:00.000Z`,
    status: acceptedFindings.length > 0 ? "passed-with-exceptions" : "passed",
    sources: summaries.map((summary) => ({
      scope: summary.scope, subject: summary.subject, status: summary.status,
      assessmentPolicy: summary.assessmentPolicy
    })),
    blockingFindings, acceptedFindings, informationalFindings,
    ...(assessments.length > 0 ? { assessments } : {})
  };
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
  if (!["passed", "passed-with-exceptions", "blocked", "incomplete"].includes(summary.status)) {
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
  if (typeof input?.auditReportVersion !== "number") throw new Error("npm audit report requires auditReportVersion");
  if (!input.vulnerabilities || Array.isArray(input.vulnerabilities) || typeof input.vulnerabilities !== "object") {
    throw new Error("npm audit report requires vulnerabilities");
  }
  const findings = Object.entries(input.vulnerabilities).map(([name, finding]) => {
    const advisory = finding.via?.find((entry) => typeof entry === "object");
    return {
      id: String(advisory?.source ?? advisory?.url ?? `npm:${name}`),
      severity: String(finding.severity).toUpperCase(),
      target: `${name}@${finding.range}`,
      component: name,
      advisorySource: advisory?.url ?? null,
      aliases: [...new Set([
        String(advisory?.source ?? `npm:${name}`),
        ...(String(advisory?.url ?? "").match(/(?:GHSA-[a-z0-9-]+|CVE-[0-9]{4}-[0-9]+)/ig) ?? [])
      ].map((alias) => alias.toUpperCase()))].toSorted(),
      cwes: [...new Set(advisory?.cwe ?? [])].toSorted(),
      reachability: "not-assessed"
    };
  });
  return {
    scanner: "npm", version: metadata.version ?? "unknown", status: "completed",
    subject: metadata.subject ?? "unknown", findings
  };
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

function parseArguments(args) {
  const values = {
    trivy: [], npm: [], codeql: [], summary: [], lifecycle: undefined,
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
    else if (option === "--codeql") values.codeql.push(value);
    else if (option === "--summary") values.summary.push(value);
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
      summaries, scope: values.scope, subject: values.subject, sourceSubject: values.sourceSubject
    });
  } else {
    const policy = JSON.parse(readFileSync(values.exceptions, "utf8"));
    if (policy.schemaVersion !== 1 || !Array.isArray(policy.exceptions)) throw new Error("Unsupported security exception policy");
    validateRiskAcceptances(policy.riskAcceptances ?? []);
    const reports = [
      ...values.trivy.map((path) => trivyReport(path, { version: values.trivyVersion, subject: values.subject })),
      ...values.npm.map((path) => npmReport(path, { version: values.npmVersion, subject: values.subject })),
      ...values.codeql.flatMap((path) => codeqlReports(path, { subject: values.subject }))
    ];
    if (reports.some((report) => report.version === "unknown" || report.status !== "completed")) {
      throw new Error("Security scanner identity or completion status is missing");
    }
    const assessment = values.lifecycle
      ? summarizeFindingLifecycle(JSON.parse(readFileSync(values.lifecycle, "utf8")), policy)
      : undefined;
    if (assessment && assessment.run.subject !== values.subject) {
      throw new Error("Security lifecycle subject does not match the normalized record subject");
    }
    result = evaluateSecurityReports({
      reports, exceptions: policy.exceptions, scope: values.scope, subject: values.subject,
      assessment, assessmentPolicy: values.assessmentPolicy
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
