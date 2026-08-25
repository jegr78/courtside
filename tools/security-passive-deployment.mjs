import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import { join } from "node:path";
import tls from "node:tls";
import { createRequire } from "node:module";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const Ajv = require("ajv/dist/2020").default;
const evidenceSchema = JSON.parse(readFileSync(new URL(
  "../security/passive-deployment-evidence.schema.json", import.meta.url)));
const validateEvidence = new Ajv({ strict: true, allErrors: true }).compile(evidenceSchema);

// Dependabot bumps the deployment and nothing beside it, so the scanner's version and digest are
// read from there rather than repeated here, where nothing would keep them in step.
export const zapImage = deployedZapImage();
export const zapVersion = zapImage.slice(zapImage.indexOf(":") + 1, zapImage.indexOf("@"));
export const passiveScannerOrigin = "http://scanner-gateway:8090";

function deployedZapImage() {
  const compose = new URL("../deploy/compose.security.yaml", import.meta.url);
  const found = /zaproxy\/zap-stable:[\w.]+@sha256:[a-f0-9]{64}/.exec(readFileSync(compose, "utf8"));
  if (!found) throw new Error(`${compose.pathname} names no ZAP image pinned by digest`);
  return found[0];
}
const securityHeaders = [
  "content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"
];
const publicPaths = ["/", "/api/source", "/login", "/does-not-exist", "/icon.svg"];
const exposurePaths = ["/actuator", "/actuator/health", "/swagger-ui/index.html", "/.git/config", "/assets/app.js.map"];
const suspiciousCommentPatterns = [
  "todo", "fixme", "bug", "bugs", "xxx", "query", "db", "admin", "administrator", "user", "username",
  "select", "where", "from", "later", "debug"
];
export const requiredPassiveCheckIds = Object.freeze([
  ...publicPaths.map((path) => `headers-${pathId(path)}`),
  ...exposurePaths.map((path) => `exposure-${pathId(path)}`),
  "method-trace", "method-connect", "method-track", "body-limit", "header-limit", "forwarded-boundary",
  "host-boundary", "tls-versions", "certificate-trust", "http-redirect", "runtime-hardening", "loopback-publication",
  "management-separation", "direct-forwarded-behavior", "scanner-runtime-hardening", "secure-cookie-delivery", "transport-security",
  "qualified-image-evidence"
].toSorted());

export function normalizeZapAlerts(report) {
  if (report == null || typeof report !== "object" || Array.isArray(report)
      || !Array.isArray(report.site) || report.site.length === 0
      || report.site.some((site) => site == null || typeof site !== "object" || Array.isArray(site)
        || !Array.isArray(site.alerts))) {
    throw new Error("ZAP produced an invalid report structure");
  }
  const normalized = new Map();
  for (const alert of report.site.flatMap((site) => site.alerts)) {
    if (alert == null || typeof alert !== "object" || Array.isArray(alert)) {
      throw new Error("ZAP produced an invalid alert record");
    }
    const pluginId = alert.pluginid;
    const riskCode = Number(alert.riskcode);
    const confidence = Number(alert.confidence);
    if (typeof pluginId !== "string" || !/^\d+$/.test(pluginId)
        || typeof alert.riskcode !== "string" || !/^[0-3]$/.test(alert.riskcode)
        || typeof alert.confidence !== "string" || !/^[0-4]$/.test(alert.confidence)
        || !Number.isInteger(riskCode) || !Number.isInteger(confidence)
        || !Array.isArray(alert.instances) || alert.instances.length === 0) {
      throw new Error("ZAP produced an invalid alert record");
    }
    for (const instance of alert.instances) {
      if (instance == null || typeof instance !== "object" || Array.isArray(instance)
          || typeof instance.method !== "string" || typeof instance.uri !== "string") {
        throw new Error("ZAP produced an invalid alert record");
      }
      const method = instance.method.toUpperCase();
      if (!["GET", "HEAD"].includes(method)) throw new Error("ZAP produced an invalid alert record");
      const routeTemplate = passiveRouteTemplate(instance.uri);
      const fingerprint = passiveAlertFingerprint(pluginId, method, routeTemplate);
      const ruleEvidence = passiveRuleEvidence(pluginId, alert, instance, fingerprint);
      const key = `${pluginId}\0${method}\0${routeTemplate}`;
      const existing = normalized.get(key);
      if (existing && (existing.riskCode !== riskCode || existing.confidence !== confidence)) {
        throw new Error("ZAP produced a contradictory alert record");
      }
      if (existing && JSON.stringify(existing.ruleEvidence) !== JSON.stringify(ruleEvidence)) {
        throw new Error("ZAP produced contradictory rule evidence");
      }
      if (existing) existing.count++;
      else normalized.set(key, { pluginId, riskCode, confidence, method, routeTemplate,
        fingerprint, count: 1, ruleEvidence });
    }
  }
  return [...normalized.values()].toSorted((left, right) =>
    left.pluginId.localeCompare(right.pluginId) || left.method.localeCompare(right.method)
      || left.routeTemplate.localeCompare(right.routeTemplate));
}

function passiveRuleEvidence(pluginId, alert, instance, locationDigest) {
  const unsupported = () => new Error(`ZAP rule ${pluginId} produced unsupported rule evidence`);
  const param = instance.param;
  const evidence = instance.evidence;
  const otherInfo = instance.otherinfo;
  if (![param, evidence, otherInfo].every((value) => typeof value === "string")) {
    throw unsupported();
  }
  if (["10010", "10054"].includes(pluginId)) {
    if (param !== "XSRF-TOKEN" || evidence !== "Set-Cookie: XSRF-TOKEN" || otherInfo !== "") {
      throw unsupported();
    }
    return { kind: "cookie-attribute", cookieName: "xsrf-token",
      missingAttribute: pluginId === "10010" ? "http-only" : "same-site" };
  }
  if (pluginId === "10027") {
    const pathname = new URL(instance.uri).pathname;
    if (!/\.(?:css|js)$/.test(pathname)) {
      throw new Error("ZAP attributed textual evidence to a non-textual resource");
    }
    if (evidence.length === 0) throw new Error("ZAP rule 10027 produced no match evidence");
    const patternSource = /pattern was used:/i.test(otherInfo)
      ? otherInfo : typeof alert.otherinfo === "string" ? alert.otherinfo : "";
    const patternWindow = /pattern was used:([\s\S]{1,80})/i.exec(patternSource)?.[1].toLowerCase() ?? "";
    const matchedPatterns = suspiciousCommentPatterns.filter((pattern) => patternWindow.includes(`\\b${pattern}\\b`));
    if (matchedPatterns.length !== 1) {
      throw new Error("ZAP rule 10027 produced an unsupported pattern identifier");
    }
    const patternId = `comment-${matchedPatterns[0]}`;
    return { kind: "text-pattern", patternId,
      locationDigest: passiveRuleLocationDigest(locationDigest, patternId) };
  }
  if (pluginId === "10036") {
    if (param !== "" || evidence.length === 0 || otherInfo !== "") {
      throw unsupported();
    }
    return { kind: "response-header", headerName: "server" };
  }
  if (pluginId === "10055") {
    const directives = [...otherInfo.matchAll(/(?:^|\n)([a-z][a-z-]*)(?:\n|$)/g)].map((match) => match[1]);
    if (param.toLowerCase() !== "content-security-policy" || evidence.length === 0
        || directives.length === 0 || directives.some((directive) => directive !== "img-src")) {
      throw unsupported();
    }
    return { kind: "policy-directive", headerName: "content-security-policy", directives: [...new Set(directives)] };
  }
  if (pluginId === "10109") {
    if (param !== "" || !evidence.includes("<script")
        || !otherInfo.startsWith("No links have been found while there are scripts")) {
      throw unsupported();
    }
    return { kind: "application-signal", signal: "scripts-without-links" };
  }
  if (pluginId === "10112") {
    const tokenNames = otherInfo.split("\n").map((line) => /^cookie:(SESSION|XSRF-TOKEN)$/.exec(line)?.[1])
      .filter(Boolean).map((name) => name === "SESSION" ? "session" : "xsrf-token").toSorted();
    const expected = param === "SESSION" ? "SESSION" : param === "XSRF-TOKEN" ? "XSRF-TOKEN" : null;
    if (!expected || evidence !== expected || tokenNames.length === 0
        || tokenNames.length !== otherInfo.split("\n").length) {
      throw unsupported();
    }
    return { kind: "session-signal", tokenNames: [...new Set(tokenNames)] };
  }
  throw new Error(`ZAP produced an unsupported passive rule: ${pluginId}`);
}

function passiveAlertFingerprint(pluginId, method, routeTemplate) {
  const identity = [pluginId, `${method} ${routeTemplate}`, "response", "passive-web"]
    .map((value) => value.toLowerCase()).join("\0");
  return `sha256:${createHash("sha256").update(identity).digest("hex")}`;
}

function passiveRouteTemplate(uri) {
  let path;
  try {
    const parsed = new URL(uri);
    if (parsed.origin !== passiveScannerOrigin || parsed.username || parsed.password || parsed.search) throw new Error();
    path = parsed.pathname;
  } catch {
    throw new Error("ZAP produced an unclassified route");
  }
  if (path === "/index.html") return "/";
  if (["/", "/api/source", "/login", "/does-not-exist", "/icon.svg", "/manifest.webmanifest",
    "/registerSW.js", "/sw.js", "/font-licenses.txt", "/robots.txt", "/sitemap.xml"].includes(path)) return path;
  if (/^\/assets\/[A-Za-z0-9._-]+\.(?:css|js|png|svg|woff2?)$/.test(path)) return "/assets/{asset}";
  if (/^\/workbox-[A-Za-z0-9._-]+\.js$/.test(path)) return "/workbox-{asset}.js";
  throw new Error("ZAP produced an unclassified route");
}

export function assertQualifiedImageEvidence(qualification, imageDigest, imageArchitecture) {
  const digest = imageDigest.includes("@") ? imageDigest.slice(imageDigest.indexOf("@") + 1) : imageDigest;
  const checks = qualification?.checks;
  if (qualification?.schemaVersion !== 1 || qualification?.status !== "passed"
      || qualification?.manifestDigest !== digest || qualification?.architecture !== imageArchitecture
      || !checks
      || !["deployment", "authentication", "bookingPersistence", "hardening"].every((name) => checks[name] === true)) {
    throw new Error("The deployment qualification does not prove the assessed image digest");
  }
}

export function buildPassiveDeploymentEvidence({
  targetFingerprint, imageDigest, observations, zapReport, requestCount
}) {
  if (!Number.isInteger(requestCount) || requestCount < 1 || requestCount > 1000) {
    throw new Error("The passive assessment request budget was exceeded");
  }
  const checks = observations.map(({ id, layer, passed, outcome, observation }) => ({
    id, layer, outcome: outcome ?? (passed ? "passed" : "failed"), observation
  }));
  const checkIds = checks.map(({ id }) => id).toSorted();
  if (new Set(checkIds).size !== checkIds.length
      || JSON.stringify(checkIds) !== JSON.stringify(requiredPassiveCheckIds)) {
    throw new Error("The passive assessment evidence is missing required checks");
  }
  const alerts = normalizeZapAlerts(zapReport);
  const failed = checks.some((check) => check.outcome === "failed");
  const incomplete = !failed && alerts.length > 0;
  const evidence = {
    schemaVersion: 2,
    testId: "CSA-DEPLOY-001",
    targetFingerprint,
    imageDigest,
    layers: [...new Set(checks.map(({ layer }) => layer))].toSorted(),
    checks,
    zap: { image: zapImage, version: zapReport.version, status: "completed", alerts },
    requestCount,
    outcome: failed ? "failed" : incomplete ? "incomplete" : "passed"
  };
  assertPassiveDeploymentEvidence(evidence);
  return evidence;
}

export function evaluatePublicResponseHeaders(response) {
  const contentSecurityPolicy = response.headers.get("content-security-policy") ?? "";
  const permissionsPolicy = response.headers.get("permissions-policy") ?? "";
  const parsedDirectives = contentSecurityPolicy.split(";").map((directive) => directive.trim())
    .filter(Boolean).map((directive) => directive.split(/\s+/).map((part) => part.toLowerCase()));
  const expectedDirectives = new Map([
    ["default-src", ["'self'"]], ["object-src", ["'none'"]],
    ["img-src", ["'self'", "https:"]], ["style-src", ["'self'"]],
    ["script-src", ["'self'"]], ["connect-src", ["'self'"]],
    ["manifest-src", ["'self'"]], ["worker-src", ["'self'"]],
    ["frame-ancestors", ["'none'"]], ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]]
  ]);
  const cspValid = parsedDirectives.length === expectedDirectives.size
    && new Set(parsedDirectives.map(([name]) => name)).size === expectedDirectives.size
    && parsedDirectives.every(([name, ...sources]) => {
      const expectedSources = expectedDirectives.get(name);
      return expectedSources !== undefined && sources.length === expectedSources.length
        && expectedSources.every((source) => sources.includes(source));
    });
  const passed = securityHeaders.every((header) => response.headers.has(header))
    && response.headers.get("x-content-type-options") === "nosniff"
    && response.headers.get("x-frame-options") === "DENY"
    && response.headers.get("referrer-policy") === "strict-origin-when-cross-origin"
    && cspValid
    && ["geolocation=()", "camera=()", "microphone=()"].every((directive) =>
      permissionsPolicy.includes(directive))
    && !response.headers.has("server") && !response.headers.has("via") && response.cacheProtected;
  return {
    passed,
    observation: response.headers.has("server") ? "server-header-exposed"
      : response.headers.has("via") ? "proxy-implementation-disclosed"
        : passed ? "security-and-cache-headers-valid" : "security-or-cache-headers-invalid"
  };
}

export function assertPassiveDeploymentEvidence(evidence) {
  if (!validateEvidence(evidence)) {
    throw new Error(`The passive assessment evidence is invalid: ${JSON.stringify(validateEvidence.errors)}`);
  }
  const fingerprints = new Set();
  for (const alert of evidence.zap.alerts) {
    if (alert.fingerprint !== passiveAlertFingerprint(alert.pluginId, alert.method, alert.routeTemplate)) {
      throw new Error("The passive assessment evidence contains a mismatched alert fingerprint");
    }
    if (!retainedRuleEvidenceMatches(alert)) {
      throw new Error("The passive assessment evidence contains mismatched rule evidence");
    }
    if (fingerprints.has(alert.fingerprint)) {
      throw new Error("The passive assessment evidence contains a duplicate alert fingerprint");
    }
    fingerprints.add(alert.fingerprint);
  }
}

function passiveRuleLocationDigest(fingerprint, patternId) {
  return `sha256:${createHash("sha256").update(`${fingerprint}\0${patternId}`).digest("hex")}`;
}

function retainedRuleEvidenceMatches(alert) {
  const evidence = alert.ruleEvidence;
  if (alert.pluginId === "10010") return evidence.kind === "cookie-attribute"
    && evidence.cookieName === "xsrf-token" && evidence.missingAttribute === "http-only";
  if (alert.pluginId === "10054") return evidence.kind === "cookie-attribute"
    && evidence.cookieName === "xsrf-token" && evidence.missingAttribute === "same-site";
  if (alert.pluginId === "10027") return evidence.kind === "text-pattern"
    && suspiciousCommentPatterns.map((pattern) => `comment-${pattern}`).includes(evidence.patternId)
    && evidence.locationDigest === passiveRuleLocationDigest(alert.fingerprint, evidence.patternId);
  if (alert.pluginId === "10036") return evidence.kind === "response-header" && evidence.headerName === "server";
  if (alert.pluginId === "10055") return evidence.kind === "policy-directive"
    && evidence.headerName === "content-security-policy"
    && JSON.stringify(evidence.directives) === JSON.stringify(["img-src"]);
  if (alert.pluginId === "10109") return evidence.kind === "application-signal"
    && evidence.signal === "scripts-without-links";
  if (alert.pluginId === "10112") return evidence.kind === "session-signal"
    && evidence.tokenNames.length > 0
    && evidence.tokenNames.every((tokenName) => ["session", "xsrf-token"].includes(tokenName))
    && JSON.stringify(evidence.tokenNames) === JSON.stringify(evidence.tokenNames.toSorted());
  return false;
}

export async function runPassiveDeploymentAssessment(plan, context) {
  if (plan.profile !== "safe" || plan.environment !== "SECURITY"
      || plan.selectedTests.length !== 1 || plan.selectedTests[0] !== "CSA-DEPLOY-001") {
    throw new Error("The passive deployment suite requires safe CSA-DEPLOY-001 in SECURITY");
  }
  const observations = [];
  let requestCount = 0;
  const control = createAssessmentControl(context.stopFile, context.deadline);
  try {
    assertQualifiedImageEvidence(context.qualification, plan.imageDigest, plan.imageArchitecture);
    for (const path of publicPaths) {
    control.beforeRequest();
    const response = await passiveRequest(plan.target, path, { ca: context.ca, signal: control.signal,
      timeoutMilliseconds: control.remainingMilliseconds() });
    requestCount++;
    const headerAssessment = evaluatePublicResponseHeaders(response);
    observations.push({
      id: `headers-${pathId(path)}`, layer: "proxy",
      passed: headerAssessment.passed,
      observation: headerAssessment.observation
    });
    if (path === "/") observations.push({ id: "secure-cookie-delivery", layer: "proxy",
      passed: response.cookiesSecure,
      observation: response.cookiesSecure ? "issued-cookies-secure" : "insecure-cookie-issued" });
  }
  for (const path of exposurePaths) {
    control.beforeRequest();
    const response = await passiveRequest(plan.target, path, { ca: context.ca, signal: control.signal,
      timeoutMilliseconds: control.remainingMilliseconds() });
    requestCount++;
    observations.push({ id: `exposure-${pathId(path)}`, layer: "proxy", passed: response.status === 404,
      observation: response.status === 404 ? "route-not-exposed" : "unexpected-route-response" });
  }
  for (const method of ["TRACE", "CONNECT", "TRACK"]) {
    control.beforeRequest();
    const response = method === "CONNECT"
      ? await connectRequest(plan.target, context.ca, control)
      : await passiveRequest(plan.target, "/", { method, ca: context.ca, signal: control.signal,
        timeoutMilliseconds: control.remainingMilliseconds() });
    requestCount++;
    observations.push({ id: `method-${method.toLowerCase()}`, layer: "proxy",
      passed: [400, 405].includes(response.status),
      observation: [400, 405].includes(response.status) ? "method-rejected" : "method-accepted" });
  }
  control.beforeRequest();
  const csrf = await csrfToken(plan.target, context.ca, control);
  requestCount++;
  control.beforeRequest();
  const oversized = await passiveRequest(plan.target, "/api/session", {
    method: "POST", headers: { "content-type": "application/json", "content-length": String(2 * 1024 * 1024 + 1),
      cookie: `XSRF-TOKEN=${csrf.cookie}`, "x-xsrf-token": csrf.header },
    ca: context.ca, signal: control.signal, timeoutMilliseconds: control.remainingMilliseconds()
  });
  requestCount++;
  observations.push({ id: "body-limit", layer: "proxy", passed: oversized.status === 413,
    observation: oversized.status === 413 ? "proxy-body-limit-enforced" : "proxy-body-limit-not-proven" });
  control.beforeRequest();
  const oversizedHeader = await passiveRequest(plan.target, "/api/source", { ca: context.ca,
    signal: control.signal, timeoutMilliseconds: control.remainingMilliseconds(),
    headers: { "x-security-limit-probe": "a".repeat(128 * 1024) } });
  requestCount++;
  observations.push({ id: "header-limit", layer: "proxy", passed: [400, 413, 431].includes(oversizedHeader.status),
    observation: [400, 413, 431].includes(oversizedHeader.status)
      ? "oversized-header-rejected" : "oversized-header-accepted" });
  control.beforeRequest();
  const spoofedHost = await passiveRequest(plan.target, "/api/source", { headers: {
    "x-forwarded-host": "attacker.example", "x-forwarded-proto": "http"
  }, ca: context.ca, signal: control.signal, timeoutMilliseconds: control.remainingMilliseconds() });
  requestCount++;
  observations.push({ id: "forwarded-boundary", layer: "proxy", passed: spoofedHost.status === 421,
    observation: spoofedHost.status === 421 ? "spoofed-host-rejected" : "spoofed-host-not-rejected" });
  control.beforeRequest();
  const hostileHost = await passiveRequest(plan.target, "/__security/request-observation", { headers: {
    host: "attacker.example"
  }, ca: context.ca, signal: control.signal, timeoutMilliseconds: control.remainingMilliseconds() });
  requestCount++;
  const hostCanonicalized = hostileHost.status === 200
    && hostileHost.headers.get("x-courtside-observed-host") === "localhost";
  observations.push({ id: "host-boundary", layer: "proxy", passed: hostCanonicalized,
    observation: hostCanonicalized ? "upstream-host-canonicalized" : "upstream-host-not-canonicalized" });
  control.beforeRequest();
  const tlsResults = await Promise.all([
    tlsProtocol(plan.target, "TLSv1.2", "TLSv1.2", context.ca, control),
    tlsProtocol(plan.target, "TLSv1.3", "TLSv1.3", context.ca, control),
    tlsProtocol(plan.target, "TLSv1", "TLSv1.1", context.ca, control)
  ]);
  requestCount += 3;
  observations.push({ id: "tls-versions", layer: "proxy",
    passed: tlsResults[0] && tlsResults[1] && !tlsResults[2],
    observation: tlsResults[0] && tlsResults[1] && !tlsResults[2] ? "tls12-and-tls13-only" : "tls-policy-mismatch" });
  observations.push({ id: "certificate-trust", layer: "proxy", passed: tlsResults[0],
    observation: tlsResults[0] ? "certificate-chain-and-host-valid" : "certificate-validation-failed" });
  observations.push({ id: "http-redirect", layer: "host", outcome: "not-applicable",
    observation: "http-port-not-published" });
  observations.push({ id: "transport-security", layer: "host", outcome: "not-applicable",
    observation: "localhost-transport-qualified-externally" });
  observations.push({ id: "qualified-image-evidence", layer: "host", passed: true,
    observation: "covered-by-image-qualification" });
  const runtime = await context.inspectRuntime(plan, { control, stopFile: context.stopFile });
  observations.push(...runtime.observations);
  requestCount += runtime.requestCount;
  mkdirSync(context.evidenceDirectory, { recursive: true, mode: 0o700 });
  control.beforeRequest();
  const zapReport = await context.runZap(plan, { attempt: context.attempt,
    maxRequests: plan.budgets.requests - requestCount, timeoutMilliseconds: control.remainingMilliseconds() });
  requestCount += Number(zapReport.requestCount ?? 0);
  observations.push({ id: "scanner-runtime-hardening", layer: "container", passed: zapReport.runtimeHardened === true,
    observation: zapReport.runtimeHardened === true ? "scanner-runtime-controls-present"
      : "scanner-runtime-controls-incomplete" });
  const evidence = buildPassiveDeploymentEvidence({
    targetFingerprint: plan.targetFingerprint, imageDigest: plan.imageDigest,
    observations, zapReport: { ...zapReport, version: zapVersion }, requestCount
  });
  const serializedEvidence = `${JSON.stringify(evidence, null, 2)}\n`;
  const renderedSummary = passiveDeploymentSummary(evidence);
  if (Buffer.byteLength(serializedEvidence) + Buffer.byteLength(renderedSummary)
      > plan.budgets.evidenceMegabytes * 1024 * 1024) {
    throw new Error("The passive assessment evidence budget was exceeded");
  }
  const output = join(context.evidenceDirectory, "passive-deployment.json");
  writeFileSync(output, serializedEvidence, { mode: 0o600 });
  chmodSync(output, 0o600);
  const summary = join(context.evidenceDirectory, "passive-deployment.md");
  writeFileSync(summary, renderedSummary, { mode: 0o600 });
  chmodSync(summary, 0o600);
  return evidence;
  } finally {
    control.close();
  }
}

export function passiveDeploymentSummary(evidence) {
  const checks = evidence.checks.map((check) =>
    `| ${check.id} | ${check.layer} | ${check.outcome} | ${check.observation} |`).join("\n");
  return `# Passive deployment security assessment\n\n`
    + `Outcome: ${evidence.outcome}\n\n`
    + `Target fingerprint: ${evidence.targetFingerprint}\n\n`
    + `Application image: ${evidence.imageDigest}\n\n`
    + `Requests: ${evidence.requestCount}\n\n`
    + `ZAP candidates: ${evidence.zap.alerts.length}\n\n`
    + `| Check | Layer | Outcome | Observation |\n| --- | --- | --- | --- |\n${checks}\n`;
}

export function passiveEvidenceDigest(evidence) {
  return `sha256:${createHash("sha256").update(JSON.stringify(evidence)).digest("hex")}`;
}

export function passiveRequest(origin, path, options = {}) {
  const body = options.body;
  const target = new URL(path, origin);
  return new Promise((resolve, reject) => {
    const result = (response) => {
      const headers = new Map(Object.entries(response.headers)
        .map(([name, value]) => [name.toLowerCase(), Array.isArray(value) ? value.join(", ") : value]));
      const cookies = response.headers["set-cookie"] ?? [];
      return { status: response.statusCode, headers,
        cacheProtected: /(?:no-cache|no-store|private)/i.test(headers.get("cache-control") ?? ""),
        cookiesSecure: cookies.length > 0 && cookies.every((cookie) => /;\s*Secure(?:;|$)/i.test(cookie)) };
    };
    const call = https.request(target, {
      method: options.method ?? "GET", headers: { ...options.headers, ...(body ? { "content-length": body.length } : {}) },
      agent: false, ca: options.ca, servername: target.hostname,
      timeout: Math.max(1, Math.min(10_000, options.timeoutMilliseconds ?? 10_000)), signal: options.signal
    }, (response) => {
      response.resume();
      response.once("end", () => resolve(result(response)));
    });
    call.once("connect", (response, socket) => { socket.destroy(); resolve(result(response)); });
    call.once("timeout", () => call.destroy(new Error("Passive request timed out")));
    call.once("error", (failure) => reject(new Error(
      `Passive ${options.method ?? "GET"} ${path} failed: ${failure.message}`)));
    if (body) call.write(body);
    call.end();
  });
}

function tlsProtocol(origin, minVersion, maxVersion, ca, control) {
  const target = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: target.hostname, port: target.port || 443, servername: target.hostname,
      ca, minVersion, maxVersion, signal: control.signal });
    const timeout = setTimeout(() => socket.destroy(new Error("TLS probe timed out")), control.remainingMilliseconds());
    socket.once("secureConnect", () => { clearTimeout(timeout); socket.destroy(); resolve(true); });
    socket.once("error", () => {
      clearTimeout(timeout);
      if (control.signal.aborted) reject(control.signal.reason instanceof Error
        ? control.signal.reason : new Error("Assessment aborted"));
      else resolve(false);
    });
  });
}

function connectRequest(origin, ca, control) {
  const target = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: target.hostname, port: target.port || 443, servername: target.hostname, ca,
      signal: control.signal });
    let response = "";
    const timeout = setTimeout(() => socket.destroy(new Error("CONNECT probe timed out")),
      control.remainingMilliseconds());
    socket.once("secureConnect", () => socket.write(
      `CONNECT / HTTP/1.1\r\nHost: ${target.hostname}\r\nConnection: close\r\n\r\n`));
    socket.on("data", (chunk) => {
      response += chunk.toString("ascii");
      if (response.includes("\r\n")) socket.destroy();
    });
    socket.once("close", () => {
      clearTimeout(timeout);
      const status = Number(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(response)?.[1]);
      if (status) resolve({ status, headers: new Set() });
      else reject(new Error("CONNECT produced no HTTP status"));
    });
    socket.once("error", (failure) => { clearTimeout(timeout);
      reject(new Error(`Passive CONNECT failed: ${failure.message}`)); });
  });
}

function csrfToken(origin, ca, control) {
  const target = new URL("/", origin);
  return new Promise((resolve, reject) => {
    const call = https.request(target, { agent: false, ca, servername: target.hostname, signal: control.signal,
      timeout: Math.max(1, Math.min(10_000, control.remainingMilliseconds())) }, (response) => {
      response.resume();
      response.once("end", () => {
        const cookie = (response.headers["set-cookie"] ?? []).find((value) => value.startsWith("XSRF-TOKEN="));
        const encoded = /^XSRF-TOKEN=([^;]+)/.exec(cookie ?? "")?.[1];
        if (!encoded) reject(new Error("The proxy issued no CSRF cookie for the body-limit probe"));
        else resolve({ cookie: encoded, header: decodeURIComponent(encoded) });
      });
    });
    call.once("timeout", () => call.destroy(new Error("CSRF prerequisite timed out")));
    call.once("error", reject);
    call.end();
  });
}

export function createAssessmentControl(stopFile, deadline) {
  const controller = new AbortController();
  const reason = () => existsSync(stopFile) ? "The emergency stop prevents further assessment requests"
    : Date.now() >= deadline.getTime() ? "The duration budget was exceeded" : null;
  const monitor = setInterval(() => {
    const failure = reason();
    if (failure) controller.abort(new Error(failure));
  }, 50);
  return {
    signal: controller.signal,
    beforeRequest() {
      const failure = reason();
      if (failure) {
        controller.abort(new Error(failure));
        throw new Error(failure);
      }
    },
    remainingMilliseconds() {
      return Math.max(1, deadline.getTime() - Date.now());
    },
    close() { clearInterval(monitor); }
  };
}

function pathId(path) {
  return path === "/" ? "root" : path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-$/, "");
}

export function runOwnedProcess(command, args, {
  timeoutMilliseconds, stopFile, cleanup = async () => {}, environment = process.env, acceptedExitCodes = [0], guard,
  guardFailure = "Owned security process exceeded a safety limit", outputLimitBytes = 1024 * 1024, input
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"], env: environment });
    if (input !== undefined) child.stdin.end(input);
    const output = [];
    const errors = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let terminationReason;
    const collect = (chunks, chunk, current) => {
      if (current + chunk.length > outputLimitBytes) {
        terminationReason = "Owned security process output exceeded its safety limit";
        child.kill("SIGKILL");
        return current;
      }
      chunks.push(chunk);
      return current + chunk.length;
    };
    child.stdout.on("data", (chunk) => { outputBytes = collect(output, chunk, outputBytes); });
    child.stderr.on("data", (chunk) => { errorBytes = collect(errors, chunk, errorBytes); });
    const deadline = setTimeout(() => {
      terminationReason = "Owned security process exceeded its duration limit";
      child.kill("SIGKILL");
    }, timeoutMilliseconds);
    const stop = setInterval(() => {
      try {
        readFileSync(stopFile);
        terminationReason = "Emergency stop requested";
        child.kill("SIGKILL");
        return;
      } catch { }
      try {
        if (guard?.()) {
          terminationReason = guardFailure;
          child.kill("SIGKILL");
        }
      } catch (failure) {
        terminationReason = `Owned security process guard failed: ${failure.message}`;
        child.kill("SIGKILL");
      }
    }, 50);
    child.once("close", async (code, signal) => {
      clearTimeout(deadline);
      clearInterval(stop);
      const accepted = acceptedExitCodes.includes(code);
      if (signal || !accepted) await cleanup();
      if (accepted) resolve({ code, stdout: Buffer.concat(output).toString("utf8"),
        stderr: Buffer.concat(errors).toString("utf8") });
      else reject(new Error(`${terminationReason ?? `Owned security process failed (${signal ?? code})`}: `
        + Buffer.concat(errors).toString("utf8")));
    });
    child.once("error", async (failure) => {
      clearTimeout(deadline);
      clearInterval(stop);
      await cleanup();
      reject(failure);
    });
  });
}
