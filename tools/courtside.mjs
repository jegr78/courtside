#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = join(root, "deploy", "compose.dev.yaml");
const composeArgs = ["compose", "-p", "courtside-dev", "-f", composeFile];
const stateFile = join(root, "build", "dev-processes.json");

export function executableNames(platform = process.platform) {
  return {
    maven: platform === "win32" ? "mvnw.cmd" : "./mvnw",
    npm: platform === "win32" ? "npm.cmd" : "npm"
  };
}

export function parseArguments(argv) {
  const [command, ...flags] = argv;
  const supported = new Set([
    "build", "verify", "dev", "dev-debug", "dev-stop", "dev-reset", "status", "help"
  ]);
  if (!command || !supported.has(command)) {
    throw new Error(command ? `Unknown command: ${command}` : "A command is required");
  }
  const options = { command, suspend: false, json: false, environment: undefined };
  for (const flag of flags) {
    if (flag === "--suspend" && command === "dev-debug") {
      options.suspend = true;
    } else if (flag === "--json" && command === "status") {
      options.json = true;
    } else if (flag === "dev" && command === "status" && !options.environment) {
      options.environment = "dev";
    } else {
      throw new Error(`Unknown option for ${command}: ${flag}`);
    }
  }
  if (command === "status" && options.environment !== "dev") {
    throw new Error("status currently requires the environment 'dev'");
  }
  return options;
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

export function requiredPorts(options) {
  return [5432, 8080, 5173, ...(options.command === "dev-debug" ? [5005] : [])];
}

export function lifecyclePlan(command) {
  if (command === "dev-stop") {
    return { command: "docker", args: [...composeArgs, "stop"] };
  }
  if (command === "dev-reset") {
    return { command: "docker", args: [...composeArgs, "down", "--volumes", "--remove-orphans"] };
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
    if (["build", "verify", "dev", "dev-debug"].includes(options.command)) {
      validateJava();
    }
    if (["verify", "dev", "dev-debug", "dev-stop", "dev-reset", "status"].includes(options.command)) {
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
  if (options.command === "status") {
    await showStatus(options.json);
    return;
  }
  await startDevelopment(options);
}

async function startDevelopment(options) {
  for (const port of requiredPorts(options)) {
    if (port === 5432 && isDevDatabaseRunning()) continue;
    if (!await isPortAvailable(port)) {
      throw new Error(`Port ${port} is already in use`);
    }
  }
  runInteractive({ command: "docker", args: [...composeArgs, "up", "-d", "--wait", "db"] });
  const plans = processPlans(options);
  const environment = {
    ...process.env,
    COURTSIDE_DEMO_CONFIRM_DISPOSABLE: "true",
    COURTSIDE_COOKIE_SECURE: "false",
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
  if (options.command === "dev-debug") {
    process.stdout.write(`Debugger: 127.0.0.1:5005${options.suspend ? " (waiting)" : ""}\n`);
  }
  writeProcessState(children, options.command);
  const stop = () => {
    children.forEach(terminate);
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
    children.forEach(runtime.terminate);
    throw failure;
  }
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

function isDevDatabaseRunning() {
  const result = spawnSync("docker", [...composeArgs, "ps", "-q", "db"], {
    cwd: root, encoding: "utf8"
  });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function runInteractive(plan) {
  const result = spawnSync(plan.command, plan.args, {
    cwd: root, env: process.env, stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${plan.command} exited with status ${result.status}`);
  }
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

async function showStatus(asJson) {
  const compose = spawnSync("docker", [...composeArgs, "ps", "--format", "json"], {
    cwd: root, encoding: "utf8"
  });
  const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  const volumes = spawnSync("docker", ["volume", "ls", "--filter", "label=com.docker.compose.project=courtside-dev", "--format", "{{.Name}}"], { encoding: "utf8" });
  const runtime = readProcessState();
  const status = {
    environment: "dev",
    mode: runtime.mode,
    gitVersion: git.stdout.trim(),
    gitDirty: dirty.status === 0 && dirty.stdout.trim().length > 0,
    processes: runtime.processes,
    ports: {
      database: { port: 5432, reachable: await canConnect(5432) },
      backend: { port: 8080, reachable: await canConnect(8080) },
      frontend: { port: 5173, reachable: await canConnect(5173) },
      ...(runtime.mode === "dev-debug"
        ? { debugger: { port: 5005, reachable: isListenerActive(5005) } }
        : {})
    },
    health: await readHealth(),
    volumes: volumes.stdout.trim().split(/\r?\n/).filter(Boolean),
    containers: compose.stdout.trim().split(/\r?\n/).filter(Boolean).map(parseJson)
  };
  if (asJson) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  } else {
    process.stdout.write(`Dev @ ${status.gitVersion}${status.gitDirty ? " (dirty)" : ""}\n`);
    process.stdout.write(`Health: ${status.health}\n`);
    Object.entries(status.ports).forEach(([name, value]) => {
      process.stdout.write(`${name}: 127.0.0.1:${value.port} (${value.reachable ? "reachable" : "stopped"})\n`);
    });
    process.stdout.write(`Volumes: ${status.volumes.join(", ") || "none"}\n`);
    process.stdout.write(`Containers: ${status.containers.length}\n`);
    Object.entries(status.processes).forEach(([name, value]) => {
      process.stdout.write(`${name} process: ${value.running ? `PID ${value.pid}` : "stopped"}\n`);
    });
  }
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

async function readHealth() {
  try {
    const response = await fetch("http://127.0.0.1:8080/actuator/health", { signal: AbortSignal.timeout(1000) });
    return response.ok ? (await response.json()).status : `HTTP ${response.status}`;
  } catch {
    return "unavailable";
  }
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return value; }
}

function showHelp() {
  process.stdout.write(`Usage: node tools/courtside.mjs <command>\n\nCommands:\n  build\n  verify\n  dev\n  dev-debug [--suspend]\n  dev-stop\n  dev-reset\n  status dev [--json]\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedPath) {
  await main();
}
