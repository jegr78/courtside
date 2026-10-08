import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { EventEmitter, once } from "node:events";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { containerIdentity } from "./mail-relay-certificate.mjs";
import vm from "node:vm";
import { runInNewContext } from "node:vm";
import { assertPerformanceStateOwnership } from "./immutable-image-reuse.mjs";
import {
  assertFunnelShareable, classifyFunnelConfig, executableNames, frontendInstallPlan, funnelPlan,
  funnelResetPlan, lifecyclePlan, listenerOutputMatches, parseArguments, parseTailscaleNodeStatus, newBootstrapPassword,
  openBackupForRestore, packagedApplicationJar, processPlans, requiredPorts, restoreDatabase, runInteractive,
  runLifecyclePlans, startProcesses,
  startPerformance,
  assertPerformanceSource,
  superviseFunnel, terminate,
  terminateChildren, uatComposeArgs, uatResetPlans, perfComposeArgs, perfComposePlan, perfResetPlan,
  writePrivateFile, performanceRunPlan, performanceContainerLogPlan, performanceIdentityRequest, buildPerformanceResult, comparePerformanceResults, performanceBaselinePlan,
  performanceImagePlans, performanceStartupSummary, performanceRelayCertificate, performanceRelaySettings,
  funnelPerformanceRunPlan, localRequest, validateFunnelTarget, validatePerformanceResult,
  redactUatDiagnostics, remoteJsonRequest, resolvePublicFunnelAddresses, uatStartupSummary, uatImageReference,
  uatInstance, uatStateFile, uatSmokeEnvironment, repositoryFromRemote, uatBookingSeedCandidate, uatBookingSeedPlans,
  validateNode, validatePublicAddress
} from "./courtside.mjs";

function composeService(compose, service) {
  return compose.match(new RegExp(`^  ${service}:\\n(?<body>.*?)(?=^  [\\w-]+:|^volumes:|^networks:)`, "ms"))?.groups.body ?? "";
}

for (const scenario of ["state", "images-only", "deployment-only", "override", "reservation"]) {
test(`given retained immutable PERFORMANCE ${scenario}, when the actual legacy start runs, then refuse before relay state writes or build plans`, async () => {
  // given
    const root = mkdtempSync(join(tmpdir(), "legacy-perf-refusal-"));
    if (scenario === "override") {
      mkdirSync(join(root, "build"));
      writeFileSync(join(root, "build/immutable-performance-compose.json"), "{}");
    }
    const events = [];
    const state = ["state", "images-only", "deployment-only"].includes(scenario) ? { password: "retained-private-password",
      ...(scenario !== "deployment-only" ? { immutableImages: { sourceCommit: "a".repeat(40) } } : {}),
      ...(scenario !== "images-only" ? { immutableDeployment: { owner: "b".repeat(32) } } : {}) } : undefined;
    const runtime = { readState: () => state, assertStateOwnership: value => assertPerformanceStateOwnership(value, { root,
      execute: () => ({ status: 0, stdout: scenario === "reservation" ? "c".repeat(64) : "", stderr: "" }) }),
      run: () => events.push("run"), relay: () => { events.push("relay"); return {}; },
    writeState: () => events.push("state"), extract: () => events.push("extract"), stage: () => events.push("stage"),
    output: () => events.push("output") };
    // when / then
    try {
      await assert.rejects(() => startPerformance({ command: "perf", skipVerify: true }, runtime), /Immutable PERFORMANCE/);
      assert.deepEqual(events, []);
    } finally { rmSync(root, { recursive: true, force: true }); }
});
}

test("given marker-free legacy PERFORMANCE state, when the actual legacy start runs with complete injected closures, then preserve its existing build behavior", async () => {
  // given
  const events = [];
  const runtime = { readState: () => ({ password: "retained-private-password" }),
    assertStateOwnership: () => events.push("ownership"), run: plan => events.push(plan), relay: () => ({}),
    writeState: state => events.push(state), extract() {}, stage() {}, output() {} };
  // when
  await startPerformance({ command: "perf", skipVerify: true }, runtime);
  // then
  assert.equal(events[0], "ownership");
  assert.equal(events[1].password, "retained-private-password");
  assert.ok(events.some(event => event.command === "./mvnw"));
  assert.ok(events.some(event => event.args?.includes("--force-recreate")));
});

test("given a paired seed command, when parsing its BASE checkout, then the explicit compose root is retained only for seeding", () => {
  // given
  const args = ["security-seed", "compare-base-1-1", `sha256:${"a".repeat(64)}`,
    "--state", "/base/build/security/compare-base-1-1/environment.json"];
  // when / then
  assert.equal(parseArguments([...args, "--compose-root", "/base"]).composeRoot, "/base");
  assert.equal(parseArguments(args).composeRoot, undefined);
  assert.throws(() => parseArguments([...args, "--compose-root"]), /requires/);
  assert.throws(() => parseArguments(["security-stop", "compare-base-1-1", "--compose-root", "/base"]), /Unknown option/);
});

test("given an explicit BASE compose root, when the CLI dispatches seeding, then it passes the checkout to the HEAD producer", async () => {
  // given
  const source = readFileSync(new URL("./courtside.mjs", import.meta.url), "utf8");
  const start = source.indexOf("async function execute(options) {");
  const declaration = source.slice(start, source.indexOf("\n}\n", start) + 2);
  const calls = [];
  const execute = vm.runInNewContext("(" + declaration + ")", {
    seedSecurityEnvironment: (...args) => calls.push(JSON.parse(JSON.stringify(args)))
  });
  const options = parseArguments(["security-seed", "compare-base-1-1", `sha256:${"a".repeat(64)}`,
    "--state", "/base/build/security/compare-base-1-1/environment.json", "--compose-root", "/base"]);
  // when
  await execute(options);
  // then
  assert.deepEqual(calls, [[options.runId, options.image, options.state, { composeRoot: "/base" }]]);
});

test("given an image proof failure with a private cleanup receipt, when the actual CLI catches it, then report the first error and bounded cleanup outcome", async () => {
  // given
  const source = readFileSync(new URL("./courtside.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async function main("), source.indexOf("\nasync function execute("));
  const failure = Object.assign(new Error("Immutable image proof exceeded its command budget"), {
    imageProbeFailureReceipt: "/private/probe.json", imageProbeCleanup: { outcome: "passed", reason: "secret-native-stderr" }
  });
  let output = "";
  const process = { argv: [], stderr: { write: value => { output += value; } } };
  const main = runInNewContext(body + "\nmain", { process, parseArguments: () => ({ command: "perf", image: "selected" }),
    validateNode() {}, validateDocker() {}, execute: async () => { throw failure; } });
  // when
  await main();
  // then
  assert.match(output, /Immutable image proof exceeded its command budget/);
  assert.match(output, /image probe cleanup: passed; private failure receipt retained/);
  assert.doesNotMatch(output, /secret-native-stderr/);
  assert.equal(process.exitCode, 1);
});

function performanceResetStateHarness({ missing = false, corrupt = false, override = false, reservation = false, command = "perf-reset" } = {}) {
  const source = readFileSync(new URL("./courtside.mjs", import.meta.url), "utf8");
  const reader = source.slice(source.indexOf("function readPerformanceState("), source.indexOf("\nexport function perfResetPlan("));
  const reset = source.slice(source.indexOf(command === "perf-reset" ? '  if (options.command === "perf-reset") {' : '  if (["perf-stop", "perf-logs", "perf-db-shell"].includes(options.command)) {'),
    source.indexOf('  if (options.command === "perf-run") {'));
  const events = [];
  const context = { options: { command }, root: "/repo", perfStateFile: "/repo/build/perf-environment.json",
    perfMailDirectory: "/repo/build/perf-mail", process: { stdout: { write() {} }, env: {} },
    readFileSync: () => { if (missing) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return corrupt ? "{" : JSON.stringify({ password: "legacy-password" }); },
    existsSync: () => override,
    assertPerformanceStateOwnership: (state) => {
      if (override || reservation) throw new Error("Immutable PERFORMANCE state is unavailable; reset refused");
    },
    resetPerformanceReuse: () => events.push("immutable-reset"), performanceRelaySettings: () => ({}),
    runInteractive: () => events.push("legacy-down"), perfResetPlan: () => ({}), lifecyclePlan: () => ({}),
    rmSync: () => events.push("remove-file") };
  return { events, run: runInNewContext(reader + "\n(async () => {" + reset + "})", context) };
}

test("given missing PERFORMANCE state and surviving immutable ownership, when stop logs or db-shell runs, then refuse before legacy lifecycle", async () => {
  // given
  for (const command of ["perf-stop", "perf-logs", "perf-db-shell"]) {
    for (const retained of [{ override: true }, { reservation: true }]) {
      const harness = performanceResetStateHarness({ missing: true, command, ...retained });
      // when / then
      await assert.rejects(harness.run, /Immutable PERFORMANCE state is unavailable/);
      assert.deepEqual(harness.events, []);
    }
  }
});

test("given missing PERFORMANCE state with an immutable override or reservation, when the actual reset producer runs, then refuse before legacy down or file removal", async () => {
  // given
  for (const retained of [{ override: true }, { reservation: true }]) {
    const harness = performanceResetStateHarness({ missing: true, ...retained });
    // when / then
    await assert.rejects(harness.run, { message: "Immutable PERFORMANCE state is unavailable; reset refused" });
    assert.deepEqual(harness.events, []);
  }
});

test("given corrupt PERFORMANCE state, when the actual reset producer reads it, then refuse instead of treating it as missing", async () => {
  // given
  const harness = performanceResetStateHarness({ corrupt: true });
  // when / then
  await assert.rejects(harness.run, /PERFORMANCE state is corrupt/);
  assert.deepEqual(harness.events, []);
});

test("given an oversized immutable PERFORMANCE identity response, when the actual HTTP helper reads it, then abort at the byte ceiling", async () => {
  // given
  const server = createServer((_request, response) => response.end("x".repeat(2048)));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    // when / then
    await assert.rejects(() => localRequest({ secure: false, port: server.address().port, path: "/api/source",
      absoluteDeadlineMilliseconds: 1000, responseLimitBytes: 1024 }), { message: "Identity response exceeded its byte budget" });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("given an immutable PERFORMANCE identity stream that keeps sending bytes, when its absolute deadline expires, then abort despite socket activity", async () => {
  // given
  const server = createServer((_request, response) => {
    const timer = setInterval(() => response.write("x"), 5);
    const finish = setTimeout(() => response.end(), 150);
    response.once("close", () => { clearInterval(timer); clearTimeout(finish); });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    // when / then
    await assert.rejects(() => localRequest({ secure: false, port: server.address().port, path: "/api/source",
      absoluteDeadlineMilliseconds: 30, responseLimitBytes: 1024 }), { message: "Identity request absolute deadline exceeded" });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("given immutable PERFORMANCE HTTPS identity options, when the actual request helper encounters certificate rejection, then preserve the owned CA hostname and TLS verification", async () => {
  // given
  const source = readFileSync(new URL("./courtside.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export function localRequest("), source.indexOf("\nfunction certificatePublicKeyPin("))
    .replace("export function", "function");
  const captured = [];
  const context = { Buffer, setTimeout, clearTimeout,
    httpRequest: () => { throw new Error("Unexpected HTTP downgrade"); },
    httpsRequest: (options) => {
      captured.push(options);
      const request = new EventEmitter();
      request.end = () => queueMicrotask(() => request.emit("error", new Error("Certificate rejected")));
      request.destroy = () => {};
      return request;
    },
    certificatePublicKeyPin: () => { throw new Error("No unverified certificate may be pinned"); } };
  const request = runInNewContext(body + "\nlocalRequest", context);
  // when / then
  await assert.rejects(() => request(performanceIdentityRequest("owned-ca", { immutable: true })), { message: "Certificate rejected" });
  assert.equal(captured[0].rejectUnauthorized, true);
  assert.equal(captured[0].ca, "owned-ca");
  assert.equal(captured[0].servername, "proxy");
  assert.equal(captured[0].hostname, "127.0.0.1");
});

function immutablePerformanceHarness({ wrongSource = false, runnerFailure = false } = {}) {
  const text = readFileSync(new URL("./courtside.mjs", import.meta.url), "utf8");
  const body = text.slice(text.indexOf("async function runPerformance(options)"), text.indexOf("async function runFunnelPerformance(options)"));
  const logs = text.slice(text.indexOf("function retainContainerLogs("), text.indexOf("export function funnelPerformanceRunPlan("));
  const events = [];
  const files = new Map();
  const state = { password: "private-test-password", immutableImages: { sourceCommit: "c".repeat(40) } };
  const context = { root: "/private/scratch", join, process: { env: {}, platform: "linux", arch: "x64", stdout: { write() {} } },
    Date, JSON, createHash: () => ({ update() { return this; }, digest: () => "a".repeat(64) }),
    readPerformanceState: () => state, performanceRelaySettings: () => ({}),
    assertPerformanceReuse: () => { events.push("proof"); return { runtime: { oomKilled: false, restartCount: 0 } }; },
    mkdirSync: () => {}, perfComposePlan: (args) => ({ command: "docker", args, environment: {} }),
    performanceContainerLogPlan: (stdout) => ({ command: "docker", args: ["compose", "logs"], environment: {}, stdout }),
    openSync: (file, flags, mode) => { events.push({ opened: file, flags, mode }); return 7; },
    writeSync: (descriptor, text) => events.push({ written: descriptor, text }), closeSync: () => {},
    boundedImageCommand: (_execute, command, args) => { events.push({ command, args, bounded: true }); }, spawnSync: (command, args, options) => {
      if (!args.includes("logs")) throw new Error("Unexpected process closure");
      events.push({ logs: true, options }); return { status: 0 };
    },
    runInteractive: () => { events.push("unbounded"); files.set("raw-summary.json", "{}"); },
    localRequest: async (request) => { events.push({ identityRequest: request }); return { statusCode: 200, body: JSON.stringify({ environment: "PERFORMANCE", version: "1.2.3", commit: (wrongSource ? "d" : "c").repeat(40) }), certificatePin: "pin" }; },
    performanceIdentityRequest, parseJson: JSON.parse, assertPerformanceSource,
    performanceRunPlan: () => ({ command: "docker", args: ["run", "--pull=never"], environment: {} }),
    runOwnedProcess: async (_command, _args, options) => { events.push({ runner: true, options }); if (runnerFailure) { await options.cleanup(); throw new Error("Runner refused"); } files.set("raw-summary.json", "{}"); },
    randomBytes: () => Buffer.from("owned-runner"), cleanupPerformanceRunner: () => events.push("runner-cleanup"),
    readFileSync: (file) => file.endsWith("contract.json") ? JSON.stringify({ profiles: { smoke: { limits: { maximumDuration: "1m" } } } }) : file.endsWith("root.crt") ? "trusted-ca" : files.get("raw-summary.json"),
    existsSync: () => files.has("raw-summary.json"),
    writePrivateFile: () => events.push("private-proof"), writeFileSync: () => events.push("summary"), rmSync: () => {},
    buildPerformanceResult: () => ({}), validatePerformanceResult: () => {}, durationSeconds: () => 60 };
  return { events, run: runInNewContext(`${logs}${body}; runPerformance`, context) };
}

test("given proven immutable PERFORMANCE state, when the actual runner producer executes, then bound certificate and traffic commands and retain before-after runtime evidence", async () => {
  // given
  const harness = immutablePerformanceHarness();
  // when
  await harness.run({ profile: "smoke" });
  // then
  assert.ok(!harness.events.includes("unbounded"));
  assert.equal(harness.events.filter(event => event === "proof").length, 2);
  const runner = harness.events.find(event => event?.runner);
  assert.equal(runner.options.timeoutMilliseconds, 180_000);
  assert.equal(runner.options.outputLimitBytes, 4 * 1024 * 1024);
  assert.ok(harness.events.includes("private-proof"));
  const request = harness.events.find(event => event?.identityRequest).identityRequest;
  assert.equal(request.absoluteDeadlineMilliseconds, 30000);
  assert.equal(request.responseLimitBytes, 4 * 1024 * 1024);
  assert.equal(request.secure, true);
  assert.equal(request.ca, "trusted-ca");
  assert.equal(request.servername, "proxy");
  const logs = harness.events.find(event => event?.logs);
  assert.equal(logs?.options.timeout, 60000, "the container logs are read within a time bound like every other immutable command");
  assert.equal(logs.options.stdio[1], 7, "the logs stream into the file, because a full run outgrows an in-memory bound");
  assert.ok(harness.events.some(event => event?.opened?.endsWith("/containers.log") && event.mode === 0o600),
    "the container logs are kept as a private file in the result directory");
});

test("given a different immutable PERFORMANCE source, when the actual producer observes TLS identity, then refuse before any traffic command", async () => {
  // given
  const harness = immutablePerformanceHarness({ wrongSource: true });
  // when / then
  await assert.rejects(() => harness.run({ profile: "smoke" }), { message: "Immutable PERFORMANCE runtime source does not match the selected commit" });
  assert.ok(!harness.events.some(event => event?.runner));
  assert.ok(!harness.events.includes("unbounded"));
});

test("given a failed immutable PERFORMANCE runner, when the actual producer aborts, then clean the owned runner and retain runtime evidence without a passing summary", async () => {
  // given
  const harness = immutablePerformanceHarness({ runnerFailure: true });
  // when / then
  await assert.rejects(() => harness.run({ profile: "smoke" }), { message: "Runner refused" });
  assert.ok(harness.events.includes("runner-cleanup"));
  assert.ok(harness.events.includes("private-proof"));
  assert.ok(!harness.events.includes("summary"));
  assert.ok(harness.events.some(event => event?.logs),
    "a failed runner still leaves the container logs that explain it");
});

test("given an explicitly proven prebuilt PERF selection, when starting through the producer, then never execute a package or image build", async () => {
  // given
  const image = `sha256:${"a".repeat(64)}`;
  const fixturesImage = `sha256:${"b".repeat(64)}`;
  const sourceCommit = "c".repeat(40);
  const events = [];
  const runtime = { readState: () => undefined, stateExists: () => false,
    inspect: () => ({ productionImageID: image, fixturesImageID: fixturesImage, sourceCommit }),
    assertEmpty: () => events.push("empty"), relay: () => ({}),
    prepare: () => ({ owner: "d".repeat(32), override: "/private/override" }),
    writeState: (record) => events.push(record), start: async () => events.push("start"),
    assertRuntime: () => ({ resources: [], runtime: { oomKilled: false, restartCount: 0 } }), output: () => {},
    run: () => { throw new Error("Unexpected legacy build path"); } };
  // when / then
  await assert.doesNotReject(() => startPerformance({ image, fixturesImage, sourceCommit, showCredentials: false }, runtime));
  assert.ok(events.includes("empty"));
  assert.ok(events.includes("start"));
  const record = events.find((event) => typeof event === "object");
  assert.equal(record.immutableImages.fixturesImageID, fixturesImage);
});

test("given an incomplete execution seam, when starting PERFORMANCE, then refuse before reading credentials or launching any command", async () => {
  // given
  const events = [];
  const runtime = { run: () => events.push("run"), readState: () => events.push("state") };
  // when / then
  await assert.rejects(() => startPerformance({}, runtime), { message: "Performance execution seam is incomplete" });
  assert.deepEqual(events, []);
});

test("given rejected immutable source proof, when starting PERFORMANCE, then create no credentials certificate or runtime state", async () => {
  // given
  const events = [];
  const record = () => events.push("unexpected mutation");
  const runtime = { readState: () => undefined, inspect: () => { throw new Error("Source proof rejected"); },
    assertEmpty: record, relay: record, prepare: record, writeState: record,
    start: record, assertRuntime: record, output: record };
  // when / then
  await assert.rejects(() => startPerformance({ image: `sha256:${"a".repeat(64)}`,
    fixturesImage: `sha256:${"b".repeat(64)}`, sourceCommit: "c".repeat(40) }, runtime), { message: "Source proof rejected" });
  assert.deepEqual(events, []);
});

test("given retained immutable PERFORMANCE state, when planning compose operations, then reuse the exact owned override and private environment", () => {
  // given
  const state = { password: "private-test-password", immutableImages: { sourceCommit: "c".repeat(40) },
    immutableDeployment: { compose: ["compose", "--env-file", "/dev/null", "-p", "courtside-perf", "-f", "/private/override.json"] } };
  // when
  const plan = perfComposePlan(["cp", "proxy:/data/root.crt", "/private/root.crt"], { state, environment: {} });
  // then
  assert.deepEqual(plan.args, [...state.immutableDeployment.compose, "cp", "proxy:/data/root.crt", "/private/root.crt"]);
  assert.equal(plan.environment.COURTSIDE_PERF_SHARED_PASSWORD, state.password);
});

test("given immutable PERFORMANCE state, when planning its runner, then refuse automatic runner pulls without changing the legacy plan", () => {
  // given
  const state = { immutableImages: { sourceCommit: "c".repeat(40) } };
  // when
  const immutable = performanceRunPlan({ profile: "smoke" }, "/private/results", "/private/root.crt", "test-run", undefined, state);
  const legacy = performanceRunPlan({ profile: "smoke" }, "/private/results", "/private/root.crt", "test-run", undefined, undefined);
  // then
  assert.ok(immutable.args.includes("--pull=never"));
  assert.ok(!legacy.args.includes("--pull=never"));
});

test("given immutable PERFORMANCE source binding, when the TLS source reports another commit, then refuse the profile before generating traffic", () => {
  // given
  const state = { immutableImages: { sourceCommit: "c".repeat(40) } };
  // when / then
  assert.throws(() => assertPerformanceSource({ environment: "PERFORMANCE", commit: "d".repeat(40) }, state),
    { message: "Immutable PERFORMANCE runtime source does not match the selected commit" });
  assert.doesNotThrow(() => assertPerformanceSource({ environment: "PERFORMANCE", commit: "c".repeat(40) }, state));
});

test("given complete immutable PERF and SECURITY selections, when parsing CLI arguments, then preserve exact engine-native IDs and source without changing defaults", () => {
  // given
  const image = `sha256:${"a".repeat(64)}`;
  const fixturesImage = `sha256:${"b".repeat(64)}`;
  const commit = "c".repeat(40);
  // when / then
  for (const args of [["perf", "--image", image], ["security", "run-0001", image],
    ["security", "run-0001", "--image", image]]) {
    let selected;
    assert.doesNotThrow(() => { selected = parseArguments([...args, "--fixtures-image", fixturesImage, "--source-commit", commit]); });
    assert.equal(selected.image, image);
    assert.equal(selected.fixturesImage, fixturesImage);
    assert.equal(selected.sourceCommit, commit);
  }
  assert.equal(parseArguments(["perf", "--skip-verify"]).skipVerify, true);
});

test("given partial duplicate tag or conflicting immutable selection, when parsing CLI arguments, then reject before any command", () => {
  // given
  const image = `sha256:${"a".repeat(64)}`;
  const fixturesImage = `sha256:${"b".repeat(64)}`;
  const source = "c".repeat(40);
  const args = ["perf", "--image", image, "--fixtures-image", fixturesImage, "--source-commit", source];
  // when / then
  for (const invalid of [["perf", "--image", image], [...args, "--image", image],
    [...args, "--source-commit", source], [...args.slice(0, 2), "courtside:local", ...args.slice(3)],
    [...args, "--skip-verify"], ["security", "run-0001", image, "--source-commit", source],
    ["security", "run-0001", "--image", image],
    ["security", "run-0001", image, "--image", image, "--fixtures-image", fixturesImage, "--source-commit", source]]) {
    assert.throws(() => parseArguments(invalid));
  }
});

function passingPerformanceResult() {
  return {
    schemaVersion: 1,
    contract: { schemaVersion: 1, digest: `sha256:${"a".repeat(64)}` },
    build: { applicationVersion: "1.2.3", gitCommit: "abcdef0" },
    runtime: {
      k6Version: "2.2.0", operatingSystem: "linux", architecture: "arm64",
      runner: { processorCount: 4, memoryMegabytes: 16384 }
    },
    profile: {
      name: "baseline", workload: "reference", target: "system", environment: "PERFORMANCE",
      startedAt: "2026-08-10T12:00:00.000Z", durationSeconds: 600
    },
    load: {
      dataset: { members: 1000, courts: 8 }, readShare: 0.9, writeShare: 0.1, virtualUsers: 50
    },
    resources: {
      application: { cpu: 2, memoryMegabytes: 1024 },
      database: { cpu: 2, memoryMegabytes: 2048 },
      proxy: { cpu: 0.5, memoryMegabytes: 256 }
    },
    thresholds: {
      technicalErrorRate: true, unexpectedServerErrors: true, readOnlyApi: true, login: true, booking: true
    },
    metrics: {
      iterations: 100, requests: 300, throughputPerSecond: 5, technicalErrorRate: 0,
      unexpectedServerErrors: 0, bookingConflicts: 1, bookingConflictRate: 0.1,
      latencyMilliseconds: { p50: 10, p90: 20, p95: 30, p99: 40 }
    }
  };
}

function passingBrowserPerformanceResult() {
  const result = passingPerformanceResult();
  result.profile.name = "browser";
  result.thresholds = {
    technicalErrorRate: true, unexpectedServerErrors: true, webVitals: true, browserErrors: true,
    browserJourney: true
  };
  result.metrics = {
    iterations: 100, requests: 300, throughputPerSecond: 5, technicalErrorRate: 0,
    unexpectedServerErrors: 0, browserErrors: 0, browserJourneyMilliseconds: 1800,
    webVitals: { percentile: 75, lcpMilliseconds: 1200, inpMilliseconds: 80, cls: 0.03 },
    latencyMilliseconds: { p50: 10, p90: 20, p95: 30, p99: 40 }
  };
  return result;
}

test("given Windows, when resolving executables, then wrapper commands use cmd launchers", () => {
  // when / then
  assert.deepEqual(executableNames("win32"), { maven: "mvnw.cmd", npm: "npm.cmd" });
});

test("given UAT booking data, when parsing the command, then writes require the exact confirmation", () => {
  // when / then
  assert.equal(parseArguments(["uat-seed-bookings"]).confirm, undefined);
  assert.equal(parseArguments(["uat-seed-bookings", "--confirm", "courtside-uat"]).confirm,
    "courtside-uat");
  assert.throws(() => parseArguments(["uat-seed-bookings", "--confirm", "wrong"]),
    /--confirm courtside-uat/);
});

test("given a persistent UAT image, when planning its booking seed, then the fixture overlays that image", () => {
  // given
  const state = { image: "ghcr.io/example/courtside:1.2.3", dbPort: true };

  // when
  const preview = uatBookingSeedPlans(state, false);
  const write = uatBookingSeedPlans(state, true);

  // then
  assert.ok(preview.image.args.includes("BASE_IMAGE=ghcr.io/example/courtside:1.2.3"));
  assert.ok(preview.run.args.some((argument) => argument.endsWith("compose.uat-seed.yaml")));
  assert.equal(preview.run.environment.COURTSIDE_UAT_BOOKING_SEED_WRITE, "false");
  assert.equal(write.run.environment.COURTSIDE_UAT_BOOKING_SEED_WRITE, "true");
  assert.ok(preview.run.args.some((argument) => argument.endsWith("compose.uat-db.yaml")));
});

test("given an optional published booking seed candidate, when UAT smoke resolves it, then absence skips and partial input fails", () => {
  // given
  const image = `ghcr.io/example/courtside@sha256:${"a".repeat(64)}`;
  const composeFile = "/tmp/candidate/compose.booking-seed.yaml";

  // when / then
  assert.equal(uatBookingSeedCandidate({}), null);
  assert.deepEqual(uatBookingSeedCandidate({ COURTSIDE_UAT_BOOKING_SEED_IMAGE: image,
    COURTSIDE_UAT_BOOKING_SEED_COMPOSE: composeFile }), { image, composeFile });
  assert.throws(() => uatBookingSeedCandidate({ COURTSIDE_UAT_BOOKING_SEED_IMAGE: image }),
    /needs both/);
  assert.throws(() => uatBookingSeedCandidate({ COURTSIDE_UAT_BOOKING_SEED_COMPOSE: composeFile }),
    /needs both/);
});

test("given macOS or Linux, when resolving executables, then the POSIX Maven wrapper is used", () => {
  // when / then
  assert.deepEqual(executableNames("darwin"), { maven: "./mvnw", npm: "npm" });
  assert.deepEqual(executableNames("linux"), { maven: "./mvnw", npm: "npm" });
});

test("given a supported or newer Node release, when validating the runtime, then no upper major blocks upgrades", () => {
  // when / then
  assert.doesNotThrow(() => validateNode("24.0.0"));
  assert.doesNotThrow(() => validateNode("26.5.1"));
  assert.doesNotThrow(() => validateNode("27.0.0"));
});

test("given a Node release below the minimum, when validating the runtime, then it is rejected", () => {
  // when / then
  assert.throws(() => validateNode("23.11.1"), /Node 24 or later is required, found 23\.11\.1/);
});

test("given a frontend spawn failure, when starting development, then the backend is terminated", async () => {
  // given
  const backend = childProcess(101);
  const frontend = childProcess();
  const terminated = [];
  let invocation = 0;

  // when
  const started = startProcesses(processPlans(parseArguments(["dev"])), {}, {
    spawn: () => invocation++ === 0 ? backend : frontend,
    terminate: (child) => terminated.push(child.pid)
  });
  backend.emit("spawn");
  await new Promise((resolve) => setImmediate(resolve));
  frontend.emit("error", new Error("npm missing"));

  // then
  await assert.rejects(started, /frontend failed to start: npm missing/);
  assert.deepEqual(terminated, [101]);
});

test("given the backend exits while the frontend starts, when supervising development, then its exit is retained", async () => {
  // given
  const backend = childProcess(101);
  const frontend = childProcess(102);
  let invocation = 0;

  // when
  const started = startProcesses(processPlans(parseArguments(["dev"])), {}, {
    spawn: () => invocation++ === 0 ? backend : frontend,
    terminate: () => {}
  });
  backend.emit("spawn");
  await new Promise((resolve) => setImmediate(resolve));
  backend.emit("exit", 7);
  frontend.emit("spawn");
  const processes = await started;

  // then
  assert.equal(await processes.exit, 7);
});

test("given a POSIX process already ended, when terminating its group, then cleanup tolerates ESRCH", () => {
  // given
  const child = { exitCode: null, pid: 101 };
  const kill = () => {
    const failure = new Error("No such process");
    failure.code = "ESRCH";
    throw failure;
  };

  // when / then
  assert.doesNotThrow(() => terminate(child, "linux", kill));
});

test("given multiple development processes, when stopping them, then only each child is passed to termination", () => {
  // given
  const children = [{ pid: 101 }, { pid: 102 }];
  const terminated = [];

  // when
  terminateChildren(children, (...argumentsReceived) => terminated.push(argumentsReceived));

  // then
  assert.deepEqual(terminated, [[children[0]], [children[1]]]);
});

test("given lifecycle commands, when planning them, then only the isolated Dev project is targeted", () => {
  // when
  const stop = lifecyclePlan("dev-stop");
  const reset = lifecyclePlan("dev-reset");

  // then
  assert.deepEqual(stop.args.slice(-1), ["stop"]);
  assert.deepEqual(reset.args.slice(-3), ["down", "--volumes", "--remove-orphans"]);
  assert.ok(stop.args.includes("courtside-dev"));
  assert.ok(reset.args.some((argument) => argument.endsWith("compose.dev.yaml")));
});

test("given a fresh checkout, when installing frontend dependencies, then npm ci is platform safe", () => {
  // when
  const windows = frontendInstallPlan("win32");
  const linux = frontendInstallPlan("linux");

  // then
  assert.equal(windows.command, "cmd.exe");
  assert.equal(windows.args.at(-1), "npm.cmd --prefix frontend ci");
  assert.deepEqual(linux.args, ["--prefix", "frontend", "ci"]);
});

test("given platform listener output, when checking JDWP, then only loopback listeners match", () => {
  // when / then
  assert.equal(listenerOutputMatches("TCP 127.0.0.1:5005 0.0.0.0:0 LISTENING", 5005), true);
  assert.equal(listenerOutputMatches("LISTEN 0 1 127.0.0.1:5005 0.0.0.0:*", 5005), true);
  assert.equal(listenerOutputMatches("TCP 0.0.0.0:5005 0.0.0.0:0 LISTENING", 5005), false);
});

test("given a loopback-bound environment, when requesting it, then local probes cannot escape to an IPv6 listener", () => {
  // given
  const source = readFileSync(fileURLToPath(new URL("./courtside.mjs", import.meta.url)), "utf8");

  // when / then
  assert.match(source, /hostname: "127\.0\.0\.1", port, path, method, headers/);
  assert.match(source, /servername: servername \?\? "localhost"/);
  assert.match(source, /headers: \{ Host: `localhost:\$\{port\}`, \.\.\.headers \}/);
});

test("given Windows development, when planning processes, then both platform launchers are used", () => {
  // when
  const plans = processPlans(parseArguments(["dev"]), "win32");

  // then
  assert.equal(plans.backend.command, "cmd.exe");
  assert.match(plans.backend.args.at(-1), /^mvnw\.cmd spring-boot:run/);
  assert.equal(plans.frontend.command, "cmd.exe");
  assert.match(plans.frontend.args.at(-1), /^npm\.cmd --prefix frontend/);
  assert.equal(plans.backend.detached, false);
  assert.equal(plans.frontend.detached, false);
});

test("given POSIX development, when planning processes, then no command shell is introduced", () => {
  // when
  const plans = processPlans(parseArguments(["dev"]), "linux");

  // then
  assert.equal(plans.backend.command, "./mvnw");
  assert.equal(plans.frontend.command, "npm");
  assert.equal(plans.backend.detached, true);
  assert.equal(plans.frontend.detached, true);
});

function childProcess(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  return child;
}

test("given dev debug with suspend, when planning processes, then JDWP waits on loopback", () => {
  // when
  const options = parseArguments(["dev-debug", "--suspend"]);
  const plans = processPlans(options, "linux");

  // then
  assert.match(plans.backend.args.join(" "), /address=127\.0\.0\.1:5005/);
  assert.match(plans.backend.args.join(" "), /suspend=y/);
  assert.deepEqual(plans.frontend.args,
    ["--prefix", "frontend", "run", "dev", "--", "--host", "127.0.0.1"]);
});

test("given build and verify, when planning commands, then Maven remains the build entry point", () => {
  // when / then
  assert.deepEqual(processPlans(parseArguments(["build"]), "linux").single.args,
    ["package", "-DskipTests", "-Dfrontend.test.skip=true"]);
  assert.deepEqual(processPlans(parseArguments(["verify"]), "linux").single.args,
    ["clean", "verify"]);
});

test("given a local check, when parsing its options, then planning and escalation remain explicit", () => {
  // when
  const normal = parseArguments(["check"]);
  const planned = parseArguments(["check", "--plan"]);
  const full = parseArguments(["check", "--full"]);
  const rerun = parseArguments(["check", "--rerun"]);

  // then
  assert.equal(normal.planOnly, false);
  assert.equal(normal.forceFull, false);
  assert.equal(planned.planOnly, true);
  assert.equal(full.forceFull, true);
  assert.equal(rerun.rerun, true);
  assert.throws(() => parseArguments(["check", "--skip-verify"]), /Unknown option/);
});

test("given an unsupported argument, when parsing it, then it is rejected", () => {
  // when / then
  assert.throws(() => parseArguments(["dev", "--force"]), /Unknown option/);
});

test("given performance commands, when parsing them, then lifecycle and diagnosis options are explicit", () => {
  // when / then
  assert.equal(parseArguments(["perf"]).command, "perf");
  assert.equal(parseArguments(["perf", "--db-port"]).dbPort, true);
  assert.equal(parseArguments(["perf", "--telemetry"]).telemetry, true);
  assert.equal(parseArguments(["status", "perf"]).environment, "perf");
  assert.throws(() => parseArguments(["perf-reset", "wrong"]), /courtside-perf/);
  assert.equal(parseArguments(["perf-reset", "courtside-perf"]).confirm, "courtside-perf");
  assert.equal(parseArguments([
    "perf-promote", "build/performance/baseline/run/summary.json", "--confirm", "courtside-perf"
  ]).file, "build/performance/baseline/run/summary.json");
  assert.throws(() => parseArguments(["perf-promote", "summary.json"]), /--confirm courtside-perf/);
});

test("given security commands, when parsing them, then run identity and authorization stay explicit", () => {
  // when
  const plan = parseArguments(["security-plan", "run-0001", "active"]);
  const run = parseArguments([
    "security-run", "run-0001", "active", "--qualification", "qualification.json",
    "--authorize", "authorize-active-run-0001"
  ]);

  // then
  assert.equal(plan.runId, "run-0001");
  assert.equal(plan.profile, "active");
  assert.equal(run.authorization, "authorize-active-run-0001");
  assert.throws(() => parseArguments(["security-run", "run-0001", "active", "--qualification", "qualification.json"]),
    /--authorize/);
  assert.throws(() => parseArguments(["security-run", "run-0001", "safe"]), /--qualification/);
  assert.equal(parseArguments(["security-stop", "run-0001"]).runId, "run-0001");
  assert.equal(parseArguments(["security-report", "run-0001", "--attempt", "2"]).attempt, 2);
  assert.throws(() => parseArguments(["security-recover", "run-0001"]), /--attempt/);
  assert.throws(() => parseArguments(["security-reset", "run-0001", "--confirm", "wrong"]),
    /courtside-security-run-0001/);
});

test("given the performance environment, when its image is built, then Compose runs the fixture image", () => {
  // given
  const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");
  const compose = yaml.load(readFileSync(fileURLToPath(new URL("../deploy/compose.perf.yaml", import.meta.url)), "utf8"));

  // when
  const plans = performanceImagePlans();

  // then
  const served = plans.filter((plan) => plan.args.includes(compose.services.app.image));
  assert.equal(served.length, 1, "no image build produces what Compose runs");
  assert.ok(served[0].args.includes("Dockerfile.fixtures"), "Compose runs an image without the fixtures");
  assert.deepEqual(served[0].args.filter((argument) => argument.startsWith("BASE_IMAGE=")),
    [`BASE_IMAGE=${plans[0].args[plans[0].args.indexOf("-t") + 1]}`]);
});

test("given the performance environment, when its mail is handed over, then the relay is one it can reach", () => {
  // given
  const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");
  const compose = yaml.load(readFileSync(fileURLToPath(new URL("../deploy/compose.perf.yaml", import.meta.url)), "utf8"));
  const app = compose.services.app;

  // when
  const relay = compose.services[app.environment.COURTSIDE_MAIL_RELAY_HOST];

  // then
  assert.ok(relay, `the application hands its mail to ${app.environment.COURTSIDE_MAIL_RELAY_HOST}, which this stack does not run`);
  assert.ok(relay.networks.some((network) => app.networks.includes(network)),
    "the relay shares no network with the application");
  assert.match(relay.image, /^axllent\/mailpit:[^\s]+@sha256:[a-f0-9]{64}$/);
  assert.ok(relay.command.includes("--smtp-require-starttls"),
    "the application requires STARTTLS, so a relay without it refuses every message");
  assert.equal(app.environment.COURTSIDE_MAIL_RELAY_PORT, "1025");
  assert.equal(app.environment.COURTSIDE_MAIL_TRUST_RELAY_CERTIFICATE, "true");
  assert.equal(app.depends_on.mail.condition, "service_healthy",
    "the seed starts against a relay that is not listening yet, so its first messages wait on a retry");
});

test("given the performance documentation, when a run is read, then it states what the load pays for mail", () => {
  // given
  const documentation = readFileSync(fileURLToPath(new URL("../docs/performance-testing.md", import.meta.url)), "utf8");
  const compose = readFileSync(fileURLToPath(new URL("../deploy/compose.perf.yaml", import.meta.url)), "utf8");

  const tool = readFileSync(fileURLToPath(new URL("../tools/courtside.mjs", import.meta.url)), "utf8");

  // when
  const relay = compose.match(/image: axllent\/(mailpit):/)?.[1];
  const issued = tool.match(/perfMailDirectory = join\(root, "build", "([a-z-]+)"\)/)?.[1];
  const days = tool.match(/PERF_MAIL_CERTIFICATE_DAYS = (\d+);/)?.[1];

  // then
  assert.ok(relay, "the performance stack runs no Mailpit for the documentation to describe");
  assert.ok(issued, "the CLI issues the certificate somewhere this test cannot read");
  assert.match(documentation, new RegExp(relay, "i"),
    "the documentation does not name the relay a run is measured against");
  assert.match(documentation, new RegExp(`build/${issued}`),
    "the documentation names another place for the certificate than the CLI writes");
  assert.match(documentation, /STARTTLS/,
    "the documentation does not say the relay is reached over STARTTLS");
  assert.ok(days, "the CLI issues the certificate for a period this test cannot read");
  assert.match(documentation, new RegExp(`${days} days`),
    "the documentation states another life for the certificate than the CLI issues it for");
});

test("given a performance command other than the start, when it is planned, then it still defines the relay", () => {
  // given
  const compose = readFileSync(fileURLToPath(new URL("../deploy/compose.perf.yaml", import.meta.url)), "utf8");
  const source = readFileSync(fileURLToPath(new URL("./courtside.mjs", import.meta.url)), "utf8");
  const required = [...compose.matchAll(/\$\{(COURTSIDE_PERF_MAIL_[A-Z_]+):\?/g)].map((match) => match[1]);

  // when
  const plans = [lifecyclePlan("perf-stop", {}), lifecyclePlan("perf-logs", {}),
    lifecyclePlan("perf-db-shell", {}), perfResetPlan(), perfComposePlan(["ps"])];

  // then
  assert.ok(required.length > 0, "the compose file requires no relay variable at all");
  for (const plan of plans) {
    for (const name of required) {
      assert.ok(plan.environment?.[name], `${plan.args.at(-1)} leaves ${name} undefined`);
    }
  }
  const built = [...source.matchAll(/perfComposeArgs\(/g)];
  assert.equal(built.length, 2,
    "the arguments are built somewhere other than perfComposePlan, which is how a command comes to "
    + "interpolate the compose file without defining what it requires");
});

test("given the performance relay certificate, when it is issued, then it is owner-only and replaces the last one", {
  skip: process.platform === "win32"
}, () => {
  // given
  const parent = mkdtempSync(join(tmpdir(), "courtside-perf-mail-"));
  const directory = join(parent, "perf-mail");

  try {
    // when
    const first = performanceRelayCertificate(directory);
    writeFileSync(join(directory, "stale.pem"), "x");
    const second = performanceRelayCertificate(directory);

    // then
    assert.deepEqual(first, second);
    assert.deepEqual(first, performanceRelaySettings(directory));
    assert.equal(existsSync(join(directory, "stale.pem")), false, "a restart kept the last issue");
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(join(directory, "key.pem")).mode & 0o777, 0o600);
    assert.ok(existsSync(join(directory, "cert.pem")));
    const dates = spawnSync("openssl",
      ["x509", "-dates", "-noout", "-in", join(directory, "cert.pem")], { encoding: "utf8" });
    assert.equal(dates.status, 0, dates.stderr);
    const [notBefore, notAfter] = dates.stdout.trim().split("\n")
      .map((line) => Date.parse(line.replace(/^not(Before|After)=/, "")));
    assert.ok(notAfter - notBefore > 7 * 24 * 3600 * 1000,
      "the certificate expires under a stack that is left standing between runs");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("given automated performance startup, when suppressing credentials, then the password is absent from output", () => {
  // given
  const options = parseArguments(["perf", "--skip-verify", "--no-credential-output"]);

  // when
  const summary = performanceStartupSummary("not-for-logs", options);

  // then
  assert.equal(options.showCredentials, false);
  assert.match(summary, /Performance: https:\/\/localhost:9443/);
  assert.doesNotMatch(summary, /not-for-logs|shared password|Accounts:/);
});

test("given load profiles, when parsing execution, then manual runs require disposable confirmation", () => {
  // when / then
  assert.equal(parseArguments(["perf-run", "smoke"]).profile, "smoke");
  assert.equal(parseArguments(["perf-run", "baseline", "--confirm", "courtside-perf"]).profile, "baseline");
  assert.equal(parseArguments(["perf-run", "smoke", "--remote-write"]).remoteWrite, true);
  assert.equal(parseArguments(["perf-run", "browser", "--confirm", "courtside-perf"]).profile, "browser");
  assert.throws(() => parseArguments(["perf-run", "stress"]), /--confirm courtside-perf/);
  assert.throws(() => parseArguments(["perf-run", "soak", "--confirm", "courtside-perf"]), /--fresh/);
  assert.equal(parseArguments(["perf-run", "soak", "--confirm", "courtside-perf", "--fresh"]).fresh, true);
  assert.throws(() => parseArguments(["perf-run", "browser"]), /--confirm courtside-perf/);
});

test("given a Funnel smoke, when parsing execution, then the public target and explicit confirmation are mandatory", () => {
  // when
  const options = parseArguments([
    "perf-run", "funnel-smoke", "--target", "https://courtside.example.ts.net",
    "--confirm", "courtside-uat-funnel"
  ]);

  // then
  assert.equal(options.profile, "funnel-smoke");
  assert.equal(options.target, "https://courtside.example.ts.net");
  assert.throws(
    () => parseArguments(["perf-run", "funnel-smoke", "--target", "https://courtside.example.ts.net"]),
    /--confirm courtside-uat-funnel/
  );
  assert.throws(
    () => parseArguments(["perf-run", "funnel-smoke", "--confirm", "courtside-uat-funnel"]),
    /--target/
  );
  assert.throws(
    () => parseArguments([
      "perf-run", "funnel-smoke", "--target", "https://courtside.example.ts.net",
      "--confirm", "courtside-uat-funnel", "--remote-write"
    ]),
    /cannot use --remote-write/
  );
  assert.throws(
    () => parseArguments([
      "perf-run", "funnel-smoke", "--target", "https://courtside.example.ts.net",
      "--confirm", "courtside-uat-funnel", "--fresh"
    ]),
    /cannot use --fresh/
  );
  assert.throws(
    () => parseArguments(["perf-run", "smoke", "--target", "https://courtside.example.ts.net"]),
    /only valid for funnel-smoke/
  );
});

test("given a remote target, when validating it, then only a bare public HTTPS origin is accepted", () => {
  // when / then
  assert.equal(validateFunnelTarget("https://courtside.example.ts.net"), "https://courtside.example.ts.net");
  assert.throws(() => validateFunnelTarget("http://courtside.example.ts.net"), /HTTPS/);
  assert.throws(() => validateFunnelTarget("https://localhost"), /public hostname/);
  assert.throws(() => validateFunnelTarget("https://127.0.0.1"), /public hostname/);
  assert.throws(() => validateFunnelTarget("https://user:secret@courtside.example.ts.net"), /credentials/);
  assert.throws(() => validateFunnelTarget("https://courtside.example.ts.net/path"), /origin/);
  assert.throws(() => validateFunnelTarget("https://courtside.example.ts.net?target=other"), /origin/);
});

test("given resolved Funnel addresses, when validating them, then every address must be public", async () => {
  // given
  const publicResolver = async () => [
    { address: "203.0.114.10", family: 4 },
    { address: "2001:4860:4860::8888", family: 6 }
  ];
  const privateResolver = async () => [{ address: "127.0.0.1", family: 4 }];
  const mixedResolver = async () => [
    { address: "203.0.114.10", family: 4 },
    { address: "100.64.0.1", family: 4 }
  ];

  // when / then
  assert.deepEqual(await resolvePublicFunnelAddresses("courtside.example.org", publicResolver), [
    { address: "203.0.114.10", family: 4 },
    { address: "2001:4860:4860::8888", family: 6 }
  ]);
  await assert.rejects(resolvePublicFunnelAddresses("courtside.example.org", privateResolver), /public address/);
  await assert.rejects(resolvePublicFunnelAddresses("courtside.example.org", mixedResolver), /public address/);
  assert.throws(() => validatePublicAddress("::ffff:192.168.1.20"), /public address/);
  assert.throws(() => validatePublicAddress("fe80::1"), /public address/);
});

test("given a Funnel smoke, when planning k6, then no credentials, local trust, or target report is mounted", () => {
  // given
  const options = parseArguments([
    "perf-run", "funnel-smoke", "--target", "https://courtside.example.ts.net",
    "--confirm", "courtside-uat-funnel"
  ]);

  // when
  const plan = funnelPerformanceRunPlan(options, "/tmp/funnel-result", "test-run");

  // then
  assert.equal(plan.command, "docker");
  assert.ok(plan.args.includes("PERF_PROFILE=funnel-smoke"));
  assert.ok(plan.args.includes("PERF_TARGET=https://courtside.example.ts.net"));
  assert.ok(plan.args.includes("/scripts/funnel.js"));
  assert.ok(plan.args.includes("/tmp/funnel-result:/results"));
  assert.equal(plan.args.some((argument) => argument.includes("perf.json")), false);
  assert.equal(plan.args.some((argument) => argument.includes("root.crt")), false);
  assert.equal(plan.args.includes("K6_WEB_DASHBOARD_EXPORT=/results/report.html"), false);
  assert.equal(plan.args.includes("--add-host"), false);
  assert.ok(plan.args.includes("--log-output=none"));
});

test("given the browser profile, when planning k6, then Chromium and the browser journey are isolated", () => {
  // given
  const options = parseArguments(["perf-run", "browser", "--confirm", "courtside-perf"]);

  // when
  const plan = performanceRunPlan(options, "/tmp/performance-result", "/tmp/performance-root.crt", "test-run", "test-pin");

  // then
  assert.throws(
    () => performanceRunPlan(options, "/tmp/performance-result", "/tmp/performance-root.crt"),
    /verified target certificate pin/
  );
  assert.ok(plan.args.some((argument) => /^grafana\/k6:\S+-with-browser@sha256:[a-f0-9]{64}$/.test(argument)));
  assert.ok(plan.args.includes("/scripts/browser.js"));
  assert.ok(plan.args.includes("K6_BROWSER_HEADLESS=true"));
  assert.ok(plan.args.includes("HOME=/tmp"));
  const target = plan.args.find(argument => argument.startsWith("PERF_TARGET=")).slice("PERF_TARGET=".length);
  assert.equal(target, new URL(target).origin);
  if (process.platform !== "win32") assert.ok(plan.args.includes(containerIdentity()));
  assert.equal(plan.args[plan.args.indexOf("--network") + 1], "courtside-perf_load");
  assert.equal(plan.args.includes("--privileged"), false);
  assert.equal(plan.args.includes("seccomp=unconfined"), false);
  assert.ok(plan.args.includes("K6_BROWSER_ARGS=no-sandbox,ignore-certificate-errors-spki-list=test-pin"));
  assert.ok(plan.args.some((argument) => argument.includes("p(75)")));
});

test("given a headless browser profile, when planning its launcher, then isolate browser data without changing the journey or TLS pin", () => {
  // given
  const options = parseArguments(["perf-run", "browser", "--confirm", "courtside-perf"]);
  // when
  const plan = performanceRunPlan(options, "/results", "/root.crt", "test-run", "test-pin");
  const image = plan.args.findIndex(argument => /^grafana\/k6:.*-with-browser@sha256:/.test(argument));
  // then
  assert.equal(plan.args[plan.args.indexOf("--entrypoint") + 1], "/bin/sh");
  assert.ok(plan.args.includes("K6_BROWSER_EXECUTABLE_PATH=/tmp/courtside-browser-runtime/chromium"));
  assert.deepEqual(plan.args.slice(image + 1, image + 3), ["/scripts/browser-entrypoint.sh", "run"]);
  assert.ok(plan.args.includes("K6_BROWSER_ARGS=no-sandbox,ignore-certificate-errors-spki-list=test-pin"));
  assert.ok(plan.args.includes("/scripts/browser.js"));
});

test("given a protocol profile, when planning its runner, then leave its native k6 entrypoint unchanged", () => {
  // given
  const options = parseArguments(["perf-run", "baseline", "--confirm", "courtside-perf"]);
  // when
  const plan = performanceRunPlan(options, "/results", "/root.crt", "test-run");
  const image = plan.args.findIndex(argument => /^grafana\/k6:.*@sha256:/.test(argument));
  // then
  assert.equal(plan.args.includes("--entrypoint"), false);
  assert.equal(plan.args.some(argument => argument.startsWith("K6_BROWSER_EXECUTABLE_PATH=")), false);
  assert.equal(plan.args[image + 1], "run");
  assert.ok(plan.args.includes("/scripts/protocol.js"));
});

test("given distinct localhost and proxy certificates, when probing performance identity, then the browser target supplies the TLS pin", () => {
  // given
  const options = parseArguments(["perf-run", "browser", "--confirm", "courtside-perf"]);
  const plan = performanceRunPlan(options, "/results", "/root.crt", "test-run", "test-pin");
  const target = new URL(plan.args.find(argument => argument.startsWith("PERF_TARGET=")).slice("PERF_TARGET=".length));
  const ca = Buffer.from("private test authority");

  // when
  const request = performanceIdentityRequest(ca);

  // then
  assert.equal(request.servername, target.hostname);
  assert.equal(request.headers.Host, target.host);
  assert.equal(request.secure, true);
  assert.equal(request.port, 9443);
  assert.equal(request.path, "/api/source");
  assert.equal(request.ca, ca);
});

test("given a finished performance run, when planning its logs, then they can be captured without following", () => {
  // given
  const following = parseArguments(["perf-logs"]);
  const once = parseArguments(["perf-logs", "--no-follow"]);

  // when
  const followPlan = lifecyclePlan(following.command, following);
  const capturePlan = lifecyclePlan(once.command, once);

  // then
  assert.ok(followPlan.args.includes("--follow"));
  assert.equal(capturePlan.args.includes("--follow"), false);
  assert.ok(capturePlan.args.includes("--no-color"));
  assert.ok(capturePlan.args.includes("logs"));
});

test("given a local performance run, when planning k6, then its log is written beside the result", () => {
  // given
  const protocol = parseArguments(["perf-run", "peak", "--confirm", "courtside-perf"]);
  const browser = parseArguments(["perf-run", "browser", "--confirm", "courtside-perf"]);

  // when
  const protocolPlan = performanceRunPlan(protocol, "/tmp/performance-result", "/tmp/performance-root.crt");
  const browserPlan = performanceRunPlan(browser, "/tmp/performance-result", "/tmp/performance-root.crt", "test-run", "test-pin");

  // then
  for (const plan of [protocolPlan, browserPlan]) {
    assert.ok(plan.args.includes("--log-output=file=/results/k6.log"),
      "a failed run must leave its k6 log in the result directory, not only in a terminal");
    assert.ok(plan.args.indexOf("--log-output=file=/results/k6.log") > plan.args.indexOf("run"));
  }
});

test("given a finished performance run, when planning its container logs, then application, proxy and database are captured once", () => {
  // when
  const plan = performanceContainerLogPlan(7);

  // then
  assert.equal(plan.stdout, 7);
  assert.deepEqual(plan.args.slice(plan.args.indexOf("logs")), ["logs", "--no-color", "--timestamps", "app", "proxy", "db"]);
  assert.equal(plan.args.includes("--follow"), false);
});

test("given a private credentials file, when planning k6, then the container runs as the user that owns it", () => {
  // given
  const options = parseArguments(["perf-run", "peak", "--confirm", "courtside-perf"]);
  const funnel = parseArguments([
    "perf-run", "funnel-smoke", "--target", "https://courtside.example.ts.net",
    "--confirm", "courtside-uat-funnel"
  ]);

  // when
  const plan = performanceRunPlan(options, "/tmp/performance-result", "/tmp/performance-root.crt");
  const funnelPlan = funnelPerformanceRunPlan(funnel, "/tmp/funnel-result", "test-run");

  // then
  const expected = containerIdentity();
  assert.equal(plan.args[plan.args.indexOf("--user") + 1], expected);
  assert.equal(funnelPlan.args[funnelPlan.args.indexOf("--user") + 1], expected);
});

test("given a protocol profile, when planning k6, then the pinned image and isolated artifacts are used", () => {
  // given
  const options = parseArguments(["perf-run", "peak", "--confirm", "courtside-perf"]);

  // when
  const plan = performanceRunPlan(options, "/tmp/performance-result", "/tmp/performance-root.crt");

  // then
  assert.equal(plan.command, "docker");
  assert.ok(plan.args.some((argument) => /^grafana\/k6:[^-\s]+@sha256:[a-f0-9]{64}$/.test(argument)));
  assert.ok(plan.args.includes("PERF_PROFILE=peak"));
  assert.equal(plan.args.includes("HOME=/tmp"), false);
  assert.ok(plan.args.includes("PERF_RUN_ID=test-run"));
  assert.ok(plan.args.includes("PERF_TARGET=https://proxy"));
  assert.equal(plan.args[plan.args.indexOf("--network") + 1], "courtside-perf_load");
  assert.equal(plan.args.includes("--add-host"), false);
  assert.ok(plan.args.includes("/tmp/performance-result:/results"));
  assert.ok(plan.args.some((argument) => argument.endsWith(":/run/courtside/perf.json:ro")));
  assert.ok(plan.args.includes("K6_WEB_DASHBOARD_EXPORT=/results/report.html"));
  assert.ok(plan.args.includes("SSL_CERT_FILE=/certs/root.crt"));
  assert.ok(plan.args.includes("/tmp/performance-root.crt:/certs/root.crt:ro"));
  assert.deepEqual(plan.args.filter((argument) => argument === "--tag"), ["--tag", "--tag"]);
  assert.ok(plan.args.includes("testid=test-run"));
  assert.ok(plan.args.includes("profile=peak"));
  assert.equal(plan.args.includes("experimental-prometheus-rw"), false);
});

test("given remote write is selected, when planning k6, then Prometheus remains an optional secondary output", () => {
  // given
  const options = parseArguments(["perf-run", "smoke", "--remote-write"]);

  // when
  const plan = performanceRunPlan(options, "/tmp/performance-result", "/tmp/performance-root.crt");

  // then
  assert.ok(plan.args.includes("K6_PROMETHEUS_RW_SERVER_URL=http://prometheus:9090/api/v1/write"));
  assert.ok(plan.args.includes("experimental-prometheus-rw"));
  assert.ok(plan.args.includes("K6_WEB_DASHBOARD_EXPORT=/results/report.html"));
});

test("given raw k6 metrics, when building a result, then the performance schema metadata is retained", () => {
  // given
  const contract = JSON.parse(readFileSync(fileURLToPath(new URL("../performance/contract.json", import.meta.url))));
  const raw = {
    state: { testRunDurationMs: 60_400 },
    metrics: {
      iterations: { values: { count: 100 } },
      http_reqs: { values: { count: 300, rate: 5 } },
      technical_errors: { values: { rate: 0 }, thresholds: { "rate<0.01": { ok: true } } },
      unexpected_server_errors: { values: { count: 0 }, thresholds: { "count==0": { ok: true } } },
      read_only_api_duration: { thresholds: { "p(95)<500": { ok: true } } },
      login_duration: { thresholds: { "p(95)<750": { ok: true } } },
      booking_duration: { thresholds: { "p(95)<1000": { ok: true } } },
      booking_conflicts: { values: { count: 4 } },
      booking_conflict_rate: { values: { rate: 0.25 } },
      http_req_duration: { values: { "p(50)": 10, "p(90)": 20, "p(95)": 30, "p(99)": 40 } }
    }
  };

  // when
  const result = buildPerformanceResult({
    contract, contractDigest: `sha256:${"a".repeat(64)}`, source: { version: "1.2.3", commit: "abcdef0" },
    profileName: "smoke", startedAt: "2026-08-10T12:00:00.000Z", raw, platform: "darwin", architecture: "arm64",
    runner: { processorCount: 8, memoryMegabytes: 32768 }
  });

  // then
  assert.equal(result.build.applicationVersion, "1.2.3");
  assert.equal(result.profile.durationSeconds, 60);
  assert.deepEqual(result.runtime.runner, { processorCount: 8, memoryMegabytes: 32768 });
  assert.equal(result.metrics.throughputPerSecond, 5);
  assert.equal(result.metrics.bookingConflictRate, 0.25);
  assert.deepEqual(result.metrics.latencyMilliseconds, { p50: 10, p90: 20, p95: 30, p99: 40 });
  assert.deepEqual(result.thresholds, { technicalErrorRate: true, unexpectedServerErrors: true });
});

test("given raw browser metrics, when building a result, then p75 Web Vitals and journey evidence are retained", () => {
  // given
  const contract = JSON.parse(readFileSync(fileURLToPath(new URL("../performance/contract.json", import.meta.url))));
  const metric = (value, ok = true) => ({ values: value, thresholds: { budget: { ok } } });
  const raw = {
    state: { testRunDurationMs: 90_000 },
    metrics: {
      iterations: { values: { count: 5 } },
      browser_http_req_duration: { values: { "p(50)": 20, "p(90)": 40, "p(95)": 50, "p(99)": 70 } },
      browser_requests: { values: { count: 50, rate: 0.55 } },
      browser_web_vital_lcp: metric({ "p(75)": 1200 }),
      browser_web_vital_inp: metric({ "p(75)": 80 }),
      browser_web_vital_cls: metric({ "p(75)": 0.03 }),
      browser_errors: metric({ count: 0 }),
      browser_journey_success: metric({ rate: 1 }),
      browser_journey_duration: { values: { count: 5, avg: 1800 } },
      technical_errors: metric({ rate: 0 }),
      unexpected_server_errors: metric({ count: 0 })
    }
  };

  // when
  const result = buildPerformanceResult({
    contract, contractDigest: `sha256:${"a".repeat(64)}`, source: { version: "1.2.3", commit: "abcdef0" },
    profileName: "browser", startedAt: "2026-08-10T12:00:00.000Z", raw, platform: "linux", architecture: "x64",
    runner: { processorCount: 4, memoryMegabytes: 8192 }
  });

  // then
  assert.deepEqual(result.thresholds, {
    technicalErrorRate: true, unexpectedServerErrors: true, webVitals: true, browserErrors: true,
    browserJourney: true
  });
  assert.deepEqual(result.metrics.webVitals, {
    percentile: 75, lcpMilliseconds: 1200, inpMilliseconds: 80, cls: 0.03
  });
  assert.equal(result.metrics.browserErrors, 0);
  assert.equal(result.metrics.browserJourneyMilliseconds, 1800);
});

test("given a Funnel summary, when building a result, then UAT read-only evidence contains no target", () => {
  // given
  const contract = JSON.parse(readFileSync(fileURLToPath(new URL("../performance/contract.json", import.meta.url))));
  const raw = {
    state: { testRunDurationMs: 120_000 },
    metrics: {
      iterations: { values: { count: 200 } },
      http_reqs: { values: { count: 2200, rate: 18.3 } },
      technical_errors: { values: { rate: 0 }, thresholds: { "rate<0.01": { ok: true } } },
      unexpected_server_errors: { values: { count: 0 }, thresholds: { "count==0": { ok: true } } },
      read_only_api_duration: {
        values: { "p(50)": 20, "p(90)": 30, "p(95)": 40, "p(99)": 50 },
        thresholds: { "p(95)<500": { ok: true }, "p(99)<1000": { ok: true } }
      },
      http_req_duration: { values: { "p(50)": 20, "p(90)": 30, "p(95)": 40, "p(99)": 50 } }
    }
  };

  // when
  const result = buildPerformanceResult({
    contract, contractDigest: `sha256:${"a".repeat(64)}`,
    source: { version: "1.2.3", commit: "abcdef0", environment: "UAT" },
    profileName: "funnel-smoke", startedAt: "2026-08-10T12:00:00.000Z", raw,
    platform: "darwin", architecture: "arm64", runner: { processorCount: 8, memoryMegabytes: 32768 }
  });

  // then
  assert.equal(result.profile.target, "funnel");
  assert.equal(result.profile.environment, "UAT");
  assert.equal(result.load.readShare, 1);
  assert.equal(result.load.writeShare, 0);
  assert.equal(result.thresholds.readOnlyApi, true);
  assert.equal("bookingConflicts" in result.metrics, false);
  assert.deepEqual(result.profile, {
    name: "funnel-smoke",
    workload: "reference",
    target: "funnel",
    environment: "UAT",
    startedAt: "2026-08-10T12:00:00.000Z",
    durationSeconds: 120
  });
  assert.doesNotThrow(() => validatePerformanceResult(result));
});

test("given an approved result, when planning baseline promotion, then its versioned path contains no machine data", () => {
  // given
  const result = passingPerformanceResult();

  // when
  const baseline = performanceBaselinePlan(result, result.contract.digest);

  // then
  assert.equal(baseline.relativePath, "performance/baselines/baseline/1.2.3-abcdef0.json");
  assert.equal(JSON.parse(baseline.content).build.gitCommit, "abcdef0");
});

test("given approved browser and soak results, when promoting references, then each profile has an immutable path", () => {
  // given
  const browser = passingBrowserPerformanceResult();
  const soak = passingPerformanceResult();
  soak.profile.name = "soak";

  // when
  const browserBaseline = performanceBaselinePlan(browser, browser.contract.digest);
  const soakBaseline = performanceBaselinePlan(soak, soak.contract.digest);

  // then
  assert.equal(browserBaseline.relativePath, "performance/baselines/browser/1.2.3-abcdef0.json");
  assert.equal(soakBaseline.relativePath, "performance/baselines/soak/1.2.3-abcdef0.json");
});

test("given a failed or stale result, when planning baseline promotion, then it is rejected", () => {
  // given
  const failed = passingPerformanceResult();
  failed.thresholds.booking = false;
  const stale = passingPerformanceResult();
  const smoke = passingPerformanceResult();
  smoke.profile.name = "smoke";

  // when / then
  assert.throws(() => performanceBaselinePlan(failed, failed.contract.digest), /thresholds/);
  assert.throws(() => performanceBaselinePlan(stale, `sha256:${"b".repeat(64)}`), /contract/);
  assert.throws(() => performanceBaselinePlan(smoke, smoke.contract.digest), /reference/);
});

test("given comparable results, when latency or throughput exceeds the policy, then owned findings are reported", () => {
  // given
  const baseline = passingPerformanceResult();
  const candidate = structuredClone(baseline);
  candidate.build = { applicationVersion: "1.2.4", gitCommit: "bcdef01" };
  candidate.metrics.latencyMilliseconds.p95 = 36;
  candidate.metrics.throughputPerSecond = 4.4;

  // when
  const comparison = comparePerformanceResults(candidate, baseline, baseline.contract.digest);

  // then
  assert.equal(comparison.status, "regression");
  assert.deepEqual(comparison.findings.map(({ metric, severity, owner }) => ({ metric, severity, owner })), [
    { metric: "latencyMilliseconds.p95", severity: "high", owner: "Performance maintainer" },
    { metric: "throughputPerSecond", severity: "high", owner: "Performance maintainer" }
  ]);
  assert.doesNotMatch(JSON.stringify(comparison), /startedAt|target|environment/);
});

test("given results from different execution conditions, when comparing them, then comparison fails closed", () => {
  // given
  const baseline = passingPerformanceResult();
  const candidate = structuredClone(baseline);
  candidate.runtime.runner.processorCount = 8;

  // when / then
  assert.throws(() => comparePerformanceResults(candidate, baseline, baseline.contract.digest), /runner/);
});

test("given results with different observed durations, when comparing them, then comparison fails closed", () => {
  // given
  const baseline = passingPerformanceResult();
  const candidate = structuredClone(baseline);
  candidate.profile.durationSeconds += 1;

  // when / then
  assert.throws(() => comparePerformanceResults(candidate, baseline, baseline.contract.digest), /profile/);
});

test("given a stale or failed baseline, when comparing a candidate, then it cannot hide a regression", () => {
  // given
  const candidate = passingPerformanceResult();
  const stale = structuredClone(candidate);
  stale.contract.digest = `sha256:${"b".repeat(64)}`;
  const failed = structuredClone(candidate);
  failed.thresholds.booking = false;

  // when / then
  assert.throws(() => comparePerformanceResults(candidate, stale, candidate.contract.digest), /contract/);
  assert.throws(() => comparePerformanceResults(candidate, failed, candidate.contract.digest), /thresholds/);
  assert.throws(() => comparePerformanceResults(candidate, candidate, `sha256:${"c".repeat(64)}`), /contract/);
});

test("given a candidate with a failed contract threshold, when comparing it, then the result is a regression", () => {
  // given
  const baseline = passingPerformanceResult();
  const candidate = structuredClone(baseline);
  candidate.thresholds.booking = false;

  // when
  const comparison = comparePerformanceResults(candidate, baseline, baseline.contract.digest);

  // then
  assert.equal(comparison.status, "regression");
  assert.equal(comparison.findings[0].metric, "thresholds.booking");
});

test("given performance evidence files, when parsing comparison, then baseline and output are explicit", () => {
  // when
  const options = parseArguments([
    "perf-compare", "build/performance/candidate.json", "--baseline", "performance/baselines/baseline/reference.json",
    "--output", "build/performance/comparison.json"
  ]);

  // then
  assert.equal(options.file, "build/performance/candidate.json");
  assert.equal(options.baseline, "performance/baselines/baseline/reference.json");
  assert.equal(options.output, "build/performance/comparison.json");
});

test("given an existing credential file, when rewriting it on POSIX, then owner-only mode is restored", () => {
  // given
  const calls = [];
  const filesystem = {
    mkdirSync: (...args) => calls.push(["mkdir", ...args]),
    writeFileSync: (...args) => calls.push(["write", ...args]),
    chmodSync: (...args) => calls.push(["chmod", ...args])
  };

  // when
  writePrivateFile("build/perf-environment.json", "{}\n", "linux", filesystem);

  // then
  assert.deepEqual(calls.map((call) => call[0]), ["mkdir", "write", "chmod"]);
  assert.deepEqual(calls.at(-1), ["chmod", "build/perf-environment.json", 0o600]);
});

test("given Windows credential storage, when writing state, then unsupported POSIX chmod is skipped", () => {
  // given
  const calls = [];
  const filesystem = {
    mkdirSync: () => calls.push("mkdir"),
    writeFileSync: () => calls.push("write"),
    chmodSync: () => calls.push("chmod")
  };

  // when
  writePrivateFile("build/perf-environment.json", "{}\n", "win32", filesystem);

  // then
  assert.deepEqual(calls, ["mkdir", "write"]);
});

test("given performance lifecycle commands, when planning them, then only the performance project is targeted", () => {
  // when
  const privateArgs = perfComposeArgs(false);
  const exposedArgs = perfComposeArgs(true);
  const telemetryArgs = perfComposeArgs(false, true);
  const reset = perfResetPlan();

  // then
  assert.ok(privateArgs.includes("courtside-perf"));
  assert.equal(privateArgs.some((argument) => argument.endsWith("compose.perf-db.yaml")), false);
  assert.equal(exposedArgs.some((argument) => argument.endsWith("compose.perf-db.yaml")), true);
  assert.equal(telemetryArgs.some((argument) => argument.endsWith("compose.perf-telemetry.yaml")), true);
  assert.deepEqual(reset.args.slice(-3), ["down", "--volumes", "--remove-orphans"]);
  assert.ok(reset.args.includes("courtside-perf"));
});

test("given telemetry was previously enabled, when starting without it, then orphaned collectors are removed", () => {
  // given
  const source = readFileSync(fileURLToPath(new URL("./courtside.mjs", import.meta.url)), "utf8");

  // when / then
  assert.match(source, /dbPort: options\.dbPort, telemetry: options\.telemetry.*--remove-orphans/s);
});

test("given the performance compose contract, when inspecting isolation, then resources and ports are bounded", () => {
  // given
  const compose = readFileSync(fileURLToPath(new URL("../deploy/compose.perf.yaml", import.meta.url)), "utf8");
  const databaseOverride = readFileSync(fileURLToPath(new URL("../deploy/compose.perf-db.yaml", import.meta.url)), "utf8");
  const telemetryOverride = readFileSync(fileURLToPath(new URL("../deploy/compose.perf-telemetry.yaml", import.meta.url)), "utf8");
  const prometheus = readFileSync(fileURLToPath(new URL("../deploy/prometheus.perf.yaml", import.meta.url)), "utf8");
  const postgresQueries = readFileSync(fileURLToPath(new URL("../deploy/postgres-exporter.perf.yaml", import.meta.url)), "utf8");
  const dashboard = readFileSync(fileURLToPath(new URL("../deploy/grafana/performance-dashboard.json", import.meta.url)), "utf8");

  // when / then
  assert.match(compose, /^name: courtside-perf/m);
  assert.match(composeService(compose, "app"), /cpus: 3\.0/);
  assert.match(composeService(compose, "app"), /mem_limit: 1g/);
  assert.match(composeService(compose, "db"), /cpus: 2\.0/);
  assert.match(composeService(compose, "db"), /mem_limit: 2g/);
  assert.doesNotMatch(composeService(compose, "db"), /ports:/);
  assert.match(databaseOverride, /127\.0\.0\.1:5434:5432/);
  assert.match(compose, /SPRING_PROFILES_ACTIVE: perf/);
  assert.match(compose, /COURTSIDE_PERF_CONFIRM_DISPOSABLE: "true"/);
  assert.match(compose, /COURTSIDE_ENVIRONMENT: PERFORMANCE/);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{COURTSIDE_PERF_SHARED_PASSWORD:-\}/);
  assert.match(telemetryOverride, /prom\/prometheus:[^\s]+@sha256:[a-f0-9]{64}/);
  assert.match(telemetryOverride, /prometheuscommunity\/postgres-exporter:[^\s]+@sha256:[a-f0-9]{64}/);
  assert.match(telemetryOverride, /grafana\/grafana:[^\s]+@sha256:[a-f0-9]{64}/);
  assert.match(composeService(telemetryOverride, "app"), /COURTSIDE_PERF_TELEMETRY_ENABLED: "true"/);
  assert.match(composeService(telemetryOverride, "prometheus"), /127\.0\.0\.1:9090:9090/);
  assert.doesNotMatch(composeService(telemetryOverride, "postgres-exporter"), /ports:/);
  assert.match(prometheus, /app:9091/);
  assert.match(prometheus, /postgres-exporter:9187/);
  assert.match(postgresQueries, /FROM pg_locks/);
  assert.match(dashboard, /http_server_requests_seconds/);
  assert.match(dashboard, /hikaricp_connections_active/);
  assert.match(dashboard, /pg_stat_database_numbackends/);
  assert.match(dashboard, /k6_http_req_duration/);
  const caddy = readFileSync(fileURLToPath(new URL("../deploy/Caddyfile.perf", import.meta.url)), "utf8");
  assert.match(caddy, /^https:\/\/localhost:443, https:\/\/proxy:443 \{$/m);
});

test("given performance telemetry, when inspecting collectors, then budgets and plugin startup are bounded", () => {
  // given
  const compose = readFileSync(fileURLToPath(new URL("../deploy/compose.perf-telemetry.yaml", import.meta.url)), "utf8");

  // when
  const prometheus = composeService(compose, "prometheus");
  const grafana = composeService(compose, "grafana");
  const exporter = composeService(compose, "postgres-exporter");

  // then
  assert.match(prometheus, /cpus: 1\.0/);
  assert.match(prometheus, /mem_limit: 2g/);
  assert.match(prometheus, /memswap_limit: 2g/);
  assert.match(grafana, /cpus: 0\.5/);
  assert.match(grafana, /mem_limit: 512m/);
  assert.match(grafana, /\/tmp:size=256m,mode=1777/);
  assert.match(grafana, /GF_PLUGINS_PREINSTALL_SYNC: prometheus/);
  assert.match(grafana, /GF_PLUGINS_PREINSTALL_AUTO_UPDATE: "false"/);
  assert.match(grafana, /read_only: true/);
  assert.doesNotMatch(grafana, /GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS/);
  assert.match(exporter, /cpus: 0\.25/);
  assert.match(exporter, /mem_limit: 128m/);
});

test("given development modes, when validating ports, then debug adds only its listener", () => {
  // when / then
  assert.deepEqual(requiredPorts(parseArguments(["dev"])), [5432, 8080, 5173, 8082]);
  assert.deepEqual(requiredPorts(parseArguments(["dev-debug"])), [5432, 8080, 5173, 8082, 5005]);
});

test("given retained development containers, when validating ports, then their listeners are reused", () => {
  // given
  const runningServices = new Set(["db", "api-ui", "api-proxy"]);

  // when / then
  assert.deepEqual(requiredPorts(parseArguments(["dev"]), runningServices), [8080, 5173]);
  assert.deepEqual(requiredPorts(parseArguments(["dev-debug"]), runningServices), [8080, 5173, 5005]);
});

test("given local API tooling, when reading deployment contracts, then Swagger UI stays out of production", () => {
  // given
  const devCompose = readFileSync(fileURLToPath(new URL("../deploy/compose.dev.yaml", import.meta.url)), "utf8");
  const uatCompose = readFileSync(fileURLToPath(new URL("../deploy/compose.uat.yaml", import.meta.url)), "utf8");
  const uatCaddy = readFileSync(fileURLToPath(new URL("../deploy/Caddyfile.uat", import.meta.url)), "utf8");
  const deployment = fileURLToPath(new URL("../deploy/", import.meta.url));
  const base = readFileSync(`${deployment}compose.yaml`, "utf8");
  const components = [...base.matchAll(/^  - (compose[\w.-]+\.yaml)$/gm)].map((match) => match[1]);
  const productionCompose = [base, ...components.map((name) => readFileSync(`${deployment}${name}`, "utf8"))].join("\n");

  // when / then
  assert.match(devCompose, /swaggerapi\/swagger-ui:[^\s]+@sha256:/);
  assert.match(uatCompose, /swaggerapi\/swagger-ui:[^\s]+@sha256:/);
  assert.match(devCompose, /SWAGGER_JSON_URL: \/api\/openapi\.yaml/);
  assert.match(uatCompose, /SWAGGER_JSON_URL: \/api\/openapi\.yaml/);
  assert.match(uatCaddy, /\/api-ui/);
  assert.ok(components.includes("compose.caddy.yaml"), "the production components were not read");
  assert.doesNotMatch(productionCompose, /swagger|api-ui/i);
});

test("given local API tooling, when reading its container boundaries, then Swagger cannot reach PostgreSQL", () => {
  // given
  const devCompose = readFileSync(fileURLToPath(new URL("../deploy/compose.dev.yaml", import.meta.url)), "utf8");
  const uatCompose = readFileSync(fileURLToPath(new URL("../deploy/compose.uat.yaml", import.meta.url)), "utf8");

  // when / then
  for (const compose of [devCompose, uatCompose]) {
    assert.match(composeService(compose, "db"), /networks:\n      - backend/);
    assert.doesNotMatch(composeService(compose, "db"), /frontend/);
    assert.match(composeService(compose, "api-ui"), /user: "101:101"/);
    assert.match(composeService(compose, "api-ui"), /no-new-privileges:true/);
    assert.match(composeService(compose, "api-ui"), /cap_drop:\n      - ALL/);
    assert.match(composeService(compose, "api-ui"), /networks:\n      - frontend/);
    assert.doesNotMatch(composeService(compose, "api-ui"), /backend/);
  }
  assert.match(composeService(uatCompose, "app"), /networks:\n      - backend\n      - frontend/);
  assert.match(composeService(uatCompose, "proxy"), /networks:\n      - frontend/);
});

test("given the local API collection, when reading tracked requests, then secrets stay runtime-only", () => {
  // given
  const collection = readFileSync(fileURLToPath(new URL("../bruno/bruno.json", import.meta.url)), "utf8");
  const devEnvironment = readFileSync(fileURLToPath(new URL("../bruno/environments/Dev.bru", import.meta.url)), "utf8");
  const uatEnvironment = readFileSync(fileURLToPath(new URL("../bruno/environments/UAT.bru", import.meta.url)), "utf8");
  const csrfRequest = readFileSync(fileURLToPath(new URL("../bruno/02 Authentication/01 Get session and CSRF token.bru", import.meta.url)), "utf8");
  const loginRequest = readFileSync(fileURLToPath(new URL("../bruno/02 Authentication/02 Log in.bru", import.meta.url)), "utf8");

  // when / then
  assert.match(collection, /"name": "Courtside local API"/);
  assert.match(devEnvironment, /baseUrl: http:\/\/127\.0\.0\.1:8082/);
  assert.match(uatEnvironment, /baseUrl: https:\/\/localhost:8443/);
  assert.doesNotMatch(`${devEnvironment}\n${uatEnvironment}`, /password|token/i);
  assert.match(csrfRequest, /bru\.setVar\("csrfToken"/);
  assert.match(csrfRequest, /\^__Host-XSRF-TOKEN=/);
  assert.match(csrfRequest, /\^XSRF-TOKEN=/);
  assert.match(loginRequest, /\^__Host-XSRF-TOKEN=/);
  assert.match(loginRequest, /\^XSRF-TOKEN=/);
  assert.match(loginRequest, /X-XSRF-TOKEN: \{\{csrfToken\}\}/);
  assert.match(loginRequest, /username: \{\{username\}\}/);
  assert.match(loginRequest, /password: \{\{password\}\}/);
});

test("given UAT source options, when parsing them, then verification and database exposure are explicit", () => {
  // when
  const options = parseArguments(["uat", "--skip-verify", "--db-port"]);

  // then
  assert.equal(options.skipVerify, true);
  assert.equal(options.dbPort, true);
  assert.equal(options.version, undefined);
});

test("given an explicit UAT share command, when parsing it, then detached exposure is impossible", () => {
  // when / then
  assert.equal(parseArguments(["uat", "share"]).command, "uat-share");
  assert.throws(() => parseArguments(["uat", "share", "--detach"]), /Unknown option/);
});

test("given a connected Funnel-capable node, when parsing its status, then sharing prerequisites are known", () => {
  // given
  const status = JSON.stringify({
    BackendState: "Running",
    Self: {
      ID: "node-example",
      DNSName: "uat.example.ts.net.",
      CapMap: {
        "https://tailscale.com/cap/funnel-ports?ports=443,8443,10000": null,
        "https": null
      }
    }
  });

  // when / then
  assert.deepEqual(parseTailscaleNodeStatus(status), {
    connected: true,
    nodeId: "node-example",
    dnsName: "uat.example.ts.net",
    funnelCapable: true,
    httpsCapable: true
  });
});

test("given a foreign Funnel handler, when classifying it, then Courtside cannot claim ownership", () => {
  // given
  const status = JSON.stringify({
    TCP: { "443": { HTTPS: true } },
    Web: {
      "uat.example.ts.net:443": {
        Handlers: { "/foreign-service": { Proxy: "http://127.0.0.1:19090/foreign-service" } }
      }
    },
    AllowFunnel: { "uat.example.ts.net:443": true }
  });

  // when / then
  const funnel = classifyFunnelConfig(status);
  assert.deepEqual(funnel, { ownership: "foreign" });
  assert.throws(() => assertFunnelShareable(funnel), /left it unchanged/);
});

test("given the exact Courtside Funnel handler without a marker, when classifying it, then it remains unclaimed", () => {
  // given
  const status = JSON.stringify({
    TCP: { "443": { HTTPS: true } },
    Web: {
      "uat.example.ts.net:443": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:8083" } }
      }
    },
    AllowFunnel: { "uat.example.ts.net:443": true }
  });

  // when / then
  assert.deepEqual(classifyFunnelConfig(status), {
    ownership: "unclaimed",
    publicUrl: "https://uat.example.ts.net/"
  });
  assert.throws(() => assertFunnelShareable(classifyFunnelConfig(status)), /left it unchanged/);
});

test("given the exact Courtside Funnel handler and marker, when classifying it, then ownership is node-bound", () => {
  // given
  const status = JSON.stringify({
    TCP: { "443": { HTTPS: true } },
    Web: {
      "uat.example.ts.net:443": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:8083" } }
      }
    },
    AllowFunnel: { "uat.example.ts.net:443": true }
  });
  const marker = { target: "http://127.0.0.1:8083", nodeId: "node-example" };

  // when / then
  assert.deepEqual(classifyFunnelConfig(status, marker, "node-example"), {
    ownership: "courtside",
    publicUrl: "https://uat.example.ts.net/"
  });
  assert.equal(classifyFunnelConfig(status, marker, "other-node").ownership, "unclaimed");
  assert.deepEqual(classifyFunnelConfig("{}"), { ownership: "none" });
});

test("given a public UAT target, when planning Funnel, then it stays attached to the CLI", () => {
  // when
  const plan = funnelPlan("tailscale");

  // then
  assert.deepEqual(plan, {
    command: "tailscale",
    args: ["funnel", "--yes", "--https=443", "http://127.0.0.1:8083"]
  });
  assert.equal(plan.args.includes("--bg"), false);
});

test("given Funnel ownership, when planning cleanup, then only Courtside can be reset", () => {
  // when / then
  assert.deepEqual(funnelResetPlan("tailscale", { ownership: "courtside" }), {
    command: "tailscale",
    args: ["funnel", "reset"]
  });
  assert.equal(funnelResetPlan("tailscale", { ownership: "none" }), undefined);
  assert.equal(funnelResetPlan("tailscale", { ownership: "unclaimed" }), undefined);
  assert.throws(() => funnelResetPlan("tailscale", { ownership: "foreign" }, true), /not reset/);
  assert.throws(() => funnelResetPlan("tailscale", { ownership: "unclaimed" }, true), /not reset/);
});

test("given an attached Funnel session, when interrupted, then it is stopped and cleaned up", async () => {
  // given
  const signals = new EventEmitter();
  const child = new EventEmitter();
  child.kill = () => child.emit("exit", 0);
  const cleaned = [];

  // when
  const sharing = superviseFunnel(funnelPlan("tailscale"), {
    spawn: () => child,
    signals,
    cleanup: () => cleaned.push(true),
    platform: "linux"
  });
  child.emit("spawn");
  signals.emit("SIGINT");
  await sharing;

  // then
  assert.deepEqual(cleaned, [true]);
});

test("given a published UAT version, when parsing it, then only an image-safe tag is accepted", () => {
  // when / then
  assert.equal(parseArguments(["uat", "--version", "1.2.3"]).version, "1.2.3");
  assert.throws(() => parseArguments(["uat", "--version", "latest;whoami"]), /Invalid image version/);
});

test("given automated UAT startup, when suppressing credentials, then the password is absent from output", () => {
  // given
  const options = parseArguments(["uat", "--version", "1.2.3", "--no-credential-output"]);

  // when
  const summary = uatStartupSummary("not-for-logs", true, options);

  // then
  assert.equal(options.showCredentials, false);
  assert.match(summary, /UAT: https:\/\/localhost:8443/);
  assert.doesNotMatch(summary, /not-for-logs|one-time password/);
});

test("given the release qualification smoke, when starting UAT, then credential output is disabled", () => {
  // given
  const smoke = readFileSync(fileURLToPath(new URL("./courtside.uat-smoke.mjs", import.meta.url)), "utf8");

  // when / then
  assert.match(smoke, /startArguments = \["uat", "--no-credential-output"/);
  assert.ok(smoke.indexOf("confirmation.join") < smoke.indexOf("uatSmokeEnvironment(version,"));
  assert.match(smoke, /: uatSmokeEnvironment\(version, selectedEnvironment\)/);
  assert.match(smoke, /run\("docker", \[\.\.\.compose, \.\.\.args\], \{ environment: smokeEnvironment \}\)/);
  assert.match(smoke, /resetPassword = newBootstrapPassword\(\)/);
  assert.match(smoke, /smokeEnvironment\.COURTSIDE_UAT_ADMIN_PASSWORD = resetPassword/);
  assert.match(smoke, /password, permanentPassword, resetPassword, plaintextCredential/);
  assert.match(smoke,
    /catch \(failure\) \{[\s\S]*redactUatDiagnostics\([\s\S]*writeFileSync\(join\(build, "container-logs\.txt"\)[\s\S]*throw failure;/);
  assert.match(smoke, /localCa = composeRun\("exec", "-T", "proxy", "cat"/);
  assert.ok(smoke.split("\n").filter((line) => line.includes("secure: true"))
    .every((line) => line.includes("ca: localCa")));
});

test("given a published UAT image, when the smoke resets its project, then every start keeps the same digest", () => {
  // given
  const source = { GITHUB_REPOSITORY: "example-club/courtside", UNRELATED: "retained" };
  const version = `nightly-candidate@sha256:${"a".repeat(64)}`;

  // when
  const environment = uatSmokeEnvironment(version, source, () => undefined);
  const beforeReset = { ...environment };
  environment.COURTSIDE_UAT_ADMIN_PASSWORD = "second-bootstrap";
  const afterReset = { ...environment };

  // then
  assert.notEqual(environment, source);
  assert.equal(source.COURTSIDE_UAT_IMAGE, undefined);
  assert.equal(beforeReset.COURTSIDE_UAT_IMAGE,
    `ghcr.io/example-club/courtside:nightly-candidate@sha256:${"a".repeat(64)}`);
  assert.equal(afterReset.COURTSIDE_UAT_IMAGE, beforeReset.COURTSIDE_UAT_IMAGE);
  assert.equal(afterReset.UNRELATED, "retained");
});

test("given failed UAT logs, when diagnostics are retained, then credentials and encoded canaries are redacted", () => {
  // given
  const password = "p@ss word";
  const cookie = "cookie%2Fvalue";

  // when
  const diagnostics = redactUatDiagnostics(
    `safe password=${password} encoded=${encodeURIComponent(password)} cookie=${cookie} decoded=cookie/value`,
    [password, cookie]
  );

  // then
  assert.equal(diagnostics,
    "safe password=[REDACTED] encoded=[REDACTED] cookie=[REDACTED] decoded=[REDACTED]");
});

test("given UAT status, when parsing output options, then the environment is retained", () => {
  // when
  const options = parseArguments(["status", "uat", "--json"]);

  // then
  assert.equal(options.environment, "uat");
  assert.equal(options.json, true);
});

test("given destructive UAT commands, when confirmation differs, then they are rejected", () => {
  // when / then
  assert.throws(() => parseArguments(["uat-reset", "uat"]), /exact project name/);
  assert.throws(() => parseArguments(["uat-restore", "backup.dump", "--confirm", "uat"]), /requires a file/);
  assert.equal(parseArguments(["uat-reset", "courtside-uat", "--all"]).all, true);
});

test("given optional UAT database access, when composing the project, then the port override is opt in", () => {
  // when
  const privateArgs = uatComposeArgs();
  const exposedArgs = uatComposeArgs(true);

  // then
  assert.equal(privateArgs.some((argument) => argument.endsWith("compose.uat-db.yaml")), false);
  assert.equal(exposedArgs.some((argument) => argument.endsWith("compose.uat-db.yaml")), true);
  assert.ok(exposedArgs.includes("courtside-uat"));
});

test("given UAT lifecycle commands, when planning them, then they target only the UAT project", () => {
  // when
  const stop = lifecyclePlan("uat-stop");
  const shell = lifecyclePlan("uat-db-shell");

  // then
  assert.ok(stop.args.includes("courtside-uat"));
  assert.deepEqual(stop.args.slice(-1), ["stop"]);
  assert.deepEqual(shell.args.slice(-6), ["exec", "db", "psql", "-U", "courtside", "courtside"]);
});

test("given UAT persistence, when reading its Compose contract, then data, CA, TLS, and database exposure are separated", () => {
  // given
  const compose = readFileSync(fileURLToPath(new URL("../deploy/compose.uat.yaml", import.meta.url)), "utf8");
  const databaseOverride = readFileSync(fileURLToPath(new URL("../deploy/compose.uat-db.yaml", import.meta.url)), "utf8");
  const caddy = readFileSync(fileURLToPath(new URL("../deploy/Caddyfile.uat", import.meta.url)), "utf8");
  const localCaddy = caddy.slice(0, caddy.indexOf("http://:8083"));

  // when / then
  assert.match(compose, /COURTSIDE_COOKIE_SECURE: "true"/);
  assert.match(compose, /COURTSIDE_ENVIRONMENT: UAT/);
  assert.match(compose, /postgres:18-alpine@sha256:[a-f0-9]{64}/);
  assert.match(compose, /caddy:2-alpine@sha256:[a-f0-9]{64}/);
  assert.match(compose, /COURTSIDE_UAT_ADMIN_PASSWORD/);
  assert.doesNotMatch(compose, /courtside-admin/);
  assert.doesNotMatch(compose, /5433:5432/);
  assert.match(databaseOverride, /127\.0\.0\.1:5433:5432/);
  assert.match(compose, /caddy-data:\/data/);
  assert.match(compose, /db:\/var\/lib\/postgresql$/m);
  assert.match(caddy, /auto_https disable_redirects/);
  assert.match(caddy, /method GET HEAD/);
  assert.match(caddy, /path \/ \/courts \/login/);
  assert.match(caddy, /redir https:\/\/localhost:\{\$COURTSIDE_UAT_HTTPS_PORT:8443\}\{uri\} permanent/);
  assert.match(caddy, /respond "Plain HTTP is not accepted\." 400/);
  assert.doesNotMatch(caddy, /auto_https (?:off|disable_certs)/);
  assert.doesNotMatch(localCaddy, /Strict-Transport-Security/);
  assert.doesNotMatch(compose, /demo/);
});

test("given the Funnel ingress, when reading its proxy contract, then only application traffic is public", () => {
  // given
  const compose = readFileSync(fileURLToPath(new URL("../deploy/compose.uat.yaml", import.meta.url)), "utf8");
  const caddy = readFileSync(fileURLToPath(new URL("../deploy/Caddyfile.uat", import.meta.url)), "utf8");

  // when / then
  assert.match(compose, /"127\.0\.0\.1:\$\{COURTSIDE_UAT_SHARED_PORT:-8083\}:8083"/);
  assert.match(caddy, /http:\/\/:8083/);
  assert.match(caddy, /X-Robots-Tag "noindex, nofollow"/);
  assert.match(caddy, /Strict-Transport-Security/);
  assert.match(caddy, /@private path \/api-ui\* \/actuator\* \/api\/openapi\.yaml/);
  assert.match(caddy, /handle @private \{\n\t\trespond 404\n\t\}/);
  assert.match(caddy, /header_up X-Forwarded-Proto https/);
  assert.match(caddy, /header_up X-Forwarded-Port 443/);
});

test("given a fresh UAT database, when creating its bootstrap password, then it is unpredictable and strong", () => {
  // when
  const first = newBootstrapPassword();
  const second = newBootstrapPassword();

  // then
  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9_-]{24}$/);
});

test("given a missing backup, when opening it for restore, then the failure names the requested path", () => {
  // given
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });

  // when
  let failure;
  try {
    openBackupForRestore("missing.dump", () => { throw missing; });
  } catch (caught) {
    failure = caught;
  }

  // then
  assert.equal(failure.message, "Backup does not exist: missing.dump");
});

test("given an execution plan, when running it, then only trusted commands run without a shell", () => {
  // given
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  };

  // when
  let failure;
  try {
    runInteractive({ command: "untrusted", args: [] }, execute);
  } catch (caught) {
    failure = caught;
  }
  runInteractive({ command: "docker", args: ["version"] }, execute);

  // then
  assert.equal(failure.message, "Unsupported command: untrusted");
  assert.equal(calls[0].command, "docker");
  assert.equal(calls[0].options.shell, false);
});

test("given lifecycle plans, when running them, then array indexes never replace the command executor", () => {
  // given
  const plans = [{ command: "docker", args: ["first"] }, { command: "docker", args: ["second"] }];
  const calls = [];

  // when
  runLifecyclePlans(plans, (...arguments_) => calls.push(arguments_));

  // then
  assert.deepEqual(calls, [[plans[0]], [plans[1]]]);
});

test("given a restore failure, when restoring UAT, then changes are atomic and the application restarts", () => {
  // given
  const calls = [];
  const execute = (plan) => {
    calls.push(plan.args);
    if (plan.args.includes("pg_restore")) throw new Error("invalid archive");
  };

  // when / then
  assert.throws(() => restoreDatabase(42, uatComposeArgs(), {}, execute), /invalid archive/);
  const restore = calls.find((args) => args.includes("pg_restore"));
  assert.ok(restore.includes("--single-transaction"));
  assert.ok(restore.includes("--exit-on-error"));
  assert.deepEqual(calls.at(-1).slice(-5), ["up", "-d", "--wait", "app", "proxy"]);
});

test("given UAT reset modes, when planning cleanup, then the CA is removed only by all", () => {
  // when
  const databaseOnly = uatResetPlans(false);
  const all = uatResetPlans(true);

  // then
  assert.deepEqual(databaseOnly[1].args, ["volume", "rm", "--force", "courtside-uat_db"]);
  assert.equal(databaseOnly.flatMap((plan) => plan.args).includes("--volumes"), false);
  assert.equal(all[0].args.includes("--volumes"), true);
});

test("given an environment that was never created, when it is reset, then the removal does not refuse a volume it cannot find", () => {
  // when
  const databaseOnly = uatResetPlans(false);

  // then
  assert.equal(databaseOnly[1].args.includes("--force"), true);
});

test("given no version to qualify, when the image is named, then the locally built one is used", () => {
  // when
  const reference = uatImageReference(undefined, {}, () => undefined);

  // then
  assert.equal(reference, "courtside:uat-local");
});

test("given the repository the workflow runs in, when a version is qualified, then its image is named", () => {
  // when
  const reference = uatImageReference("v1.2.3", { GITHUB_REPOSITORY: "example-club/courtside" },
    () => "somebody-else/courtside");

  // then
  assert.equal(reference, "ghcr.io/example-club/courtside:v1.2.3");
});

test("given no workflow environment, when a version is qualified, then the checkout names the repository", () => {
  // when
  const reference = uatImageReference("v1.2.3", {}, () => "example-club/courtside");

  // then
  assert.equal(reference, "ghcr.io/example-club/courtside:v1.2.3");
});

test("given nothing names the repository, when a version is qualified, then it says what would name it", () => {
  // when / then
  assert.throws(() => uatImageReference("v1.2.3", {}, () => undefined), (failure) => {
    assert.match(failure.message, /GITHUB_REPOSITORY/);
    assert.match(failure.message, /origin/);
    return true;
  });
});

test("given a remote that only carries github.com somewhere, when it is read, then no repository is named", () => {
  // when / then
  assert.equal(repositoryFromRemote("https://elsewhere.example//github.com/attacker/courtside.git"), undefined);
  assert.equal(repositoryFromRemote("https://elsewhere.example/redirect@github.com/attacker/courtside.git"), undefined);
  assert.equal(repositoryFromRemote("git@evil.example:mirror/of@github.com/attacker/courtside.git"), undefined);
  assert.equal(repositoryFromRemote("ssh://git@evil.example:22/@github.com/attacker/repo.git"), undefined);
  assert.equal(repositoryFromRemote("https://github.com@evil.example/attacker/repo.git"), undefined);
  assert.equal(repositoryFromRemote("https://github.com.evil.example/attacker/courtside.git"), undefined);
});

test("given a repository named in capitals, when the image is named, then the reference a registry accepts is used", () => {
  // when
  const reference = uatImageReference("v1.2.3", { GITHUB_REPOSITORY: "Example-Club/Courtside" }, () => undefined);

  // then
  assert.equal(reference, "ghcr.io/example-club/courtside:v1.2.3");
});

test("given something that is not a repository, when the image is named, then it is refused by name", () => {
  // when / then
  assert.throws(() => uatImageReference("v1.2.3", { GITHUB_REPOSITORY: "not-a-repository" }, () => undefined),
    /not-a-repository/);
  assert.throws(() => uatImageReference("v1.2.3", { GITHUB_REPOSITORY: "owner/name/extra" }, () => undefined),
    /owner\/name\/extra/);
});

test("given a remote in either form, when the repository is read from it, then owner and name are kept", () => {
  // when / then
  assert.equal(repositoryFromRemote("git@github.com:example-club/courtside.git"), "example-club/courtside");
  assert.equal(repositoryFromRemote("https://github.com/example-club/courtside.git"), "example-club/courtside");
  assert.equal(repositoryFromRemote("https://github.com/example-club/courtside\n"), "example-club/courtside");
  assert.equal(repositoryFromRemote("https://user@github.com/example-club/courtside.git"), "example-club/courtside");
  assert.equal(repositoryFromRemote("ssh://git@github.com/example-club/courtside.git"), "example-club/courtside");
  assert.equal(repositoryFromRemote("https://gitlab.example.org/example-club/courtside.git"), undefined);
  assert.equal(repositoryFromRemote("https://elsewhere.example/github.com/example-club/courtside.git"), undefined);
  assert.equal(repositoryFromRemote(""), undefined);
});

test("given a leftover jar that sorts first, when the packaged application is chosen, then the build's own version wins", () => {
  // given
  const files = ["courtside-0.1.0-SNAPSHOT.jar", "courtside-0.1.0-rc.1.jar", "courtside-0.1.0-rc.1.jar.original"];

  // when
  const jar = packagedApplicationJar(files, "build.artifact=courtside\nbuild.version=0.1.0-rc.1\n");

  // then
  assert.equal(jar, "courtside-0.1.0-rc.1.jar");
});

test("given the build's own jar is missing, when the packaged application is chosen, then no other jar stands in", () => {
  // when / then
  assert.throws(() => packagedApplicationJar(["courtside-0.1.0-SNAPSHOT.jar"], "build.version=0.1.0-rc.1\n"),
    /courtside-0\.1\.0-rc\.1\.jar was not found/);
});

test("given build information without a version, when the packaged application is chosen, then no jar is guessed", () => {
  // when / then
  assert.throws(() => packagedApplicationJar(["courtside-0.1.0-rc.1.jar"], "build.artifact=courtside\n"),
    /no build version/);
});

async function slowServer(delayMilliseconds) {
  const server = createServer((request, response) => {
    setTimeout(() => response.end("ready"), delayMilliseconds);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

test("given an answer that takes longer than a second, when a smoke asks for it, then it waits for the answer",
  async () => {
    // given
    const server = await slowServer(1500);

    try {
      // when
      const response = await localRequest({ secure: false, port: server.address().port, path: "/api/session" });

      // then
      assert.equal(response.body, "ready", "a request doing real work was cut off by a clock");
    } finally {
      server.close();
    }
  });

test("given a readiness probe, when the target does not answer within its deadline, then the probe gives up",
  async () => {
    // given
    const server = await slowServer(1500);

    try {
      // when / then
      await assert.rejects(localRequest({ secure: false, port: server.address().port, path: "/api/source",
        probeDeadlineMilliseconds: 200 }), /Request timed out/);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

test("given no instance settings, when the UAT instance is named, then it is the developer's fixed one", () => {
  // when
  const instance = uatInstance({});

  // then
  assert.deepEqual(instance, { project: "courtside-uat", image: "courtside:uat-local", httpPort: 8081,
    httpsPort: 8443, sharedPort: 8083, logPort: 1515 });
  assert.equal(uatImageReference(undefined, {}, () => undefined), "courtside:uat-local");
});

test("given a run-scoped instance, when the UAT is composed, then it never names the developer's project, image or ports", () => {
  // given
  const environment = { COURTSIDE_UAT_PROJECT: "courtside-uat-gate-7", COURTSIDE_UAT_LOCAL_IMAGE: "courtside:uat-gate-7",
    COURTSIDE_UAT_HTTP_PORT: "41001", COURTSIDE_UAT_HTTPS_PORT: "41002", COURTSIDE_UAT_SHARED_PORT: "41003",
    COURTSIDE_OPERATIONAL_LOG_PORT: "41004" };

  // when
  const instance = uatInstance(environment);
  const composed = uatComposeArgs(false, environment);
  const reset = uatResetPlans(false, environment);

  // then
  assert.deepEqual(instance, { project: "courtside-uat-gate-7", image: "courtside:uat-gate-7", httpPort: 41001,
    httpsPort: 41002, sharedPort: 41003, logPort: 41004 });
  assert.equal(composed[composed.indexOf("-p") + 1], "courtside-uat-gate-7");
  assert.deepEqual(reset.at(-1).args, ["volume", "rm", "--force", "courtside-uat-gate-7_db"]);
  assert.equal(uatImageReference(undefined, environment, () => undefined), "courtside:uat-gate-7");
  assert.ok(!JSON.stringify([composed, reset]).includes("courtside-uat\""), "the developer's project stays untouched");
  assert.match(uatStateFile(environment), /build\/uat-environment-courtside-uat-gate-7\.json$/,
    "a gate run keeps its state beside the developer's, not over it");
  assert.match(uatStateFile({}), /build\/uat-environment\.json$/);
});

test("given an instance setting outside the UAT namespace, when the instance is named, then it is refused", () => {
  // when / then
  assert.throws(() => uatInstance({ COURTSIDE_UAT_PROJECT: "courtside-perf" }), /UAT project/);
  assert.throws(() => uatInstance({ COURTSIDE_UAT_LOCAL_IMAGE: "ghcr.io/x/y:1" }), /UAT image/);
  assert.throws(() => uatInstance({ COURTSIDE_UAT_HTTPS_PORT: "80" }), /UAT port/);
  assert.throws(() => uatInstance({ COURTSIDE_UAT_HTTP_PORT: "8081x" }), /UAT port/);
});

test("given the UAT compose file, when a run-scoped instance starts, then its ports and redirect follow the instance", () => {
  // given
  const compose = readFileSync(new URL("../deploy/compose.uat.yaml", import.meta.url), "utf8");
  const caddy = readFileSync(new URL("../deploy/Caddyfile.uat", import.meta.url), "utf8");

  // when / then
  assert.match(compose, /- "127\.0\.0\.1:\$\{COURTSIDE_UAT_HTTP_PORT:-8081\}:80"/);
  assert.match(compose, /- "127\.0\.0\.1:\$\{COURTSIDE_UAT_HTTPS_PORT:-8443\}:443"/);
  assert.match(compose, /- "127\.0\.0\.1:\$\{COURTSIDE_UAT_SHARED_PORT:-8083\}:8083"/);
  assert.match(compose, /COURTSIDE_UAT_HTTPS_PORT: \$\{COURTSIDE_UAT_HTTPS_PORT:-8443\}/);
  assert.match(caddy, /redir https:\/\/localhost:\{\$COURTSIDE_UAT_HTTPS_PORT:8443\}\{uri\} permanent/);
});

test("given a run-scoped instance, when the smoke composes the UAT, then it runs the instance's own image", () => {
  // given
  const environment = { COURTSIDE_UAT_LOCAL_IMAGE: "courtside:uat-gate-7" };

  // when
  const resolved = uatSmokeEnvironment(undefined, environment, () => undefined);

  // then
  assert.equal(resolved.COURTSIDE_UAT_IMAGE, "courtside:uat-gate-7",
    "Compose would otherwise fall back to the shared courtside:uat-local and recreate the app from it");
  assert.equal(uatSmokeEnvironment(undefined, {}, () => undefined).COURTSIDE_UAT_IMAGE, "courtside:uat-local");
});

test("given every public Funnel address failing, when the identity is requested, then the error names each address with its reason", async () => {
  // given
  const resolve = async () => [{ address: "203.0.113.10", family: 4 }, { address: "2001:db8::10", family: 6 }];
  const request = async (_target, _path, { address }) => {
    throw address.includes(":") ? new Error("connect ETIMEDOUT") : new Error("certificate has expired");
  };
  // when / then
  await assert.rejects(remoteJsonRequest("https://courtside.example.org", "/api/source", { resolve, request }), (error) => {
    assert.match(error.message, /^The Funnel target could not be reached through a validated public address: /);
    assert.match(error.message, /203\.0\.113\.10 Error: certificate has expired/, "each address keeps why it failed");
    assert.match(error.message, /2001:db8::10 Error: connect ETIMEDOUT/, "a later address does not hide an earlier reason");
    return true;
  });
});
