import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  assertFunnelShareable, classifyFunnelConfig, executableNames, frontendInstallPlan, funnelPlan,
  funnelResetPlan, lifecyclePlan, listenerOutputMatches, parseArguments, parseTailscaleNodeStatus, newBootstrapPassword,
  openBackupForRestore, processPlans, requiredPorts, restoreDatabase, runInteractive, runLifecyclePlans, startProcesses,
  superviseFunnel, terminate,
  terminateChildren, uatComposeArgs, uatResetPlans, perfComposeArgs, perfResetPlan,
  writePrivateFile, performanceRunPlan, buildPerformanceResult, comparePerformanceResults, performanceBaselinePlan,
  performanceStartupSummary, funnelPerformanceRunPlan, validateFunnelTarget, validatePerformanceResult,
  resolvePublicFunnelAddresses, uatStartupSummary, uatImageReference, repositoryFromRemote,
  validateNode, validatePublicAddress
} from "./courtside.mjs";

function composeService(compose, service) {
  return compose.match(new RegExp(`^  ${service}:\\n(?<body>.*?)(?=^  [\\w-]+:|^volumes:|^networks:)`, "ms"))?.groups.body ?? "";
}

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
    ["package", "-DskipTests"]);
  assert.deepEqual(processPlans(parseArguments(["verify"]), "linux").single.args,
    ["clean", "verify"]);
});

test("given a local check, when parsing its options, then planning and escalation remain explicit", () => {
  // when
  const normal = parseArguments(["check"]);
  const planned = parseArguments(["check", "--plan"]);
  const full = parseArguments(["check", "--full"]);

  // then
  assert.equal(normal.planOnly, false);
  assert.equal(normal.forceFull, false);
  assert.equal(planned.planOnly, true);
  assert.equal(full.forceFull, true);
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
  assert.ok(plan.args.includes("K6_BROWSER_ARGS=no-sandbox,ignore-certificate-errors-spki-list=test-pin"));
  assert.ok(plan.args.some((argument) => argument.includes("p(75)")));
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
  const expected = `${process.getuid()}:${process.getgid()}`;
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
  assert.ok(plan.args.includes("PERF_RUN_ID=test-run"));
  assert.ok(plan.args.includes("PERF_TARGET=https://proxy:443"));
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
  assert.match(source, /perfComposeArgs\(options\.dbPort, options\.telemetry\).*--remove-orphans/s);
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
  assert.match(composeService(compose, "app"), /cpus: 2\.0/);
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
  const productionCompose = readFileSync(fileURLToPath(new URL("../deploy/compose.yaml", import.meta.url)), "utf8");

  // when / then
  assert.match(devCompose, /swaggerapi\/swagger-ui:[^\s]+@sha256:/);
  assert.match(uatCompose, /swaggerapi\/swagger-ui:[^\s]+@sha256:/);
  assert.match(devCompose, /SWAGGER_JSON_URL: \/api\/openapi\.yaml/);
  assert.match(uatCompose, /SWAGGER_JSON_URL: \/api\/openapi\.yaml/);
  assert.match(uatCaddy, /\/api-ui/);
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
  assert.match(smoke, /localCa = composeRun\("exec", "-T", "proxy", "cat"/);
  assert.ok(smoke.split("\n").filter((line) => line.includes("secure: true"))
    .every((line) => line.includes("ca: localCa")));
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
  assert.match(compose, /postgres:17-alpine@sha256:[a-f0-9]{64}/);
  assert.match(compose, /caddy:2-alpine@sha256:[a-f0-9]{64}/);
  assert.match(compose, /COURTSIDE_UAT_ADMIN_PASSWORD/);
  assert.doesNotMatch(compose, /courtside-admin/);
  assert.doesNotMatch(compose, /5433:5432/);
  assert.match(databaseOverride, /127\.0\.0\.1:5433:5432/);
  assert.match(compose, /caddy-data:\/data/);
  assert.match(compose, /db:\/var\/lib\/postgresql\/data/);
  assert.match(caddy, /redir https:\/\/localhost:8443\{uri\} permanent/);
  assert.doesNotMatch(localCaddy, /Strict-Transport-Security/);
  assert.doesNotMatch(compose, /demo/);
});

test("given the Funnel ingress, when reading its proxy contract, then only application traffic is public", () => {
  // given
  const compose = readFileSync(fileURLToPath(new URL("../deploy/compose.uat.yaml", import.meta.url)), "utf8");
  const caddy = readFileSync(fileURLToPath(new URL("../deploy/Caddyfile.uat", import.meta.url)), "utf8");

  // when / then
  assert.match(compose, /127\.0\.0\.1:8083:8083/);
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
  assert.deepEqual(databaseOnly[1].args, ["volume", "rm", "courtside-uat_db"]);
  assert.equal(databaseOnly.flatMap((plan) => plan.args).includes("--volumes"), false);
  assert.equal(all[0].args.includes("--volumes"), true);
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
  // when / then — every one of these resolved to a repository while the host was merely scanned for
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
