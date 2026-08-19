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
    applicationCommit: input.applicationCommit,
    seedFingerprint: input.seedFingerprint,
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
  const executeTool = runtime.executeTool ?? missingToolExecutor;
  const { attempt, paths } = reserveAttempt(root, plan.runId);
  const startedAt = now();
  const manifest = createManifest(plan, attempt, startedAt);
  writeManifest(paths.manifest, manifest);
  let requests = 0;
  let generatedDataMegabytes = 0;
  const guard = securityExecutionGuard(plan, paths, startedAt, now, verifyTarget);
  try {
    for (const tool of plan.tools) {
      assertRunning(paths, startedAt, now(), plan.budgets);
      const identity = await verifyTarget(plan);
      assertTargetIdentity(plan, identity);
      const result = await executeTool(tool, {
        target: plan.target,
        runId: plan.runId,
        profile: plan.profile,
        budgets: plan.budgets,
        evidenceDirectory: paths.evidence,
        guard
      });
      assertRunning(paths, startedAt, now(), plan.budgets);
      requests += result?.requests ?? 0;
      generatedDataMegabytes += result?.generatedDataMegabytes ?? 0;
      requests = Math.max(requests, guard.usage().requests);
      generatedDataMegabytes = Math.max(generatedDataMegabytes, guard.usage().generatedDataMegabytes);
      assertUsage(requests, generatedDataMegabytes, result, plan.budgets);
      manifest.toolResults.push({ id: tool.id, version: tool.version, outcome: result?.outcome ?? "incomplete" });
      if (result?.outcome === "failed") {
        const failure = new Error(`${tool.id} reported a security failure`);
        failure.assessmentOutcome = "failed";
        throw failure;
      }
      if (result?.outcome !== "passed") throw new Error(`${tool.id} did not complete`);
      assertEvidenceSize(paths.evidence, plan.budgets.evidenceMegabytes);
      writeManifest(paths.manifest, manifest);
    }
    manifest.status = "finished";
    manifest.outcome = plan.tools.length && plan.selectedTests.length ? "passed" : "incomplete";
    if (!plan.tools.length) manifest.reason = "No executable security tool was selected";
    else if (!plan.selectedTests.length) manifest.reason = "No executable assessment test was selected";
  } catch (failure) {
    manifest.status = "finished";
    manifest.outcome = failure.assessmentOutcome ?? "incomplete";
    manifest.reason = redactSecurityText(failure.message);
  }
  requests = Math.max(requests, guard.usage().requests);
  generatedDataMegabytes = Math.max(generatedDataMegabytes, guard.usage().generatedDataMegabytes);
  manifest.finishedAt = now().toISOString();
  manifest.usage = { requests, generatedDataMegabytes, evidenceBytes: directoryBytes(paths.evidence) };
  writeManifest(paths.manifest, manifest);
  return manifest;
}

function securityExecutionGuard(plan, paths, startedAt, now, verifyTarget) {
  let guardedRequests = 0;
  let guardedGeneratedData = 0;
  return Object.freeze({
    async beforeRequest(target = plan.target) {
      assertRunning(paths, startedAt, now(), plan.budgets);
      if (new URL(target, plan.target).origin !== plan.target) {
        throw new Error("The request is outside the target allowlist");
      }
      assertTargetIdentity(plan, await verifyTarget(plan));
      guardedRequests++;
      if (guardedRequests > plan.budgets.requests) throw new Error("The request budget was exceeded");
    },
    validateRedirect(location) {
      return validateSecurityRedirect(location, plan.target);
    },
    recordGeneratedData(megabytes) {
      guardedGeneratedData += megabytes;
      if (guardedGeneratedData > plan.budgets.generatedDataMegabytes) {
        throw new Error("The generated-data budget was exceeded");
      }
    },
    observeResources(observation) {
      assertUsage(guardedRequests, guardedGeneratedData, observation, plan.budgets);
    },
    usage() {
      return { requests: guardedRequests, generatedDataMegabytes: guardedGeneratedData };
    }
  });
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
  for (const value of [input.seedFingerprint, input.targetFingerprint]) {
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
      || actual.imageDigest !== plan.imageDigest || actual.seedFingerprint !== plan.seedFingerprint
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

function assertUsage(requests, generatedDataMegabytes, result, budgets) {
  if (result?.unstable) throw new Error("The target became unstable");
  if (requests > budgets.requests) throw new Error("The request budget was exceeded");
  if ((result?.peakConcurrency ?? 0) > budgets.concurrency) throw new Error("The concurrency budget was exceeded");
  if (generatedDataMegabytes > budgets.generatedDataMegabytes) {
    throw new Error("The generated-data budget was exceeded");
  }
  if ((result?.peakCpu ?? 0) > budgets.cpu) throw new Error("The CPU budget was exceeded");
  if ((result?.peakMemoryMegabytes ?? 0) > budgets.memoryMegabytes) {
    throw new Error("The memory budget was exceeded");
  }
}

function assertEvidenceSize(directory, megabytes) {
  if (directoryBytes(directory) > megabytes * 1024 * 1024) throw new Error("The evidence budget was exceeded");
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

function missingToolExecutor() {
  throw new Error("No security tool executor is configured");
}

export function fingerprintSecurityTarget(identity) {
  return `sha256:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}
