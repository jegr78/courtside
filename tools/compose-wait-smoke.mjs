#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const minimumComposeVersion = [2, 33, 1];

export function composeWaitSmokeIdentity(sourceCommit, pid) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit) || !Number.isSafeInteger(pid) || pid < 1) {
    throw new Error("Compose smoke identity is invalid");
  }
  return {
    sourceCommit,
    project: `courtside-verify-${sourceCommit.slice(0, 12)}-${pid}`
  };
}

export function parseComposeVersion(value) {
  const match = /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(value.trim());
  if (!match) throw new Error("Docker Compose did not report a semantic version");
  return match.slice(1).map(Number);
}

export function supportsComposeWait(version) {
  for (let index = 0; index < minimumComposeVersion.length; index += 1) {
    if (version[index] !== minimumComposeVersion[index]) return version[index] > minimumComposeVersion[index];
  }
  return true;
}

export function redactComposeDiagnostics(value, secrets) {
  let redacted = String(value);
  for (const secret of secrets) {
    if (secret) redacted = redacted.replaceAll(String(secret), "[REDACTED]");
  }
  return redacted;
}

export async function runComposeWaitSmoke(options = {}) {
  const execute = options.execute ?? executeProcess;
  const sourceCommit = commandOutput(execute, "git", ["rev-parse", "HEAD"]).trim();
  const identity = composeWaitSmokeIdentity(sourceCommit, options.pid ?? process.pid);
  const composeOutput = commandOutput(execute, "docker", ["compose", "version"]);
  const composeVersion = parseComposeVersion(composeOutput);
  if (!supportsComposeWait(composeVersion)) {
    throw new Error(`Docker Compose ${composeVersion.join(".")} is older than 2.33.1`);
  }

  const output = resolve(options.output ?? join(repository, "build", "compose-wait-smoke", "result.json"));
  const work = dirname(output);
  const layers = join(work, "layers");
  const imageTag = `courtside:verification-${sourceCommit.slice(0, 12)}-${options.pid ?? process.pid}`;
  const iidFile = join(work, "image-id.txt");
  const compose = ["compose", "-p", identity.project, "-f", join(repository, "deploy", "compose.uat.yaml")];
  const port = options.port ?? await availableUdpPort();
  const adminPassword = `${randomBytes(24).toString("base64url")}Aa1!`;
  const environment = {
    ...process.env,
    COURTSIDE_OPERATIONAL_LOG_PORT: String(port),
    COURTSIDE_UAT_ADMIN_PASSWORD: adminPassword
  };
  mkdirSync(work, { recursive: true });
  rmSync(layers, { recursive: true, force: true });
  let imageId;
  let failure;
  try {
    const jar = applicationJar();
    commandOutput(execute, javaExecutable(), ["-Djarmode=tools", "-jar", jar, "extract", "--layers",
      "--launcher", "--destination", layers]);
    commandOutput(execute, "docker", ["build", "--iidfile", iidFile, "--tag", imageTag,
      "--build-arg", `LAYERS=${relativePath(layers)}`, repository]);
    imageId = readFileSync(iidFile, "utf8").trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("Docker did not record an immutable image ID");
    environment.COURTSIDE_UAT_IMAGE = imageId;
    commandOutput(execute, "docker", [...compose, "up", "-d", "--wait", "app"], environment);
    const services = Object.fromEntries(["log-collector", "db", "app"].map((service) => {
      const container = commandOutput(execute, "docker", [...compose, "ps", "-q", service], environment).trim();
      if (!/^[a-f0-9]{12,64}$/.test(container)) throw new Error(`${service} did not start`);
      const health = commandOutput(execute, "docker",
        ["inspect", "--format", "{{.State.Health.Status}}", container]).trim();
      if (health !== "healthy") throw new Error(`${service} is ${health || "without health evidence"}`);
      return [service, { container, health }];
    }));
    const record = {
      schemaVersion: 1,
      sourceCommit,
      composeVersion: composeVersion.join("."),
      imageId,
      project: identity.project,
      services,
      outcome: "passed"
    };
    writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`Compose wait smoke passed with ${record.composeVersion} for ${imageId}.\n`);
    return record;
  } catch (error) {
    failure = error;
    try {
      const logs = commandOutput(execute, "docker",
        [...compose, "logs", "--no-color", "--tail", "200"], environment);
      if (logs.trim()) process.stderr.write(redactComposeDiagnostics(logs, [adminPassword]));
    } catch {}
    throw error;
  } finally {
    const cleanupFailures = [];
    for (const [command, arguments_, env] of [
      ["docker", [...compose, "down", "--volumes", "--remove-orphans"], environment],
      ...(imageId ? [["docker", ["image", "rm", imageTag], process.env]] : [])
    ]) {
      try {
        commandOutput(execute, command, arguments_, env);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    rmSync(layers, { recursive: true, force: true });
    rmSync(iidFile, { force: true });
    if (failure === undefined && cleanupFailures.length > 0) {
      throw new AggregateError(cleanupFailures, "Compose wait smoke cleanup failed");
    }
  }
}

function applicationJar() {
  const target = join(repository, "target");
  const candidates = readdirSync(target)
    .filter((name) => /^courtside-.+\.jar$/.test(name) && !name.endsWith(".jar.original"))
    .map((name) => ({ path: join(target, name), modified: statSync(join(target, name)).mtimeMs }))
    .sort((left, right) => right.modified - left.modified);
  if (!candidates[0]) throw new Error("No packaged Courtside application was found");
  return candidates[0].path;
}

function relativePath(path) {
  const prefix = `${repository}/`;
  if (!path.startsWith(prefix)) throw new Error("Compose smoke layers escaped the repository");
  return path.slice(prefix.length);
}

function javaExecutable() {
  return process.env.JAVA_HOME ? join(process.env.JAVA_HOME, "bin", "java") : "java";
}

function commandOutput(execute, command, arguments_, environment = process.env) {
  const result = execute(command, arguments_, {
    cwd: repository,
    env: environment,
    encoding: "utf8",
    shell: false,
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${arguments_.join(" ")} failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return String(result.stdout ?? "");
}

function executeProcess(command, arguments_, options) {
  return spawnSync(command, arguments_, options);
}

function availableUdpPort() {
  return new Promise((resolvePort, rejectPort) => {
    const socket = createSocket("udp4");
    socket.once("error", rejectPort);
    socket.bind(0, "127.0.0.1", () => {
      const address = socket.address();
      socket.close(() => resolvePort(address.port));
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runComposeWaitSmoke().catch((error) => {
    process.stderr.write(`compose-wait-smoke: ${error.message}\n`);
    process.exitCode = 1;
  });
}
