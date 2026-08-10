#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createConnection, createServer } from "node:net";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const devComposeFile = join(root, "deploy", "compose.dev.yaml");
const devComposeArgs = ["compose", "-p", "courtside-dev", "-f", devComposeFile];
const uatComposeFile = join(root, "deploy", "compose.uat.yaml");
const uatDbComposeFile = join(root, "deploy", "compose.uat-db.yaml");
const uatProject = "courtside-uat";
const stateFile = join(root, "build", "dev-processes.json");
const uatStateFile = join(root, "build", "uat-environment.json");

export function executableNames(platform = process.platform) {
  return {
    maven: platform === "win32" ? "mvnw.cmd" : "./mvnw",
    npm: platform === "win32" ? "npm.cmd" : "npm"
  };
}

export function parseArguments(argv) {
  const [command, ...flags] = argv;
  const supported = new Set([
    "build", "verify", "dev", "dev-debug", "dev-stop", "dev-reset", "uat", "uat-stop",
    "uat-logs", "uat-db-shell", "uat-cert", "uat-backup", "uat-restore", "uat-reset", "status", "help"
  ]);
  if (!command || !supported.has(command)) {
    throw new Error(command ? `Unknown command: ${command}` : "A command is required");
  }
  const options = {
    command, suspend: false, json: false, environment: undefined, version: undefined,
    skipVerify: false, dbPort: false, file: undefined, confirm: undefined, all: false
  };
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (flag === "--suspend" && command === "dev-debug") {
      options.suspend = true;
    } else if (flag === "--version" && command === "uat") {
      options.version = requiredOptionValue(flags, ++index, "--version");
      validateImageVersion(options.version);
    } else if (flag === "--skip-verify" && command === "uat") {
      options.skipVerify = true;
    } else if (flag === "--db-port" && command === "uat") {
      options.dbPort = true;
    } else if (flag === "--json" && command === "status") {
      options.json = true;
    } else if (["dev", "uat"].includes(flag) && command === "status" && !options.environment) {
      options.environment = flag;
    } else if (flag === "--confirm" && command === "uat-restore") {
      options.confirm = requiredOptionValue(flags, ++index, "--confirm");
    } else if (flag === "--all" && command === "uat-reset") {
      options.all = true;
    } else if (!flag.startsWith("--") && ["uat-cert", "uat-backup", "uat-restore"].includes(command) && !options.file) {
      options.file = flag;
    } else if (!flag.startsWith("--") && command === "uat-reset" && !options.confirm) {
      options.confirm = flag;
    } else {
      throw new Error(`Unknown option for ${command}: ${flag}`);
    }
  }
  if (command === "status" && !options.environment) {
    throw new Error("status requires the environment 'dev' or 'uat'");
  }
  if (command === "uat-restore" && (!options.file || options.confirm !== uatProject)) {
    throw new Error(`uat-restore requires a file and --confirm ${uatProject}`);
  }
  if (command === "uat-reset" && options.confirm !== uatProject) {
    throw new Error(`uat-reset requires the exact project name '${uatProject}'`);
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
    if (["build", "verify", "dev", "dev-debug", "uat"].includes(options.command) && !options.version) {
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
  if (["uat-stop", "uat-logs", "uat-db-shell"].includes(options.command)) {
    runInteractive(lifecyclePlan(options.command));
    return;
  }
  if (options.command === "uat") {
    startUat(options);
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
  for (const port of requiredPorts(options)) {
    if (port === 5432 && isDevDatabaseRunning()) continue;
    if (!await isPortAvailable(port)) {
      throw new Error(`Port ${port} is already in use`);
    }
  }
  runInteractive({ command: "docker", args: [...devComposeArgs, "up", "-d", "--wait", "db"] });
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
  const result = spawnSync("docker", [...devComposeArgs, "ps", "-q", "db"], {
    cwd: root, encoding: "utf8"
  });
  return result.status === 0 && result.stdout.trim().length > 0;
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
  const uatState = readUatState();
  const project = isUat ? uatProject : "courtside-dev";
  const composeArgs = isUat ? uatComposeArgs(uatState.dbPort) : devComposeArgs;
  const compose = spawnSync("docker", [...composeArgs, "ps", "--format", "json"], {
    cwd: root, encoding: "utf8"
  });
  const git = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
  const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  const volumes = spawnSync("docker", ["volume", "ls", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.Name}}"], { encoding: "utf8" });
  const runtime = isUat ? { mode: "uat", processes: {} } : readProcessState();
  const status = {
    environment,
    mode: runtime.mode,
    gitVersion: git.stdout.trim(),
    gitDirty: dirty.status === 0 && dirty.stdout.trim().length > 0,
    processes: runtime.processes,
    ports: {
      database: {
        port: isUat ? 5433 : 5432,
        exposed: isUat ? uatState.dbPort : true,
        reachable: isUat ? uatState.dbPort && await canConnect(5433) : await canConnect(5432)
      },
      ...(isUat ? {
        http: { port: 8081, reachable: await canConnect(8081) },
        https: { port: 8443, reachable: await canConnect(8443) }
      } : {
        backend: { port: 8080, reachable: await canConnect(8080) },
        frontend: { port: 5173, reachable: await canConnect(5173) }
      }),
      ...(runtime.mode === "dev-debug"
        ? { debugger: { port: 5005, reachable: isListenerActive(5005) } }
        : {})
    },
    health: await readHealth(isUat ? "https://localhost:8443/actuator/health" : "http://127.0.0.1:8080/actuator/health", isUat),
    volumes: volumes.stdout.trim().split(/\r?\n/).filter(Boolean),
    containers: compose.stdout.trim().split(/\r?\n/).filter(Boolean).map(parseJson)
  };
  if (asJson) {
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  } else {
    process.stdout.write(`${isUat ? "UAT" : "Dev"} @ ${status.gitVersion}${status.gitDirty ? " (dirty)" : ""}\n`);
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

async function readHealth(url, allowLocalCertificate = false) {
  try {
    if (allowLocalCertificate) {
      const response = await localRequest({ secure: true, port: 8443, path: "/actuator/health" });
      if (response.statusCode < 200 || response.statusCode >= 300) return `HTTP ${response.statusCode}`;
      return parseJson(response.body).status ?? "unknown";
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    return response.ok ? (await response.json()).status : `HTTP ${response.status}`;
  } catch {
    return "unavailable";
  }
}

export function localRequest({ secure, port, path, method = "GET", headers = {}, body }) {
  return new Promise((resolveResponse, rejectResponse) => {
    const request = (secure ? httpsRequest : httpRequest)({
      hostname: "localhost", port, path, method, headers,
      ...(secure ? { rejectUnauthorized: false } : {})
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
  process.stdout.write(`Usage: node tools/courtside.mjs <command>\n\nCommands:\n  build\n  verify\n  dev\n  dev-debug [--suspend]\n  dev-stop\n  dev-reset\n  uat [--version <tag>] [--skip-verify] [--db-port]\n  uat-stop\n  uat-logs\n  uat-db-shell\n  uat-cert [file]\n  uat-backup [file]\n  uat-restore <file> --confirm courtside-uat\n  uat-reset courtside-uat [--all]\n  status <dev|uat> [--json]\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (import.meta.url === invokedPath) {
  await main();
}
