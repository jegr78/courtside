import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";

const byteBudget = 262144;
const streamLimit = 122880;
const lifetimeMilliseconds = 20000;
const incomplete = () => Object.freeze({ outcome: "incomplete", reason: "startup-diagnostics-incomplete" });
const inspection = '[{"Id":{{json .Id}},"Name":{{json .Name}},"Config":{"Labels":{{json .Config.Labels}}},'
  + '"State":{"Status":{{json .State.Status}},"Running":{{json .State.Running}},'
  + '"ExitCode":{{json .State.ExitCode}},"OOMKilled":{{json .State.OOMKilled}}}}]';

function privateDirectory(directory, runId) {
  if (typeof directory !== "string" || !isAbsolute(directory) || resolve(directory) !== directory
    || basename(directory) !== runId) throw new Error("directory-invalid");
  let current = directory;
  const binding = [];
  while (current !== parse(current).root) {
    const state = lstatSync(current);
    if (!state.isDirectory() || state.isSymbolicLink()) throw new Error("directory-invalid");
    if (current === directory && (state.uid !== process.getuid() || (state.mode & 0o777) !== 0o700)) {
      throw new Error("directory-invalid");
    }
    binding.push({ path: current, dev: state.dev, ino: state.ino });
    current = dirname(current);
  }
  return binding;
}

function resultBytes(result, limit) {
  if (!result || result.error || result.signal || result.truncated || result.timedOut
    || ![result.exitCode, result.code, result.status].some(code => code === 0)
    || [result.exitCode, result.code, result.status].some(code => code !== undefined && code !== 0)
    || ![result.stdout, result.stderr].every(value => Buffer.isBuffer(value) || typeof value === "string")) {
    throw new Error("command-incomplete");
  }
  const stdout = Buffer.from(result.stdout);
  const stderr = Buffer.from(result.stderr);
  if (stdout.length > limit || stderr.length > limit) throw new Error("command-incomplete");
  return { stdout, stderr };
}

export function captureSecurityStartupDiagnostics({ directory, attempt, identity, command } = {}) {
  try {
    if (!identity || typeof identity.runId !== "string" || !/^[a-z0-9][a-z0-9-]{5,47}$/.test(identity.runId)
      || ![identity.seedFingerprint, identity.instanceFingerprint].every(value => typeof value === "string"
        && /^sha256:[a-f0-9]{64}$/.test(value))
      || !Number.isInteger(attempt) || attempt < 1 || attempt > 3 || typeof command !== "function") return incomplete();
    const directoryBinding = privateDirectory(directory, identity.runId);
    const evidenceDirectory = join(directory, `startup-diagnostics-attempt${attempt}`);
    mkdirSync(evidenceDirectory, { mode: 0o700 });
    const evidenceBinding = lstatSync(evidenceDirectory);
    const deadline = performance.now() + lifetimeMilliseconds;
    const invoke = (args, limit) => {
      const remaining = Math.floor(deadline - performance.now());
      if (remaining <= 0) throw new Error("deadline-exhausted");
      const result = resultBytes(command(args, { timeoutMilliseconds: Math.min(15000, remaining), outputLimitBytes: limit }), limit);
      if (performance.now() >= deadline) throw new Error("deadline-exhausted");
      return result;
    };
    const project = `courtside-security-${identity.runId}`;
    const name = `${project}-seeder-1`;
    const inspected = invoke(["inspect", "--format", inspection, name], 32768);
    if (inspected.stderr.length) throw new Error("inspect-incomplete");
    const containers = JSON.parse(inspected.stdout.toString("utf8"));
    if (!Array.isArray(containers) || containers.length !== 1) throw new Error("container-invalid");
    const container = containers[0];
    const labels = container?.Config?.Labels;
    const expectedLabels = {
      "org.courtside.environment": "SECURITY", "org.courtside.security.run-id": identity.runId,
      "org.courtside.security.seed-fingerprint": identity.seedFingerprint,
      "org.courtside.security.instance-fingerprint": identity.instanceFingerprint,
      "com.docker.compose.project": project, "com.docker.compose.service": "seeder"
    };
    if (typeof container?.Id !== "string" || !/^[a-f0-9]{64}$/.test(container.Id)
      || container.Name !== `/${name}` || !labels
      || !Object.entries(expectedLabels).every(([key, value]) => labels[key] === value)
      || !["created", "running", "paused", "restarting", "removing", "exited", "dead"].includes(container.State?.Status)
      || typeof container.State.Running !== "boolean" || typeof container.State.OOMKilled !== "boolean"
      || !Number.isInteger(container.State.ExitCode) || container.State.ExitCode < 0 || container.State.ExitCode > 255) {
      throw new Error("container-invalid");
    }
    const state = Buffer.from(`${JSON.stringify({ containerId: container.Id, status: container.State.Status,
      running: container.State.Running, exitCode: container.State.ExitCode, oomKilled: container.State.OOMKilled })}\n`);
    let retainedBytes = 0;
    const retain = (filename, bytes) => {
      if (retainedBytes + bytes.length > byteBudget) throw new Error("budget-exhausted");
      const currentBinding = privateDirectory(directory, identity.runId);
      if (currentBinding.length !== directoryBinding.length || !currentBinding.every((entry, index) =>
        entry.path === directoryBinding[index].path && entry.dev === directoryBinding[index].dev
          && entry.ino === directoryBinding[index].ino)) throw new Error("directory-replaced");
      const target = lstatSync(evidenceDirectory);
      if (!target.isDirectory() || target.isSymbolicLink() || target.uid !== process.getuid()
        || (target.mode & 0o777) !== 0o700 || target.dev !== evidenceBinding.dev
        || target.ino !== evidenceBinding.ino) throw new Error("directory-invalid");
      const fd = openSync(join(evidenceDirectory, filename), constants.O_WRONLY | constants.O_CREAT
        | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        const file = fstatSync(fd);
        if (!file.isFile() || file.uid !== process.getuid() || (file.mode & 0o777) !== 0o600) throw new Error("file-invalid");
        writeFileSync(fd, bytes);
      } finally { closeSync(fd); }
      retainedBytes += bytes.length;
    };
    retain("seeder-state.json", state);
    const logs = invoke(["logs", "--tail", "200", container.Id], streamLimit);
    retain("stdout.bin", logs.stdout);
    retain("stderr.bin", logs.stderr);
    return Object.freeze({ outcome: "captured" });
  } catch { return incomplete(); }
}
