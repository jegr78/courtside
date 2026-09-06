import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { authorizationRequest, SecurityCookieJar } from "./security-authorization.mjs";
import { createAssessmentControl, zapVersion } from "./security-passive-deployment.mjs";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const evidenceSchema = JSON.parse(readFileSync(
  new URL("../security/authenticated-zap-evidence.schema.json", import.meta.url), "utf8"));
const lifecycleSchema = JSON.parse(readFileSync(
  new URL("../security/finding-lifecycle.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv({ strict: true, allErrors: true });
ajv.addSchema(lifecycleSchema);
const validateEvidenceSchema = ajv.compile(evidenceSchema);
import {
  createCandidate, createFinding, fingerprintFinding, recordRetest, transitionFinding,
  validateFindingTimeline
} from "./security-triage.mjs";

export const authenticatedZapPolicy = Object.freeze(JSON.parse(readFileSync(
  new URL("../security/zap-authenticated-policy.json", import.meta.url), "utf8")));
export const authenticatedZapPlanSessionPlaceholder = "SESSION=[SYNTHETIC]; XSRF-TOKEN=[SYNTHETIC]";

export function authenticatedZapPolicyDigest(policy = authenticatedZapPolicy) {
  return `sha256:${createHash("sha256").update(JSON.stringify(policy)).digest("hex")}`;
}

export function authenticatedZapPlanDigest(plans = authenticatedZapPolicy.roles.map((role) => ({
  role,
  plan: renderAuthenticatedZapPlan(role, authenticatedZapPlanSessionPlaceholder)
})).concat([{ role: "CANARY_RETEST", plan: renderAuthenticatedZapCanaryRetestPlan() }])) {
  return `sha256:${createHash("sha256").update(JSON.stringify(plans)).digest("hex")}`;
}

export function renderAuthenticatedZapCanaryRetestPlan() {
  return `env:
  contexts:
    - name: courtside-canary-retest
      urls:
        - http://scanner-gateway:8090${authenticatedZapPolicy.canary.path}
      includePaths:
        - ^http://scanner-gateway:8090${authenticatedZapPolicy.canary.path}$
  parameters:
    failOnError: true
    failOnWarning: false
    continueOnFailure: false
jobs:
  - type: passiveScan-config
    parameters:
      maxAlertsPerRule: 1
      scanOnlyInScope: true
      maxBodySizeInBytesToScan: 65536
      disableAllRules: true
    rules:
      - id: ${authenticatedZapPolicy.canary.passiveRuleId}
        threshold: Low
  - type: requestor
    requests:
      - url: http://scanner-gateway:8090${authenticatedZapPolicy.canary.path}
        name: scanner-canary-remediation-retest
        method: GET
        responseCode: 404
  - type: passiveScan-wait
    parameters:
      maxDuration: 1
    tests:
      - name: scanner canary remains absent
        type: alert
        action: passIfAbsent
        scanRuleId: ${authenticatedZapPolicy.canary.passiveRuleId}
        url: http://scanner-gateway:8090${authenticatedZapPolicy.canary.path}
        onFail: error
  - type: report
    parameters:
      template: traditional-json
      reportDir: /zap/wrk
      reportFile: report-canary-retest.json
      reportTitle: Courtside scanner canary remediation retest
`;
}

export function renderAuthenticatedZapPlan(role, cookieHeader) {
  assertRole(role);
  if (typeof cookieHeader !== "string" || !cookieHeader.includes("SESSION=")) {
    throw new Error("Authenticated ZAP requires a synthetic session cookie");
  }
  const active = authenticatedZapPolicy.active.roles.includes(role);
  const rules = authenticatedZapPolicy.active.ruleIds.map((id) => `        - id: ${id}\n`
    + `          strength: ${authenticatedZapPolicy.active.strength}\n`
    + `          threshold: ${authenticatedZapPolicy.active.threshold}`).join("\n");
  return `env:
  contexts:
    - name: courtside-${role.toLowerCase()}
      urls:
        - http://scanner-gateway:8090/api/my/bookings?limit=1
        - http://scanner-gateway:8090${authenticatedZapPolicy.canary.path}
      includePaths:
        - ^http://scanner-gateway:8090/api(?:/.*)?$
        - ^http://scanner-gateway:8090${authenticatedZapPolicy.canary.path}$
      excludePaths:
        - ^http://scanner-gateway:8090/api/session/logout$
  parameters:
    failOnError: true
    failOnWarning: false
    continueOnFailure: false
    progressToStdout: true
jobs:
  - type: passiveScan-config
    parameters:
      maxAlertsPerRule: 10
      scanOnlyInScope: true
      maxBodySizeInBytesToScan: 65536
      disableAllRules: true
    rules:
      - id: ${authenticatedZapPolicy.canary.passiveRuleId}
        threshold: Low
  - type: replacer
    parameters:
      deleteAllRules: true
    rules:
      - description: synthetic-${role.toLowerCase()}-session
        matchType: req_header
        matchString: Cookie
        matchRegex: false
        replacementString: ${JSON.stringify(cookieHeader)}
  - type: requestor
    requests:
      - url: http://scanner-gateway:8090/api/my/bookings?limit=1
        name: authenticated-session-proof
        method: GET
        responseCode: 200
      - url: http://scanner-gateway:8090/api/bookings?date=2026-08-21
        name: bounded-query-input
        method: GET
        responseCode: 200
      - url: http://scanner-gateway:8090${authenticatedZapPolicy.canary.path}
        name: scanner-canary
        method: GET
        responseCode: 200
  - type: spider
    parameters:
      context: courtside-${role.toLowerCase()}
      url: http://scanner-gateway:8090/api/my/bookings?limit=1
      maxDuration: ${authenticatedZapPolicy.spider.maxDurationMinutes}
      maxDepth: ${authenticatedZapPolicy.spider.maxDepth}
      maxChildren: ${authenticatedZapPolicy.spider.maxChildren}
      postForm: false
      processForm: false
      parseComments: false
      parseGit: false
      parseDsStore: false
      parseRobotsTxt: false
      parseSitemapXml: false
      parseSVNEntries: false
      threadCount: ${authenticatedZapPolicy.active.threadsPerHost}
    tests:
      - name: authenticated coverage
        type: stats
        statistic: automation.spider.urls.added
        operator: ">="
        value: ${authenticatedZapPolicy.spider.minimumUrlsPerRole}
        onFail: error
  - type: passiveScan-wait
    parameters:
      maxDuration: 1
    tests:
      - name: scanner canary detected
        type: alert
        action: passIfPresent
        scanRuleId: ${authenticatedZapPolicy.canary.passiveRuleId}
        url: http://scanner-gateway:8090${authenticatedZapPolicy.canary.path}
        onFail: error
${active ? `  - type: activeScan-config
    parameters:
      maxRuleDurationInMins: ${authenticatedZapPolicy.active.maxRuleDurationMinutes}
      maxScanDurationInMins: ${authenticatedZapPolicy.active.maxScanDurationMinutes}
      maxAlertsPerRule: ${authenticatedZapPolicy.active.maxAlertsPerRule}
      defaultPolicy: courtside-curated
      handleAntiCSRFTokens: false
      injectPluginIdInHeader: true
      threadPerHost: ${authenticatedZapPolicy.active.threadsPerHost}
    inputVectors:
      urlQueryStringAndDataDrivenNodes:
        enabled: true
        addParam: false
        odata: false
      postData:
        enabled: false
      urlPath: false
      httpHeaders:
        enabled: false
      cookieData:
        enabled: false
      scripts: false
  - type: activeScan-policy
    parameters:
      name: courtside-curated
    policyDefinition:
      defaultStrength: Low
      defaultThreshold: "Off"
      rules:
${rules}
  - type: activeScan
    parameters:
      context: courtside-${role.toLowerCase()}
      policy: courtside-curated
      url: http://scanner-gateway:8090/api/my/bookings?limit=1
` : ""}  - type: requestor
    requests:
      - url: http://scanner-gateway:8090/api/my/bookings?limit=1
        name: authenticated-session-retention-proof
        method: GET
        responseCode: 200
  - type: report
    parameters:
      template: traditional-json
      reportDir: /zap/wrk
      reportFile: report-${role.toLowerCase()}.json
      reportTitle: Courtside authenticated ZAP ${role}
`;
}

export function normalizeAuthenticatedZapAlerts(reports, run) {
  const candidates = new Map();
  let canaryDetected = false;
  let lifecycleSeed;
  for (const report of reports) {
    for (const alert of (report.site ?? []).flatMap((site) => site.alerts ?? [])) {
      const ruleId = String(alert.pluginid);
      const instances = alert.instances ?? [];
      if (!/^\d+$/.test(ruleId) || !instances.length) throw new Error("ZAP produced an invalid alert");
      for (const instance of instances) {
        const target = new URL(instance.uri);
        if (target.origin !== "http://scanner-gateway:8090") {
          throw new Error("ZAP reported traffic outside the scanner gateway");
        }
        if (Number(ruleId) === authenticatedZapPolicy.canary.passiveRuleId
            && target.pathname === authenticatedZapPolicy.canary.path) {
          canaryDetected = true;
          const seed = zapCandidate(alert, instance, run);
          lifecycleSeed ??= seed;
          continue;
        }
        if (!authenticatedZapPolicy.active.ruleIds.includes(Number(ruleId))) {
          throw new Error(`ZAP reported unapproved rule ${ruleId}`);
        }
        const candidate = zapCandidate(alert, instance, run);
        candidates.set(candidate.fingerprint, candidate);
      }
    }
  }
  if (!canaryDetected) throw new Error("ZAP did not detect the isolated scanner canary");
  return { candidates: [...candidates.values()], canaryDetected, lifecycleSeed };
}

export function authenticatedZapCanaryRetestDetected(report) {
  if (!report || !Array.isArray(report.site)) throw new Error("ZAP canary retest produced no valid report");
  let detected = false;
  for (const site of report.site) {
    if (!Array.isArray(site.alerts)) throw new Error("ZAP canary retest produced an invalid alert list");
    for (const alert of site.alerts) {
      if (Number(alert.pluginid) !== authenticatedZapPolicy.canary.passiveRuleId
          || !Array.isArray(alert.instances) || alert.instances.length === 0) {
        throw new Error("ZAP canary retest produced evidence outside its closed schema");
      }
      for (const instance of alert.instances) {
        const target = new URL(instance.uri);
        if (target.origin !== "http://scanner-gateway:8090"
            || target.pathname !== authenticatedZapPolicy.canary.path) {
          throw new Error("ZAP canary retest reported traffic outside its isolated target");
        }
        detected = true;
      }
    }
  }
  return detected;
}

export function createCanaryLifecycleProof(candidate, run) {
  const reference = "authenticated-zap.json#scanner-canary";
  const retestReference = "authenticated-zap.json#scanner-canary-remediation-retest";
  let finding = createFinding(candidate, {
    priority: "P3",
    cvssVector: "CVSS:4.0/AV:L/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N",
    mappings: {
      cwe: ["CWE-200"],
      wstg: ["WSTG-v4.2-CONF-02"],
      asvs: ["v5.0.0-13.2.1"],
      apiTop10: ["API8:2023"]
    },
    context: {
      impact: "The seeded response exists only inside the isolated assessment gateway.",
      reachability: "Only scanner containers on the private assessment network can reach it."
    },
    validation: {
      method: "regression-test", reference, reproducedAt: run.observedAt, actor: run.actor
    }
  });
  finding = transitionFinding(finding, {
    state: "remediation-in-progress", actor: run.actor, changedAt: run.observedAt, reference
  });
  finding = transitionFinding(finding, {
    state: "fixed", actor: run.actor, changedAt: run.observedAt, reference: retestReference
  });
  return recordRetest(finding, {
    outcome: "passed", testedAt: run.observedAt, actor: run.actor, reference: retestReference
  });
}

export function retainAuthenticatedZapEvidence(directory, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "authenticated-zap.json");
  writeFileSync(path, serialized, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function validateAuthenticatedZapEvidence(evidence) {
  if (!validateEvidenceSchema(evidence)) {
    throw new Error(`Authenticated ZAP evidence is invalid: ${JSON.stringify(validateEvidenceSchema.errors)}`);
  }
  const expectedRoles = authenticatedZapPolicy.roles.toSorted();
  const actualRoles = evidence.roles.map(({ role }) => role).toSorted();
  if (JSON.stringify(actualRoles) !== JSON.stringify(expectedRoles)
      || JSON.stringify(evidence.activeRuleIds) !== JSON.stringify(authenticatedZapPolicy.active.ruleIds)
      || evidence.policyDigest !== authenticatedZapPolicyDigest()
      || evidence.planDigest !== authenticatedZapPlanDigest()
      || evidence.requestCount > authenticatedZapPolicy.requestLimit + authenticatedZapPolicy.roles.length * 3) {
    throw new Error("Authenticated ZAP evidence contradicts its pinned policy");
  }
  const derived = evidence.candidates.some(({ state }) => state === "candidate") ? "incomplete" : "passed";
  if (evidence.outcome !== derived) throw new Error("Authenticated ZAP evidence outcome is inconsistent");
  const expectedTransitions = ["validated", "remediation-in-progress", "fixed", "retest-passed"];
  const reference = "authenticated-zap.json#scanner-canary";
  const retestReference = "authenticated-zap.json#scanner-canary-remediation-retest";
  const expectedFingerprint = fingerprintFinding(String(authenticatedZapPolicy.canary.passiveRuleId),
    authenticatedZapPolicy.canary.path, "response", "scanner-canary-server-header");
  const proof = evidence.lifecycleProof;
  validateFindingTimeline(proof, proof.provenance.observedAt);
  const expectedTransitionReferences = [reference, reference, retestReference, retestReference];
  if (evidence.lifecycleProof.fingerprint !== expectedFingerprint
      || evidence.lifecycleProof.ruleId !== String(authenticatedZapPolicy.canary.passiveRuleId)
      || evidence.lifecycleProof.normalizedSurface !== authenticatedZapPolicy.canary.path
      || evidence.lifecycleProof.provenance.targetFingerprint !== evidence.targetFingerprint
      || evidence.lifecycleProof.state !== "retest-passed"
      || evidence.lifecycleProof.validation.method !== "regression-test"
      || evidence.lifecycleProof.validation.reference !== reference
      || evidence.lifecycleProof.retests.length !== 1
      || evidence.lifecycleProof.retests[0].outcome !== "passed"
      || evidence.lifecycleProof.retests[0].reference !== retestReference
      || evidence.lifecycleProof.transitions.some((transition, index) =>
        transition.actor !== "local-maintainer"
        || transition.changedAt !== proof.provenance.observedAt
        || transition.reference !== expectedTransitionReferences[index])
      || JSON.stringify(evidence.lifecycleProof.transitions.map(({ state }) => state))
        !== JSON.stringify(expectedTransitions)) {
    throw new Error("Authenticated ZAP evidence has no matching remediation lifecycle proof");
  }
}

export async function runAuthenticatedZapAssessment(plan, context) {
  if (plan.profile !== "active" || plan.environment !== "SECURITY"
      || !["CSA-AUTHN-001", "CSA-AUTHZ-001", "CSA-DAST-001"]
        .every((testId) => plan.selectedTests.includes(testId))) {
    throw new Error("Authenticated ZAP requires the complete active SECURITY plan");
  }
  if (!Number.isSafeInteger(context.maxRequests) || context.maxRequests < 1
      || context.maxRequests > authenticatedZapPolicy.requestLimit) {
    throw new Error("Authenticated ZAP has no remaining request budget");
  }
  const control = createAssessmentControl(context.stopFile, context.deadline);
  try {
    const sessions = {};
    let nativeRequests = 0;
    for (const role of authenticatedZapPolicy.roles) {
      const authenticated = context.authenticateRole
        ? await context.authenticateRole(role)
        : await authenticateSyntheticRole(plan, context, control, role);
      nativeRequests += authenticated.requestCount;
      if (authenticated.requestCount !== 3 || nativeRequests > context.maxRequests
          || !authenticated.cookieHeader?.includes("SESSION=")) {
        throw new Error(`Authenticated ZAP lost the synthetic ${role} session`);
      }
      sessions[role] = authenticated.cookieHeader;
    }
    const scanner = await context.runZap(plan, {
      sessions,
      policy: authenticatedZapPolicy,
      policyDigest: authenticatedZapPolicyDigest(),
      planDigest: authenticatedZapPlanDigest(),
      planSessionPlaceholder: authenticatedZapPlanSessionPlaceholder,
      attempt: context.attempt,
      maxRequests: context.maxRequests - nativeRequests,
      timeoutMilliseconds: control.remainingMilliseconds()
    });
    const requestCount = nativeRequests + scanner.requestCount;
    if (!scanner.runtimeHardened || !Number.isSafeInteger(scanner.requestCount) || scanner.requestCount < 1
        || requestCount > context.maxRequests || scanner.planDigest !== authenticatedZapPlanDigest()
        || JSON.stringify(scanner.roles?.toSorted()) !== JSON.stringify(authenticatedZapPolicy.roles.toSorted())) {
      throw new Error(scanner.planDigest !== authenticatedZapPlanDigest()
        ? "Authenticated ZAP plan digest does not match the executed plans"
        : "Authenticated ZAP coverage or runtime controls are incomplete");
    }
    const observedAt = (context.now?.() ?? new Date()).toISOString();
    const normalized = normalizeAuthenticatedZapAlerts(scanner.reports, {
      runId: plan.runId,
      attempt: context.attempt,
      targetFingerprint: plan.targetFingerprint,
      observedAt,
      expiresOn: new Date(new Date(observedAt).getTime() + 30 * 86_400_000).toISOString().slice(0, 10),
      actor: "local-maintainer"
    });
    const canaryRetestDetected = scanner.canaryRetest?.detected
      ?? authenticatedZapCanaryRetestDetected(scanner.canaryRetest?.report);
    if (canaryRetestDetected !== false
        || !Number.isSafeInteger(scanner.canaryRetest.requestCount)
        || scanner.canaryRetest.requestCount < 1) {
      throw new Error("Authenticated ZAP canary remediation retest did not pass");
    }
    const lifecycleProof = createCanaryLifecycleProof(normalized.lifecycleSeed, {
      observedAt,
      actor: "local-maintainer"
    });
    const unresolved = normalized.candidates.some(({ state }) => state === "candidate");
    const evidence = {
      schemaVersion: 2,
      testId: "CSA-DAST-001",
      targetFingerprint: plan.targetFingerprint,
      image: authenticatedZapPolicy.image,
      policyDigest: authenticatedZapPolicyDigest(),
      planDigest: scanner.planDigest,
      roles: authenticatedZapPolicy.roles.map((role) => ({ role, outcome: "passed" })),
      activeRuleIds: authenticatedZapPolicy.active.ruleIds,
      passiveEvidence: "separate-csa-deploy-001",
      canaryDetected: normalized.canaryDetected,
      candidates: normalized.candidates,
      lifecycleProof,
      requestCount,
      generatedDataMegabytes: scanner.generatedDataMegabytes ?? 0,
      outcome: unresolved ? "incomplete" : "passed"
    };
    validateAuthenticatedZapEvidence(evidence);
    retainAuthenticatedZapEvidence(context.evidenceDirectory, evidence);
    return evidence;
  } finally {
    control.close();
  }
}

async function authenticateSyntheticRole(plan, context, control, role) {
  const jar = new SecurityCookieJar();
  let requestCount = 0;
  const request = async (probe, options = {}) => {
    control.beforeRequest();
    requestCount++;
    return authorizationRequest(plan.target, jar, probe, {
      ca: context.ca, signal: control.signal, timeoutMilliseconds: control.remainingMilliseconds(), ...options
    });
  };
  await request({ method: "GET", path: "/api/session", headers: {} });
  const username = `security.${role.toLowerCase().replaceAll("_", ".")}.1`;
  const body = new URLSearchParams({ username, password: context.sharedPassword }).toString();
  const login = await request({ method: "POST", path: "/api/session",
    headers: { "content-type": "application/x-www-form-urlencoded" }, body }, { csrf: true });
  const session = await request({ method: "GET", path: "/api/session", headers: {} });
  if (login.status !== 200 || session.status !== 200 || session.json?.authenticated !== true
      || !session.json.roles?.includes(role)) {
    throw new Error(`Authenticated ZAP lost the synthetic ${role} session`);
  }
  return { cookieHeader: jar.header(), requestCount };
}

function assertRole(role) {
  if (!authenticatedZapPolicy.roles.includes(role)) throw new Error(`Unsupported ZAP role ${role}`);
}

function normalizeRoute(pathname) {
  return pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "{id}")
    .replace(/\/[0-9]+(?=\/|$)/g, "/{id}");
}

function zapCandidate(alert, instance, run) {
  const ruleId = String(alert.pluginid);
  const target = new URL(instance.uri);
  const normalizedSurface = normalizeRoute(target.pathname);
  const parameter = instance.param || "response";
  const attackClass = new Map([
    ["10037", "scanner-canary-server-header"],
    ["40012", "reflected-cross-site-scripting"],
    ["40018", "sql-injection"]
  ]).get(ruleId);
  if (!attackClass
      || !["/__security/zap-canary", "/api/my/bookings", "/api/bookings"].includes(normalizedSurface)
      || !["response", "limit", "date"].includes(parameter)) {
    throw new Error("ZAP produced evidence outside the closed assessment schema");
  }
  return createCandidate({
    scanner: "owasp-zap",
    ruleId,
    normalizedSurface,
    parameter,
    attackClass,
    provenance: {
      tool: "owasp-zap", version: zapVersion, runId: run.runId, attempt: run.attempt,
      targetFingerprint: run.targetFingerprint, observedAt: run.observedAt
    },
    evidence: [{
      id: `zap-${ruleId}-${evidenceDigest(instance).slice(7, 19)}`,
      status: "retained", classification: "protected", digest: evidenceDigest(instance),
      expiresOn: run.expiresOn
    }]
  });
}

function evidenceDigest(instance) {
  const safe = JSON.stringify({ method: instance.method ?? "GET", status: instance.status ?? "unknown",
    route: normalizeRoute(new URL(instance.uri).pathname), param: instance.param ?? "response" });
  return `sha256:${createHash("sha256").update(safe).digest("hex")}`;
}
