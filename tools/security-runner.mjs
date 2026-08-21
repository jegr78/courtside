import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");
export const securityRunContract = Object.freeze(JSON.parse(
  readFileSync(join(repository, "security", "run-contract.json"), "utf8")));
const profiles = securityRunContract.profiles;

export function authorizeSecurityProfile(profile, runId, authorization) {
  if (!profiles[profile]) throw new Error(`Unknown security profile: ${profile}`);
  const required = requiredSecurityAuthorization(profile, runId);
  if (required && authorization !== required) {
    throw new Error(`${profile} requires the exact authorization '${required}'`);
  }
  return required;
}

export function requiredSecurityAuthorization(profile, runId) {
  if (!profiles[profile]) throw new Error(`Unknown security profile: ${profile}`);
  return profile === "safe" ? undefined : `authorize-${profile}-${runId}`;
}

export function validateSecurityTarget(value, profile, authorizedOrigin) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error("The security target must be a valid HTTPS origin");
  }
  if (target.protocol !== "https:" || target.username || target.password
      || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("The security target must be a bare HTTPS origin without credentials");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if (profile !== "safe" && !loopback) throw new Error(`${profile} requires a loopback target`);
  if (!loopback && target.origin !== authorizedOrigin) {
    throw new Error("The security target is outside the explicit allowlist");
  }
  return target.origin;
}

export function validateSecurityRedirect(location, allowedOrigin) {
  const redirect = new URL(location, allowedOrigin);
  if (redirect.origin !== allowedOrigin) throw new Error("The redirect is outside the target allowlist");
  return redirect.href;
}

export function buildSecurityPlan(input) {
  const requiredAuthorization = input.dryRun
    ? requiredSecurityAuthorization(input.profile, input.runId)
    : authorizeSecurityProfile(input.profile, input.runId, input.authorization);
  if (["active", "destructive"].includes(input.profile) && input.environment !== "SECURITY") {
    throw new Error(`${input.profile} only supports the SECURITY environment`);
  }
  const target = validateSecurityTarget(input.target, input.profile, input.authorizedOrigin);
  validateIdentity(input);
  const tools = structuredClone(input.tools ?? []);
  const selectedTests = [...(input.selectedTests ?? [])];
  const executableTests = new Set(tools.flatMap(({ testIds }) => testIds ?? []));
  const missingTests = selectedTests.filter((testId) => !executableTests.has(testId));
  if (missingTests.length) throw new Error(`No executable tool covers: ${missingTests.join(", ")}`);
  if (input.catalogTests) validateSecuritySelection(input.profile, selectedTests, input.catalogTests);
  return Object.freeze({
    schemaVersion: 1,
    runId: input.runId,
    profile: input.profile,
    target,
    environment: input.environment,
    imageDigest: input.imageDigest,
    imageArchitecture: input.imageArchitecture,
    applicationCommit: input.applicationCommit,
    seedFingerprint: input.seedFingerprint,
    instanceFingerprint: input.instanceFingerprint,
    targetFingerprint: input.targetFingerprint,
    catalogVersion: input.catalogVersion,
    tools,
    selectedTests,
    budgets: { ...profiles[input.profile] },
    requiredAuthorization
  });
}

export function validateSecuritySelection(profile, selectedTests, catalogTests) {
  const catalogById = new Map(catalogTests.map((entry) => [entry.id, entry]));
  for (const testId of selectedTests) {
    const entry = catalogById.get(testId);
    if (!entry) throw new Error(`The selected test is absent from the catalog: ${testId}`);
    if (entry.status !== "implemented") throw new Error(`The selected test is not implemented: ${testId}`);
    if (entry.profile !== profile) throw new Error(`The selected test does not belong to ${profile}: ${testId}`);
  }
}

export function securityRunPaths(root, runId, attempt) {
  validateSecurityRunId(runId);
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("Invalid security attempt number");
  const directory = join(root, runId, "assessment", `attempt-${attempt}`);
  return {
    directory,
    manifest: join(directory, "manifest.json"),
    evidence: join(directory, "evidence"),
    stop: join(root, runId, "STOP")
  };
}

export function requestEmergencyStop(root, runId, actor) {
  validateSecurityRunId(runId);
  const stop = join(root, runId, "STOP");
  writePrivate(stop, `${JSON.stringify({ actor, requestedAt: new Date().toISOString() })}\n`);
}

export function clearEmergencyStop(root, runId) {
  validateSecurityRunId(runId);
  const stop = join(root, runId, "STOP");
  if (existsSync(stop)) {
    const retained = JSON.parse(readFileSync(stop, "utf8"));
    if (!retained.actor || !retained.requestedAt) throw new Error("The emergency-stop identity is invalid");
  }
  return stop;
}

export async function executeSecurityPlan(plan, runtime = {}) {
  const root = runtime.root ?? join("build", "security");
  const now = runtime.now ?? (() => new Date());
  const verifyTarget = runtime.verifyTarget ?? missingTargetVerifier;
  const runPassiveAssessment = runtime.runPassiveAssessment ?? missingPassiveAssessment;
  const runAuthorizationAssessment = runtime.runAuthorizationAssessment ?? missingAuthorizationAssessment;
  const runAuthenticatedZapAssessment = runtime.runAuthenticatedZapAssessment ?? missingAuthenticatedZapAssessment;
  const runOpenApiFuzzAssessment = runtime.runOpenApiFuzzAssessment ?? missingOpenApiFuzzAssessment;
  const { attempt, paths } = reserveAttempt(root, plan.runId);
  const startedAt = now();
  const manifest = createManifest(plan, attempt, startedAt);
  writeManifest(paths.manifest, manifest);
  try {
    const adapter = assertSupportedPlan(plan);
    assertRunning(paths, startedAt, now(), plan.budgets);
    const deadline = new Date(startedAt.getTime() + plan.budgets.durationSeconds * 1000);
    assertTargetIdentity(plan, await verifyTarget(plan, { stopFile: paths.stop, deadline }));
    manifest.toolResults.push({ id: "target-identity", version: plan.tools[0].version, outcome: "passed" });
    if (adapter === "passive-deployment") {
      assertRunning(paths, startedAt, now(), plan.budgets);
      const evidence = await runPassiveAssessment(plan, { evidenceDirectory: paths.evidence, stopFile: paths.stop,
        attempt, deadline });
      assertRunning(paths, startedAt, now(), plan.budgets);
      manifest.toolResults.push({ id: "passive-deployment", version: plan.tools[1].version,
        outcome: evidence.outcome });
      manifest.outcome = evidence.outcome;
      manifest.reason = evidence.outcome === "passed" ? null : "Passive deployment security checks did not pass";
      manifest.usage = { requests: evidence.requestCount, generatedDataMegabytes: 0,
        evidenceBytes: directoryBytes(paths.evidence) };
      assertUsage(manifest.usage, plan.budgets);
    } else if (adapter === "active-security") {
      assertRunning(paths, startedAt, now(), plan.budgets);
      const zapEvidence = await runAuthenticatedZapAssessment(plan, { evidenceDirectory: paths.evidence,
        stopFile: paths.stop, attempt, deadline,
        maxRequests: Math.min(plan.budgets.requests, authenticatedZapRequestLimit(plan)) });
      assertRunning(paths, startedAt, now(), plan.budgets);
      manifest.toolResults.push({ id: "authenticated-zap", version: plan.tools[1].version,
        outcome: zapEvidence.outcome });
      const fuzzEvidence = await runOpenApiFuzzAssessment(plan, { evidenceDirectory: paths.evidence,
        stopFile: paths.stop, attempt, deadline, maxRequests: openApiFuzzRequestLimit(plan) });
      assertRunning(paths, startedAt, now(), plan.budgets);
      manifest.toolResults.push({ id: "openapi-fuzzer", version: plan.tools[2].version,
        outcome: fuzzEvidence.outcome });
      let authorizationEvidence = { outcome: "passed", requestCount: 0 };
      if (fuzzEvidence.outcome !== "failed") {
        authorizationEvidence = await runAuthorizationAssessment(plan, { evidenceDirectory: paths.evidence,
          stopFile: paths.stop, attempt, deadline, maxRequests: authorizationRequestLimit(plan) });
        assertRunning(paths, startedAt, now(), plan.budgets);
        manifest.toolResults.push({ id: "authorization-matrix", version: plan.tools[3].version,
          outcome: authorizationEvidence.outcome });
      }
      manifest.outcome = combinedOutcome(authorizationEvidence.outcome, zapEvidence.outcome, fuzzEvidence.outcome);
      manifest.reason = fuzzEvidence.outcome === "failed" ? "OpenAPI fuzzing changed protected domain state"
        : manifest.outcome === "passed" ? null : "Active security checks did not pass";
      manifest.usage = { requests: zapEvidence.requestCount + fuzzEvidence.requestCount
          + authorizationEvidence.requestCount,
        generatedDataMegabytes: (zapEvidence.generatedDataMegabytes ?? 0)
          + (fuzzEvidence.generatedDataMegabytes ?? 0),
        evidenceBytes: directoryBytes(paths.evidence) };
      assertUsage(manifest.usage, plan.budgets);
    } else {
      manifest.outcome = "incomplete";
      manifest.reason = "No isolated assessment adapter is registered";
    }
    manifest.status = "finished";
  } catch (failure) {
    manifest.status = "finished";
    manifest.outcome = failure.assessmentOutcome ?? "incomplete";
    manifest.reason = redactSecurityText(failure.message);
  }
  manifest.finishedAt = now().toISOString();
  manifest.usage ??= { requests: 0, generatedDataMegabytes: 0, evidenceBytes: directoryBytes(paths.evidence) };
  writeManifest(paths.manifest, manifest);
  return manifest;
}

function assertUsage(usage, budgets) {
  if (usage.requests > budgets.requests) throw new Error("The request budget was exceeded");
  if (usage.generatedDataMegabytes > budgets.generatedDataMegabytes) {
    throw new Error("The generated-data budget was exceeded");
  }
  if (usage.evidenceBytes > budgets.evidenceMegabytes * 1024 * 1024) {
    throw new Error("The evidence budget was exceeded");
  }
}

function assertSupportedPlan(plan) {
  const identity = plan.tools[0];
  const prerequisiteOnly = plan.selectedTests.length === 0 && plan.tools.length === 1
    && identity?.id === "target-identity" && identity.testIds.length === 0;
  if (prerequisiteOnly) return null;
  const passive = plan.profile === "safe" && plan.environment === "SECURITY"
    && plan.selectedTests.length === 1 && plan.selectedTests[0] === "CSA-DEPLOY-001"
    && plan.tools.length === 2 && identity?.id === "target-identity" && identity.testIds.length === 0
    && plan.tools[1]?.id === "passive-deployment"
    && plan.tools[1].testIds.length === 1 && plan.tools[1].testIds[0] === "CSA-DEPLOY-001";
  if (passive) return "passive-deployment";
  const authorization = plan.profile === "active" && plan.environment === "SECURITY"
    && JSON.stringify(plan.selectedTests) === JSON.stringify(["CSA-AUTHN-001", "CSA-AUTHZ-001", "CSA-DAST-001",
      "CSA-API-001", "CSA-IMPORT-001"])
    && plan.tools.length === 4 && identity?.id === "target-identity" && identity.testIds.length === 0
    && plan.tools[1]?.id === "authenticated-zap"
    && JSON.stringify(plan.tools[1].testIds) === JSON.stringify(["CSA-DAST-001"])
    && plan.tools[2]?.id === "openapi-fuzzer"
    && JSON.stringify(plan.tools[2].testIds) === JSON.stringify(["CSA-API-001", "CSA-IMPORT-001"])
    && plan.tools[3]?.id === "authorization-matrix"
    && JSON.stringify(plan.tools[3].testIds) === JSON.stringify(["CSA-AUTHN-001", "CSA-AUTHZ-001"]);
  if (authorization) return "active-security";
  throw new Error("Assessment adapters require an isolated orchestrator-owned runner");
}

function combinedOutcome(...outcomes) {
  if (outcomes.includes("failed")) return "failed";
  if (outcomes.includes("incomplete")) return "incomplete";
  return "passed";
}

function authenticatedZapRequestLimit(plan) {
  const reservedForOtherSuites = 4000;
  if (plan.budgets.requests <= reservedForOtherSuites) {
    throw new Error("The active request budget cannot reserve authorization coverage");
  }
  return plan.budgets.requests - reservedForOtherSuites;
}

function openApiFuzzRequestLimit(plan) {
  return Math.min(2000, plan.budgets.requests - authenticatedZapRequestLimit(plan));
}

function authorizationRequestLimit(plan) {
  return plan.budgets.requests - authenticatedZapRequestLimit(plan) - openApiFuzzRequestLimit(plan);
}

async function missingOpenApiFuzzAssessment() {
  throw new Error("No OpenAPI fuzz assessment adapter is registered");
}

export function redactSecurityText(value) {
  return String(value)
    .replace(/\b(authorization|cookie|set-cookie):\s*[^\r\n]+/gi, "$1: [REDACTED]")
    .replace(/\b(password|token|secret|csrf)[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]");
}

export function recoverSecurityRun(root, runId, attempt) {
  const paths = securityRunPaths(root, runId, attempt);
  const manifest = JSON.parse(readFileSync(paths.manifest, "utf8"));
  if (manifest.runId !== runId || manifest.attempt !== attempt) {
    throw new Error("The retained run identity does not match the recovery request");
  }
  if (manifest.status === "running") {
    manifest.status = "finished";
    manifest.outcome = "incomplete";
    manifest.reason = "Recovered after interruption";
    manifest.finishedAt = new Date().toISOString();
    writeManifest(paths.manifest, manifest);
  }
  return manifest;
}

export function readSecurityManifest(root, runId, attempt) {
  const selectedAttempt = attempt ?? latestAttempt(root, runId);
  return JSON.parse(readFileSync(securityRunPaths(root, runId, selectedAttempt).manifest, "utf8"));
}

function validateIdentity(input) {
  validateSecurityRunId(input.runId);
  if (!/^(?:sha256:[a-f0-9]{64}|[^\s@]+@sha256:[a-f0-9]{64})$/.test(input.imageDigest)) {
    throw new Error("Invalid application image digest");
  }
  if (!/^[a-f0-9]{7,64}$/.test(input.applicationCommit)) throw new Error("Invalid application commit");
  if (!["amd64", "arm64"].includes(input.imageArchitecture)) throw new Error("Invalid application image architecture");
  for (const value of [input.seedFingerprint, input.instanceFingerprint, input.targetFingerprint]) {
    if (!/^sha256:[a-f0-9]{64}$/.test(value)) throw new Error("Invalid security target fingerprint");
  }
}

function validateSecurityRunId(runId) {
  if (!/^[a-z0-9][a-z0-9-]{5,47}$/.test(runId)) throw new Error("Invalid security run ID");
}

function createManifest(plan, attempt, startedAt) {
  return {
    schemaVersion: 1,
    runId: plan.runId,
    attempt,
    status: "running",
    outcome: null,
    profile: plan.profile,
    target: plan.target,
    environment: plan.environment,
    application: { imageDigest: plan.imageDigest, commit: plan.applicationCommit },
    targetFingerprint: plan.targetFingerprint,
    seedFingerprint: plan.seedFingerprint,
    instanceFingerprint: plan.instanceFingerprint,
    catalogVersion: plan.catalogVersion,
    tools: plan.tools,
    selectedTests: plan.selectedTests,
    budgets: plan.budgets,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    toolResults: [],
    reason: null,
    usage: null
  };
}

function assertTargetIdentity(plan, actual) {
  if (actual.environment !== plan.environment || actual.target !== plan.target
      || actual.imageDigest !== plan.imageDigest || actual.imageArchitecture !== plan.imageArchitecture
      || actual.seedFingerprint !== plan.seedFingerprint
      || actual.instanceFingerprint !== plan.instanceFingerprint
      || actual.targetFingerprint !== plan.targetFingerprint) {
    throw new Error("The target identity changed during the security run");
  }
}

function assertRunning(paths, startedAt, currentTime, budgets) {
  if (existsSync(paths.stop)) throw new Error("The emergency stop prevents further attack requests");
  if ((currentTime.getTime() - startedAt.getTime()) / 1000 > budgets.durationSeconds) {
    throw new Error("The duration budget was exceeded");
  }
}

function directoryBytes(directory) {
  if (!existsSync(directory)) return 0;
  return readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const path = join(directory, entry.name);
    return total + (entry.isDirectory() ? directoryBytes(path) : statSync(path).size);
  }, 0);
}

function nextAttempt(root, runId) {
  validateSecurityRunId(runId);
  try {
    return Math.max(0, ...readdirSync(join(root, runId, "assessment"))
      .map((name) => /^attempt-(\d+)$/.exec(name)?.[1])
      .filter(Boolean)
      .map(Number)) + 1;
  } catch {
    return 1;
  }
}

function reserveAttempt(root, runId) {
  mkdirSync(join(root, runId, "assessment"), { recursive: true, mode: 0o700 });
  let attempt = nextAttempt(root, runId);
  while (true) {
    const paths = securityRunPaths(root, runId, attempt);
    try {
      mkdirSync(paths.directory, { mode: 0o700 });
      return { attempt, paths };
    } catch (failure) {
      if (failure.code !== "EEXIST") throw failure;
      attempt++;
    }
  }
}

function latestAttempt(root, runId) {
  const attempt = nextAttempt(root, runId) - 1;
  if (attempt < 1) throw new Error(`No assessment exists for ${runId}`);
  return attempt;
}

function writeManifest(file, manifest) {
  writePrivate(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

function writePrivate(file, content) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, content, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function missingTargetVerifier() {
  throw new Error("No target verifier is configured");
}

function missingPassiveAssessment() {
  throw new Error("No orchestrator-owned passive assessment is configured");
}

function missingAuthorizationAssessment() {
  throw new Error("No orchestrator-owned authorization assessment is configured");
}

function missingAuthenticatedZapAssessment() {
  throw new Error("No orchestrator-owned authenticated ZAP assessment is configured");
}

export function fingerprintSecurityTarget(identity) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalSecurityValue(identity))).digest("hex")}`;
}

function canonicalSecurityValue(value) {
  if (Array.isArray(value)) return value.map(canonicalSecurityValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right))
      .map(([name, nested]) => [name, canonicalSecurityValue(nested)]));
  }
  return value;
}
