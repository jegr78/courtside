import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { runOwnedProcess } from "./security-passive-deployment.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = join(root, "deploy", "compose.security.yaml");
const stateRoot = join(root, "build", "security");
const reservationImage = "caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648";
export const securityStateRoot = stateRoot;

export function securityProject(runId) {
  if (!/^[a-z0-9][a-z0-9-]{5,47}$/.test(runId)) {
    throw new Error("The security run ID must contain 6 to 48 lowercase letters, digits, or hyphens");
  }
  return `courtside-security-${runId}`;
}

export function securityComposeArgs(runId) {
  return ["compose", "-p", securityProject(runId), "-f", composeFile];
}

export function securityEnvironment(runId, image, password = randomBytes(24).toString("base64url"), httpsPort = 0) {
  if (!/^(?:sha256:[a-f0-9]{64}|[^\s@]+@sha256:[a-f0-9]{64})$/.test(image)) {
    throw new Error("The security candidate must be selected by immutable image digest");
  }
  const seed = readFileSync(join(root, "src/main/resources/security-assessment-dataset.properties"));
  const seedFingerprint = `sha256:${createHash("sha256").update(seed).digest("hex")}`;
  const instanceFingerprint = `sha256:${randomBytes(32).toString("hex")}`;
  return {
    COURTSIDE_SECURITY_RUN_ID: runId,
    COURTSIDE_SECURITY_IMAGE: image,
    COURTSIDE_SECURITY_HTTPS_PORT: String(httpsPort),
    COURTSIDE_SECURITY_SHARED_PASSWORD: password,
    COURTSIDE_SECURITY_SEED_FINGERPRINT: seedFingerprint,
    COURTSIDE_SECURITY_INSTANCE_FINGERPRINT: instanceFingerprint
  };
}

export function availableLoopbackPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((failure) => failure ? rejectPort(failure) : resolvePort(address.port));
    });
  });
}

export function securityDownPlan(runId) {
  return { command: "docker", args: [...securityComposeArgs(runId), "down", "--volumes", "--remove-orphans"] };
}

export function securityReservationArgs(environment) {
  const runId = environment.COURTSIDE_SECURITY_RUN_ID;
  return ["create", "--pull", "never", "--name", `courtside-security-reservation-${runId}`, "--network", "none",
    "--label", `com.docker.compose.project=${securityProject(runId)}`,
    "--label", "org.courtside.environment=SECURITY",
    "--label", `org.courtside.security.run-id=${runId}`,
    "--label", `org.courtside.security.seed-fingerprint=${environment.COURTSIDE_SECURITY_SEED_FINGERPRINT}`,
    "--label", `org.courtside.security.instance-fingerprint=${environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT}`,
    reservationImage, "caddy", "version"];
}

export function recoveryEnvironment(runId, seedFingerprint) {
  return {
    ...securityEnvironment(runId, `sha256:${"0".repeat(64)}`, "recovery-placeholder", 1),
    ...(seedFingerprint ? { COURTSIDE_SECURITY_SEED_FINGERPRINT: seedFingerprint } : {})
  };
}

export function assertSecurityRecoveryOwnership(resources, expected) {
  const project = securityProject(expected.runId);
  if (![expected.seedFingerprint, expected.instanceFingerprint]
    .every((value) => /^sha256:[a-f0-9]{64}$/.test(value))) {
    throw new Error("The retained security fingerprint is invalid");
  }
  for (const resource of resources) {
    const labels = resource.labels ?? {};
    if (labels["com.docker.compose.project"] !== project
        || labels["org.courtside.environment"] !== "SECURITY"
        || labels["org.courtside.security.run-id"] !== expected.runId
        || labels["org.courtside.security.seed-fingerprint"] !== expected.seedFingerprint
        || labels["org.courtside.security.instance-fingerprint"] !== expected.instanceFingerprint) {
      throw new Error(`Security ${resource.type} ${resource.id} does not belong to the retained run identity`);
    }
  }
}

export function assertSecurityStartAvailable(resources, stateExists, identityExists) {
  if (resources.length || stateExists || identityExists) {
    throw new Error("The security run identity already exists");
  }
}

export function assertSecurityIdentity({ source, labels, image }, expected, expectedImage = expected.COURTSIDE_SECURITY_IMAGE) {
  if (source.environment !== "SECURITY") throw new Error("The target does not report SECURITY");
  if (image !== expectedImage) throw new Error("The running target image does not match this security run");
  if (labels["org.courtside.environment"] !== "SECURITY"
      || labels["org.courtside.security.run-id"] !== expected.COURTSIDE_SECURITY_RUN_ID
      || labels["org.courtside.security.seed-fingerprint"] !== expected.COURTSIDE_SECURITY_SEED_FINGERPRINT
      || labels["org.courtside.security.instance-fingerprint"] !== expected.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT) {
    throw new Error("The running target identity does not match this security run");
  }
}

function execute(command, args, environment = process.env) {
  return execFileSync(command, args, { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function securityStateFile(runId) {
  securityProject(runId);
  return join(stateRoot, runId, "environment.json");
}

export function securityIdentityFile(runId) {
  securityProject(runId);
  return join(stateRoot, runId, "identity.json");
}

function writeState(runId, environment) {
  const file = securityStateFile(runId);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(environment, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function readSecurityEnvironment(runId) {
  return JSON.parse(readFileSync(securityStateFile(runId), "utf8"));
}

export function readSecurityIdentity(runId) {
  return JSON.parse(readFileSync(securityIdentityFile(runId), "utf8"));
}

function writeIdentity(runId, identity) {
  const file = securityIdentityFile(runId);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export async function startSecurityEnvironment(runId, image) {
  assertSecurityStartAvailable(securityProjectResources(runId), existsSync(securityStateFile(runId)),
    existsSync(securityIdentityFile(runId)));
  let environment = securityEnvironment(runId, image, randomBytes(24).toString("base64url"),
    await availableLoopbackPort());
  for (let attempt = 1; attempt <= 3; attempt++) {
    reserveSecurityEnvironment(environment);
    writeState(runId, environment);
    try {
      execute("docker", [...securityComposeArgs(runId), "up", "-d", "--wait"], { ...process.env, ...environment });
      break;
    } catch (failure) {
      const output = `${failure.stderr ?? ""}`;
      if (attempt === 3 || !/address already in use|port is already allocated/i.test(output)) throw failure;
      removeOwnedSecurityEnvironment(runId, {
        runId,
        seedFingerprint: environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
        instanceFingerprint: environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT
      });
      environment = { ...environment, COURTSIDE_SECURITY_HTTPS_PORT: String(await availableLoopbackPort()) };
    }
  }
  const identity = verifySecurityEnvironment(runId);
  writeIdentity(runId, identity);
  process.stdout.write(`Security environment ${runId} is ready\n`);
  process.stdout.write(`Shared synthetic credential: ${environment.COURTSIDE_SECURITY_SHARED_PASSWORD}\n`);
}

export function verifySecurityEnvironment(runId) {
  const environment = readSecurityEnvironment(runId);
  const port = environment.COURTSIDE_SECURITY_HTTPS_PORT;
  const source = JSON.parse(execute("curl", ["--fail", "--silent", "--insecure",
    "--resolve", `localhost:${port}:127.0.0.1`, `https://localhost:${port}/api/source`]));
  const container = JSON.parse(execute("docker", ["inspect", `${securityProject(runId)}-app-1`, "--format", "{{json .}}"]));
  const expectedImage = execute("docker", ["image", "inspect", environment.COURTSIDE_SECURITY_IMAGE,
    "--format", "{{.Id}}"]).trim();
  assertSecurityIdentity({ source, labels: container.Config.Labels, image: container.Image }, environment, expectedImage);
  if (typeof source.commit !== "string" || !/^[a-f0-9]{7,64}$/.test(source.commit)) {
    throw new Error("The security candidate does not report a traceable source commit");
  }
  return {
    target: `https://localhost:${port}`,
    environment: source.environment,
    imageDigest: environment.COURTSIDE_SECURITY_IMAGE,
    applicationCommit: source.commit,
    applicationVersion: source.version,
    sourceUrl: source.sourceUrl,
    seedFingerprint: environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
    instanceFingerprint: environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT,
    containerImage: container.Image,
    runId
  };
}

export async function inspectPassiveSecurityRuntime(plan) {
  const project = securityProject(plan.runId);
  const inspect = (service) => JSON.parse(execute("docker", ["inspect", `${project}-${service}-1`, "--format", "{{json .}}"]));
  const hardened = [inspect("app"), inspect("proxy")].every((container) => container.HostConfig.ReadonlyRootfs
    && container.HostConfig.CapDrop?.includes("ALL")
    && container.HostConfig.SecurityOpt?.includes("no-new-privileges:true")
    && container.HostConfig.Memory > 0 && container.HostConfig.NanoCpus > 0);
  const published = inspect("proxy").NetworkSettings.Ports?.["443/tcp"] ?? [];
  const management = execute("docker", ["exec", `${project}-app-1`, "curl", "--silent", "--output", "/dev/null",
    "--write-out", "%{http_code}", "http://127.0.0.1:8080/actuator/health"]).trim();
  return [
    { id: "runtime-hardening", layer: "container", passed: hardened,
      observation: hardened ? "runtime-controls-present" : "runtime-controls-incomplete" },
    { id: "loopback-publication", layer: "host", passed: published.length === 1
        && published[0].HostIp === "127.0.0.1",
      observation: published.length === 1 && published[0].HostIp === "127.0.0.1"
        ? "proxy-loopback-only" : "proxy-publication-mismatch" },
    { id: "management-separation", layer: "application", passed: management === "200",
      observation: management === "200" ? "management-internal-only" : "management-internal-unavailable" }
  ];
}

export async function runPassiveZap(plan, evidenceDirectory, stopFile) {
  const environment = { ...process.env, ...readSecurityEnvironment(plan.runId),
    COURTSIDE_SECURITY_EVIDENCE_DIR: evidenceDirectory };
  const name = `courtside-security-zap-${plan.runId}`;
  const proxy = `${securityProject(plan.runId)}-proxy-1`;
  resetZapAccessLog(proxy, environment);
  const args = [...securityComposeArgs(plan.runId), "--profile", "assessment", "run", "--rm", "--no-deps",
    "--name", name, "zap", "zap-baseline.py", "-t", "http://proxy:8080", "-m", "0", "-I", "-J", "zap.json"];
  const result = await runOwnedProcess("docker", args, {
    timeoutMilliseconds: plan.budgets.durationSeconds * 1000,
    stopFile,
    cleanup: async () => {
      try { execute("docker", ["rm", "-f", name], environment); } catch { }
      try { resetZapAccessLog(proxy, environment); } catch { }
    },
    environment,
    acceptedExitCodes: [0, 1, 2]
  });
  const reportFile = join(evidenceDirectory, "zap.json");
  try {
    if (!existsSync(reportFile)) {
      throw new Error(`ZAP produced no JSON report (exit ${result.code})`);
    }
    const report = JSON.parse(readFileSync(reportFile, "utf8"));
    rmSync(reportFile);
    const requestCount = Number(execute("docker", ["exec", proxy, "sh", "-c",
      "wc -l < /tmp/zap-access.log"], environment).trim());
    if (!Number.isSafeInteger(requestCount) || requestCount < 1) {
      throw new Error("The proxy produced no valid ZAP request count");
    }
    return { ...report, requestCount };
  } finally {
    resetZapAccessLog(proxy, environment);
  }
}

function resetZapAccessLog(proxy, environment) {
  execute("docker", ["exec", proxy, "sh", "-c", ": > /tmp/zap-access.log"], environment);
}

export function readSecurityProxyCa(runId) {
  return execute("docker", ["exec", `${securityProject(runId)}-proxy-1`, "cat",
    "/data/caddy/pki/authorities/local/root.crt"]);
}

export function stopSecurityEnvironment(runId) {
  const environment = readSecurityEnvironment(runId);
  removeOwnedSecurityEnvironment(runId, {
    runId: environment.COURTSIDE_SECURITY_RUN_ID,
    seedFingerprint: environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
    instanceFingerprint: environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT
  });
}

function reserveSecurityEnvironment(environment) {
  execute("docker", securityReservationArgs(environment));
  const expected = {
    runId: environment.COURTSIDE_SECURITY_RUN_ID,
    seedFingerprint: environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
    instanceFingerprint: environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT
  };
  try {
    assertSecurityRecoveryOwnership(securityProjectResources(expected.runId), expected);
  } catch (failure) {
    execute("docker", ["rm", `courtside-security-reservation-${expected.runId}`]);
    throw failure;
  }
}

export function recoverSecurityEnvironment(runId, expected) {
  if (expected?.runId !== runId) throw new Error("The retained recovery run identity does not match");
  removeOwnedSecurityEnvironment(runId, expected);
}

function removeOwnedSecurityEnvironment(runId, expected) {
  const resources = securityProjectResources(runId);
  assertSecurityRecoveryOwnership(resources, expected);
  removeSecurityResources(resources);
  rmSync(securityStateFile(runId), { force: true });
  rmSync(securityIdentityFile(runId), { force: true });
}

function securityProjectResources(runId) {
  const project = securityProject(runId);
  const filter = `label=com.docker.compose.project=${project}`;
  const containers = execute("docker", ["ps", "-aq", "--filter", filter]).trim().split("\n").filter(Boolean);
  const networks = execute("docker", ["network", "ls", "-q", "--filter", filter]).trim().split("\n").filter(Boolean);
  const volumes = execute("docker", ["volume", "ls", "-q", "--filter", filter]).trim().split("\n").filter(Boolean);
  return [
    ...inspectResources("container", containers, ["inspect"]),
    ...inspectResources("network", networks, ["network", "inspect"]),
    ...inspectResources("volume", volumes, ["volume", "inspect"])
  ];
}

function inspectResources(type, ids, command) {
  if (!ids.length) return [];
  return JSON.parse(execute("docker", [...command, ...ids])).map((resource) => ({
    type,
    id: resource.Id ?? resource.ID ?? resource.Name,
    labels: resource.Config?.Labels ?? resource.Labels
  }));
}

function removeSecurityResources(resources) {
  for (const [type, command] of [["container", ["rm", "-f"]], ["network", ["network", "rm"]],
    ["volume", ["volume", "rm"]]]) {
    const ids = resources.filter((resource) => resource.type === type).map((resource) => resource.id);
    if (ids.length) execute("docker", [...command, ...ids]);
  }
}

async function main(argv) {
  const [command, runId, image] = argv;
  if (command === "start" && runId && image) return await startSecurityEnvironment(runId, image);
  if (command === "verify" && runId) return verifySecurityEnvironment(runId);
  if ((command === "stop" || command === "reset") && runId) return stopSecurityEnvironment(runId);
  if (command === "recover" && runId) return recoverSecurityEnvironment(runId);
  throw new Error(
    "Usage: security-environment.mjs <start RUN_ID IMAGE|verify RUN_ID|stop RUN_ID|reset RUN_ID|recover RUN_ID>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (failure) {
    process.stderr.write(`${failure.stderr || failure.message}\n`);
    process.exitCode = 1;
  }
}
