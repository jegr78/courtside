import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { arch, cpus, homedir, hostname, platform, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { localVerificationPlans } from "./local-check.mjs";
import { loadProfileContract, localTasksForProfiles, profilePolicyFingerprint } from "./test-profile-contract.mjs";

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutput = join(repository, "build", "local-profile-timing", "evidence.json");
const defaultReservationRoot = join(homedir(), ".courtside", "profile-timing");
const timingPolicy = JSON.parse(readFileSync(join(repository, "quality", "local-profile-timing-policy.json"), "utf8"));
const frontendRequire = createRequire(resolve(repository, "frontend", "package.json"));
const timingDefinitions = [
  { id: "docs", profiles: ["docs"] },
  { id: "tooling", profiles: ["tooling"] },
  { id: "backend", profiles: ["backend"] },
  { id: "frontend", profiles: ["frontend"] },
  { id: "backend-frontend", profiles: ["backend", "frontend"] },
  { id: "full", profiles: ["full"] }
];

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function timestamp(value) {
  if (!timestampPattern.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value ? null : parsed.valueOf();
}

function evidenceValidator() {
  const Ajv = frontendRequire("ajv/dist/2020").default;
  const schema = JSON.parse(readFileSync(join(repository, "quality", "local-profile-timing.schema.json"), "utf8"));
  return new Ajv({ strict: true, allErrors: true }).compile(schema);
}

export function localTimingCases(contract) {
  return timingDefinitions.map(({ id, profiles }) => ({
    id,
    profiles: [...profiles],
    tasks: localTasksForProfiles(contract, profiles)
  }));
}

export function createTimingStudy(context, contract, existing = null) {
  const machineFingerprint = fingerprint(context.machine);
  const cases = localTimingCases(contract).map(({ id, profiles, tasks }) => ({
    id, profiles, tasks: tasks.map(({ label }) => label)
  }));
  if (!/^[a-f0-9]{40}$/.test(context.commit) || !/^[a-f0-9]{64}$/.test(context.policyFingerprint)
      || timestamp(context.createdAt) === null) {
    throw new Error("Timing study identity is invalid");
  }
  if (existing !== null) {
    const validate = evidenceValidator();
    if (!validate(existing)) throw new Error(`Timing study evidence is invalid: ${JSON.stringify(validate.errors)}`);
    if (existing.commit !== context.commit || existing.policyFingerprint !== context.policyFingerprint
        || existing.machineFingerprint !== machineFingerprint || stableJson(existing.cases) !== stableJson(cases)) {
      throw new Error("Timing study identity does not match this commit, policy, machine, or task plan");
    }
    validateAttemptSequence(existing);
    if (stableJson(existing.summary) !== stableJson(summarizeTimingStudy(existing))) {
      throw new Error("Timing study summary does not match its attempts");
    }
    return structuredClone(existing);
  }
  const study = {
    schemaVersion: 1,
    studyId: randomUUID(),
    commit: context.commit,
    policyFingerprint: context.policyFingerprint,
    machineFingerprint,
    machine: structuredClone(context.machine),
    createdAt: context.createdAt,
    attemptsPerCase: 3,
    targets: structuredClone(timingPolicy),
    cases,
    attempts: []
  };
  study.summary = summarizeTimingStudy(study);
  return study;
}

function validateAttemptSequence(study) {
  const expected = Array.from({ length: study.attemptsPerCase }, (_, index) => study.cases.map(({ id }) => ({
    caseId: id, attempt: index + 1
  }))).flat();
  for (const [index, attempt] of study.attempts.entries()) {
    if (attempt.caseId !== expected[index]?.caseId || attempt.attempt !== expected[index]?.attempt
        || (attempt.outcome === "running") !== (attempt.completedAt === null && attempt.durationMs === null)
        || (attempt.outcome !== "running" && (attempt.completedAt === null || attempt.durationMs === null))
        || timestamp(attempt.startedAt) === null
        || (attempt.completedAt !== null && (timestamp(attempt.completedAt) === null
          || timestamp(attempt.completedAt) < timestamp(attempt.startedAt)
          || Math.abs(timestamp(attempt.completedAt) - timestamp(attempt.startedAt) - attempt.durationMs) > 5_000))
        || (index > 0 && timestamp(attempt.startedAt) < timestamp(study.attempts[index - 1].completedAt))
        || (["running", "failed"].includes(attempt.outcome) && index !== study.attempts.length - 1)) {
      throw new Error("Timing study attempt sequence is invalid");
    }
  }
}

export function nextTimingAttempt(study) {
  const unfinished = study.attempts.find(({ outcome }) => outcome === "running");
  if (unfinished) throw new Error("Timing study contains an unfinished attempt and cannot be retried");
  if (study.attempts.some(({ outcome }) => outcome === "failed")) {
    throw new Error("Timing study contains a failed first attempt and cannot be resumed");
  }
  const schedule = Array.from({ length: study.attemptsPerCase }, (_, index) => study.cases.map(({ id }) => ({
    caseId: id, attempt: index + 1
  }))).flat();
  return schedule[study.attempts.length] ?? null;
}

export function beginTimingAttempt(study, caseId, attempt, startedAt) {
  const expected = nextTimingAttempt(study);
  if (expected === null || expected.caseId !== caseId || expected.attempt !== attempt) {
    throw new Error("Requested attempt is not the next timing attempt");
  }
  if (timestamp(startedAt) === null) throw new Error("Timing attempt start is invalid");
  const copy = structuredClone(study);
  copy.attempts.push({ caseId, attempt, startedAt, completedAt: null, durationMs: null, outcome: "running" });
  copy.summary = summarizeTimingStudy(copy);
  return copy;
}

export function completeTimingAttempt(study, outcome, durationMs, completedAt) {
  const copy = structuredClone(study);
  const attempt = copy.attempts.at(-1);
  if (attempt?.outcome !== "running" || !["passed", "failed"].includes(outcome)
      || !Number.isSafeInteger(durationMs) || durationMs < 0 || timestamp(completedAt) === null
      || Math.abs(timestamp(completedAt) - timestamp(attempt.startedAt) - durationMs) > 5_000) {
    throw new Error("Timing attempt result is invalid");
  }
  Object.assign(attempt, { completedAt, durationMs, outcome });
  copy.summary = summarizeTimingStudy(copy);
  return copy;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)];
}

function roundedRatio(value) {
  return Math.round(value * 10_000) / 10_000;
}

export function summarizeTimingStudy(study) {
  const cases = study.cases.map(({ id }) => {
    const completed = study.attempts.filter((entry) => entry.caseId === id && entry.outcome === "passed")
      .map(({ durationMs }) => durationMs);
    return {
      id,
      completedAttempts: completed.length,
      medianMs: completed.length === study.attemptsPerCase ? median(completed) : null,
      maximumMs: completed.length === study.attemptsPerCase ? Math.max(...completed) : null
    };
  });
  const duration = (id) => cases.find((entry) => entry.id === id)?.medianMs;
  const full = duration("full");
  const savings = (id) => full === null || duration(id) === null ? null
    : roundedRatio(1 - duration(id) / full);
  const failed = study.attempts.some(({ outcome }) => outcome === "failed");
  const complete = cases.every(({ completedAttempts }) => completedAttempts === study.attemptsPerCase);
  const absoluteTargets = {
    docs: duration("docs") === null ? null : duration("docs") < study.targets.absoluteMedianLimitsMs.docs,
    tooling: duration("tooling") === null ? null : duration("tooling") < study.targets.absoluteMedianLimitsMs.tooling
  };
  const relativeSavings = {
    backend: savings("backend"),
    frontend: savings("frontend"),
    backendFrontend: savings("backend-frontend")
  };
  const targetsMet = complete && absoluteTargets.docs && absoluteTargets.tooling
    && relativeSavings.backend >= study.targets.minimumRelativeSavings.backend
    && relativeSavings.frontend >= study.targets.minimumRelativeSavings.frontend;
  return {
    status: failed ? "execution-failed" : !complete ? "collecting" : targetsMet ? "qualified" : "target-failed",
    cases,
    absoluteTargets,
    relativeSavings
  };
}

function measurementEnvironment() {
  return Object.fromEntries(Object.entries(process.env).sort(([left], [right]) => left.localeCompare(right)));
}

export function validateTimingEnvironment(environment) {
  const scopeChanging = new Set(["MAVEN_ARGS", "MAVEN_OPTS", "JDK_JAVA_OPTIONS", "JAVA_TOOL_OPTIONS",
    "_JAVA_OPTIONS", "NODE_OPTIONS", "NPM_CONFIG_IGNORE_SCRIPTS", "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"]);
  for (const [key, value] of Object.entries(environment)) {
    if (value && scopeChanging.has(key.toUpperCase())) {
      throw new Error(`Local timing forbids the scope-changing environment variable ${key}`);
    }
  }
}

export function assertPrivateTimingPlatform(value = platform()) {
  if (value === "win32") {
    throw new Error("Local profile timing requires POSIX owner-only file permissions");
  }
}

function machineIdentity(environment) {
  const processors = cpus();
  validateTimingEnvironment(environment);
  assertPrivateTimingPlatform();
  const ignoredEnvironment = new Set(["OLDPWD", "PWD", "SHLVL", "TERM_SESSION_ID", "_"]);
  const sensitiveKey = /(TOKEN|PASSWORD|SECRET|CREDENTIAL|PRIVATE|API_KEY)/i;
  const stableEnvironment = Object.fromEntries(Object.entries(environment)
    .filter(([key]) => !ignoredEnvironment.has(key))
    .map(([key, value]) => [key, sensitiveKey.test(key) ? "<present>" : value]));
  return {
    hostFingerprint: fingerprint({ hostname: hostname() }),
    environmentFingerprint: fingerprint(stableEnvironment),
    platform: platform(),
    arch: arch(),
    cpuModel: processors[0]?.model ?? "unknown",
    cpuCount: processors.length,
    totalMemoryBytes: totalmem(),
    nodeVersion: process.version
  };
}

export function reserveTimingStudy(study, reservationRoot = defaultReservationRoot) {
  const key = fingerprint({
    commit: study.commit,
    policyFingerprint: study.policyFingerprint
  });
  const path = join(reservationRoot, `${key}.json`);
  mkdirSync(reservationRoot, { recursive: true, mode: 0o700 });
  chmodSync(reservationRoot, 0o700);
  const record = {
    schemaVersion: 1,
    studyId: study.studyId,
    commit: study.commit,
    policyFingerprint: study.policyFingerprint,
    machineFingerprint: study.machineFingerprint
  };
  try {
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (failure) {
    if (failure.code !== "EEXIST") throw failure;
    const existing = JSON.parse(readFileSync(path, "utf8"));
    if (stableJson(existing) !== stableJson(record)) {
      throw new Error("This commit, policy, and machine already have another timing study");
    }
  }
  return path;
}

function git(arguments_) {
  return execFileSync("git", arguments_, { cwd: repository, encoding: "utf8", shell: false }).trim();
}

function assertCleanCommit(expectedCommit = null) {
  const commit = git(["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(commit) || (expectedCommit !== null && commit !== expectedCommit)
      || git(["status", "--porcelain", "--untracked-files=all"]) !== "") {
    throw new Error("Local timing requires one unchanged clean commit");
  }
  return commit;
}

function writeEvidence(path, study) {
  const validate = evidenceValidator();
  if (!validate(study)) throw new Error(`Timing study evidence is invalid: ${JSON.stringify(validate.errors)}`);
  validateAttemptSequence(study);
  if (study.machineFingerprint !== fingerprint(study.machine)
      || stableJson(study.summary) !== stableJson(summarizeTimingStudy(study))) {
    throw new Error("Timing study derived evidence is inconsistent");
  }
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(study, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function executeCase(timingCase, environment) {
  for (const plan of localVerificationPlans(timingCase.tasks, process.platform, repository)) {
    execFileSync(plan.command, plan.arguments, {
      cwd: plan.workingDirectory,
      env: environment,
      shell: false,
      stdio: "inherit"
    });
  }
}

function parseArguments(arguments_) {
  let runAll = false;
  for (const argument of arguments_) {
    if (argument === "--run-all") runAll = true;
    else throw new Error(`Unsupported local timing argument: ${argument}`);
  }
  return { output: defaultOutput, runAll };
}

function runTiming(options) {
  const lock = `${options.output}.lock`;
  mkdirSync(dirname(options.output), { recursive: true });
  const descriptor = openSync(lock, "wx", 0o600);
  closeSync(descriptor);
  try {
    const contract = loadProfileContract();
    const environment = measurementEnvironment();
    const context = {
      commit: assertCleanCommit(),
      policyFingerprint: profilePolicyFingerprint(),
      machine: machineIdentity(environment),
      createdAt: new Date().toISOString()
    };
    const existing = (() => {
      try { return JSON.parse(readFileSync(options.output, "utf8")); } catch (failure) {
        if (failure.code === "ENOENT") return null;
        throw failure;
      }
    })();
    let study = createTimingStudy(context, contract, existing);
    reserveTimingStudy(study);
    do {
      const next = nextTimingAttempt(study);
      if (next === null) break;
      assertCleanCommit(study.commit);
      study = beginTimingAttempt(study, next.caseId, next.attempt, new Date().toISOString());
      writeEvidence(options.output, study);
      const started = process.hrtime.bigint();
      let outcome = "passed";
      try {
        const timingCase = localTimingCases(contract).find(({ id }) => id === next.caseId);
        executeCase(timingCase, environment);
        assertCleanCommit(study.commit);
      } catch (failure) {
        outcome = "failed";
        throw failure;
      } finally {
        const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
        study = completeTimingAttempt(study, outcome, durationMs, new Date().toISOString());
        writeEvidence(options.output, study);
      }
      process.stdout.write(`${next.caseId} attempt ${next.attempt}: ${study.attempts.at(-1).durationMs} ms\n`);
    } while (options.runAll);
    process.stdout.write(`${JSON.stringify(study.summary, null, 2)}\n`);
  } finally {
    rmSync(lock, { force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) runTiming(parseArguments(process.argv.slice(2)));
