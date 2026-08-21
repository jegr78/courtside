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
    COURTSIDE_SECURITY_INSTANCE_FINGERPRINT: instanceFingerprint,
    COURTSIDE_SECURITY_MAX_REQUESTS: "1",
    COURTSIDE_SECURITY_MAX_CONCURRENCY: "1"
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

export function securityAssessmentReservationArgs(environment, attempt) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("The security attempt must be a positive integer");
  const runId = environment.COURTSIDE_SECURITY_RUN_ID;
  return ["create", "--pull", "never", "--name", `courtside-security-assessment-${runId}`, "--network", "none",
    "--label", `com.docker.compose.project=${securityProject(runId)}`,
    "--label", "org.courtside.environment=SECURITY",
    "--label", `org.courtside.security.run-id=${runId}`,
    "--label", `org.courtside.security.seed-fingerprint=${environment.COURTSIDE_SECURITY_SEED_FINGERPRINT}`,
    "--label", `org.courtside.security.instance-fingerprint=${environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT}`,
    "--label", `org.courtside.security.attempt=${attempt}`, reservationImage, "caddy", "version"];
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
  return execFileSync(command, args, {
    cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000
  });
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

export function mergeSecurityProcessEnvironment(security, host = process.env) {
  const selected = Object.fromEntries(Object.entries(security)
    .filter(([name]) => name.startsWith("COURTSIDE_SECURITY_")));
  return { ...host, ...selected };
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
      removeOwnedSecurityEnvironment(runId, {
        runId,
        seedFingerprint: environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
        instanceFingerprint: environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT
      });
      if (attempt === 3 || !/address already in use|port is already allocated/i.test(output)) throw failure;
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
  const imageArchitecture = execute("docker", ["image", "inspect", environment.COURTSIDE_SECURITY_IMAGE,
    "--format", "{{.Architecture}}"]).trim();
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
    imageArchitecture,
    runId
  };
}

export async function verifySecurityEnvironmentForAssessment(runId, { stopFile, deadline }) {
  const environment = mergeSecurityProcessEnvironment(readSecurityEnvironment(runId));
  const control = {
    beforeRequest() {
      if (existsSync(stopFile)) throw new Error("Emergency stop requested");
      if (Date.now() >= deadline.getTime()) throw new Error("The duration budget was exceeded");
    },
    remainingMilliseconds() {
      return Math.max(1, deadline.getTime() - Date.now());
    }
  };
  const command = async (args) => runSecurityCommand("docker", args, environment, control, stopFile);
  control.beforeRequest();
  const port = environment.COURTSIDE_SECURITY_HTTPS_PORT;
  const sourceResult = await runOwnedProcess("curl", ["--fail", "--silent", "--insecure",
    "--resolve", `localhost:${port}:127.0.0.1`, `https://localhost:${port}/api/source`], {
    timeoutMilliseconds: control.remainingMilliseconds(), stopFile, environment
  });
  const source = JSON.parse(sourceResult.stdout);
  const containerResult = await command(["inspect", `${securityProject(runId)}-app-1`, "--format", "{{json .}}"]);
  const imageResult = await command(["image", "inspect", environment.COURTSIDE_SECURITY_IMAGE, "--format", "{{.Id}}"]);
  const architectureResult = await command(["image", "inspect", environment.COURTSIDE_SECURITY_IMAGE,
    "--format", "{{.Architecture}}"]);
  const container = JSON.parse(containerResult.stdout);
  const expectedImage = imageResult.stdout.trim();
  const imageArchitecture = architectureResult.stdout.trim();
  assertSecurityIdentity({ source, labels: container.Config.Labels, image: container.Image }, environment, expectedImage);
  if (typeof source.commit !== "string" || !/^[a-f0-9]{7,64}$/.test(source.commit)) {
    throw new Error("The security candidate does not report a traceable source commit");
  }
  return {
    target: `https://localhost:${port}`, environment: source.environment,
    imageDigest: environment.COURTSIDE_SECURITY_IMAGE, imageArchitecture,
    applicationCommit: source.commit, applicationVersion: source.version, sourceUrl: source.sourceUrl,
    seedFingerprint: environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
    instanceFingerprint: environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT,
    containerImage: container.Image, runId
  };
}

async function runSecurityCommand(command, args, environment, control, stopFile, acceptedExitCodes = [0]) {
  control.beforeRequest();
  return runOwnedProcess(command, args, {
    timeoutMilliseconds: control.remainingMilliseconds(), stopFile, environment, acceptedExitCodes
  });
}

function responseHeader(output, name) {
  const match = output.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "im"));
  return match?.[1]?.trim();
}

export async function inspectPassiveSecurityRuntime(plan, { control, stopFile }) {
  const project = securityProject(plan.runId);
  const environment = { ...process.env, ...readSecurityEnvironment(plan.runId) };
  const inspect = async (service) => JSON.parse((await runSecurityCommand("docker",
    ["inspect", `${project}-${service}-1`, "--format", "{{json .}}"], environment, control, stopFile)).stdout);
  const app = await inspect("app");
  const proxy = await inspect("proxy");
  const hardened = [app, proxy].every((container) => container.HostConfig.ReadonlyRootfs
    && container.HostConfig.CapDrop?.includes("ALL")
    && container.HostConfig.SecurityOpt?.includes("no-new-privileges:true")
    && container.HostConfig.Memory > 0 && container.HostConfig.NanoCpus > 0);
  const published = proxy.NetworkSettings.Ports?.["443/tcp"] ?? [];
  const management = (await runSecurityCommand("docker", ["exec", `${project}-app-1`, "curl", "--silent",
    "--output", "/dev/null", "--write-out", "%{http_code}", "http://127.0.0.1:8080/actuator/health"],
  environment, control, stopFile)).stdout.trim();
  const direct = (await runSecurityCommand("docker", ["exec", `${project}-app-1`, "curl", "--silent", "--dump-header", "-",
    "--output", "/dev/null", "--header", "Host: attacker.example", "--header", "X-Forwarded-Host: attacker.example",
    "--header", "X-Forwarded-Proto: https", "http://127.0.0.1:8080/actuator/health"],
  environment, control, stopFile)).stdout;
  const directObserved = responseHeader(direct, "X-Courtside-Observed-Host") === "attacker.example"
    && responseHeader(direct, "X-Courtside-Observed-Scheme") === "https";
  return { requestCount: 2, observations: [
    { id: "runtime-hardening", layer: "container", passed: hardened,
      observation: hardened ? "runtime-controls-present" : "runtime-controls-incomplete" },
    { id: "loopback-publication", layer: "host", passed: published.length === 1
        && published[0].HostIp === "127.0.0.1",
      observation: published.length === 1 && published[0].HostIp === "127.0.0.1"
        ? "proxy-loopback-only" : "proxy-publication-mismatch" },
    { id: "management-separation", layer: "application", passed: management === "200",
      observation: management === "200" ? "management-internal-only" : "management-internal-unavailable" },
    { id: "direct-forwarded-behavior", layer: "application", passed: directObserved,
      observation: directObserved ? "direct-app-distinguished-from-proxy" : "direct-app-probe-failed" }
  ] };
}

export async function runPassiveZap(plan, stopFile, limits) {
  const environment = { ...process.env, ...readSecurityEnvironment(plan.runId),
    COURTSIDE_SECURITY_MAX_REQUESTS: String(limits.maxRequests),
    COURTSIDE_SECURITY_MAX_CONCURRENCY: String(plan.budgets.concurrency) };
  const attempt = limits.attempt;
  const name = `courtside-security-zap-${plan.runId}-${attempt}`;
  const reservation = `courtside-security-assessment-${plan.runId}`;
  const gateway = `${securityProject(plan.runId)}-scanner-gateway-1`;
  const deadline = Date.now() + limits.timeoutMilliseconds;
  const command = async (args, acceptedExitCodes = [0]) => {
    if (existsSync(stopFile)) throw new Error("Emergency stop requested");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Owned security process exceeded its duration limit");
    return runOwnedProcess("docker", args, {
      timeoutMilliseconds: remaining, stopFile, environment, acceptedExitCodes
    });
  };
  await command(securityAssessmentReservationArgs(environment, attempt));
  const args = [...securityComposeArgs(plan.runId), "--profile", "assessment", "run", "--no-deps",
    "--name", name, "zap", "sh", "-c", "/zap/zap-baseline.py -t http://scanner-gateway:8090 -m 0 -I -J zap.json; "
      + "printf '%s' $? >/tmp/zap-exit; test -f /zap/wrk/zap.json || exit 3; touch /tmp/zap-complete; "
      + "while [ ! -e /tmp/zap-collected ]; do sleep 0.1; done; exit \"$(cat /tmp/zap-exit)\""];
  try {
    await command([...securityComposeArgs(plan.runId), "--profile", "assessment", "up", "-d", "--wait",
      "scanner-gateway"]);
    let processResult;
    let processFailure;
    const scannerTimeout = deadline - Date.now();
    if (scannerTimeout <= 0) throw new Error("Owned security process exceeded its duration limit");
    const process = runOwnedProcess("docker", args, {
      timeoutMilliseconds: scannerTimeout,
      stopFile,
      environment,
      acceptedExitCodes: [0, 1, 2]
    }).then((result) => { processResult = result; }, (failure) => { processFailure = failure; });
    while (!processFailure && !processResult && !await containerExists(name, command)) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    if (processFailure) throw processFailure;
    const scannerRuntimeResult = await command(["inspect", name, "--format", "{{json .}}"]);
    const gatewayRuntimeResult = await command(["inspect", gateway, "--format", "{{json .}}"]);
    const scannerRuntime = JSON.parse(scannerRuntimeResult.stdout);
    const gatewayRuntime = JSON.parse(gatewayRuntimeResult.stdout);
    const runtimeHardened = scannerRuntimeHardened(scannerRuntime, {
      memory: 1024 * 1024 * 1024, nanoCpus: 2_000_000_000, pids: 256,
      networks: [`${securityProject(plan.runId)}_scanner-client`]
    }) && scannerRuntimeHardened(gatewayRuntime, {
      memory: 128 * 1024 * 1024, nanoCpus: 500_000_000, pids: 64,
      networks: [`${securityProject(plan.runId)}_scanner-client`, `${securityProject(plan.runId)}_scanner-upstream`]
    });
    let reportReady = await containerFileExists(name, "/tmp/zap-complete", command);
    while (!processFailure && !processResult && !reportReady) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      reportReady = await containerFileExists(name, "/tmp/zap-complete", command);
    }
    if (processFailure) throw processFailure;
    if (!reportReady) throw new Error(`ZAP stopped before producing its report: ${processResult?.stderr ?? ""}`);
    const rawReport = (await command(["exec", name, "cat", "/zap/wrk/zap.json"])).stdout;
    await command(["exec", name, "touch", "/tmp/zap-collected"]);
    await process;
    if (processFailure) throw processFailure;
    const report = JSON.parse(rawReport);
    const requestCount = await zapRequestCount(gateway, command);
    if (!Number.isSafeInteger(requestCount) || requestCount < 1) {
      throw new Error("The proxy produced no valid ZAP request count");
    }
    if (requestCount > limits.maxRequests) throw new Error("The scanner request budget was exceeded");
    return { ...report, requestCount, runtimeHardened };
  } finally {
    const cleanupFailures = [];
    for (const resource of [name, gateway, reservation]) {
      let removalFailure;
      try {
        await runOwnedProcess("docker", ["rm", "-f", resource], {
          timeoutMilliseconds: 10_000, stopFile: "/dev/null/courtside-cleanup-stop-disabled", environment
        });
      } catch (failure) {
        removalFailure = failure;
      }
      try {
        if (await containerExistsForCleanup(resource, environment)) {
          cleanupFailures.push(`${resource}: ${removalFailure?.message ?? "still present"}`);
        }
      } catch (failure) {
        cleanupFailures.push(`${resource}: cleanup could not be verified: ${failure.message}`);
      }
    }
    if (cleanupFailures.length) throw new Error(`Scanner cleanup was incomplete: ${cleanupFailures.join("; ")}`);
  }
}

export async function runAuthenticatedZap(plan, stopFile, limits, renderPlan) {
  const environment = { ...process.env, ...readSecurityEnvironment(plan.runId),
    COURTSIDE_SECURITY_MAX_REQUESTS: String(limits.maxRequests),
    COURTSIDE_SECURITY_MAX_CONCURRENCY: String(plan.budgets.concurrency),
    COURTSIDE_SECURITY_ALLOWED_METHODS: "GET,HEAD,OPTIONS",
    COURTSIDE_SECURITY_ALLOWED_PATH_PREFIXES: "/api,/courts,/my-bookings,/__security/zap-canary",
    COURTSIDE_SECURITY_CANARY_ENABLED: "true",
    COURTSIDE_SECURITY_MAX_TARGET_BYTES: String(limits.policy.maxTargetBytes) };
  const reservation = `courtside-security-assessment-${plan.runId}`;
  const gateway = `${securityProject(plan.runId)}-scanner-gateway-1`;
  const deadline = Date.now() + limits.timeoutMilliseconds;
  const command = async (args, options = {}) => {
    if (existsSync(stopFile)) throw new Error("Emergency stop requested");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Owned security process exceeded its duration limit");
    return runOwnedProcess("docker", args, {
      timeoutMilliseconds: remaining, stopFile, environment,
      acceptedExitCodes: options.acceptedExitCodes ?? [0], input: options.input,
      outputLimitBytes: options.outputLimitBytes ?? 1024 * 1024
    });
  };
  const containers = [];
  const reports = [];
  const executedPlans = [];
  let generatedBytes = 0;
  try {
    await command(securityAssessmentReservationArgs(environment, limits.attempt));
    await command([...securityComposeArgs(plan.runId), "--profile", "assessment", "up", "-d", "--wait",
      "scanner-gateway"]);
    for (const role of Object.keys(limits.sessions)) {
      const name = `courtside-security-zap-${plan.runId}-${limits.attempt}-${role.toLowerCase().replaceAll("_", "-")}`;
      containers.push(name);
      await command([...securityComposeArgs(plan.runId), "--profile", "assessment", "run", "-d", "--no-deps",
        "--name", name, "zap", "tail", "-f", "/dev/null"]);
      const runtime = JSON.parse((await command(["inspect", name, "--format", "{{json .}}"])).stdout);
      if (!scannerRuntimeHardened(runtime, {
        memory: 1024 * 1024 * 1024, nanoCpus: 2_000_000_000, pids: 256,
        networks: [`${securityProject(plan.runId)}_scanner-client`]
      })) throw new Error("Authenticated ZAP runtime controls are incomplete");
      const rendered = renderPlan(role, limits.sessions[role]);
      executedPlans.push({ role, plan: rendered.replaceAll(limits.sessions[role], limits.planSessionPlaceholder) });
      await command(["exec", "-i", name, "sh", "-c", "umask 077; cat > /tmp/courtside-plan.yaml"], {
        input: rendered
      });
      const zap = await command(["exec", name, "zap.sh", "-cmd", "-autorun", "/tmp/courtside-plan.yaml"], {
        acceptedExitCodes: [0, 2], outputLimitBytes: 4 * 1024 * 1024
      });
      if (zap.code !== 0) {
        throw new Error(`ZAP assessment failed: ${authenticatedZapDiagnostic(
          `${zap.stdout}\n${zap.stderr}`, Object.values(limits.sessions))}`);
      }
      const report = (await command(["exec", name, "cat", `/zap/wrk/report-${role.toLowerCase()}.json`], {
        outputLimitBytes: 10 * 1024 * 1024
      })).stdout;
      generatedBytes += Buffer.byteLength(report);
      reports.push(JSON.parse(report));
      await command(["rm", "-f", name]);
      containers.pop();
    }
    const gatewayRuntime = JSON.parse((await command(["inspect", gateway, "--format", "{{json .}}"])).stdout);
    const runtimeHardened = scannerRuntimeHardened(gatewayRuntime, {
      memory: 128 * 1024 * 1024, nanoCpus: 500_000_000, pids: 64,
      networks: [`${securityProject(plan.runId)}_scanner-client`, `${securityProject(plan.runId)}_scanner-upstream`]
    });
    const requestCount = await zapRequestCount(gateway, command);
    if (!Number.isSafeInteger(requestCount) || requestCount < 1 || requestCount > limits.maxRequests) {
      throw new Error("Authenticated ZAP exceeded its request budget");
    }
    const planDigest = `sha256:${createHash("sha256").update(JSON.stringify(executedPlans)).digest("hex")}`;
    if (planDigest !== limits.planDigest) throw new Error("Authenticated ZAP plan digest changed during execution");
    return { reports, requestCount, runtimeHardened, roles: Object.keys(limits.sessions), planDigest,
      generatedDataMegabytes: generatedBytes / (1024 * 1024) };
  } finally {
    const cleanupFailures = [];
    for (const resource of [...containers, gateway, reservation]) {
      try {
        await runOwnedProcess("docker", ["rm", "-f", resource], {
          timeoutMilliseconds: 10_000, stopFile: "/dev/null/courtside-cleanup-stop-disabled", environment
        });
      } catch (failure) {
        if (await containerExistsForCleanup(resource, environment)) cleanupFailures.push(`${resource}: ${failure.message}`);
      }
    }
    if (cleanupFailures.length) throw new Error(`Scanner cleanup was incomplete: ${cleanupFailures.join("; ")}`);
  }
}

export async function runOpenApiFuzzer(plan, stopFile, limits) {
  if (limits.maxRequests <= limits.policy.nativeRequestReserve) {
    throw new Error("The OpenAPI fuzz request budget cannot reserve native fixture requests");
  }
  const environment = { ...process.env, ...readSecurityEnvironment(plan.runId),
    COURTSIDE_SECURITY_MAX_REQUESTS: String(limits.maxRequests - limits.policy.nativeRequestReserve),
    COURTSIDE_SECURITY_MAX_CONCURRENCY: "1",
    COURTSIDE_SECURITY_ALLOWED_METHODS: "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    COURTSIDE_SECURITY_ALLOWED_PATH_PREFIXES: "/api,/manifest.webmanifest",
    COURTSIDE_SECURITY_CANARY_ENABLED: "false",
    COURTSIDE_SECURITY_MAX_TARGET_BYTES: "8192" };
  const reservation = `courtside-security-assessment-${plan.runId}`;
  const gateway = `${securityProject(plan.runId)}-scanner-gateway-1`;
  const scanner = `${securityProject(plan.runId)}-schemathesis-1`;
  const deadline = Date.now() + limits.timeoutMilliseconds;
  let fixture;
  const command = async (args, options = {}) => {
    if (existsSync(stopFile)) throw new Error("Emergency stop requested");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Owned security process exceeded its duration limit");
    return runOwnedProcess("docker", args, { timeoutMilliseconds: remaining, stopFile, environment,
      acceptedExitCodes: options.acceptedExitCodes ?? [0], input: options.input,
      outputLimitBytes: options.outputLimitBytes ?? 4 * 1024 * 1024 });
  };
  try {
    await command(securityAssessmentReservationArgs(environment, limits.attempt));
    await command([...securityComposeArgs(plan.runId), "--profile", "assessment", "up", "-d", "--wait",
      "scanner-gateway", "schemathesis"]);
    const scannerRuntime = JSON.parse((await command(["inspect", scanner, "--format", "{{json .}}"])).stdout);
    const gatewayRuntime = JSON.parse((await command(["inspect", gateway, "--format", "{{json .}}"])).stdout);
    const runtimeHardened = scannerRuntime.Config.Image === limits.policy.image
      && scannerRuntimeOwned(scannerRuntime, environment)
      && scannerRuntimeOwned(gatewayRuntime, environment)
      && scannerRuntimeHardened(scannerRuntime, { memory: 1024 * 1024 * 1024, nanoCpus: 2_000_000_000,
        pids: 256, networks: [`${securityProject(plan.runId)}_scanner-client`] })
      && scannerRuntimeHardened(gatewayRuntime, { memory: 128 * 1024 * 1024, nanoCpus: 500_000_000,
        pids: 64, networks: [`${securityProject(plan.runId)}_scanner-client`,
          `${securityProject(plan.runId)}_scanner-upstream`] });
    if (!runtimeHardened) throw new Error("OpenAPI fuzzer runtime controls are incomplete");
    const mountedDigest = (await command(["exec", scanner, "sha256sum", "/schema/openapi.yaml"])).stdout
      .trim().split(/\s+/)[0];
    if (`sha256:${mountedDigest}` !== limits.specificationDigest) {
      throw new Error("The mounted OpenAPI document differs from the planned contract");
    }
    fixture = await limits.prepareFixtures();
    const config = `headers = { Cookie = ${JSON.stringify(fixture.client.header())}, X-XSRF-TOKEN = ${JSON.stringify(fixture.client.csrfToken())} }\n`;
    await command(["exec", "-i", scanner, "sh", "-c", "umask 077; cat > /tmp/courtside-schemathesis.toml"],
      { input: config });
    const events = {};
    let generatedBytes = 0;
    const runMode = async (mode) => {
      const selected = limits.inventory.filter(({ modes }) => modes.includes(mode));
      const reportDirectory = `/tmp/courtside-schemathesis-${mode}`;
      const args = ["exec", scanner, "st", "--config-file", "/tmp/courtside-schemathesis.toml", "run",
        "/schema/openapi.yaml", "--url", "http://scanner-gateway:8090", "--phases", "fuzzing", "--mode", mode,
        "--max-examples", String(limits.policy.maxExamples), "--workers", String(limits.policy.workers),
        "--seed", String(limits.policy.seed), "--request-timeout", String(limits.policy.requestTimeoutSeconds),
        "--request-retries", "0", "--max-redirects", "0", "--max-failures", String(limits.policy.maxFailures),
        "--checks", limits.policy.checks.join(","), "--report", "ndjson", "--report-dir", reportDirectory,
        "--output-sanitize", "true", "--output-truncate", "true", "--generation-database", ":memory:", "--no-color",
        ...selected.flatMap(({ operationId }) => ["--include-operation-id", operationId])];
      const execution = await command(args, { acceptedExitCodes: [0, 1] });
      if (![0, 1].includes(execution.code)) throw new Error("Schemathesis failed before producing coverage");
      const report = (await command(["exec", scanner, "sh", "-c", `cat ${reportDirectory}/*.ndjson`],
        { outputLimitBytes: 25 * 1024 * 1024 })).stdout;
      generatedBytes += Buffer.byteLength(report);
      events[mode] = report.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    };
    await runMode("positive");
    const stateBefore = await limits.captureState();
    await runMode("negative");
    const importResult = await limits.runImportCases(fixture);
    const stateAfter = await limits.captureState();
    const metrics = await scannerGatewayMetrics(gateway, command);
    const requestCount = metrics.requests + fixture.requestCount + importResult.requestCount;
    if (fixture.requestCount + importResult.requestCount > limits.policy.nativeRequestReserve
        || requestCount > limits.maxRequests) throw new Error("The OpenAPI fuzz request budget was exceeded");
    return { events, importCases: importResult.cases, stateBefore, stateAfter, requestCount, runtimeHardened,
      specificationDigest: limits.specificationDigest,
      generatedDataMegabytes: (generatedBytes + metrics.requestBytes) / (1024 * 1024) };
  } finally {
    fixture?.close();
    const cleanupFailures = [];
    for (const resource of [scanner, gateway, reservation]) {
      try {
        await runOwnedProcess("docker", ["rm", "-f", resource], {
          timeoutMilliseconds: 10_000, stopFile: "/dev/null/courtside-cleanup-stop-disabled", environment
        });
      } catch (failure) {
        if (await containerExistsForCleanup(resource, environment)) cleanupFailures.push(`${resource}: ${failure.message}`);
      }
    }
    if (cleanupFailures.length) throw new Error(`Scanner cleanup was incomplete: ${cleanupFailures.join("; ")}`);
  }
}

export async function securityDomainStateFingerprint(runId, stopFile, timeoutMilliseconds) {
  const environment = { ...process.env, ...readSecurityEnvironment(runId) };
  const dump = await runOwnedProcess("docker", [...securityComposeArgs(runId), "exec", "-T", "db", "pg_dump",
    "--data-only", "--column-inserts", "--no-owner", "--no-privileges",
    "--restrict-key=4f96f35005ce47c58f86e12cb61ab144",
    "--exclude-table=spring_session", "--exclude-table=spring_session_attributes",
    "--exclude-table=login_attempt_limit", "--exclude-table=import_preview", "--exclude-table=import_run",
    "-U", "courtside", "courtside_security"], {
    timeoutMilliseconds, stopFile, environment, outputLimitBytes: 50 * 1024 * 1024
  });
  const stable = dump.stdout.split("\n").filter((line) => !line.startsWith("SELECT pg_catalog.setval")).join("\n");
  return `sha256:${createHash("sha256").update(stable).digest("hex")}`;
}

export function authenticatedZapDiagnostic(output, sessionCookies) {
  let safe = String(output);
  for (const cookie of sessionCookies) safe = safe.replaceAll(cookie, "[REDACTED]");
  return safe.replace(/http:\/\/scanner-gateway:8090\S*/g, "[SCANNER_ROUTE]")
    .replace(/(cookie|authorization|password|token)\s*[:=][^\r\n]+/gi, "$1=[REDACTED]")
    .replace(/SESSION=[^;\s]+/gi, "SESSION=[REDACTED]")
    .slice(-8192)
    .trim();
}

function scannerRuntimeHardened(container, expected) {
  const host = container.HostConfig;
  const networks = Object.keys(container.NetworkSettings.Networks ?? {}).toSorted();
  return host.ReadonlyRootfs && host.CapDrop?.includes("ALL")
    && host.SecurityOpt?.includes("no-new-privileges:true")
    && host.Memory === expected.memory && host.NanoCpus === expected.nanoCpus && host.PidsLimit === expected.pids
    && Object.keys(host.PortBindings ?? {}).length === 0
    && JSON.stringify(networks) === JSON.stringify(expected.networks.toSorted());
}

function scannerRuntimeOwned(container, environment) {
  const labels = container.Config.Labels ?? {};
  return labels["org.courtside.environment"] === "SECURITY"
    && labels["org.courtside.security.run-id"] === environment.COURTSIDE_SECURITY_RUN_ID
    && labels["org.courtside.security.seed-fingerprint"] === environment.COURTSIDE_SECURITY_SEED_FINGERPRINT
    && labels["org.courtside.security.instance-fingerprint"]
      === environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT;
}

async function containerExistsForCleanup(name, environment) {
  try {
    await runOwnedProcess("docker", ["inspect", name], {
      timeoutMilliseconds: 10_000, stopFile: "/dev/null/courtside-cleanup-stop-disabled", environment
    });
    return true;
  } catch (failure) {
    if (isMissingDockerResource(failure, name)) return false;
    throw failure;
  }
}

export function isMissingDockerResource(failure, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:Error:|Error response from daemon:) No such (?:object|container): ${escapedName}\\s*$`)
    .test(failure?.message ?? "");
}

async function containerFileExists(name, path, command) {
  try {
    await command(["exec", name, "test", "-e", path]);
    return true;
  } catch {
    return false;
  }
}

async function containerExists(name, command) {
  try {
    await command(["inspect", name]);
    return true;
  } catch {
    return false;
  }
}

async function zapRequestCount(gateway, command) {
  try {
    return (await scannerGatewayMetrics(gateway, command)).requests;
  } catch {
    return 0;
  }
}

async function scannerGatewayMetrics(gateway, command) {
  const raw = (await command(["exec", gateway, "cat", "/tmp/security-gateway-metrics"])).stdout.trim();
  const [requests, requestBytes] = raw.split(" ").map(Number);
  if (![requests, requestBytes].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Scanner gateway metrics are invalid");
  }
  return { requests, requestBytes };
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
