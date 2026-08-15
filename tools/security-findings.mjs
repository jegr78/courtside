import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const requiredExceptionFields = [
  "id", "scope", "scanner", "findingId", "target", "rationale", "owner", "compensatingControl", "expiresOn"
];

export function evaluateSecurityReports({ reports, exceptions, scope, subject, today = new Date().toISOString().slice(0, 10) }) {
  if (!scope || !subject) throw new Error("Security evidence requires a scope and subject");
  validateExceptions(exceptions, today);
  const scopedExceptions = exceptions.filter((exception) => exception.scope === scope);
  const allFindings = reports.flatMap((report) => report.findings.map((finding) => ({ scanner: report.scanner, ...finding })))
    .toSorted(compareFinding);
  const findings = allFindings.filter(isBlocking);
  const informationalFindings = allFindings.filter((finding) => !isBlocking(finding));
  const matchedExceptions = new Set();
  const blockingFindings = [];
  const acceptedFindings = [];
  for (const finding of findings) {
    const exception = scopedExceptions.find((candidate) => matches(candidate, finding));
    if (exception) {
      matchedExceptions.add(exception.id);
      acceptedFindings.push({ ...finding, exceptionId: exception.id, expiresOn: exception.expiresOn });
    } else {
      blockingFindings.push(finding);
    }
  }
  for (const exception of scopedExceptions) {
    if (!matchedExceptions.has(exception.id)) throw new Error(`Security exception ${exception.id} does not match a current finding`);
  }
  const status = blockingFindings.length > 0 ? "blocked" : acceptedFindings.length > 0 ? "passed-with-exceptions" : "passed";
  return {
    schemaVersion: 1, scope, subject, generatedAt: `${today}T00:00:00.000Z`, status,
    blockingFindings, acceptedFindings, informationalFindings
  };
}

export function combineSecuritySummaries({ summaries, scope, subject, today = new Date().toISOString().slice(0, 10) }) {
  if (!scope || !subject || summaries.length === 0) throw new Error("Combined security evidence requires summaries, a scope and subject");
  for (const summary of summaries) validateSummary(summary);
  const sourceScopes = new Set(summaries.map((summary) => summary.scope));
  if (sourceScopes.size !== summaries.length) throw new Error("Combined security evidence requires unique source scopes");
  const blockingFindings = summaries.flatMap((summary) => summary.blockingFindings).toSorted(compareFinding);
  const acceptedFindings = summaries.flatMap((summary) => summary.acceptedFindings).toSorted(compareFinding);
  const informationalFindings = summaries.flatMap((summary) => summary.informationalFindings).toSorted(compareFinding);
  if (blockingFindings.length > 0) throw new Error("Cannot combine blocked security evidence");
  return {
    schemaVersion: 1, scope, subject, generatedAt: `${today}T00:00:00.000Z`,
    status: acceptedFindings.length > 0 ? "passed-with-exceptions" : "passed",
    sources: summaries.map((summary) => ({ scope: summary.scope, subject: summary.subject, status: summary.status })),
    blockingFindings, acceptedFindings, informationalFindings
  };
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

function validateSummary(summary) {
  if (summary?.schemaVersion !== 1 || typeof summary.scope !== "string" || typeof summary.subject !== "string") {
    throw new Error("Unsupported security summary");
  }
  for (const field of ["blockingFindings", "acceptedFindings", "informationalFindings"]) {
    if (!Array.isArray(summary[field])) throw new Error(`Security summary requires ${field}`);
  }
  if (summary.status !== "passed" && summary.status !== "passed-with-exceptions" && summary.status !== "blocked") {
    throw new Error("Security summary has an invalid status");
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

export function parseTrivyReport(input) {
  if (!Array.isArray(input?.Results)) throw new Error("Trivy report requires a Results array");
  const findings = input.Results.flatMap((result) => [
    ...(result.Vulnerabilities ?? []).map((finding) => ({
      id: finding.VulnerabilityID,
      severity: finding.Severity,
      target: `${result.Target}:${finding.PkgName}@${finding.InstalledVersion}`
    })),
    ...(result.Misconfigurations ?? []).map((finding) => ({ id: finding.ID, severity: finding.Severity, target: result.Target })),
    ...(result.Secrets ?? []).map((finding) => ({ id: finding.RuleID, severity: finding.Severity, target: result.Target }))
  ]);
  return { scanner: "trivy", findings };
}

export function parseNpmReport(input) {
  if (typeof input?.auditReportVersion !== "number") throw new Error("npm audit report requires auditReportVersion");
  if (!input.vulnerabilities || Array.isArray(input.vulnerabilities) || typeof input.vulnerabilities !== "object") {
    throw new Error("npm audit report requires vulnerabilities");
  }
  const findings = Object.entries(input.vulnerabilities).map(([name, finding]) => {
    const advisory = finding.via?.find((entry) => typeof entry === "object");
    return {
      id: String(advisory?.source ?? advisory?.url ?? `npm:${name}`),
      severity: String(finding.severity).toUpperCase(),
      target: `${name}@${finding.range}`
    };
  });
  return { scanner: "npm", findings };
}

function trivyReport(path) {
  return parseTrivyReport(JSON.parse(readFileSync(path, "utf8")));
}

function npmReport(path) {
  return parseNpmReport(JSON.parse(readFileSync(path, "utf8")));
}

function codeqlReports(directory) {
  const paths = readdirSync(directory, { recursive: true }).filter((path) => path.endsWith(".sarif"));
  if (paths.length === 0) throw new Error("CodeQL produced no SARIF report");
  return paths.map((path) => {
    const input = JSON.parse(readFileSync(join(directory, path), "utf8"));
    return parseCodeqlReport(input);
  });
}

export function parseCodeqlReport(input) {
  if (!Array.isArray(input?.runs)) throw new Error("CodeQL SARIF report requires a runs array");
  const findings = input.runs.flatMap((run) => {
      const rules = new Map((run.tool?.driver?.rules ?? []).map((rule) => [rule.id, rule]));
      return (run.results ?? []).map((result) => ({
        id: result.ruleId,
        severity: String(rules.get(result.ruleId)?.properties?.["security-severity"] ?? "0"),
        target: result.locations?.[0]?.physicalLocation?.artifactLocation?.uri ?? "unknown"
      }));
  });
  return { scanner: "codeql", findings };
}

function parseArguments(args) {
  const values = {
    trivy: [], npm: [], codeql: [], summary: [], exceptions: undefined, output: undefined, scope: undefined, subject: undefined
  };
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${option}`);
    if (option === "--trivy") values.trivy.push(value);
    else if (option === "--npm") values.npm.push(value);
    else if (option === "--codeql") values.codeql.push(value);
    else if (option === "--summary") values.summary.push(value);
    else if (option === "--exceptions") values.exceptions = value;
    else if (option === "--output") values.output = value;
    else if (option === "--scope") values.scope = value;
    else if (option === "--subject") values.subject = value;
    else throw new Error(`Unknown option ${option}`);
  }
  if (!values.output) throw new Error("Missing --output");
  if (!values.scope) throw new Error("Missing --scope");
  if (!values.subject) throw new Error("Missing --subject");
  const reportCount = values.trivy.length + values.npm.length + values.codeql.length;
  if (values.summary.length > 0 && reportCount > 0) throw new Error("Summaries and scanner reports cannot be combined in one invocation");
  if (values.summary.length === 0 && reportCount === 0) throw new Error("At least one security report is required");
  if (reportCount > 0 && !values.exceptions) throw new Error("Missing --exceptions");
  return values;
}

function main(args) {
  const values = parseArguments(args);
  let result;
  if (values.summary.length > 0) {
    const summaries = values.summary.map((path) => JSON.parse(readFileSync(path, "utf8")));
    result = combineSecuritySummaries({ summaries, scope: values.scope, subject: values.subject });
  } else {
    const policy = JSON.parse(readFileSync(values.exceptions, "utf8"));
    if (policy.schemaVersion !== 1 || !Array.isArray(policy.exceptions)) throw new Error("Unsupported security exception policy");
    const reports = [
      ...values.trivy.map(trivyReport),
      ...values.npm.map(npmReport),
      ...values.codeql.flatMap(codeqlReports)
    ];
    result = evaluateSecurityReports({
      reports, exceptions: policy.exceptions, scope: values.scope, subject: values.subject
    });
  }
  writeFileSync(values.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  if (result.status === "blocked") {
    const ids = result.blockingFindings.map((finding) => `${finding.scanner}:${finding.id}:${finding.target}`).join(", ");
    throw new Error(`Actionable security findings: ${ids}`);
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
