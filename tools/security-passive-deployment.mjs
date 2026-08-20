import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import { join } from "node:path";
import tls from "node:tls";

export const zapImage = "zaproxy/zap-stable:2.16.1@sha256:7840969c7c9fead565bf9734b12f49f6886db90b1d35b1f74d79710bbd081dab";
const securityHeaders = [
  "content-security-policy", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"
];
const publicPaths = ["/", "/api/source", "/login", "/does-not-exist", "/icon.svg"];
const exposurePaths = ["/actuator", "/actuator/health", "/swagger-ui/index.html", "/.git/config", "/assets/app.js.map"];

export function normalizeZapAlerts(report) {
  return (report?.site ?? []).flatMap((site) => site.alerts ?? []).map((alert) => ({
    pluginId: String(alert.pluginid),
    riskCode: Number(alert.riskcode),
    confidence: Number(alert.confidence),
    count: Math.max(1, alert.instances?.length ?? 0)
  })).toSorted((left, right) => left.pluginId.localeCompare(right.pluginId));
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
  const alerts = normalizeZapAlerts(zapReport);
  const failed = checks.some((check) => check.outcome === "failed");
  const incomplete = !failed && alerts.length > 0;
  return {
    schemaVersion: 1,
    testId: "CSA-DEPLOY-001",
    targetFingerprint,
    imageDigest,
    layers: [...new Set(checks.map(({ layer }) => layer))].toSorted(),
    checks,
    zap: { image: zapImage, version: zapReport.version, status: "completed", alerts },
    requestCount,
    outcome: failed ? "failed" : incomplete ? "incomplete" : "passed"
  };
}

export async function runPassiveDeploymentAssessment(plan, context) {
  if (plan.profile !== "safe" || plan.environment !== "SECURITY"
      || plan.selectedTests.length !== 1 || plan.selectedTests[0] !== "CSA-DEPLOY-001") {
    throw new Error("The passive deployment suite requires safe CSA-DEPLOY-001 in SECURITY");
  }
  const observations = [];
  let requestCount = 0;
  for (const path of publicPaths) {
    const response = await passiveRequest(plan.target, path, { ca: context.ca });
    requestCount++;
    observations.push({
      id: `headers-${pathId(path)}`, layer: "proxy",
      passed: securityHeaders.every((header) => response.headers.has(header)) && !response.headers.has("server"),
      observation: securityHeaders.every((header) => response.headers.has(header))
        ? "security-headers-present" : "security-headers-incomplete"
    });
  }
  for (const path of exposurePaths) {
    const response = await passiveRequest(plan.target, path, { ca: context.ca });
    requestCount++;
    observations.push({ id: `exposure-${pathId(path)}`, layer: "proxy", passed: response.status >= 400,
      observation: response.status >= 400 ? "route-not-exposed" : "unexpected-route-response" });
  }
  for (const method of ["TRACE", "CONNECT", "TRACK"]) {
    const response = method === "CONNECT"
      ? await connectRequest(plan.target, context.ca)
      : await passiveRequest(plan.target, "/", { method, ca: context.ca });
    requestCount++;
    observations.push({ id: `method-${method.toLowerCase()}`, layer: "proxy",
    passed: response.status >= 400,
      observation: response.status >= 400 ? "method-rejected" : "method-accepted" });
  }
  const oversized = await passiveRequest(plan.target, "/api/session", {
    method: "POST", body: Buffer.alloc(2 * 1024 * 1024 + 1), headers: { "content-type": "application/json",
      cookie: "XSRF-TOKEN=body-limit", "x-xsrf-token": "body-limit" },
    ca: context.ca
  });
  requestCount++;
  observations.push({ id: "body-limit", layer: "proxy", passed: oversized.status >= 400,
    observation: oversized.status >= 400 ? "oversized-request-rejected" : "oversized-request-accepted" });
  const spoofedHost = await passiveRequest(plan.target, "/api/source", { headers: {
    host: "attacker.example", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "http"
  }, ca: context.ca });
  requestCount++;
  observations.push({ id: "forwarded-boundary", layer: "proxy", passed: spoofedHost.status === 200,
    observation: spoofedHost.status === 200 ? "spoofed-values-replaced" : "forwarded-boundary-mismatch" });
  const tlsResults = await Promise.all([
    tlsProtocol(plan.target, "TLSv1.2", "TLSv1.2", context.ca),
    tlsProtocol(plan.target, "TLSv1.3", "TLSv1.3", context.ca),
    tlsProtocol(plan.target, "TLSv1", "TLSv1.1", context.ca)
  ]);
  observations.push({ id: "tls-versions", layer: "proxy",
    passed: tlsResults[0] && tlsResults[1] && !tlsResults[2],
    observation: tlsResults[0] && tlsResults[1] && !tlsResults[2] ? "tls12-and-tls13-only" : "tls-policy-mismatch" });
  observations.push({ id: "http-redirect", layer: "host", outcome: "not-applicable",
    observation: "http-port-not-published" });
  observations.push(...await context.inspectRuntime(plan));
  mkdirSync(context.evidenceDirectory, { recursive: true, mode: 0o700 });
  const zapReport = await context.runZap(plan);
  requestCount += Number(zapReport.requestCount ?? 0);
  const evidence = buildPassiveDeploymentEvidence({
    targetFingerprint: plan.targetFingerprint, imageDigest: plan.imageDigest,
    observations, zapReport: { ...zapReport, version: "2.16.1" }, requestCount
  });
  const output = join(context.evidenceDirectory, "passive-deployment.json");
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  chmodSync(output, 0o600);
  const summary = join(context.evidenceDirectory, "passive-deployment.md");
  writeFileSync(summary, passiveDeploymentSummary(evidence), { mode: 0o600 });
  chmodSync(summary, 0o600);
  return evidence;
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
    const result = (response) => ({ status: response.statusCode,
      headers: new Set(Object.keys(response.headers).map((header) => header.toLowerCase())) });
    const call = https.request(target, {
      method: options.method ?? "GET", headers: { ...options.headers, ...(body ? { "content-length": body.length } : {}) },
      agent: false, ca: options.ca, servername: target.hostname, timeout: 10_000
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

function tlsProtocol(origin, minVersion, maxVersion, ca) {
  const target = new URL(origin);
  return new Promise((resolve) => {
    const socket = tls.connect({ host: target.hostname, port: target.port || 443, servername: target.hostname,
      ca, minVersion, maxVersion });
    socket.once("secureConnect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

function connectRequest(origin, ca) {
  const target = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: target.hostname, port: target.port || 443, servername: target.hostname, ca });
    let response = "";
    socket.once("secureConnect", () => socket.write(
      `CONNECT / HTTP/1.1\r\nHost: ${target.hostname}\r\nConnection: close\r\n\r\n`));
    socket.on("data", (chunk) => {
      response += chunk.toString("ascii");
      if (response.includes("\r\n")) socket.destroy();
    });
    socket.once("close", () => {
      const status = Number(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(response)?.[1]);
      if (status) resolve({ status, headers: new Set() });
      else reject(new Error("CONNECT produced no HTTP status"));
    });
    socket.once("error", (failure) => reject(new Error(`Passive CONNECT failed: ${failure.message}`)));
  });
}

function pathId(path) {
  return path === "/" ? "root" : path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-$/, "");
}

export function runOwnedProcess(command, args, {
  timeoutMilliseconds, stopFile, cleanup, environment = process.env, acceptedExitCodes = [0]
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: environment });
    const output = [];
    const errors = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    const deadline = setTimeout(() => child.kill("SIGKILL"), timeoutMilliseconds);
    const stop = setInterval(() => {
      try { readFileSync(stopFile); child.kill("SIGKILL"); } catch { }
    }, 100);
    child.once("close", async (code, signal) => {
      clearTimeout(deadline);
      clearInterval(stop);
      const accepted = acceptedExitCodes.includes(code);
      if (signal || !accepted) await cleanup();
      if (accepted) resolve({ code, stdout: Buffer.concat(output).toString("utf8"),
        stderr: Buffer.concat(errors).toString("utf8") });
      else reject(new Error(`Owned security process failed (${signal ?? code}): ${Buffer.concat(errors).toString("utf8")}`));
    });
    child.once("error", reject);
  });
}
