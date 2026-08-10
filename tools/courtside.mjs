#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createConnection, createServer } from "node:net";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devComposeFile = join(root, "deploy", "compose.dev.yaml");
const devComposeArgs = ["compose", "-p", "courtside-dev", "-f", devComposeFile];
const uatComposeFile = join(root, "deploy", "compose.uat.yaml");
const uatDbComposeFile = join(root, "deploy", "compose.uat-db.yaml");
const uatProject = "courtside-uat";
const funnelTarget = "http://127.0.0.1:8083";
const stateFile = join(root, "build", "dev-processes.json");
const uatStateFile = join(root, "build", "uat-environment.json");
const uatFunnelStateFile = join(root, "build", "uat-funnel.json");
const perfComposeFile = join(root, "deploy", "compose.perf.yaml");
const perfDbComposeFile = join(root, "deploy", "compose.perf-db.yaml");
const perfTelemetryComposeFile = join(root, "deploy", "compose.perf-telemetry.yaml");
const perfProject = "courtside-perf";
const perfStateFile = join(root, "build", "perf-environment.json");

export function executableNames(platform = process.platform) {
  return {
    maven: platform === "win32" ? "mvnw.cmd" : "./mvnw",
    npm: platform === "win32" ? "npm.cmd" : "npm"
  };
}

export function parseArguments(argv) {
  let [command, ...flags] = argv;
  if (command === "uat" && flags[0] === "share") {
    command = "uat-share";
    flags = flags.slice(1);
  }
  const supported = new Set([
    "build", "verify", "dev", "dev-debug", "dev-stop", "dev-reset", "uat", "uat-stop",
    "uat-share", "uat-logs", "uat-db-shell", "uat-cert", "uat-backup", "uat-restore",
    "uat-reset", "perf", "perf-stop", "perf-logs", "perf-db-shell", "perf-reset", "perf-run", "perf-promote",
    "status", "help"
  ]);
  if (!command || !supported.has(command)) {
    throw new Error(command ? `Unknown command: ${command}` : "A command is required");
  }
  const options = {
    command, suspend: false, json: false, environment: undefined, version: undefined,
    skipVerify: false, dbPort: false, file: undefined, confirm: undefined, all: false,
    profile: undefined, fresh: false, telemetry: false, remoteWrite: false
  };
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (flag === "--suspend" && command === "dev-debug") {
      options.suspend = true;
    } else if (flag === "--version" && command === "uat") {
      options.version = requiredOptionValue(flags, ++index, "--version");
      validateImageVersion(options.version);
    } else if (flag === "--skip-verify" && ["uat", "perf"].includes(command)) {
      options.skipVerify = true;
    } else if (flag === "--db-port" && ["uat", "perf"].includes(command)) {
      options.dbPort = true;
    } else if (flag === "--telemetry" && command === "perf") {
      options.telemetry = true;
    } else if (flag === "--json" && command === "status") {
      options.json = true;
    } else if (["dev", "uat", "perf"].includes(flag) && command === "status" && !options.environment) {
      options.environment = flag;
    } else if (flag === "--confirm" && command === "uat-restore") {
      options.confirm = requiredOptionValue(flags, ++index, "--confirm");
    } else if (flag === "--all" && command === "uat-reset") {
      options.all = true;
    } else if (!flag.startsWith("--") && ["uat-cert", "uat-backup", "uat-restore"].includes(command) && !options.file) {
      options.file = flag;
    } else if (!flag.startsWith("--") && command === "uat-reset" && !options.confirm) {
      options.confirm = flag;
    } else if (!flag.startsWith("--") && command === "perf-reset" && !options.confirm) {
      options.confirm = flag;
    } else if (!flag.startsWith("--") && command === "perf-run" && !options.profile) {
      options.profile = flag;
    } else if (flag === "--confirm" && command === "perf-run") {
      options.confirm = requiredOptionValue(flags, ++index, "--confirm");
    } else if (flag === "--fresh" && command === "perf-run") {
      options.fresh = true;
    } else if (flag === "--remote-write" && command === "perf-run") {
      options.remoteWrite = true;
    } else if (!flag.startsWith("--") && command === "perf-promote" && !options.file) {
      options.file = flag;
    } else if (flag === "--confirm" && command === "perf-promote") {
      options.confirm = requiredOptionValue(flags, ++index, "--confirm");
    } else {
      throw new Error(`Unknown option for ${command}: ${flag}`);
    }
  }
  if (command === "status" && !options.environment) {
    throw new Error("status requires the environment 'dev', 'uat', or 'perf'");
  }
  if (command === "uat-restore" && (!options.file || options.confirm !== uatProject)) {
    throw new Error(`uat-restore requires a file and --confirm ${uatProject}`);
  }
  if (command === "uat-reset" && options.confirm !== uatProject) {
    throw new Error(`uat-reset requires the exact project name '${uatProject}'`);
  }
  if (command === "perf-reset" && options.confirm !== perfProject) {
    throw new Error(`perf-reset requires the exact project name '${perfProject}'`);
  }
  if (command === "perf-run") {
    const protocolProfiles = ["smoke", "baseline", "peak", "stress", "soak"];
    if (!protocolProfiles.includes(options.profile)) {
      throw new Error("perf-run requires a protocol profile: smoke, baseline, peak, stress, or soak");
    }
    if (options.profile !== "smoke" && options.confirm !== perfProject) {
      throw new Error(`perf-run ${options.profile} requires --confirm ${perfProject}`);
    }
    if (options.profile === "soak" && !options.fresh) {
      throw new Error("perf-run soak requires --fresh after recreating the performance environment");
    }
  }
  if (command === "perf-promote" && (!options.file || options.confirm !== perfProject)) {
    throw new Error(`perf-promote requires a summary file and --confirm ${perfProject}`);
  }
  return options;
}

function requiredOptionValue(values, index, option) {
  const value = values[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function validateImageVersion(version) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*(?:@sha256:[a-f0-9]{64})?$/.test(version)) {
    throw new Error(`Invalid image version: ${version}`);
  }
}

export function uatComposeArgs(withDatabasePort = false) {
  return ["compose", "-p", uatProject, "-f", uatComposeFile,
    ...(withDatabasePort ? ["-f", uatDbComposeFile] : [])];
}

export function perfComposeArgs(withDatabasePort = false, withTelemetry = false) {
  return ["compose", "-p", perfProject, "-f", perfComposeFile,
    ...(withDatabasePort ? ["-f", perfDbComposeFile] : []),
    ...(withTelemetry ? ["-f", perfTelemetryComposeFile] : [])];
}

export function parseTailscaleNodeStatus(output) {
  const status = parseJsonObject(output, "Tailscale status");
  const capabilities = Object.keys(status.Self?.CapMap ?? {});
  return {
    connected: status.BackendState === "Running",
    nodeId: typeof status.Self?.ID === "string" ? status.Self.ID : "",
    dnsName: typeof status.Self?.DNSName === "string" ? status.Self.DNSName.replace(/\.$/, "") : "",
    funnelCapable: capabilities.some((capability) =>
      capability === "funnel" || capability.includes("tailscale.com/cap/funnel")),
    httpsCapable: capabilities.some((capability) =>
      capability === "https" || capability.includes("tailscale.com/cap/https"))
  };
}

export function classifyFunnelConfig(output, marker, nodeId) {
  const status = parseJsonObject(output, "Tailscale Funnel status");
  const tcp = status.TCP ?? {};
  const web = status.Web ?? {};
  const allowed = status.AllowFunnel ?? {};
  const hasConfiguration = Object.keys(tcp).length > 0
    || Object.keys(web).length > 0
    || Object.keys(allowed).length > 0;
  if (!hasConfiguration) return { ownership: "none" };
  const webEntries = Object.entries(web);
  const allowedEntries = Object.entries(allowed);
  const handlers = webEntries[0]?.[1]?.Handlers ?? {};
  const handlerEntries = Object.entries(handlers);
  const hasCourtsideTarget = Object.keys(tcp).length === 1
    && tcp["443"]?.HTTPS === true
    && webEntries.length === 1
    && handlerEntries.length === 1
    && handlerEntries[0][0] === "/"
    && handlerEntries[0][1]?.Proxy === funnelTarget
    && allowedEntries.length === 1
    && allowedEntries[0][0] === webEntries[0][0]
    && allowedEntries[0][1] === true;
  if (!hasCourtsideTarget) return { ownership: "foreign" };
  const isCourtside = marker?.target === funnelTarget
    && typeof marker.nodeId === "string"
    && marker.nodeId.length > 0
    && marker.nodeId === nodeId;
  return {
    ownership: isCourtside ? "courtside" : "unclaimed",
    publicUrl: `https://${webEntries[0][0].replace(/:443$/, "")}/`
  };
}

export function funnelPlan(command) {
  return {
    command,
    args: ["funnel", "--yes", "--https=443", funnelTarget]
  };
}

export function assertFunnelShareable(funnel) {
  if (!["none", "courtside"].includes(funnel.ownership)) {
    throw new Error("Another Tailscale Serve or Funnel configuration is active; Courtside left it unchanged");
  }
  return funnel;
}

export function funnelResetPlan(command, funnel, required = false) {
  if (funnel.ownership === "courtside") {
    return { command, args: ["funnel", "reset"] };
  }
  if (funnel.ownership !== "none" && required) {
    throw new Error("The active Funnel no longer belongs exclusively to Courtside and was not reset");
  }
  return undefined;
}

export function superviseFunnel(plan, runtime) {
  return new Promise((resolveSession, rejectSession) => {
    const child = runtime.spawn(plan.command, plan.args, {
      cwd: root,
      stdio: "inherit"
    });
    let stopping = false;
    let finished = false;
    const stop = () => {
      if (finished || stopping) return;
      stopping = true;
      child.kill(runtime.platform === "win32" ? undefined : "SIGINT");
    };
    const removeSignalListeners = () => {
      runtime.signals.removeListener("SIGINT", stop);
      runtime.signals.removeListener("SIGTERM", stop);
    };
    const finish = async (code, failure) => {
      if (finished) return;
      finished = true;
      removeSignalListeners();
      try {
        await runtime.cleanup();
      } catch (cleanupFailure) {
        rejectSession(cleanupFailure);
        return;
      }
      if (failure) {
        rejectSession(failure);
      } else if (!stopping && code !== 0) {
        rejectSession(new Error(`${plan.command} exited with status ${code}`));
      } else {
        resolveSession();
      }
    };
    runtime.signals.once("SIGINT", stop);
    runtime.signals.once("SIGTERM", stop);
    child.once("error", (failure) => void finish(undefined, failure));
    child.once("exit", (code) => void finish(code ?? 1));
  });
}

function parseJsonObject(output, label) {
  const parsed = parseJson(output);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} was not valid JSON`);
  }
  return parsed;
}

export function processPlans(options, platform = process.platform) {
  const names = executableNames(platform);
  if (options.command === "build") {
    return { single: platformPlan(names.maven, ["package", "-DskipTests"], platform) };
  }
  if (options.command === "verify") {
    return { single: platformPlan(names.maven, ["clean", "verify"], platform) };
  }
  const debug = options.command === "dev-debug"
    ? `-Dspring-boot.run.jvmArguments=-agentlib:jdwp=transport=dt_socket,server=y,suspend=${options.suspend ? "y" : "n"},address=127.0.0.1:5005`
    : undefined;
  return {
    backend: platformPlan(names.maven,
      ["spring-boot:run", "-Dspring-boot.run.profiles=demo", ...(debug ? [debug] : [])], platform),
    frontend: platformPlan(names.npm,
      ["--prefix", "frontend", "run", "dev", "--", "--host", "127.0.0.1"], platform)
  };
}

function platformPlan(command, args, platform) {
  if (platform !== "win32") return { command, args, detached: true };
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", [command, ...args].map(validateWindowsArgument).join(" ")],
    detached: false
  };
}

function validateWindowsArgument(value) {
  if (!/^[A-Za-z0-9_./:=,@-]+$/.test(value)) {
    throw new Error(`Unsupported character in Windows command argument: ${value}`);
  }
  return value;
}

export function requiredPorts(options, runningServices = new Set()) {
  return [
    ...(runningServices.has("db") ? [] : [5432]),
    8080,
    5173,
    ...(runningServices.has("api-proxy") ? [] : [8082]),
    ...(options.command === "dev-debug" ? [5005] : [])
  ];
}

export function lifecyclePlan(command) {
  if (command === "dev-stop") {
    return { command: "docker", args: [...devComposeArgs, "stop"] };
  }
  if (command === "dev-reset") {
    return { command: "docker", args: [...devComposeArgs, "down", "--volumes", "--remove-orphans"] };
  }
  if (command === "uat-stop") {
    return { command: "docker", args: [...uatComposeArgs(), "stop"] };
  }
  if (command === "uat-logs") {
    return { command: "docker", args: [...uatComposeArgs(), "logs", "--follow"] };
  }
  if (command === "uat-db-shell") {
    return { command: "docker", args: [...uatComposeArgs(), "exec", "db", "psql", "-U", "courtside", "courtside"] };
  }
  if (command === "perf-stop") {
    return { command: "docker", args: [...perfComposeArgs(false, true), "stop"] };
  }
  if (command === "perf-logs") {
    return { command: "docker", args: [...perfComposeArgs(false, true), "logs", "--follow"] };
  }
  if (command === "perf-db-shell") {
    return { command: "docker", args: [...perfComposeArgs(), "exec", "db", "psql", "-U", "courtside", "courtside_perf"] };
  }
  throw new Error(`No lifecycle plan for ${command}`);
}

export function frontendInstallPlan(platform = process.platform) {
  return platformPlan(executableNames(platform).npm, ["--prefix", "frontend", "ci"], platform);
}

export function listenerOutputMatches(output, port) {
  return output.split(/\r?\n/).some((line) =>
    line.includes(`127.0.0.1:${port}`) && /LISTEN(?:ING)?/i.test(line));
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.command === "help") {
      showHelp();
      return;
    }
    validateNode();
    if (["build", "verify", "dev", "dev-debug", "uat", "uat-share", "perf"].includes(options.command) && !options.version) {
      validateJava();
    }
    if (!["build", "help"].includes(options.command)) {
      validateDocker();
    }
    await execute(options);
  } catch (failure) {
    process.stderr.write(`courtside: ${failure.message}\n`);
    process.exitCode = 1;
  }
}

async function execute(options) {
  if (["build", "verify"].includes(options.command)) {
    runInteractive(processPlans(options).single);
    return;
  }
  if (options.command === "dev-stop") {
    runInteractive(lifecyclePlan(options.command));
    return;
  }
  if (options.command === "dev-reset") {
    runInteractive(lifecyclePlan(options.command));
    process.stdout.write("Development data removed. Run 'dev' to create it again.\n");
    return;
  }
  if (options.command === "uat-stop") {
    cleanupUatFunnel();
    runInteractive(lifecyclePlan(options.command));
    return;
  }
  if (["uat-logs", "uat-db-shell"].includes(options.command)) {
    runInteractive(lifecyclePlan(options.command));
    return;
  }
  if (options.command === "uat") {
    startUat(options);
    return;
  }
  if (options.command === "uat-share") {
    await shareUat();
    return;
  }
  if (options.command === "uat-cert") {
    exportUatCertificate(options.file);
    return;
  }
  if (options.command === "uat-backup") {
    backupUat(options.file);
    return;
  }
  if (options.command === "uat-restore") {
    restoreUat(options.file);
    return;
  }
  if (options.command === "uat-reset") {
    resetUat(options.all);
    return;
  }
  if (options.command === "perf") {
    startPerformance(options);
    return;
  }
  if (["perf-stop", "perf-logs", "perf-db-shell"].includes(options.command)) {
    runInteractive(lifecyclePlan(options.command));
    return;
  }
  if (options.command === "perf-reset") {
    runInteractive(perfResetPlan());
    rmSync(perfStateFile, { force: true });
    process.stdout.write("Performance data and local credentials removed.\n");
    return;
  }
  if (options.command === "perf-run") {
    await runPerformance(options);
    return;
  }
  if (options.command === "perf-promote") {
    promotePerformanceBaseline(options.file);
    return;
  }
  if (options.command === "status") {
    await showStatus(options.environment, options.json);
    return;
  }
  await startDevelopment(options);
}

function startUat(options) {
  const password = process.env.COURTSIDE_UAT_BOOTSTRAP_PASSWORD ?? newBootstrapPassword();
  const environment = uatEnvironment(options.version, password);
  if (options.version) {
    runInteractive({ command: "docker", args: [...uatComposeArgs(options.dbPort), "pull", "app"], environment });
  } else {
    runInteractive(processPlans(parseArguments([options.skipVerify ? "build" : "verify"])).single);
    extractApplicationLayers();
    runInteractive({ command: "docker", args: ["build", "-t", "courtside:uat-local", "."] });
  }
  runInteractive({ command: "docker", args: [...uatComposeArgs(options.dbPort), "up", "-d", "--wait", "db"], environment });
  const needsBootstrap = !uatHasAccounts(options.dbPort, environment);
  environment.COURTSIDE_UAT_ADMIN_PASSWORD = needsBootstrap ? password : "";
  runInteractive({
    command: "docker",
    args: [...uatComposeArgs(options.dbPort), "up", "-d", "--wait", "--force-recreate", "app", "proxy"],
    environment
  });
  if (needsBootstrap) {
    environment.COURTSIDE_UAT_ADMIN_PASSWORD = "";
    runInteractive({
      command: "docker",
      args: [...uatComposeArgs(options.dbPort), "up", "-d", "--wait", "--force-recreate", "app"],
      environment
    });
  }
  mkdirSync(dirname(uatStateFile), { recursive: true });
  writeFileSync(uatStateFile, `${JSON.stringify({ image: environment.COURTSIDE_UAT_IMAGE, dbPort: options.dbPort }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write("UAT: https://localhost:8443 | HTTP redirect: http://localhost:8081\n");
  if (needsBootstrap) {
    process.stdout.write(`Bootstrap admin: admin | one-time password: ${password}\n`);
  }
  if (options.dbPort) {
    process.stdout.write("Database: jdbc:postgresql://127.0.0.1:5433/courtside\n");
  }
}

function uatEnvironment(version, password) {
  return {
    ...process.env,
    COURTSIDE_UAT_IMAGE: version ? `ghcr.io/jegr78/courtside:${version}` : "courtside:uat-local",
    COURTSIDE_UAT_ADMIN_PASSWORD: password
  };
}

function startPerformance(options) {
  const state = readPerformanceState();
  const password = state?.password ?? newBootstrapPassword();
  const environment = { ...process.env, COURTSIDE_PERF_SHARED_PASSWORD: password };
  writePrivateFile(perfStateFile,
    `${JSON.stringify({ password, dbPort: options.dbPort, telemetry: options.telemetry }, null, 2)}\n`);
  runInteractive(processPlans(parseArguments([options.skipVerify ? "build" : "verify"])).single);
  extractApplicationLayers();
  runInteractive({ command: "docker", args: ["build", "-t", "courtside:perf-local", "."] });
  runInteractive({
    command: "docker",
    args: [...perfComposeArgs(options.dbPort, options.telemetry), "up", "-d", "--wait", "--force-recreate",
      "--remove-orphans"],
    environment
  });
  process.stdout.write("Performance: https://localhost:9443 | HTTP redirect: http://localhost:9080\n");
  process.stdout.write(`Accounts: member0001 through member1000 | shared password: ${password}\n`);
  if (options.dbPort) {
    process.stdout.write("Database: jdbc:postgresql://127.0.0.1:5434/courtside_perf\n");
  }
  if (options.telemetry) {
    process.stdout.write("Prometheus: http://127.0.0.1:9090\n");
    process.stdout.write("Grafana: http://127.0.0.1:3000\n");
  }
}

export function writePrivateFile(file, content, platform = process.platform, filesystem = {
  mkdirSync, writeFileSync, chmodSync
}) {
  filesystem.mkdirSync(dirname(file), { recursive: true });
  filesystem.writeFileSync(file, content, { mode: 0o600 });
  if (platform !== "win32") {
    filesystem.chmodSync(file, 0o600);
  }
}

function readPerformanceState() {
  try {
    const state = JSON.parse(readFileSync(perfStateFile, "utf8"));
    return typeof state.password === "string" && state.password.length >= 12 ? state : undefined;
  } catch {
    return undefined;
  }
}

export function perfResetPlan() {
  return { command: "docker", args: [...perfComposeArgs(false, true), "down", "--volumes", "--remove-orphans"] };
}

export function performanceRunPlan(options, resultDirectory, certificateFile, runId = "test-run") {
  const contract = JSON.parse(readFileSync(join(root, "performance", "contract.json"), "utf8"));
  const image = contract.tooling.protocolImage;
  return {
    command: "docker",
    args: [
      "run", "--rm", "--add-host", "host.docker.internal:host-gateway",
      "-e", `PERF_PROFILE=${options.profile}`,
      "-e", `PERF_RUN_ID=${runId}`,
      "-e", "PERF_TARGET=https://host.docker.internal:9443",
      "-e", "K6_WEB_DASHBOARD=true",
      "-e", "K6_WEB_DASHBOARD_EXPORT=/results/report.html",
      ...(options.remoteWrite ? [
        "-e", "K6_PROMETHEUS_RW_SERVER_URL=http://host.docker.internal:9090/api/v1/write",
        "-e", "K6_PROMETHEUS_RW_TREND_STATS=p(50),p(90),p(95),p(99),min,max,avg,med"
      ] : []),
      "-e", "SSL_CERT_FILE=/certs/root.crt",
      "-v", `${join(root, "performance")}:/scripts:ro`,
      "-v", `${perfStateFile}:/run/courtside/perf.json:ro`,
      "-v", `${certificateFile}:/certs/root.crt:ro`,
      "-v", `${resultDirectory}:/results`,
      `${image.reference}@${image.digest}`,
      "run", ...(options.remoteWrite ? ["--out", "experimental-prometheus-rw"] : []),
      "--tag", `testid=${runId}`, "--tag", `profile=${options.profile}`,
      "--summary-trend-stats", "avg,min,med,max,p(50),p(90),p(95),p(99)",
      "/scripts/protocol.js"
    ]
  };
}

async function runPerformance(options) {
  const state = readPerformanceState();
  if (!state) {
    throw new Error("Performance credentials are unavailable; run 'perf' first");
  }
  if (options.remoteWrite && !state.telemetry) {
    throw new Error("Prometheus remote write requires a performance environment started with --telemetry");
  }
  const startedAt = new Date().toISOString();
  const runId = startedAt.replaceAll(":", "-");
  const resultDirectory = join(root, "build", "performance", options.profile, runId);
  const certificateFile = join(resultDirectory, "root.crt");
  mkdirSync(resultDirectory, { recursive: true });
  runInteractive({
    command: "docker",
    args: [...perfComposeArgs(), "cp", "proxy:/data/caddy/pki/authorities/local/root.crt", certificateFile]
  });
  const identity = await localRequest({
    secure: true, port: 9443, path: "/api/source", ca: readFileSync(certificateFile)
  });
  const source = parseJson(identity.body);
  if (identity.statusCode !== 200 || source.environment !== "PERFORMANCE") {
    throw new Error("The target did not identify itself as the disposable PERFORMANCE environment");
  }
  let runFailure;
  try {
    runInteractive(performanceRunPlan(options, resultDirectory, certificateFile, runId));
  } catch (error) {
    runFailure = error;
  }
  const rawSummary = join(resultDirectory, "raw-summary.json");
  if (!existsSync(rawSummary)) {
    rmSync(certificateFile, { force: true });
    throw runFailure ?? new Error("k6 did not produce a machine-readable summary");
  }
  const contractText = readFileSync(join(root, "performance", "contract.json"), "utf8");
  const contract = JSON.parse(contractText);
  const raw = JSON.parse(readFileSync(rawSummary, "utf8"));
  const result = buildPerformanceResult({
    contract,
    contractDigest: `sha256:${createHash("sha256").update(contractText).digest("hex")}`,
    source,
    profileName: options.profile,
    startedAt,
    raw,
    platform: process.platform,
    architecture: process.arch
  });
  validatePerformanceResult(result);
  writeFileSync(join(resultDirectory, "summary.json"), `${JSON.stringify(result, null, 2)}\n`);
  rmSync(certificateFile, { force: true });
  process.stdout.write(`Performance results: ${resultDirectory}\n`);
  if (runFailure) throw runFailure;
}

export function buildPerformanceResult({
  contract, contractDigest, source, profileName, startedAt, raw, platform, architecture
}) {
  const profile = contract.profiles[profileName];
  const workload = contract.workloads[profile.workload];
  const latency = raw.metrics.http_req_duration.values;
  const thresholdPassed = (name) => Object.values(raw.metrics[name].thresholds).every(value => value.ok);
  const load = {
    dataset: contract.datasets[workload.dataset],
    readShare: workload.readShare,
    writeShare: workload.writeShare,
    ...(profile.stages
      ? { stages: profile.stages.map(stage => ({
          targetVirtualUsers: stage.target,
          durationSeconds: durationSeconds(stage.duration)
        })) }
      : { virtualUsers: profile.virtualUsers })
  };
  return {
    schemaVersion: 1,
    contract: { schemaVersion: contract.schemaVersion, digest: contractDigest },
    build: { applicationVersion: source.version, gitCommit: source.commit },
    runtime: { k6Version: contract.tooling.k6Version, operatingSystem: platform, architecture },
    profile: {
      name: profileName,
      workload: profile.workload,
      target: contract.targets.default,
      environment: source.environment,
      startedAt,
      durationSeconds: Math.round(raw.state.testRunDurationMs / 1000)
    },
    load,
    resources: contract.resources,
    thresholds: {
      technicalErrorRate: thresholdPassed("technical_errors"),
      unexpectedServerErrors: thresholdPassed("unexpected_server_errors"),
      readOnlyApi: thresholdPassed("read_only_api_duration"),
      login: thresholdPassed("login_duration"),
      booking: thresholdPassed("booking_duration")
    },
    metrics: {
      iterations: raw.metrics.iterations.values.count,
      requests: raw.metrics.http_reqs.values.count,
      throughputPerSecond: raw.metrics.http_reqs.values.rate,
      technicalErrorRate: raw.metrics.technical_errors.values.rate,
      unexpectedServerErrors: raw.metrics.unexpected_server_errors.values.count,
      bookingConflicts: raw.metrics.booking_conflicts?.values.count ?? 0,
      bookingConflictRate: raw.metrics.booking_conflict_rate?.values.rate ?? 0,
      latencyMilliseconds: {
        p50: latency["p(50)"], p90: latency["p(90)"], p95: latency["p(95)"], p99: latency["p(99)"]
      }
    }
  };
}

function durationSeconds(duration) {
  const match = /^(\d+)([smh])$/.exec(duration);
  if (!match) throw new Error(`Unsupported performance duration: ${duration}`);
  return Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2]];
}

function validatePerformanceResult(result) {
  const require = createRequire(join(root, "frontend", "package.json"));
  const Ajv = require("ajv/dist/2020").default;
  const schema = JSON.parse(readFileSync(join(root, "performance", "result.schema.json"), "utf8"));
  const validate = new Ajv({ strict: true, strictRequired: false, formats: { "date-time": true } }).compile(schema);
  if (!validate(result)) {
    throw new Error(`Performance result does not match its schema: ${JSON.stringify(validate.errors)}`);
  }
}

export function performanceBaselinePlan(result, currentContractDigest) {
  validatePerformanceResult(result);
  if (result.profile.name !== "baseline" || result.profile.target !== "system"
      || result.profile.environment !== "PERFORMANCE") {
    throw new Error("Only an authoritative PERFORMANCE baseline result can be promoted");
  }
  if (result.contract.digest !== currentContractDigest) {
    throw new Error("The result uses a different performance contract");
  }
  if (!Object.values(result.thresholds).every(Boolean)) {
    throw new Error("A result with failed thresholds cannot become a baseline");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(result.build.applicationVersion)) {
    throw new Error("The application version is not safe for a baseline path");
  }
  const name = `${result.build.applicationVersion}-${result.build.gitCommit.slice(0, 7)}.json`;
  return {
    relativePath: join("performance", "baselines", result.profile.name, name),
    content: `${JSON.stringify(result, null, 2)}\n`
  };
}

function promotePerformanceBaseline(file) {
  const result = JSON.parse(readFileSync(resolve(root, file), "utf8"));
  const contractText = readFileSync(join(root, "performance", "contract.json"), "utf8");
  const digest = `sha256:${createHash("sha256").update(contractText).digest("hex")}`;
  const baseline = performanceBaselinePlan(result, digest);
  const destination = join(root, baseline.relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, baseline.content, { flag: "wx" });
  process.stdout.write(`Performance baseline: ${destination}\n`);
}

async function shareUat() {
  const tailscale = locateTailscale();
  const node = parseTailscaleNodeStatus(tailscale.status);
  requireFunnelPrerequisites(node);
  const existing = assertFunnelShareable(readFunnelConfig(tailscale.command, readUatFunnelState(), node.nodeId));
  if (existing.ownership === "courtside") {
    resetFunnel(tailscale.command);
  }
  rmSync(uatFunnelStateFile, { force: true });
  if (!await isUatShareReady()) {
    startUat(parseArguments(["uat"]));
  }
  if (!await isUatShareReady()) {
    throw new Error("The UAT public ingress is not ready on 127.0.0.1:8083");
  }
  const currentTailscale = locateTailscale();
  const currentNode = parseTailscaleNodeStatus(currentTailscale.status);
  requireFunnelPrerequisites(currentNode);
  assertFunnelShareable(readFunnelConfig(currentTailscale.command));
  mkdirSync(dirname(uatFunnelStateFile), { recursive: true });
  writeFileSync(uatFunnelStateFile, `${JSON.stringify({ target: funnelTarget, nodeId: currentNode.nodeId }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write("Public UAT requires synthetic data and individual test accounts. Press Ctrl+C to stop sharing.\n");
  await superviseFunnel(funnelPlan(currentTailscale.command), {
    spawn,
    signals: process,
    platform: process.platform,
    cleanup: () => cleanupUatFunnel(true)
  });
}

async function isUatShareReady() {
  try {
    const response = await localRequest({ secure: false, port: 8083, path: "/api/source" });
    return response.statusCode === 200;
  } catch {
    return false;
  }
}

function requireFunnelPrerequisites(status) {
  if (!status.connected) {
    throw new Error("Tailscale is not connected");
  }
  if (!status.dnsName || !status.nodeId) {
    throw new Error("Tailscale MagicDNS is not available for this device");
  }
  if (!status.httpsCapable || !status.funnelCapable) {
    throw new Error("Tailscale HTTPS certificates and Funnel authorization must be enabled by a tailnet administrator");
  }
}

function tailscaleCandidates(platform = process.platform, environment = process.env) {
  if (platform === "darwin") {
    return ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"];
  }
  if (platform === "win32") {
    return ["tailscale.exe", join(environment.ProgramFiles ?? "C:\\Program Files", "Tailscale", "tailscale.exe")];
  }
  return ["tailscale"];
}

function locateTailscale() {
  for (const command of tailscaleCandidates()) {
    const result = spawnSync(command, ["status", "--json"], { encoding: "utf8" });
    if (!result.error && result.status === 0) {
      return { command, status: result.stdout };
    }
    if (result.error?.code !== "ENOENT") {
      throw new Error(`Tailscale status failed: ${(result.stderr ?? result.error?.message ?? "unknown error").trim()}`);
    }
  }
  throw new Error("The Tailscale CLI is required for public UAT sharing");
}

function readFunnelConfig(command, marker, nodeId) {
  const result = spawnSync(command, ["funnel", "status", "--json"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`Tailscale Funnel status failed: ${(result.stderr ?? result.error?.message ?? "unknown error").trim()}`);
  }
  return classifyFunnelConfig(result.stdout, marker, nodeId);
}

function readUatFunnelState() {
  try {
    const marker = JSON.parse(readFileSync(uatFunnelStateFile, "utf8"));
    return typeof marker === "object" && marker !== null ? marker : undefined;
  } catch {
    return undefined;
  }
}

function resetFunnel(command) {
  const plan = funnelResetPlan(command, { ownership: "courtside" });
  const result = spawnSync(plan.command, plan.args, { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error("Courtside could not disable its Funnel. Run 'tailscale funnel reset' after verifying ownership");
  }
}

function cleanupUatFunnel(required = existsSync(uatFunnelStateFile)) {
  let tailscale;
  try {
    tailscale = locateTailscale();
  } catch (failure) {
    if (required) throw failure;
    return;
  }
  const node = parseTailscaleNodeStatus(tailscale.status);
  const funnel = readFunnelConfig(tailscale.command, readUatFunnelState(), node.nodeId);
  const reset = funnelResetPlan(tailscale.command, funnel, required);
  if (reset) {
    const result = spawnSync(reset.command, reset.args, { stdio: "inherit" });
    if (result.error || result.status !== 0) {
      throw new Error("Courtside could not disable its Funnel. Run 'tailscale funnel reset' after verifying ownership");
    }
  }
  rmSync(uatFunnelStateFile, { force: true });
}

export function newBootstrapPassword() {
  return randomBytes(18).toString("base64url");
}

function uatHasAccounts(withDatabasePort, environment) {
  const relation = runCaptured({
    command: "docker",
    args: [...uatComposeArgs(withDatabasePort), "exec", "-T", "db", "psql", "-U", "courtside", "-d", "courtside", "-tAc", "select to_regclass('public.user_account')"],
    environment
  });
  if (!relation) return false;
  return runCaptured({
    command: "docker",
    args: [...uatComposeArgs(withDatabasePort), "exec", "-T", "db", "psql", "-U", "courtside", "-d", "courtside", "-tAc", "select count(*) from user_account"],
    environment
  }) !== "0";
}

function extractApplicationLayers() {
  const jar = readdirSync(join(root, "target"))
    .find((file) => /^courtside-.*\.jar$/.test(file) && !file.endsWith(".jar.original"));
  if (!jar) throw new Error("The packaged Courtside application was not found");
  const layers = join(root, "build", "layers");
  rmSync(layers, { recursive: true, force: true });
  mkdirSync(layers, { recursive: true });
  const java = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java")
    : "java";
  runInteractive({
    command: java,
    args: ["-Djarmode=tools", "-jar", join("target", jar), "extract", "--layers", "--launcher", "--destination", layers]
  });
}

function exportUatCertificate(file) {
  const destination = resolve(root, file ?? join("build", "courtside-uat-root.crt"));
  mkdirSync(dirname(destination), { recursive: true });
  runInteractive({
    command: "docker",
    args: [...uatComposeArgs(), "cp", `proxy:/data/caddy/pki/authorities/local/root.crt`, destination]
  });
  process.stdout.write(`Certificate exported to ${destination}\n`);
  process.stdout.write("macOS: import the certificate into the System keychain with Keychain Access and mark it trusted.\n");
  process.stdout.write("Windows: import the certificate into Trusted Root Certification Authorities with Certificate Manager.\n");
  process.stdout.write("Debian/Ubuntu: copy it to /usr/local/share/ca-certificates and run update-ca-certificates.\n");
  process.stdout.write("Fedora/RHEL: copy it to /etc/pki/ca-trust/source/anchors and run update-ca-trust.\n");
}

function backupUat(file) {
  const destination = resolve(root, file ?? join("build", "backups", `courtside-uat-${backupTimestamp()}.dump`));
  mkdirSync(dirname(destination), { recursive: true });
  const output = openSync(destination, "w", 0o600);
  let backupFailure;
  try {
    runInteractive({
      command: "docker",
      args: [...uatComposeArgs(), "exec", "-T", "db", "pg_dump", "-Fc", "-U", "courtside", "courtside"],
      stdout: output
    });
  } catch (failure) {
    backupFailure = failure;
  } finally {
    closeSync(output);
  }
  if (backupFailure) {
    rmSync(destination, { force: true });
    throw backupFailure;
  }
  process.stdout.write(`Backup written to ${destination}\n`);
}

function backupTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function restoreUat(file) {
  const source = resolve(root, file);
  if (!existsSync(source)) throw new Error(`Backup does not exist: ${source}`);
  const state = readUatState();
  const environment = { ...process.env, COURTSIDE_UAT_IMAGE: state.image, COURTSIDE_UAT_ADMIN_PASSWORD: "" };
  const composeArgs = uatComposeArgs(state.dbPort);
  const input = openSync(source, "r");
  try {
    restoreDatabase(input, composeArgs, environment);
  } finally {
    closeSync(input);
  }
  process.stdout.write(`Backup restored from ${source}\n`);
}

export function restoreDatabase(input, composeArgs, environment, execute = runInteractive) {
  execute({ command: "docker", args: [...composeArgs, "stop", "app"], environment });
  let restoreFailure;
  try {
    execute({
      command: "docker",
      args: [...composeArgs, "exec", "-T", "db", "pg_restore", "--clean", "--if-exists", "--no-owner", "--single-transaction", "--exit-on-error", "-U", "courtside", "-d", "courtside"],
      environment,
      stdin: input
    });
  } catch (failure) {
    restoreFailure = failure;
  } finally {
    execute({ command: "docker", args: [...composeArgs, "up", "-d", "--wait", "app", "proxy"], environment });
  }
  if (restoreFailure) throw restoreFailure;
}

function resetUat(all) {
  cleanupUatFunnel();
  const plans = uatResetPlans(all);
  plans.forEach(runInteractive);
  if (all) {
    rmSync(uatStateFile, { force: true });
    process.stdout.write("UAT database and local certificate authority removed.\n");
    return;
  }
  rmSync(uatStateFile, { force: true });
  process.stdout.write("UAT database removed; the local certificate authority was retained.\n");
}

export function uatResetPlans(all) {
  if (all) {
    return [{ command: "docker", args: [...uatComposeArgs(), "down", "--volumes", "--remove-orphans"] }];
  }
  return [
    { command: "docker", args: [...uatComposeArgs(), "down", "--remove-orphans"] },
    { command: "docker", args: ["volume", "rm", `${uatProject}_db`] }
  ];
}

function readUatState() {
  try {
    const state = JSON.parse(readFileSync(uatStateFile, "utf8"));
    return {
      image: typeof state.image === "string" ? state.image : "courtside:uat-local",
      dbPort: state.dbPort === true
    };
  } catch {
    return { image: "courtside:uat-local", dbPort: false };
  }
}

async function startDevelopment(options) {
  for (const port of requiredPorts(options, runningDevServices())) {
    if (!await isPortAvailable(port)) {
      throw new Error(`Port ${port} is already in use`);
    }
  }
  runInteractive({ command: "docker", args: [...devComposeArgs, "up", "-d", "--wait", "db", "api-ui", "api-proxy"] });
  const plans = processPlans(options);
  const environment = {
    ...process.env,
    COURTSIDE_DEMO_CONFIRM_DISPOSABLE: "true",
    COURTSIDE_COOKIE_SECURE: "false",
    COURTSIDE_ENVIRONMENT: "DEVELOPMENT",
    SPRING_DATASOURCE_URL: "jdbc:postgresql://127.0.0.1:5432/courtside_dev",
    SPRING_DATASOURCE_USERNAME: "courtside",
    SPRING_DATASOURCE_PASSWORD: "courtside-dev"
  };
  validateExecutable(platformPlan(executableNames().npm, ["--version"], process.platform));
  if (!existsSync(join(root, "frontend", "node_modules"))) {
    runInteractive(frontendInstallPlan());
  }
  const processes = await startProcesses(plans, environment);
  const { children } = processes;
  process.stdout.write("Dev: http://localhost:5173 | DB: jdbc:postgresql://127.0.0.1:5432/courtside_dev\n");
  process.stdout.write("API UI: http://127.0.0.1:8082/api-ui/\n");
  if (options.command === "dev-debug") {
    process.stdout.write(`Debugger: 127.0.0.1:5005${options.suspend ? " (waiting)" : ""}\n`);
  }
  writeProcessState(children, options.command);
  const stop = () => {
    terminateChildren(children, terminate);
    removeProcessState();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const exitCode = await processes.exit;
  stop();
  process.exitCode = exitCode;
}

export async function startProcesses(plans, environment, runtime = { spawn, terminate }) {
  const children = [];
  const exits = [];
  try {
    for (const [label, plan] of [["backend", plans.backend], ["frontend", plans.frontend]]) {
      const process = await spawnReady(label, plan, environment, runtime.spawn);
      children.push(process.child);
      exits.push(process.exit);
    }
    return { children, exit: Promise.race(exits) };
  } catch (failure) {
    terminateChildren(children, runtime.terminate);
    throw failure;
  }
}

export function terminateChildren(children, terminateProcess) {
  children.forEach((child) => terminateProcess(child));
}

function spawnReady(label, plan, environment, spawnProcess) {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawnProcess(plan.command, plan.args, {
      cwd: root, detached: plan.detached, env: environment,
      stdio: ["inherit", "pipe", "pipe"]
    });
    const exit = new Promise((resolveExit) => {
      child.once("exit", (code) => resolveExit(code ?? 1));
    });
    const failed = (failure) => rejectChild(new Error(`${label} failed to start: ${failure.message}`));
    child.once("error", failed);
    child.once("spawn", () => {
      child.removeListener("error", failed);
      child.on("error", (failure) => process.stderr.write(`[${label}] ${failure.message}\n`));
      prefix(child.stdout, label, process.stdout);
      prefix(child.stderr, label, process.stderr);
      resolveChild({ child, exit });
    });
  });
}

function runningDevServices() {
  const result = spawnSync("docker", [...devComposeArgs, "ps", "--services", "--filter", "status=running"], {
    cwd: root, encoding: "utf8"
  });
  if (result.status !== 0) return new Set();
  return new Set(result.stdout.trim().split(/\r?\n/).filter(Boolean));
}

function runInteractive(plan) {
  const result = spawnSync(plan.command, plan.args, {
    cwd: root,
    env: plan.environment ?? process.env,
    stdio: [plan.stdin ?? "inherit", plan.stdout ?? "inherit", "inherit"]
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${plan.command} exited with status ${result.status}`);
  }
}

function runCaptured(plan) {
  const result = spawnSync(plan.command, plan.args, {
    cwd: root, env: plan.environment ?? process.env, encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${plan.command} exited with status ${result.status}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function prefix(stream, label, destination) {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const lines = (pending + chunk).split(/\r?\n/);
    pending = lines.pop();
    lines.forEach((line) => destination.write(`[${label}] ${line}\n`));
  });
  stream.on("end", () => {
    if (pending) destination.write(`[${label}] ${pending}\n`);
  });
}

export function terminate(child, platform = process.platform, killProcess = process.kill) {
  if (child.exitCode !== null) return;
  if (platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      killProcess(-child.pid, "SIGTERM");
    } catch (failure) {
      if (failure.code !== "ESRCH") throw failure;
    }
  }
}

function validateNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major !== 24) {
    throw new Error(`Node 24 is required, found ${process.versions.node}`);
  }
}

function validateJava() {
  const java = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "java.exe" : "java")
    : "java";
  const result = spawnSync(java, ["-version"], { encoding: "utf8" });
  const version = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error || !version.match(/version "25(?:[.\"])/)) {
    throw new Error("Java 25 is required; set JAVA_HOME to Eclipse Temurin 25");
  }
  if (!existsSync(join(root, executableNames().maven))) {
    throw new Error("The Maven Wrapper is missing");
  }
}

function validateDocker() {
  const result = spawnSync("docker", ["compose", "version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error("Docker with Compose is required and must be running");
  }
}

function validateExecutable(plan) {
  const result = spawnSync(plan.command, plan.args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${executableNames().npm} is required`);
  }
}

function isPortAvailable(port) {
  return new Promise((resolvePort) => {
    const server = createServer();
    server.once("error", () => resolvePort(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolvePort(true)));
  });
}

function canConnect(port) {
  return new Promise((resolveConnection) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); resolveConnection(true); });
    socket.once("timeout", () => { socket.destroy(); resolveConnection(false); });
    socket.once("error", () => resolveConnection(false));
  });
}

async function showStatus(environment, asJson) {
  const isUat = environment === "uat";
  const isPerf = environment === "perf";
  const uatState = readUatState();
  const perfState = readPerformanceState();
  const project = isUat ? uatProject : isPerf ? perfProject : "courtside-dev";
  const composeArgs = isUat ? uatComposeArgs(uatState.dbPort)
    : isPerf ? perfComposeArgs(perfState?.dbPort, perfState?.telemetry) : devComposeArgs;
  const compose = spawnSync("docker", [...composeArgs, "ps", "--format", "json"], {
    cwd: root, encoding: "utf8"
  });
  const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  const volumes = spawnSync("docker", ["volume", "ls", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.Name}}"], { encoding: "utf8" });
  const runtime = isUat || isPerf ? { mode: environment, processes: {} } : readProcessState();
  const funnel = isUat ? readFunnelStatusForDisplay() : undefined;
  const status = {
    environment,
    mode: runtime.mode,
    gitVersion: git.stdout.trim(),
    gitDirty: dirty.status === 0 && dirty.stdout.trim().length > 0,
    processes: runtime.processes,
    ports: {
      database: {
        port: isUat ? 5433 : isPerf ? 5434 : 5432,
        exposed: isUat ? uatState.dbPort : isPerf ? Boolean(perfState?.dbPort) : true,
        reachable: isUat ? uatState.dbPort && await canConnect(5433)
          : isPerf ? Boolean(perfState?.dbPort) && await canConnect(5434) : await canConnect(5432)
      },
      ...(isUat ? {
        http: { port: 8081, reachable: await canConnect(8081) },
        https: { port: 8443, reachable: await canConnect(8443) }
      } : isPerf ? {
        http: { port: 9080, reachable: await canConnect(9080) },
        https: { port: 9443, reachable: await canConnect(9443) },
        ...(perfState?.telemetry
          ? {
              prometheus: { port: 9090, reachable: await canConnect(9090) },
              grafana: { port: 3000, reachable: await canConnect(3000) }
            }
          : {})
      } : {
        backend: { port: 8080, reachable: await canConnect(8080) },
        frontend: { port: 5173, reachable: await canConnect(5173) },
        apiUi: { port: 8082, reachable: await canConnect(8082) }
      }),
      ...(runtime.mode === "dev-debug"
        ? { debugger: { port: 5005, reachable: isListenerActive(5005) } }
        : {})
    },
    health: isPerf ? readPerformanceHealth(composeArgs) : await readHealth(
      isUat ? "https://localhost:8443/actuator/health" : "http://127.0.0.1:8080/actuator/health", isUat),
    volumes: volumes.stdout.trim().split(/\r?\n/).filter(Boolean),
    containers: compose.stdout.trim().split(/\r?\n/).filter(Boolean).map(parseJson),
    ...(isUat ? { funnel } : {})
  };
  if (asJson) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  } else {
    process.stdout.write(`${isUat ? "UAT" : isPerf ? "Performance" : "Dev"} @ ${status.gitVersion}${status.gitDirty ? " (dirty)" : ""}\n`);
    process.stdout.write(`Health: ${status.health}\n`);
    Object.entries(status.ports).forEach(([name, value]) => {
      process.stdout.write(`${name}: 127.0.0.1:${value.port} (${value.reachable ? "reachable" : "stopped"})\n`);
    });
    process.stdout.write(`Volumes: ${status.volumes.join(", ") || "none"}\n`);
    process.stdout.write(`Containers: ${status.containers.length}\n`);
    if (isUat) {
      process.stdout.write(`Funnel: ${funnel.ownership}${funnel.publicUrl ? ` (${funnel.publicUrl})` : ""}\n`);
    }
    Object.entries(status.processes).forEach(([name, value]) => {
      process.stdout.write(`${name} process: ${value.running ? `PID ${value.pid}` : "stopped"}\n`);
    });
  }
}

function readFunnelStatusForDisplay() {
  try {
    const tailscale = locateTailscale();
    const node = parseTailscaleNodeStatus(tailscale.status);
    return classifyFunnelConfig(readFunnelStatusOutput(tailscale.command), readUatFunnelState(), node.nodeId);
  } catch {
    return { ownership: "unavailable" };
  }
}

function readFunnelStatusOutput(command) {
  const result = spawnSync(command, ["funnel", "status", "--json"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error("Tailscale Funnel status is unavailable");
  }
  return result.stdout;
}

function isListenerActive(port) {
  if (process.platform === "darwin") {
    const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return result.status === 0;
  }
  const command = process.platform === "win32" ? "netstat" : "ss";
  const args = process.platform === "win32" ? ["-an", "-p", "tcp"] : ["-ltn"];
  const result = spawnSync(command, args, { encoding: "utf8" });
  return result.status === 0 && listenerOutputMatches(result.stdout, port);
}

function writeProcessState(children, mode) {
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, `${JSON.stringify({
    mode,
    backend: children[0].pid,
    frontend: children[1].pid
  }, null, 2)}\n`, { mode: 0o600 });
}

function removeProcessState() {
  rmSync(stateFile, { force: true });
}

function readProcessState() {
  let stored = {};
  try {
    stored = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return {
      mode: undefined,
      processes: { backend: { running: false }, frontend: { running: false } }
    };
  }
  const processes = Object.fromEntries(["backend", "frontend"].map((name) => {
    const pid = stored[name];
    return [name, { ...(Number.isInteger(pid) ? { pid } : {}), running: isProcessRunning(pid) }];
  }));
  return { mode: stored.mode, processes };
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readHealth(url, allowLocalCertificate = false) {
  try {
    if (allowLocalCertificate) {
      const target = new URL(url);
      const response = await localRequest({
        secure: true, port: Number(target.port), path: target.pathname
      });
      if (response.statusCode < 200 || response.statusCode >= 300) return `HTTP ${response.statusCode}`;
      return parseJson(response.body).status ?? "unknown";
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok ? (await response.json()).status : `HTTP ${response.status}`;
  } catch {
    return "unavailable";
  }
}

function readPerformanceHealth(composeArgs) {
  const result = spawnSync("docker", [...composeArgs, "exec", "-T", "app", "curl", "-fsS",
    "http://127.0.0.1:9091/actuator/health"], { encoding: "utf8" });
  if (result.status !== 0) return "unavailable";
  return parseJson(result.stdout).status ?? "unknown";
}

export function localRequest({ secure, port, path, method = "GET", headers = {}, body, ca }) {
  return new Promise((resolveResponse, rejectResponse) => {
    const request = (secure ? httpsRequest : httpRequest)({
      hostname: "localhost", port, path, method, headers,
      ...(secure ? { rejectUnauthorized: Boolean(ca), ...(ca ? { ca } : {}) } : {})
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => resolveResponse({
        statusCode: response.statusCode ?? 0, headers: response.headers, body: responseBody
      }));
    });
    request.setTimeout(1000, () => request.destroy(new Error("Request timed out")));
    request.once("error", rejectResponse);
    if (body) request.write(body);
    request.end();
  });
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return value; }
}

function showHelp() {
  process.stdout.write(`Usage: node tools/courtside.mjs <command>\n\nCommands:\n  build\n  verify\n  dev\n  dev-debug [--suspend]\n  dev-stop\n  dev-reset\n  uat [--version <tag>] [--skip-verify] [--db-port]\n  uat share\n  uat-stop\n  uat-logs\n  uat-db-shell\n  uat-cert [file]\n  uat-backup [file]\n  uat-restore <file> --confirm courtside-uat\n  uat-reset courtside-uat [--all]\n  perf [--skip-verify] [--db-port] [--telemetry]\n  perf-run <smoke|baseline|peak|stress|soak> [--confirm courtside-perf] [--fresh] [--remote-write]\n  perf-promote <summary.json> --confirm courtside-perf\n  perf-stop\n  perf-logs\n  perf-db-shell\n  perf-reset courtside-perf\n  status <dev|uat|perf> [--json]\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedPath) {
  await main();
}
