import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { basename, relative, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const frontend = resolve(root, "frontend");
const schemaPath = resolve(root, "quality", "webkit-reliability.schema.json");
const frontendRequire = createRequire(resolve(frontend, "package.json"));
const executionDeadlineMs = 25 * 60 * 1_000;
const terminationGraceMs = 10_000;

function validator() {
  const Ajv = frontendRequire("ajv/dist/2020").default;
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  return new Ajv({ strict: true, allErrors: true, formats: { "date-time": true } }).compile(schema);
}

function outcome(execution) {
  if (execution.environmentFailure === true) return { status: "incomplete", classifications: ["environment"], exitCode: null };
  const claims = execution.gateOutcome?.claims;
  if (!Array.isArray(claims)) {
    return { status: "incomplete", classifications: ["harness"], exitCode: execution.exitCode };
  }
  const claim = (id) => claims.find((candidate) => candidate.id === id)?.status;
  const classifications = [];
  if ([claim("webkit-core-compatibility"), claim("webkit-axe-qualification")].includes("failed")) classifications.push("product");
  if (execution.timedOut === true || claim("browser-harness") !== "passed") classifications.push("harness");
  if (classifications.length > 0) return {
    status: classifications.includes("harness") ? "incomplete" : "failed",
    classifications,
    exitCode: execution.exitCode
  };
  if (execution.exitCode === 0
    && claim("webkit-core-compatibility") === "passed"
    && claim("webkit-axe-qualification") === "passed") {
    return { status: "passed", classifications: ["none"], exitCode: 0 };
  }
  return { status: "incomplete", classifications: ["harness"], exitCode: execution.exitCode };
}

export function buildReliabilityRecord(input) {
  const imageDigest = /@(?<digest>sha256:[0-9a-f]{64})$/.exec(input.browserImage)?.groups?.digest;
  if (imageDigest === undefined) throw new Error("The browser image is not pinned by digest");
  const started = Date.parse(input.startedAt);
  const finished = Date.parse(input.finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) {
    throw new Error("The reliability attempt timestamps are invalid");
  }
  return {
    schemaVersion: 1,
    attemptId: input.attemptId,
    sourceCommit: input.sourceCommit,
    sourceTreeState: input.sourceTreeState,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: finished - started,
    executionDeadlineMs,
    terminationGraceMs,
    toolchain: {
      playwrightVersion: input.playwrightVersion,
      browserImage: input.browserImage,
      browserImageDigest: imageDigest
    },
    matrix: {
      projectOrder: input.projectOrder,
      isolationVariant: input.isolationVariant,
      resourceProfile: input.resourceProfile,
      seedFingerprint: input.seedFingerprint
    },
    host: {
      provider: process.env.GITHUB_ACTIONS === "true" ? "github-hosted" : "local",
      ...input.host
    },
    testPopulation: input.execution.gateOutcome?.testPopulation ?? {
      count: 0,
      fingerprint: `sha256:${"0".repeat(64)}`
    },
    browserLifecycle: input.execution.browserLifecycle ?? { schemaVersion: 1, processes: [] },
    outcome: outcome(input.execution)
  };
}

export function retainReliabilityRecord(record, directory) {
  mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `${record.attemptId}.json`);
  try {
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`Reliability attempt ${record.attemptId} already exists`);
    throw error;
  }
  return path;
}

export function summarizeReliability(records) {
  for (const record of records) validateReliabilityRecord(record);
  const ordered = [...records].sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  if (new Set(ordered.map(({ attemptId }) => attemptId)).size !== ordered.length) {
    throw new Error("Reliability history contains a duplicate attempt identity");
  }
  let consecutiveSuccesses = 0;
  for (const record of ordered.toReversed()) {
    if (record.outcome.status !== "passed") break;
    consecutiveSuccesses += 1;
  }
  const hosted = ordered.filter(({ host, sourceTreeState }) => host.provider === "github-hosted" && sourceTreeState === "clean");
  let hostedConsecutiveSuccesses = 0;
  for (const record of hosted.toReversed()) {
    if (record.outcome.status !== "passed") break;
    hostedConsecutiveSuccesses += 1;
  }
  return {
    schemaVersion: 1,
    attemptCount: ordered.length,
    consecutiveSuccesses,
    hostedAttemptCount: hosted.length,
    hostedConsecutiveSuccesses,
    firstAttemptFailureRate: ordered.length === 0
      ? null
      : ordered.filter(({ outcome: result }) => result.status !== "passed").length / ordered.length,
    hostedFirstAttemptFailureRate: hosted.length === 0
      ? null
      : hosted.filter(({ outcome: result }) => result.status !== "passed").length / hosted.length
  };
}

function oneValue(records, projection, message) {
  const values = new Set(records.map(projection));
  if (values.size !== 1) throw new Error(message);
  return values.values().next().value;
}

function variantResult(records) {
  const processDurations = records.flatMap(({ browserLifecycle }) =>
    browserLifecycle.processes.flatMap(({ durationMs }) => durationMs === undefined ? [] : [durationMs]));
  const memorySamples = records.flatMap(({ browserLifecycle }) =>
    browserLifecycle.processes.flatMap(({ samples }) => samples.map(({ memoryUsageBytes }) => memoryUsageBytes)));
  return {
    attemptCount: records.length,
    passed: records.filter(({ outcome: result }) => result.status === "passed").length,
    failed: records.filter(({ outcome: result }) => result.status === "failed").length,
    incomplete: records.filter(({ outcome: result }) => result.status === "incomplete").length,
    firstAttemptFailureRate: records.filter(({ outcome: result }) => result.status !== "passed").length / records.length,
    averageProcessLifetimeMs: processDurations.length === 0 ? null
      : Math.round(processDurations.reduce((sum, duration) => sum + duration, 0) / processDurations.length),
    peakObservedMemoryBytes: memorySamples.length === 0 ? null : Math.max(...memorySamples),
    oomKilledProcesses: records.flatMap(({ browserLifecycle }) => browserLifecycle.processes)
      .filter(({ exitState }) => exitState?.oomKilled === true).length
  };
}

export function compareIsolationVariants(records) {
  for (const record of records) validateReliabilityRecord(record);
  if (new Set(records.map(({ attemptId }) => attemptId)).size !== records.length) {
    throw new Error("Isolation comparison contains a duplicate attempt identity");
  }
  const project = records.filter(({ matrix }) => matrix.isolationVariant === "fresh-project-browser");
  const test = records.filter(({ matrix }) => matrix.isolationVariant === "fresh-test-browser");
  if (project.length < 20 || test.length < 20 || project.length !== test.length) {
    throw new Error("Isolation comparison requires twenty attempts per variant and equal sample sizes");
  }
  if (records.some(({ sourceTreeState }) => sourceTreeState !== "clean")) {
    throw new Error("Isolation comparison requires a clean source tree for every attempt");
  }
  const sourceCommit = oneValue(records, ({ sourceCommit: value }) => value,
    "Isolation comparison requires the same source commit");
  oneValue(records, ({ toolchain }) => toolchain.playwrightVersion,
    "Isolation comparison requires the same Playwright version");
  oneValue(records, ({ toolchain }) => toolchain.browserImage,
    "Isolation comparison requires the same browser image");
  const browserImageDigest = oneValue(records, ({ toolchain }) => toolchain.browserImageDigest,
    "Isolation comparison requires the same browser image digest");
  const projectOrder = oneValue(records, ({ matrix }) => matrix.projectOrder,
    "Isolation comparison requires the same project order");
  const resourceProfile = oneValue(records, ({ matrix }) => matrix.resourceProfile,
    "Isolation comparison requires the same resource profile");
  oneValue(records, ({ matrix }) => matrix.seedFingerprint,
    "Isolation comparison requires the same journey seed");
  oneValue(records, ({ host }) => JSON.stringify(host),
    "Isolation comparison requires the same host capacity");
  const populationFingerprint = oneValue(records, ({ testPopulation }) => testPopulation.fingerprint,
    "Isolation comparison requires the same test population");
  oneValue(records, ({ testPopulation }) => testPopulation.count,
    "Isolation comparison requires the same test population");
  const variants = {
    "fresh-project-browser": variantResult(project),
    "fresh-test-browser": variantResult(test)
  };
  const projectFailures = variants["fresh-project-browser"].failed + variants["fresh-project-browser"].incomplete;
  const testFailures = variants["fresh-test-browser"].failed + variants["fresh-test-browser"].incomplete;
  return {
    schemaVersion: 1,
    pairs: project.length,
    sourceCommit,
    browserImageDigest,
    projectOrder,
    resourceProfile,
    populationFingerprint,
    variants,
    selectedVariant: testFailures < projectFailures ? "fresh-test-browser" : "fresh-project-browser",
    selectionReason: testFailures < projectFailures
      ? "Fresh test browsers produced fewer first-attempt failures."
      : projectFailures < testFailures
        ? "Fresh project browsers produced fewer first-attempt failures."
        : "Both variants produced the same first-attempt result, so the lower-process project lifecycle remains selected."
  };
}

function readPinnedBrowserImage() {
  const setup = readFileSync(resolve(frontend, "e2e", "global-setup.ts"), "utf8");
  const image = /mcr\.microsoft\.com\/playwright:v[^"\s]+@sha256:[0-9a-f]{64}/.exec(setup)?.[0];
  if (image === undefined) throw new Error("The pinned Playwright browser image could not be read");
  return image;
}

function journeySeedFingerprint() {
  const setup = readFileSync(resolve(frontend, "e2e", "global-setup.ts"), "utf8");
  const instant = /export const journeyInstant = "(?<value>[^"]+)"/.exec(setup)?.groups?.value;
  const date = /export const journeyDate = (?<value>[^;]+);/.exec(setup)?.groups?.value;
  if (instant === undefined || date === undefined) throw new Error("The fixed journey seed could not be read");
  return `sha256:${createHash("sha256").update(JSON.stringify({ instant, date })).digest("hex")}`;
}

function sourceCommit() {
  if (/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? "")) return process.env.GITHUB_SHA;
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0 || !/^[0-9a-f]{40}$/.test(result.stdout.trim())) {
    throw new Error("The source commit could not be determined");
  }
  return result.stdout.trim();
}

function sourceTreeState() {
  const result = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error("The source tree state could not be determined");
  return result.stdout.trim() === "" ? "clean" : "modified";
}

function gateOutcome() {
  const path = resolve(frontend, "test-results", "browser-gate-outcome.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function browserLifecycle() {
  const path = resolve(frontend, "test-results", "browser-lifecycle.json");
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function completionOf(child) {
  return new Promise((resolveCompletion) => {
    let completed = false;
    const finish = (result) => {
      if (completed) return;
      completed = true;
      resolveCompletion(result);
    };
    child.once("error", () => finish({ exitCode: null, launchError: true }));
    child.once("close", (exitCode, signal) => finish({ exitCode, signal }));
  });
}

async function waitWithin(completion, durationMs) {
  const elapsed = Symbol("elapsed");
  let timer;
  try {
    return await Promise.race([completion, new Promise((resolveWait) => {
      timer = setTimeout(() => resolveWait(elapsed), durationMs);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

function terminateProcessTree(child, signal) {
  if (child.pid === undefined) return;
  if (platform() !== "win32") {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
    return;
  }
  if (signal === "SIGTERM") {
    child.kill();
    return;
  }
  const taskkill = resolve(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
  const terminated = spawnSync(taskkill, ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  if ((terminated.error !== undefined || terminated.status !== 0) && child.exitCode === null) child.kill("SIGKILL");
}

export async function runBoundedProcess(command, args, options, limits = {}) {
  const deadlineMs = limits.deadlineMs ?? executionDeadlineMs;
  const graceMs = limits.terminationGraceMs ?? terminationGraceMs;
  const child = spawn(command, args, { ...options, detached: platform() !== "win32", shell: false });
  const completion = completionOf(child);
  const first = await waitWithin(completion, deadlineMs);
  if (typeof first !== "symbol") return { ...first, timedOut: false };
  terminateProcessTree(child, "SIGTERM");
  const graceful = await waitWithin(completion, graceMs);
  if (typeof graceful !== "symbol") return { ...graceful, timedOut: true };
  terminateProcessTree(child, "SIGKILL");
  return { ...await completion, timedOut: true };
}

export async function environmentPrerequisites(execute = runBoundedProcess, cliAvailable = true) {
  if (!cliAvailable) return { isReady: false, classification: "environment" };
  const docker = await execute("docker", ["info", "--format", "{{.ServerVersion}}"],
    { cwd: root, env: process.env, stdio: "ignore" }, { deadlineMs: 10_000, terminationGraceMs: 1_000 });
  return docker.exitCode === 0 && docker.timedOut !== true && docker.launchError !== true
    ? { isReady: true }
    : { isReady: false, classification: "environment" };
}

async function runAttempt(options, updateExitCode = true) {
  const commit = sourceCommit();
  const treeState = sourceTreeState();
  const packageJson = JSON.parse(readFileSync(resolve(frontend, "package.json"), "utf8"));
  const browserImage = readPinnedBrowserImage();
  const startedAt = new Date().toISOString();
  const attemptId = randomUUID();
  const cli = resolve(frontend, "node_modules", "@playwright", "test", "cli.js");
  rmSync(resolve(frontend, "test-results", "browser-gate-outcome.json"), { force: true });
  rmSync(resolve(frontend, "test-results", "browser-lifecycle.json"), { force: true });
  const prerequisites = await environmentPrerequisites(undefined, existsSync(cli));
  const execution = prerequisites.isReady
    ? await runBoundedProcess(process.execPath, [cli, "test", "--project=webkit-core", "--project=webkit-pwa",
      "--project=webkit-accessibility"], {
      cwd: frontend,
      env: { ...process.env, COURTSIDE_PROJECT_ORDER: options.order, COURTSIDE_WEBKIT_AXE: "true",
        COURTSIDE_WEBKIT_RELIABILITY: "true",
        COURTSIDE_WEBKIT_BROWSER_ISOLATION: options.isolation === "fresh-test-browser" ? "test" : "project" },
      stdio: "inherit"
    })
    : { exitCode: null, environmentFailure: true };
  const finishedAt = new Date().toISOString();
  const record = buildReliabilityRecord({
    attemptId,
    sourceCommit: commit,
    sourceTreeState: treeState,
    startedAt,
    finishedAt,
    playwrightVersion: packageJson.devDependencies["@playwright/test"],
    browserImage,
    projectOrder: options.order,
    isolationVariant: options.isolation,
    resourceProfile: process.env.GITHUB_ACTIONS === "true" ? "github-hosted-default" : "local-default",
    seedFingerprint: journeySeedFingerprint(),
    host: {
      platform: platform(), architecture: arch(), cpuCount: cpus().length, totalMemoryBytes: totalmem(),
      ...process.env.ImageOS && process.env.ImageVersion
        ? { runnerImage: `${process.env.ImageOS}-${process.env.ImageVersion}` }
        : {}
    },
    execution: execution.environmentFailure === true || execution.launchError === true
      ? { exitCode: null, environmentFailure: true }
      : { exitCode: execution.exitCode, timedOut: execution.timedOut, gateOutcome: gateOutcome(),
        browserLifecycle: browserLifecycle() }
  });
  validateReliabilityRecord(record);
  const path = retainReliabilityRecord(record, options.output);
  process.stdout.write(`WebKit first-attempt record: ${path}\n`);
  if (updateExitCode) process.exitCode = record.outcome.status === "passed" ? 0 : 1;
  return record;
}

export function validateReliabilityRecord(record) {
  const validate = validator();
  if (!validate(record)) throw new Error(`Invalid WebKit reliability record: ${JSON.stringify(validate.errors)}`);
  const imageDigest = /@(?<digest>sha256:[0-9a-f]{64})$/.exec(record.toolchain.browserImage)?.groups?.digest;
  if (imageDigest !== record.toolchain.browserImageDigest) throw new Error("The browser image digest does not match its reference");
  if (Date.parse(record.finishedAt) - Date.parse(record.startedAt) !== record.durationMs) {
    throw new Error("The reliability duration does not match its timestamps");
  }
  if (record.outcome.status !== "incomplete") {
    const expectedProcesses = record.matrix.isolationVariant === "fresh-test-browser"
      ? record.testPopulation.count
      : 3;
    if (record.browserLifecycle.processes.length !== expectedProcesses) {
      throw new Error("The browser process count does not match the declared isolation");
    }
    for (const process of record.browserLifecycle.processes) {
      if (process.finishedAt === undefined || process.exitState === undefined || process.projectName === undefined) {
        throw new Error("A completed reliability run has unfinished browser lifecycle evidence");
      }
      const phases = new Set(process.samples.map(({ phase }) => phase));
      if (!phases.has("start") || !phases.has("end")) {
        throw new Error("A browser process is missing start or end resource evidence");
      }
    }
  }
  const classifications = new Set(record.outcome.classifications);
  const isPassed = record.outcome.status === "passed" && classifications.size === 1
    && classifications.has("none") && record.outcome.exitCode === 0;
  const isFailed = record.outcome.status === "failed" && classifications.has("product")
    && !classifications.has("none") && record.outcome.exitCode !== 0 && record.outcome.exitCode !== null;
  const isIncomplete = record.outcome.status === "incomplete" && !classifications.has("none")
    && (classifications.has("harness") || classifications.has("environment"));
  if (!isPassed && !isFailed && !isIncomplete) throw new Error("The reliability outcome is contradictory");
}

export function reliabilityOptions(args) {
  const values = { order: "configured", isolation: "fresh-project-browser",
    output: resolve(frontend, "test-results", "webkit-reliability") };
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${name}`);
    if (name === "--order") values.order = value;
    else if (name === "--isolation") values.isolation = value;
    else if (name === "--output") values.output = resolve(value);
    else throw new Error(`Unsupported option: ${name}`);
  }
  if (!new Set(["configured", "reversed"]).has(values.order)) throw new Error("Unsupported project order");
  if (!new Set(["fresh-project-browser", "fresh-test-browser"]).has(values.isolation)) {
    throw new Error("Unsupported isolation variant");
  }
  return values;
}

export function comparisonOptions(args) {
  const pairArgument = args.findIndex((value) => value === "--pairs");
  if (pairArgument === -1 || args[pairArgument + 1] === undefined) {
    throw new Error("Isolation comparison requires --pairs");
  }
  const pairs = Number(args[pairArgument + 1]);
  if (!Number.isInteger(pairs) || pairs < 20) throw new Error("Isolation comparison requires at least twenty pairs");
  const remaining = args.filter((_value, index) => index !== pairArgument && index !== pairArgument + 1);
  const options = reliabilityOptions(remaining);
  if (!remaining.includes("--output")) {
    options.output = resolve(root, "target", "webkit-isolation-experiment");
  }
  const testResults = resolve(frontend, "test-results");
  const relation = relative(testResults, options.output);
  if (relation === "" || relation === ".." || !relation.startsWith(`..${sep}`)) {
    throw new Error("Isolation experiment output must be outside Playwright test-results");
  }
  return { ...options, pairs };
}

async function runComparison(options) {
  const records = [];
  mkdirSync(options.output, { recursive: true });
  if (readdirSync(options.output).length > 0) {
    throw new Error("Isolation experiment output directory must be empty");
  }
  for (let pair = 0; pair < options.pairs; pair += 1) {
    const variants = pair % 2 === 0
      ? ["fresh-project-browser", "fresh-test-browser"]
      : ["fresh-test-browser", "fresh-project-browser"];
    for (const isolation of variants) {
      records.push(await runAttempt({ ...options, isolation }, false));
    }
  }
  process.stdout.write(`${JSON.stringify(compareIsolationVariants(records), null, 2)}\n`);
}

function validateFile(path) {
  const record = JSON.parse(readFileSync(resolve(path), "utf8"));
  validateReliabilityRecord(record);
  process.stdout.write(`Valid WebKit reliability record: ${basename(path)}\n`);
}

function summarizeDirectory(path) {
  const records = readdirSync(resolve(path)).filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(resolve(path, name), "utf8")));
  process.stdout.write(`${JSON.stringify(summarizeReliability(records), null, 2)}\n`);
}

function compareDirectory(path) {
  const records = readdirSync(resolve(path)).filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(resolve(path, name), "utf8")));
  process.stdout.write(`${JSON.stringify(compareIsolationVariants(records), null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "run") await runAttempt(reliabilityOptions(args));
  else if (command === "experiment") await runComparison(comparisonOptions(args));
  else if (command === "validate" && args.length === 1) validateFile(args[0]);
  else if (command === "summarize" && args.length === 1) summarizeDirectory(args[0]);
  else if (command === "compare" && args.length === 1) compareDirectory(args[0]);
  else throw new Error("Usage: webkit-reliability.mjs run|experiment|validate|summarize|compare");
}
