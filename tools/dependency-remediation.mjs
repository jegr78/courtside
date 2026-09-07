import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const states = "auto_dismissed,open,dismissed,fixed";
const networkCodes = new Set(["EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "ENOTFOUND",
  "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]);
const severities = new Set(["critical", "high", "medium", "low"]);
const summaryFindingFields = ["blockingFindings", "acceptedFindings", "informationalFindings"];
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

export function dependencyConfigPath(value, fallback) {
  return value ?? resolve(repositoryRoot, fallback);
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return value;
}

function timestamp(value, name) {
  requiredString(value, name);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new Error(`${name} must be a UTC timestamp`);
  }
  const parsed = new Date(value);
  const normalized = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== normalized) {
    throw new Error(`${name} must be a timestamp`);
  }
  return parsed;
}

function policyDate(value, name) {
  requiredString(value, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be a date`);
  const parsed = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a date`);
  }
  return parsed;
}

function identityOf(alert) {
  return JSON.stringify([
    requiredString(alert?.security_advisory?.ghsa_id, "security_advisory.ghsa_id"),
    requiredString(alert?.dependency?.package?.ecosystem, "dependency.package.ecosystem"),
    requiredString(alert?.dependency?.package?.name, "dependency.package.name"),
    requiredString(alert?.dependency?.manifest_path, "dependency.manifest_path")
  ]);
}

function normalizedSeverity(value) {
  const reported = requiredString(value, "finding severity").toLowerCase();
  const severity = reported === "moderate" ? "medium" : reported;
  if (!severities.has(severity)) throw new Error(`unsupported severity ${severity}`);
  return severity;
}

function normalizedPath(value) {
  return requiredString(value, "manifest path").replace(/^\/+/, "");
}

function advisoryAliases(alert) {
  return [alert?.security_advisory?.ghsa_id, alert?.security_advisory?.cve_id]
    .filter((alias) => typeof alias === "string" && alias.trim() !== "")
    .map((alias) => alias.toUpperCase());
}

function standardizedAliases(value) {
  if (!Array.isArray(value)) throw new Error("dependency finding aliases must be an array");
  return [...new Set(value.map((alias) => requiredString(alias, "dependency finding alias").toUpperCase()))]
    .toSorted();
}

function summaryManifest(scope, scanner, component) {
  if (scanner === "npm") {
    return scope === "scheduled-npm-audit-site" ? "site/package-lock.json" : "frontend/package-lock.json";
  }
  if (scanner === "trivy" && component.includes(":")) return "pom.xml";
  return null;
}

function addCurrentFinding(findings, finding) {
  const existing = findings.find((candidate) => candidate.component === finding.component
    && candidate.ecosystem === finding.ecosystem && candidate.manifestPath === finding.manifestPath
    && candidate.aliases.some((alias) => finding.aliases.includes(alias)));
  if (!existing) {
    findings.push(finding);
    return;
  }
  existing.aliases = [...new Set([...existing.aliases, ...finding.aliases])].toSorted();
  const rank = { low: 0, medium: 1, high: 2, critical: 3 };
  if (rank[finding.severity] > rank[existing.severity]) existing.severity = finding.severity;
}

export function currentDependencyEvidence(summaries, subject) {
  if (!/^[a-f0-9]{40}$/.test(subject ?? "")) throw new Error("subject must be an immutable commit SHA");
  if (!Array.isArray(summaries) || summaries.length === 0) {
    throw new Error("current dependency evidence requires at least one security summary");
  }
  const findings = [];
  const relevantSources = [];
  for (const summary of summaries) {
    if (summary?.schemaVersion !== 1 || typeof summary.scope !== "string"
      || !Array.isArray(summary.evidenceSources)) {
      throw new Error("unsupported current security summary");
    }
    if (!["release-build", "scheduled-npm-audit", "scheduled-npm-audit-site"].includes(summary.scope)
      || !["passed", "passed-with-exceptions", "blocked", "incomplete"].includes(summary.status)) {
      throw new Error("unsupported current security summary");
    }
    if (summary.subject !== subject
      || summary.evidenceSources.some((source) => source.subject !== subject)) {
      throw new Error("current security summary subject mismatch");
    }
    for (const field of summaryFindingFields) {
      if (!Array.isArray(summary[field])) throw new Error(`current security summary requires ${field}`);
    }
    relevantSources.push(...summary.evidenceSources.filter((source) => ["npm", "trivy"].includes(source.scanner)));
    for (const record of summaryFindingFields.flatMap((field) => summary[field])) {
      for (const observation of record.observations ?? [record]) {
        const scanner = observation.scanner ?? record.scanner;
        const component = observation.component ?? record.component;
        const manifestPath = typeof component === "string"
          ? summaryManifest(summary.scope, scanner, component) : null;
        if (!manifestPath) continue;
        const aliases = standardizedAliases(record.aliases ?? observation.aliases ?? [record.id]);
        if (!aliases.some((alias) => /^(?:GHSA-[A-Z0-9-]+|CVE-[0-9]{4}-[0-9]+)$/.test(alias))) continue;
        addCurrentFinding(findings, {
          aliases,
          component,
          ecosystem: scanner === "npm" ? "npm" : "maven",
          manifestPath,
          severity: normalizedSeverity(record.severity ?? observation.severity)
        });
      }
    }
  }
  if (relevantSources.length === 0) throw new Error("current security summaries contain no dependency scanner evidence");
  const unavailable = relevantSources.find((source) => source.status === "skipped");
  if (unavailable) {
    if (!["network-unavailable", "service-unavailable", "rate-limited"].includes(unavailable.reason)) {
      throw new Error("current dependency scanner has an invalid outage reason");
    }
    return { status: "partial", reason: unavailable.reason, findings };
  }
  if (relevantSources.some((source) => source.status !== "completed")) {
    throw new Error("current dependency scanner evidence is incomplete");
  }
  findings.sort((left, right) => `${left.ecosystem}\0${left.manifestPath}\0${left.component}`
    .localeCompare(`${right.ecosystem}\0${right.manifestPath}\0${right.component}`));
  return { status: "completed", findings };
}

function addDays(date, days) {
  return new Date(date.valueOf() + days * 86_400_000);
}

function stateAt(now, due) {
  if (now < due) return "within-deadline";
  return now.valueOf() === due.valueOf() ? "due" : "overdue";
}

function validateAssessment(assessment) {
  requiredString(assessment?.identity, "assessment.identity");
  requiredString(assessment?.rationale, "assessment.rationale");
  timestamp(assessment?.assessedAt, "assessment.assessedAt");
  if (typeof assessment.directReachable !== "boolean" || typeof assessment.activelyExploited !== "boolean") {
    throw new Error("assessment reachability flags must be boolean");
  }
  if (assessment.containedAt !== undefined) timestamp(assessment.containedAt, "assessment.containedAt");
  if (assessment.remediationPlan !== undefined
    && !/^#[1-9][0-9]*$/.test(assessment.remediationPlan)) {
    throw new Error("assessment remediationPlan must be a repository issue reference");
  }
}

function validateException(exception) {
  for (const field of ["id", "identity", "affectedVersionRange", "owner", "reachabilityAnalysis",
    "riskAnalysis", "compensatingControl", "acceptedAt"]) {
    requiredString(exception?.[field], `dependency exception ${field}`);
  }
  timestamp(exception.acceptedAt, "dependency exception acceptedAt");
  if (!exception.reviewOn && !exception.expiresOn) {
    throw new Error("dependency exception requires reviewOn or expiresOn");
  }
  if (exception.reviewOn) policyDate(exception.reviewOn, "dependency exception reviewOn");
  if (exception.expiresOn) policyDate(exception.expiresOn, "dependency exception expiresOn");
}

function uniqueByIdentity(records, kind, validate) {
  const indexed = new Map();
  const ids = new Set();
  for (const record of records) {
    validate(record);
    if (indexed.has(record.identity)) throw new Error(`duplicate ${kind} for ${record.identity}`);
    if (record.id !== undefined) {
      if (ids.has(record.id)) throw new Error(`duplicate ${kind} id ${record.id}`);
      ids.add(record.id);
    }
    indexed.set(record.identity, record);
  }
  return indexed;
}

function identityParts(identity, name = "dependency identity") {
  let parts;
  try {
    parts = JSON.parse(requiredString(identity, name));
  } catch (error) {
    throw new Error(`${name} must be a JSON array: ${error.message}`);
  }
  if (!Array.isArray(parts) || parts.length !== 4) throw new Error(`${name} must contain four fields`);
  return {
    advisory: requiredString(parts[0], `${name} advisory`).toUpperCase(),
    ecosystem: requiredString(parts[1], `${name} ecosystem`).toLowerCase(),
    component: requiredString(parts[2], `${name} component`),
    manifestPath: normalizedPath(parts[3])
  };
}

function alertMatchesFinding(alert, finding) {
  return alert.dependency.package.name === finding.component
    && alert.dependency.package.ecosystem.toLowerCase() === finding.ecosystem
    && normalizedPath(alert.dependency.manifest_path) === finding.manifestPath
    && advisoryAliases(alert).some((alias) => finding.aliases.includes(alias));
}

function previousMatchesFinding(previous, finding) {
  const identity = identityParts(previous.identity, "previous finding identity");
  const aliases = standardizedAliases(previous.aliases);
  return identity.component === finding.component && identity.ecosystem === finding.ecosystem
    && identity.manifestPath === finding.manifestPath
    && aliases.some((alias) => finding.aliases.includes(alias));
}

function syntheticIdentity(finding) {
  const advisory = finding.aliases.find((alias) => alias.startsWith("GHSA-"))
    ?? finding.aliases.find((alias) => alias.startsWith("CVE-")) ?? finding.aliases[0];
  return JSON.stringify([advisory, finding.ecosystem, finding.component, finding.manifestPath]);
}

export function evaluateDependencyRemediation({ alerts, currentFindings, previousFindings = [], policy, exceptions,
  assessments, subject, now = new Date() }) {
  if (!/^[a-f0-9]{40}$/.test(subject ?? "")) throw new Error("subject must be an immutable commit SHA");
  if (!(now instanceof Date) || Number.isNaN(now.valueOf())) throw new Error("now must be a valid timestamp");
  if (!Array.isArray(alerts)) throw new Error("Dependabot response must be an array");
  if (!Array.isArray(currentFindings)) throw new Error("current dependency findings must be an array");
  if (!Array.isArray(previousFindings)) throw new Error("previous dependency findings must be an array");
  if (policy?.schemaVersion !== 1 || policy.source !== "github-dependabot") {
    throw new Error("unsupported dependency remediation policy");
  }
  for (const severity of severities) {
    if (!Number.isInteger(policy.deadlinesDays?.[severity]) || policy.deadlinesDays[severity] <= 0) {
      throw new Error(`dependency remediation policy requires a positive ${severity} deadline`);
    }
  }
  if (!Number.isInteger(policy.urgentCriticalContainmentHours)
    || policy.urgentCriticalContainmentHours <= 0) {
    throw new Error("dependency remediation policy requires a positive Critical containment deadline");
  }
  if (exceptions?.schemaVersion !== 1 || !Array.isArray(exceptions.dependencyExceptions)) {
    throw new Error("unsupported dependency exception policy");
  }
  const assessmentIndex = uniqueByIdentity(assessments ?? [], "dependency assessment", validateAssessment);
  const exceptionIndex = uniqueByIdentity(exceptions?.dependencyExceptions ?? [],
    "dependency exception", validateException);
  const reliableAlerts = [];
  for (const alert of alerts) {
    identityOf(alert);
    if (!Number.isInteger(alert.number)) throw new Error("alert.number must be an integer");
    if (!["open", "fixed", "dismissed", "auto_dismissed"].includes(alert.state)) {
      throw new Error(`unsupported alert state ${alert.state}`);
    }
    const createdAt = timestamp(alert.created_at, "alert.created_at");
    if (createdAt > now) throw new Error("alert.created_at cannot be in the future");
    if (alert.state !== "dismissed" || alert.dismissed_reason !== "inaccurate") reliableAlerts.push(alert);
  }
  const currentRecords = [];
  for (const finding of currentFindings) {
    addCurrentFinding(currentRecords, {
      aliases: standardizedAliases(finding.aliases),
      component: requiredString(finding.component, "current dependency component"),
      ecosystem: requiredString(finding.ecosystem, "current dependency ecosystem").toLowerCase(),
      manifestPath: normalizedPath(finding.manifestPath),
      severity: normalizedSeverity(finding.severity)
    });
  }
  for (const previous of previousFindings) {
    identityParts(previous?.identity, "previous finding identity");
    standardizedAliases(previous?.aliases);
    requiredString(previous?.affectedVersionRange, "previous finding affectedVersionRange");
    if (!["pending-alert-correlation", "unavailable-upstream-fix", "unplanned-update",
      "planned-update"].includes(previous?.disposition)) {
      throw new Error("previous dependency finding has an invalid disposition");
    }
    const detected = timestamp(previous?.firstDetectedAt, "previous finding firstDetectedAt");
    if (detected > now) throw new Error("previous dependency finding cannot be from the future");
  }

  const findings = [];
  for (const currentFinding of currentRecords) {
    const matchingAlerts = reliableAlerts.filter((alert) => alertMatchesFinding(alert, currentFinding));
    const current = matchingAlerts.toSorted((left, right) => right.number - left.number)[0] ?? null;
    const matchingPrevious = previousFindings.filter((previous) => previousMatchesFinding(previous, currentFinding));
    const previous = matchingPrevious.toSorted((left, right) =>
      timestamp(left.firstDetectedAt, "previous finding firstDetectedAt")
        - timestamp(right.firstDetectedAt, "previous finding firstDetectedAt"))[0] ?? null;
    const identity = current ? identityOf(current) : previous?.identity ?? syntheticIdentity(currentFinding);
    const severity = currentFinding.severity;
    const detectedTimes = [
      ...matchingAlerts.map((alert) => timestamp(alert.created_at, "alert.created_at").valueOf()),
      ...matchingPrevious.map((finding) => timestamp(finding.firstDetectedAt,
        "previous finding firstDetectedAt").valueOf())
    ];
    const firstDetected = detectedTimes.length > 0 ? new Date(Math.min(...detectedTimes)) : now;
    const remediationDue = addDays(firstDetected, policy.deadlinesDays[severity]);
    const remediationState = stateAt(now, remediationDue);
    const assessment = assessmentIndex.get(identity);
    const urgentCritical = severity === "critical"
      && (!assessment || assessment.directReachable || assessment.activelyExploited);
    const containmentDue = urgentCritical
      ? new Date(firstDetected.valueOf() + policy.urgentCriticalContainmentHours * 3_600_000)
      : null;
    const containedAt = assessment?.containedAt ? timestamp(assessment.containedAt, "assessment.containedAt") : null;
    const containmentState = !urgentCritical ? "not-required"
      : containedAt && containedAt <= containmentDue ? "contained"
        : stateAt(now, containmentDue);
    const exception = exceptionIndex.get(identity);
    const range = current
      ? requiredString(current.security_vulnerability?.vulnerable_version_range,
        "security_vulnerability.vulnerable_version_range")
      : previous?.affectedVersionRange ?? "unknown";
    const assessedAt = assessment ? timestamp(assessment.assessedAt, "assessment.assessedAt") : null;
    if (assessedAt && (assessedAt < firstDetected || assessedAt > now)) {
      throw new Error(`dependency assessment for ${identity} is outside its valid time window`);
    }
    if (containedAt && (containedAt < firstDetected || containedAt > now)) {
      throw new Error(`dependency containment for ${identity} is outside its valid time window`);
    }
    const acceptedAt = exception ? timestamp(exception.acceptedAt, "dependency exception acceptedAt") : null;
    const reviewOn = exception?.reviewOn ? policyDate(exception.reviewOn,
      "dependency exception reviewOn") : null;
    const expiresOn = exception?.expiresOn ? policyDate(exception.expiresOn,
      "dependency exception expiresOn") : null;
    const validUntil = exception ? new Date(Math.min(...[reviewOn, expiresOn].filter(Boolean)
      .map((date) => date.valueOf()))) : null;
    if (exception && (acceptedAt < firstDetected || acceptedAt > now || validUntil < acceptedAt)) {
      throw new Error(`dependency exception ${exception.id} has an invalid lifecycle`);
    }
    const exceptionCurrent = range !== "unknown" && exception?.affectedVersionRange === range
      && now <= validUntil;
    const upstreamFix = current?.security_vulnerability.first_patched_version?.identifier;
    const disposition = !current && !previous ? "pending-alert-correlation"
      : current && !upstreamFix ? "unavailable-upstream-fix"
        : !current && previous.disposition === "pending-alert-correlation" ? "pending-alert-correlation"
          : !current && previous.disposition === "unavailable-upstream-fix" ? "unavailable-upstream-fix"
            : assessment?.remediationPlan ? "planned-update" : "unplanned-update";
    findings.push({
      identity,
      aliases: currentFinding.aliases,
      affectedVersionRange: range,
      severity,
      firstDetectedAt: firstDetected.toISOString(),
      remediationDueAt: remediationDue.toISOString(),
      remediationState,
      containmentDueAt: containmentDue?.toISOString() ?? null,
      containmentState,
      disposition,
      remediationPlan: assessment?.remediationPlan ?? null,
      exception: exceptionCurrent ? { id: exception.id, validUntil: validUntil.toISOString() } : null
    });
  }
  findings.sort((left, right) => left.identity.localeCompare(right.identity));
  const blocked = findings.some((finding) => !finding.exception
    && (finding.disposition === "pending-alert-correlation"
      || ["due", "overdue"].includes(finding.remediationState)
      || ["due", "overdue"].includes(finding.containmentState)));
  return {
    schemaVersion: 1,
    source: "github-dependabot",
    status: "completed",
    subject,
    observedAt: now.toISOString(),
    lastSuccessfulEvidenceAt: now.toISOString(),
    lastSuccessfulEvidenceAgeDays: 0,
    releaseReadiness: blocked ? "blocked" : "ready",
    findings
  };
}

function outageFor(error) {
  const code = error?.cause?.code ?? error?.code;
  return networkCodes.has(code) ? { status: "skipped", reason: "network-unavailable" } : null;
}

async function requestJson(url, token, request) {
  let response;
  try {
    response = await request(url.href, {
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${requiredString(token, "GitHub token")}`,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
  } catch (error) {
    const outage = outageFor(error);
    if (outage) return outage;
    throw error;
  }
  if ([502, 503, 504].includes(response.status)) return { status: "skipped", reason: "service-unavailable" };
  if (response.status === 429 || (response.status === 403
    && response.headers.get("x-ratelimit-remaining") === "0")) {
    return { status: "skipped", reason: "rate-limited" };
  }
  if (response.status !== 200) throw new Error(`GitHub API returned HTTP ${response.status}`);
  return { status: "completed", body: await response.json(), headers: response.headers };
}

export async function collectDependabotAlerts({ repository = process.env.GITHUB_REPOSITORY,
  apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com", token = process.env.GITHUB_TOKEN
    ?? process.env.GH_TOKEN, request = fetch } = {}) {
  requiredString(repository, "repository");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("invalid repository");
  const base = new URL(apiUrl);
  if (base.protocol !== "https:") throw new Error("GitHub API URL must use HTTPS");
  const alerts = [];
  const apiRoot = `${base.href.replace(/\/+$/, "")}/`;
  const path = `${base.pathname.replace(/\/+$/, "")}/repos/${repository}/dependabot/alerts`;
  let next = new URL(`repos/${repository}/dependabot/alerts`, apiRoot);
  next.searchParams.set("state", states);
  next.searchParams.set("per_page", "100");
  for (let page = 1; page <= 100; page += 1) {
    const url = next;
    const response = await requestJson(url, token, request);
    if (response.status === "skipped") return response;
    const pageAlerts = response.body;
    if (!Array.isArray(pageAlerts)) throw new Error("Dependabot response must be an array");
    alerts.push(...pageAlerts);
    const nextMatch = response.headers.get("link")?.split(",")
      .map((part) => /^\s*<([^>]+)>;\s*rel="([^"]+)"\s*$/.exec(part))
      .find((match) => match?.[2].split(/\s+/).includes("next"));
    if (!nextMatch) {
      return { status: "completed", alerts };
    }
    next = new URL(nextMatch[1]);
    const allowedParameters = [...next.searchParams.keys()].every((name) =>
      ["state", "per_page", "after"].includes(name));
    if (next.origin !== base.origin || next.pathname !== path || next.username || next.password
      || next.hash || !allowedParameters || next.searchParams.get("state") !== states
      || next.searchParams.get("per_page") !== "100" || !next.searchParams.get("after")) {
      throw new Error("Dependabot pagination link left the fixed API boundary");
    }
  }
  throw new Error("Dependabot alert history exceeded 100 pages");
}

function readJson(path, description) {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${description}: ${error.message}`);
  }
}

function parseArguments(args) {
  const options = { "current-summary": [] };
  const allowed = new Set(["assessments", "current-summary", "exceptions", "output", "policy",
    "previous-evidence", "previous-evidence-at", "repository", "subject"]);
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index]?.startsWith("--") || args[index + 1] === undefined) throw new Error("invalid arguments");
    const name = args[index].slice(2);
    if (!allowed.has(name)) throw new Error(`unsupported argument --${name}`);
    if (name === "current-summary") options[name].push(args[index + 1]);
    else {
      if (options[name] !== undefined) throw new Error(`duplicate argument --${name}`);
      options[name] = args[index + 1];
    }
  }
  for (const name of ["subject", "output"]) requiredString(options[name], `--${name}`);
  if (options["current-summary"].length === 0) throw new Error("at least one --current-summary is required");
  return options;
}

function previousEvidence(value, now) {
  if (!value) return { at: null, age: null };
  const at = timestamp(value, "previous evidence timestamp");
  if (at > now) throw new Error("previous dependency evidence is from the future");
  return { at: at.toISOString(), age: Math.floor((now - at) / 86_400_000) };
}

function readPreviousEvidence(path, now) {
  if (!path) return { at: null, findings: [] };
  const evidence = readJson(path, "previous dependency evidence");
  if (evidence?.schemaVersion !== 1 || evidence.source !== "github-dependabot"
    || evidence.status !== "completed" || !/^[a-f0-9]{40}$/.test(evidence.subject ?? "")
    || !Array.isArray(evidence.findings)) {
    throw new Error("previous dependency evidence is unsupported or incomplete");
  }
  const at = timestamp(evidence.lastSuccessfulEvidenceAt, "previous dependency evidence timestamp");
  if (at > now) throw new Error("previous dependency evidence is from the future");
  return { at: at.toISOString(), findings: evidence.findings };
}

function writeEvidence(path, evidence) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  chmodSync(target, 0o600);
}

export function skippedDependencyEvidence({ reason, subject, now = new Date(), previousEvidenceAt,
  findings = [], blocked = false }) {
  if (!["network-unavailable", "service-unavailable", "rate-limited"].includes(reason)) {
    throw new Error("unsupported dependency evidence outage reason");
  }
  if (!/^[a-f0-9]{40}$/.test(subject ?? "")) throw new Error("subject must be an immutable commit SHA");
  const previous = previousEvidence(previousEvidenceAt, now);
  return {
    schemaVersion: 1,
    source: "github-dependabot",
    status: "skipped",
    reason,
    subject,
    observedAt: now.toISOString(),
    lastSuccessfulEvidenceAt: previous.at,
    lastSuccessfulEvidenceAgeDays: previous.age,
    releaseReadiness: blocked ? "blocked" : "unknown",
    findings
  };
}

export async function runDependencyRemediation(options) {
  const now = new Date();
  const current = currentDependencyEvidence(options["current-summary"].map((path) =>
    readJson(path, "current security summary")), options.subject);
  const previous = readPreviousEvidence(options["previous-evidence"], now);
  const previousEvidenceAt = previous.at ?? options["previous-evidence-at"];
  let evidence;
  const collected = await collectDependabotAlerts({ repository: options.repository, apiUrl: options.apiUrl,
    token: options.token, request: options.request });
  if (collected.status === "skipped") {
    if (previous.findings.length === 0) {
      evidence = skippedDependencyEvidence({ reason: collected.reason, subject: options.subject, now,
        previousEvidenceAt });
    } else {
      const policy = readJson(dependencyConfigPath(options.policy,
        "security/dependency-remediation-policy.json"), "policy");
      const exceptionFile = readJson(dependencyConfigPath(options.exceptions,
        "security/exceptions.json"), "exceptions");
      const assessmentFile = readJson(dependencyConfigPath(options.assessments,
        "security/dependency-assessments.json"), "assessments");
      if (assessmentFile.schemaVersion !== 1 || !Array.isArray(assessmentFile.assessments)) {
        throw new Error("unsupported dependency assessment file");
      }
      const retained = evaluateDependencyRemediation({ alerts: [], currentFindings: current.findings,
        previousFindings: previous.findings, policy, exceptions: exceptionFile,
        assessments: assessmentFile.assessments, subject: options.subject, now });
      evidence = skippedDependencyEvidence({ reason: collected.reason, subject: options.subject, now,
        previousEvidenceAt, findings: retained.findings, blocked: retained.releaseReadiness === "blocked" });
    }
  } else {
    const policy = readJson(dependencyConfigPath(options.policy,
      "security/dependency-remediation-policy.json"), "policy");
    const exceptionFile = readJson(dependencyConfigPath(options.exceptions,
      "security/exceptions.json"), "exceptions");
    const assessmentFile = readJson(dependencyConfigPath(options.assessments,
      "security/dependency-assessments.json"), "assessments");
    if (assessmentFile.schemaVersion !== 1 || !Array.isArray(assessmentFile.assessments)) {
      throw new Error("unsupported dependency assessment file");
    }
    evidence = evaluateDependencyRemediation({ alerts: collected.alerts, currentFindings: current.findings,
      previousFindings: previous.findings, policy, exceptions: exceptionFile,
      assessments: assessmentFile.assessments, subject: options.subject, now });
    if (current.status === "partial") {
      evidence = skippedDependencyEvidence({ reason: current.reason, subject: options.subject, now,
        previousEvidenceAt, findings: evidence.findings,
        blocked: evidence.releaseReadiness === "blocked" });
    }
  }
  writeEvidence(options.output, evidence);
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const evidence = await runDependencyRemediation(parseArguments(process.argv.slice(2)));
    process.stdout.write(`dependency remediation ${evidence.status}: ${evidence.releaseReadiness}\n`);
    if (evidence.releaseReadiness === "blocked") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
