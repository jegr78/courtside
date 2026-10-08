import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { passiveScannerOrigin, runOwnedProcess } from "./security-passive-deployment.mjs";
import { evaluateResourceSignals, evaluateSafetyLimits, resourceAbuseIntegrityDigest } from "./security-resource-abuse.mjs";
import { fixtureImagePlan, stageFixtureClasses } from "./fixture-artifact.mjs";
import { createSecurityMailCertificate, securityMailTrustPlan } from "./security-mail-capture.mjs";
import { resourceStateCatalogSql, resourceStateSnapshotSql, parseResourceState } from "./security-resource-state.mjs";
import { captureResourceState } from "./security-resource-state.mjs";
import { parseResourceJournal } from "./security-resource-journal.mjs";
import { resourceDatePlan } from "./security-resource-dates.mjs";
import { captureSecurityMailBaseline } from "./security-mail-observation.mjs";
import { resourceIntegritySnapshotFingerprint } from "./security-resource-integrity.mjs";
import { observeResourceEffects, cleanupAndRecoverResourceRuntime, createResourceEvidence,
  writeNativeEvidence, retainResourceEvidenceFailure } from "./security-resource-runtime.mjs";
import { captureResourceAuthentication, resourceSessionProjectionClassPaths } from "./security-resource-auth.mjs";
import { captureSecurityStartupDiagnostics } from "./security-startup-diagnostics.mjs";
import { inspectReusableImages, verifyReusableImages } from "./immutable-image-reuse.mjs";
import { attemptStep, failureReason } from "./failure-reason.mjs";
import { schemathesisConfiguration } from "./security-openapi-fuzz.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = join(root, "deploy", "compose.security.yaml");
const schemathesisReasonProjection = readFileSync(join(root, "security", "schemathesis_reason.py"), "utf8");
const stateRoot = join(root, "build", "security");
const reservationImage = deployedCaddyImage();
export const securityStateRoot = stateRoot;

function deployedCaddyImage() {
  const found = /caddy(?::[\w.-]+)?@sha256:[a-f0-9]{64}/.exec(readFileSync(composeFile, "utf8"));
  if (!found) {
    throw new Error(`${composeFile} names no Caddy image pinned by digest`);
  }
  return found[0];
}

export function securityProject(runId) {
  if (!/^[a-z0-9][a-z0-9-]{5,47}$/.test(runId)) {
    throw new Error("The security run ID must contain 6 to 48 lowercase letters, digits, or hyphens");
  }
  return `courtside-security-${runId}`;
}

export function resourceAuthenticationPolicy(runtime, application, classpathText) {
  const securityLibraries = typeof classpathText === "string" && Buffer.byteLength(classpathText) <= 1048576
    ? [...classpathText.matchAll(/^- "BOOT-INF\/lib\/spring-security-core-([^"\r\n]+)\.jar"$/gm)] : [];
  if (securityLibraries.length !== 1 || !/^7\.\d+\.\d+$/.test(securityLibraries[0][1])) {
    throw new Error("The candidate password-factor implementation is unverified");
  }
  const environment = new Map();
  for (const entry of runtime?.Config?.Env ?? []) {
    if (typeof entry !== "string" || !entry.includes("=")) throw new Error("Authentication environment is incomplete");
    const index = entry.indexOf("=");
    const name = entry.slice(0, index);
    if (environment.has(name)) throw new Error("Authentication environment is ambiguous");
    environment.set(name, entry.slice(index + 1));
  }
  if ([...environment.keys()].some(name => name === "SPRING_APPLICATION_JSON" || name.startsWith("SPRING_CONFIG_")
      || name.startsWith("SPRING_SESSION_") || name.startsWith("SPRING_SECURITY_"))
      || /-D(?:spring|courtside)\./.test(environment.get("JAVA_TOOL_OPTIONS") ?? "")) {
    throw new Error("Authentication configuration overrides are unsupported");
  }
  const value = raw => {
    if (typeof raw === "number") return String(raw);
    if (typeof raw !== "string") throw new Error("Candidate authentication configuration is incomplete");
    const expression = /^\$\{([A-Z_]+):([^{}]+)\}$/.exec(raw);
    if (expression) return environment.get(expression[1]) ?? expression[2];
    if (raw.includes("${")) throw new Error("Candidate authentication configuration is unsupported");
    return raw;
  };
  const integer = raw => {
    const text = value(raw);
    if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text))) throw new Error("Invalid authentication integer");
    return Number(text);
  };
  const duration = raw => {
    const match = /^([1-9]\d*)(ms|s|m|h|d)$/.exec(value(raw));
    if (!match) throw new Error("Invalid authentication duration");
    const milliseconds = Number(match[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
    if (!Number.isSafeInteger(milliseconds)) throw new Error("Invalid authentication duration");
    return milliseconds;
  };
  const session = application?.courtside?.session;
  const login = application?.courtside?.["login-protection"];
  const inactivity = duration(application?.spring?.session?.timeout);
  if (inactivity % 1000 || value(application?.server?.servlet?.session?.cookie?.secure) !== "true") {
    throw new Error("The assessed authentication cookie policy is unsupported");
  }
  return {
    sessionPolicy: { inactivitySeconds: inactivity / 1000,
      absoluteLifetimeMilliseconds: duration(session?.["absolute-lifetime"]),
      concurrentLimit: integer(session?.["concurrent-limit"]), cookieName: "__Host-SESSION", browserFamily: "OTHER",
      passwordFactorRequired: true },
    loginPolicy: { proofMode: "http-bounded-v1",
      address: { maxFailures: integer(login?.address?.["max-failures"]),
        windowMilliseconds: duration(login?.address?.window), blockMilliseconds: duration(login?.address?.block) },
      global: { threshold: integer(login?.global?.threshold), windowMilliseconds: duration(login?.global?.window) } }
  };
}

export function resourcePublicationPolicy(runtime, application, classpathText) {
  const reject = () => { throw new Error("Resource-abuse publication configuration unsupported"); };
  const config = runtime?.Config;
  if (!config || !Array.isArray(config.Env) || !Array.isArray(config.Entrypoint)
      || ![null, undefined].includes(config.Cmd) && (!Array.isArray(config.Cmd) || config.Cmd.length)) reject();
  const entrypoint = config.Entrypoint;
  const flags = ["--sun-misc-unsafe-memory-access=deny", "-XX:MaxRAMPercentage=50.0", "-XX:MaxRAMPercentage=75.0", "-XX:+ExitOnOutOfMemoryError"];
  if (!["java", "/opt/java/openjdk/bin/java"].includes(entrypoint[0])
      || entrypoint.at(-1) !== "org.springframework.boot.loader.launch.JarLauncher"
      || !entrypoint.slice(1, -1).every(flag => flags.includes(flag))
      || new Set(entrypoint.slice(1, -1)).size !== entrypoint.length - 2
      || entrypoint.filter(flag => flag.startsWith("-XX:MaxRAMPercentage=")).length > 1) reject();
  const names = new Set();
  const trustOptions = "-Djavax.net.ssl.trustStore=/trust/mail.p12 -Djavax.net.ssl.trustStorePassword=changeit -Djavax.net.ssl.trustStoreType=PKCS12";
  for (const entry of config.Env) {
    if (typeof entry !== "string" || !entry.includes("=")) reject();
    const [rawName] = entry.split("=");
    const name = rawName.toUpperCase().replace(/[.-]/g, "_");
    const value = entry.slice(rawName.length + 1);
    if (names.has(name)) reject();
    names.add(name);
    if (name.startsWith("SPRING_") && !["SPRING_DATASOURCE_URL", "SPRING_DATASOURCE_USERNAME", "SPRING_DATASOURCE_PASSWORD"].includes(name)) reject();
    if (["JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS"].includes(name)
        && value !== "" && !(name === "JAVA_TOOL_OPTIONS" && value === trustOptions)) reject();
  }
  const events = application?.spring?.modulith?.events;
  if (!events || typeof events["completion-mode"] !== "string" || events["completion-mode"].toUpperCase() !== "DELETE"
      || Object.keys(application).some(key => /^spring[._-]/i.test(key))
      || [application.spring, application.spring.modulith, events].some(value =>
        !value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => key.includes(".")))
      || ["config", "profiles", "main"].some(key => Object.hasOwn(application.spring, key))) reject();
  const jdbc = events.jdbc;
  if (jdbc !== undefined && (!jdbc || typeof jdbc !== "object" || Array.isArray(jdbc)
      || Object.keys(jdbc).some(key => !["use-legacy-structure", "schema-initialization"].includes(key))
      || Object.hasOwn(jdbc, "use-legacy-structure") && jdbc["use-legacy-structure"] !== false)) reject();
  if (jdbc?.["schema-initialization"] !== undefined) {
    const initialization = jdbc["schema-initialization"];
    if (!initialization || typeof initialization !== "object" || Array.isArray(initialization)
        || Object.keys(initialization).length !== 1 || initialization.enabled !== false) reject();
  }
  const libraries = typeof classpathText === "string" && Buffer.byteLength(classpathText) <= 1048576
    ? classpathText.split(/\r?\n/).filter(line => line.includes("spring-modulith-events-jdbc")) : [];
  if (libraries.length !== 1 || libraries[0] !== '- "BOOT-INF/lib/spring-modulith-events-jdbc-2.1.1.jar"') reject();
  return { completionMode: "DELETE", repositoryMode: "JDBC_V2",
    repositoryJarPath: "/app/BOOT-INF/lib/spring-modulith-events-jdbc-2.1.1.jar" };
}

export function resourcePublicationProjection(projectionOutput, policy) {
  if (typeof projectionOutput !== "string" || Buffer.byteLength(projectionOutput) > 4096) {
    throw new Error("Resource-abuse publication projection incomplete");
  }
  let projection;
  try { projection = JSON.parse(projectionOutput); }
  catch { throw new Error("Resource-abuse publication projection unsupported"); }
  if (!projection || Object.keys(projection).sort().join(",") !== "eventType,listenerId,repositoryClassDigest,repositoryMode"
      || projectionOutput.trim() !== JSON.stringify(projection)
      || projection.repositoryMode !== policy.repositoryMode
      || !/^sha256:[a-f0-9]{64}$/.test(projection.repositoryClassDigest ?? "")
      || projection.eventType !== "org.courtside.shared.BookingConfirmed"
      || typeof projection.listenerId !== "string" || !projection.listenerId.trim()
      || projection.listenerId.length > 512 || /[^\x20-\x7e]/.test(projection.listenerId)) {
    throw new Error("Resource-abuse publication projection unsupported");
  }
  return projection;
}

export function resourceSessionDecoderPlan(environment, attempt, image) {
  const runId = environment.COURTSIDE_SECURITY_RUN_ID;
  const project = securityProject(runId);
  if (!Number.isSafeInteger(attempt) || attempt < 1 || !/^sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error("The session decoder requires an immutable owned fixture image");
  }
  for (const name of ["COURTSIDE_SECURITY_SEED_FINGERPRINT", "COURTSIDE_SECURITY_INSTANCE_FINGERPRINT"]) {
    if (!/^sha256:[a-f0-9]{64}$/.test(environment[name] ?? "")) throw new Error("The session decoder identity is incomplete");
  }
  const name = `courtside-security-decoder-${runId}-${attempt}`;
  return { name, args: ["run", "-d", "--pull", "never", "--name", name,
    "--network", "none", "--read-only", "--user", "10001:10001", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true", "--memory", "256m", "--memory-swap", "256m",
    "--cpus", "0.25", "--pids-limit", "32", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777",
    "--label", `com.docker.compose.project=${project}`, "--label", "org.courtside.environment=SECURITY",
    "--label", `org.courtside.security.run-id=${runId}`,
    "--label", `org.courtside.security.seed-fingerprint=${environment.COURTSIDE_SECURITY_SEED_FINGERPRINT}`,
    "--label", `org.courtside.security.instance-fingerprint=${environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT}`,
    "--entrypoint", "sh", image, "-c", "exec sleep 3600"] };
}

export function securityComposeArgs(runId) {
  return ["compose", "-p", securityProject(runId), "-f", composeFile];
}

export function securityFixturesImageTag(runId) {
  securityProject(runId);
  return `courtside:security-fixtures-${runId}`;
}

export function securitySeedImageTag(runId) {
  securityProject(runId);
  return `courtside:security-seed-${runId}`;
}

function interpolatedSecurityNames(file = composeFile) {
  return new Set([...readFileSync(file, "utf8").matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map(([, name]) => name));
}

function seedComposeFile(composeRoot) {
  if (composeRoot === undefined) return composeFile;
  if (!isAbsolute(composeRoot)) throw new Error("The compose checkout root must be absolute");
  if (resolve(composeRoot) !== composeRoot || realpathSync(composeRoot) !== composeRoot
      || !lstatSync(composeRoot).isDirectory()) {
    throw new Error("The compose checkout root must be canonical");
  }
  const file = join(composeRoot, "deploy", "compose.security.yaml");
  if (realpathSync(file) !== file || !lstatSync(file).isFile()) {
    throw new Error("The compose checkout file must be canonical and regular");
  }
  return file;
}

export function securitySeedPlan(runId, image, recorded, { composeRoot } = {}) {
  if (recorded.COURTSIDE_SECURITY_RUN_ID !== runId) {
    throw new Error("The recorded environment belongs to a different security run");
  }
  if (recorded.COURTSIDE_SECURITY_IMAGE !== image) {
    throw new Error("The recorded environment assesses a different candidate image");
  }
  const file = seedComposeFile(composeRoot);
  const interpolated = interpolatedSecurityNames(file);
  const fixture = recorded.immutableImages?.fixturesImageID;
  if (recorded.immutableImages && (recorded.immutableImages.productionImageID !== image
      || !/^sha256:[a-f0-9]{64}$/.test(fixture ?? ""))) {
    throw new Error("The recorded prebuilt fixture binding does not match the candidate");
  }
  const environment = Object.fromEntries([...Object.entries(recorded),
    ["COURTSIDE_SECURITY_FIXTURES_IMAGE", fixture ?? securitySeedImageTag(runId)]]
    .filter(([name]) => interpolated.has(name)));
  if (composeRoot !== undefined) {
    for (const [, name, operator] of readFileSync(file, "utf8").matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(:\?|\?)/g)) {
      if (!(name in environment) || typeof environment[name] !== "string"
          || (operator === ":?" && environment[name] === "")) {
        throw new Error("The recorded environment is missing a required compose value");
      }
    }
  }
  return {
    command: "docker",
    args: ["compose", "-p", securityProject(runId), "-f", file, "run", "--rm", ...(fixture ? ["--pull", "never"] : []), "--no-deps", "-T", "seeder"],
    environment
  };
}

export function securityEnvironment(runId, image, password = randomBytes(24).toString("base64url"),
    httpsPort = 0) {
  if (!/^(?:sha256:[a-f0-9]{64}|[^\s@]+@sha256:[a-f0-9]{64})$/.test(image)) {
    throw new Error("The security candidate must be selected by immutable image digest");
  }
  const seed = readFileSync(join(root, "src/main/resources/security-assessment-dataset.properties"));
  const seedFingerprint = `sha256:${createHash("sha256").update(seed).digest("hex")}`;
  const instanceFingerprint = `sha256:${randomBytes(32).toString("hex")}`;
  return {
    COURTSIDE_SECURITY_RUN_ID: runId,
    COURTSIDE_SECURITY_MAIL_DIRECTORY: join(stateRoot, runId, `mail-${instanceFingerprint.slice(7)}`),
    COURTSIDE_SECURITY_MAIL_USER: `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    COURTSIDE_SECURITY_IMAGE: image,
    COURTSIDE_SECURITY_FIXTURES_IMAGE: securityFixturesImageTag(runId),
    COURTSIDE_SECURITY_HTTPS_PORT: String(httpsPort),
    COURTSIDE_SECURITY_SHARED_PASSWORD: password,
    COURTSIDE_SECURITY_SEED_FINGERPRINT: seedFingerprint,
    COURTSIDE_SECURITY_INSTANCE_FINGERPRINT: instanceFingerprint,
    COURTSIDE_LOGIN_ADDRESS_MAX_FAILURES: "5",
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

export function securityRuntimeBinding(resources) {
  const containers = resources.filter(resource => resource.type === "container");
  if (containers.length > 32 || containers.some(resource => !/^[a-f0-9]{64}$/.test(resource.id ?? "")
      || !resource.config || typeof resource.config !== "object" || Array.isArray(resource.config)
      || !resource.hostConfig || typeof resource.hostConfig !== "object" || Array.isArray(resource.hostConfig))) {
    throw new Error("Immutable SECURITY effective runtime is incomplete");
  }
  return JSON.parse(JSON.stringify(containers.sort((left, right) => left.id.localeCompare(right.id))));
}

export function assertSecurityRuntimeBinding(resources, expected, { allowMissing = false } = {}) {
  if (!Array.isArray(expected) || !expected.length) throw new Error("Immutable SECURITY retained runtime is missing");
  const actual = securityRuntimeBinding(resources);
  securityRuntimeBinding(expected);
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  if (actual.some(resource => {
    const recorded = expected.find(item => item.id === resource.id);
    return !recorded || JSON.stringify(canonical(recorded)) !== JSON.stringify(canonical(resource));
  }) || !allowMissing && expected.some(recorded => !actual.some(resource => resource.id === recorded.id))) {
    throw new Error("Immutable SECURITY effective runtime changed");
  }
}

export function assertSecurityIdentity({ source, labels, image, reference }, expected, expectedImage = expected.COURTSIDE_SECURITY_IMAGE) {
  if (source.environment !== "SECURITY") throw new Error("The target does not report SECURITY");
  const proof = expected.immutableImages;
  if (proof ? expectedImage !== proof.productionImageID || reference !== proof.productionImageID
      || !/^sha256:[a-f0-9]{64}$/.test(proof.runtimeImageIDs?.production ?? "")
      || image !== proof.runtimeImageIDs.production : image !== expectedImage) {
    throw new Error("The running target image does not match this security run");
  }
  if (labels["org.courtside.environment"] !== "SECURITY"
      || labels["org.courtside.security.run-id"] !== expected.COURTSIDE_SECURITY_RUN_ID
      || labels["org.courtside.security.seed-fingerprint"] !== expected.COURTSIDE_SECURITY_SEED_FINGERPRINT
      || labels["org.courtside.security.instance-fingerprint"] !== expected.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT) {
    throw new Error("The running target identity does not match this security run");
  }
}

function execute(command, args, environment = process.env) {
  return execFileSync(command, args, {
    cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });
}

export function executeReusableSecurityCommand(command, args, environment = process.env, timeoutMilliseconds = 10000,
  executeCommand = spawnSync) {
  if (!["docker", "curl"].includes(command) || !Number.isSafeInteger(timeoutMilliseconds)
      || timeoutMilliseconds < 1 || timeoutMilliseconds > 180000) throw new Error("Immutable SECURITY command exceeds its budget");
  const options = { cwd: root, env: environment, shell: false,
    encoding: "utf8", timeout: timeoutMilliseconds, maxBuffer: 4 * 1024 * 1024 };
  const result = command === "docker"
    ? executeCommand("docker", args, options)
    : executeCommand("curl", args, options);
  if (!result || result.error || result.status !== 0 || result.signal || result.truncated || result.timedOut
      || typeof result.stdout !== "string" || typeof result.stderr !== "string"
      || Buffer.byteLength(result.stdout) > 4 * 1024 * 1024 || Buffer.byteLength(result.stderr) > 4 * 1024 * 1024) {
    throw new Error("Immutable SECURITY command did not complete within its bounds");
  }
  return result.stdout;
}

export function securityStateFile(runId) {
  securityProject(runId);
  return join(stateRoot, runId, "environment.json");
}

export function securityIdentityFile(runId) {
  securityProject(runId);
  return join(stateRoot, runId, "identity.json");
}

function writeState(runId, environment, immutableImages) {
  const file = securityStateFile(runId);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ ...environment, ...(immutableImages ? { immutableImages } : {}) }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function readSecurityEnvironment(runId) {
  return JSON.parse(readFileSync(securityStateFile(runId), "utf8"));
}

export function mergeSecurityProcessEnvironment(security, host = process.env) {
  const selected = Object.fromEntries(Object.entries(security)
    .filter(([name]) => name.startsWith("COURTSIDE_")));
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

export async function startSecurityEnvironment(runId, image, selection) {
  const immutableImages = selection ? inspectReusableImages({ image, ...selection, root }) : undefined;
  const command = immutableImages ? executeReusableSecurityCommand : execute;
  assertSecurityStartAvailable(securityProjectResources(runId, command), existsSync(securityStateFile(runId)),
    existsSync(securityIdentityFile(runId)));
  let environment = securityEnvironment(runId, image, randomBytes(24).toString("base64url"),
    await availableLoopbackPort());
  if (immutableImages) environment.COURTSIDE_SECURITY_FIXTURES_IMAGE = immutableImages.fixturesImageID;
  for (let attempt = 1; attempt <= 3; attempt++) {
    reserveSecurityEnvironment(environment, command);
    writeState(runId, environment, immutableImages);
    try {
      if (attempt === 1) {
        const certificate = createSecurityMailCertificate(environment.COURTSIDE_SECURITY_MAIL_DIRECTORY);
        const trust = securityMailTrustPlan(environment.COURTSIDE_SECURITY_MAIL_DIRECTORY, image,
          environment.COURTSIDE_SECURITY_MAIL_USER, { runId,
            seedFingerprint: environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
            instanceFingerprint: environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT });
        command(trust.command, trust.args, { ...process.env, ...environment });
        chmodSync(join(environment.COURTSIDE_SECURITY_MAIL_DIRECTORY, "mail.p12"), 0o444);
        environment = { ...environment, COURTSIDE_SECURITY_MAIL_CERTIFICATE_FINGERPRINT: certificate.fingerprint };
        writeState(runId, environment, immutableImages);
      }
      if (immutableImages) verifyReusableImages(immutableImages, { image, ...selection, root });
      else buildSecurityFixturesImage(runId, image);
      command("docker", [...securityComposeArgs(runId), "up", ...(immutableImages ? ["--no-build", "--pull", "never"] : []), "-d", "--wait"],
        { ...process.env, ...environment }, ...(immutableImages ? [180000] : []));
      if (immutableImages) {
        const resources = securityProjectResources(runId, command);
        assertSecurityRecoveryOwnership(resources, { runId,
          seedFingerprint: environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
          instanceFingerprint: environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT });
        environment = { ...environment, immutableRuntime: securityRuntimeBinding(resources) };
        if (!environment.immutableRuntime.some(resource => resource.labels?.["com.docker.compose.service"] === "app")) {
          throw new Error("Immutable SECURITY startup app is missing");
        }
        writeState(runId, environment, immutableImages);
      }
      break;
    } catch (failure) {
      const output = `${failure.stderr ?? ""}`;
      const identity = { runId,
        seedFingerprint: environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
        instanceFingerprint: environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT };
      let startupDiagnostics = { outcome: "incomplete", reason: "startup-capture-failed" };
      try {
        startupDiagnostics = captureSecurityStartupDiagnostics({ directory: join(stateRoot, runId), attempt, identity,
          command: (args, { timeoutMilliseconds, outputLimitBytes }) => spawnSync("docker", args, {
            cwd: root, env: { ...process.env, ...environment }, timeout: timeoutMilliseconds,
            maxBuffer: outputLimitBytes, stdio: ["ignore", "pipe", "pipe"]
          }) });
      } catch (error) {
        startupDiagnostics = { ...startupDiagnostics, cause: failureReason(error).name };
      }
      let cleanupFailed = false;
      try { removeOwnedSecurityEnvironment(runId, identity, { startupFailure: true }); }
      catch { cleanupFailed = true; }
      try {
        Object.defineProperty(failure, "startupDiagnostics", { value: startupDiagnostics, configurable: true });
        Object.defineProperty(failure, "startupCleanup", { value: cleanupFailed ? "failed" : "passed", configurable: true });
      } catch {}
      if (cleanupFailed || attempt === 3 || !/address already in use|port is already allocated/i.test(output)) throw failure;
      environment = { ...environment, COURTSIDE_SECURITY_HTTPS_PORT: String(await availableLoopbackPort()) };
    }
  }
  const identity = verifySecurityEnvironment(runId);
  writeIdentity(runId, identity);
  process.stdout.write(`${securityEnvironmentReadyMessage(runId)}\n`);
}

export function fixtureImageBase({ RepoDigests: digests = [], RepoTags: tags = [] }) {
  const reference = [...tags, ...digests].find((candidate) => candidate && !candidate.includes("<none>"));
  if (!reference) throw new Error("The security candidate carries no reference a build can start from");
  return reference;
}

export function assertFixtureImageDerivation(candidate, fixtures) {
  const layers = candidate?.RootFS?.Layers;
  const fixtureLayers = fixtures?.RootFS?.Layers;
  if (!Array.isArray(layers) || layers.length === 0
      || !Array.isArray(fixtureLayers) || fixtureLayers.length !== layers.length + 1
      || layers.some((layer, index) => fixtureLayers[index] !== layer)) {
    throw new Error("The security seeder is not the candidate carrying its fixture classes");
  }
  if (["Entrypoint", "Cmd", "User"].some((field) => JSON.stringify(candidate.Config?.[field] ?? null)
      !== JSON.stringify(fixtures.Config?.[field] ?? null))) {
    throw new Error("The security seeder does not run the candidate's own entry point");
  }
}

function buildSecurityFixturesImage(runId, image, tag = securityFixturesImageTag(runId), {
  stageClasses = stageFixtureClasses, inspect = inspectImage, executeBuild = execute
} = {}) {
  stageClasses(root);
  const plan = fixtureImagePlan(tag, fixtureImageBase(inspect(image)));
  executeBuild(plan.command, plan.args);
  assertFixtureImageDerivation(inspect(image), inspect(tag));
}

export function seedSecurityEnvironment(runId, image, stateFile, options = {}, {
  resources = securityProjectResources,
  execute: executeSeed = execute,
  stageClasses = stageFixtureClasses,
  inspect = inspectImage,
  buildFixtures = (id, candidate, tag) => buildSecurityFixturesImage(id, candidate, tag,
    { stageClasses, inspect, executeBuild: executeSeed }),
  removeImage = removeSecurityImage
} = {}) {
  seedComposeFile(options.composeRoot);
  if (options.composeRoot !== undefined) {
    const expected = join(options.composeRoot, "build", "security", runId, "environment.json");
    if (stateFile !== expected || realpathSync(stateFile) !== expected || !lstatSync(stateFile).isFile()) {
      throw new Error("The recorded state must belong to the compose checkout and run");
    }
  }
  const recorded = JSON.parse(readFileSync(resolve(stateFile), "utf8"));
  const plan = securitySeedPlan(runId, image, recorded, options);
  if (recorded.immutableImages) verifyReusableImages(recorded.immutableImages, {
    image, fixturesImage: recorded.immutableImages.fixturesImageID,
    sourceCommit: recorded.immutableImages.sourceCommit, root
  });
  const command = recorded.immutableImages ? executeReusableSecurityCommand : executeSeed;
  const ownedResources = resources(runId, command);
  if (ownedResources.length === 0) {
    throw new Error("No security environment of this run is running");
  }
  assertSecurityRecoveryOwnership(ownedResources, {
    runId,
    seedFingerprint: recorded.COURTSIDE_SECURITY_SEED_FINGERPRINT,
    instanceFingerprint: recorded.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT
  });
  if (recorded.immutableImages) {
    const apps = ownedResources.filter((resource) => resource.type === "container"
      && resource.labels?.["com.docker.compose.service"] === "app");
    if (apps.length !== 1 || apps[0].reference !== recorded.immutableImages.productionImageID
        || apps[0].image !== recorded.immutableImages.runtimeImageIDs?.production) {
      throw new Error("Immutable SECURITY seed runtime identity changed");
    }
  }
  const tag = plan.environment.COURTSIDE_SECURITY_FIXTURES_IMAGE;
  if (recorded.immutableImages) assertSecurityRuntimeBinding(ownedResources, recorded.immutableRuntime);
  try {
    if (!recorded.immutableImages) buildFixtures(runId, image, tag);
    command(plan.command, plan.args, { ...process.env, ...plan.environment }, ...(recorded.immutableImages ? [180000] : []));
  } finally {
    if (!recorded.immutableImages) removeImage(tag);
  }
  process.stdout.write(`Security environment ${runId} carries the synthetic assessment dataset\n`);
}

function inspectImage(reference) {
  return JSON.parse(execute("docker", ["image", "inspect", reference, "--format", "{{json .}}"]));
}

export function securityEnvironmentReadyMessage(runId) {
  securityProject(runId);
  return `Security environment ${runId} is ready; synthetic credentials remain in private run state`;
}

export function verifySecurityEnvironment(runId) {
  const environment = readSecurityEnvironment(runId);
  if (environment.immutableImages) verifyReusableImages(environment.immutableImages, {
    image: environment.COURTSIDE_SECURITY_IMAGE, fixturesImage: environment.immutableImages.fixturesImageID,
    sourceCommit: environment.immutableImages.sourceCommit, root
  });
  const port = environment.COURTSIDE_SECURITY_HTTPS_PORT;
  const command = environment.immutableImages ? executeReusableSecurityCommand : execute;
  if (environment.immutableImages) assertSecurityRuntimeBinding(securityProjectResources(runId, command), environment.immutableRuntime);
  const source = JSON.parse(command("curl", ["--fail", "--silent", "--insecure",
    "--resolve", `localhost:${port}:127.0.0.1`, `https://localhost:${port}/api/source`]));
  const container = JSON.parse(command("docker", ["inspect", `${securityProject(runId)}-app-1`, "--format", "{{json .}}"]));
  const expectedImage = command("docker", ["image", "inspect", environment.COURTSIDE_SECURITY_IMAGE,
    "--format", "{{.Id}}"]).trim();
  const imageArchitecture = command("docker", ["image", "inspect", environment.COURTSIDE_SECURITY_IMAGE,
    "--format", "{{.Architecture}}"]).trim();
  assertSecurityIdentity({ source, labels: container.Config.Labels, image: container.Image,
    reference: container.Config.Image }, environment, expectedImage);
  if (environment.immutableImages && source.commit !== environment.immutableImages.sourceCommit) {
    throw new Error("Immutable security runtime source does not match the selected commit");
  }
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
  const recorded = readSecurityEnvironment(runId);
  if (recorded.immutableImages) verifyReusableImages(recorded.immutableImages, {
    image: recorded.COURTSIDE_SECURITY_IMAGE, fixturesImage: recorded.immutableImages.fixturesImageID,
    sourceCommit: recorded.immutableImages.sourceCommit, root
  });
  const environment = mergeSecurityProcessEnvironment(recorded);
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
  if (recorded.immutableImages) {
    if (!Array.isArray(recorded.immutableRuntime) || !recorded.immutableRuntime.length) {
      throw new Error("Immutable SECURITY retained runtime is missing");
    }
    const ids = (await command(["ps", "-aq", "--no-trunc", "--filter",
      `label=com.docker.compose.project=${securityProject(runId)}`])).stdout.trim().split("\n").filter(Boolean);
    if (!ids.length || ids.length > 32 || ids.some(id => !/^[a-f0-9]{64}$/.test(id))) {
      throw new Error("Immutable SECURITY effective runtime is incomplete");
    }
    const containers = JSON.parse((await command(["inspect", ...ids])).stdout);
    const resources = containers.map(container => ({ type: "container", id: container.Id, name: container.Name,
      image: container.Image, reference: container.Config?.Image, labels: container.Config?.Labels,
      config: container.Config, hostConfig: container.HostConfig }));
    assertSecurityRuntimeBinding(resources, recorded.immutableRuntime);
  }
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
  assertSecurityIdentity({ source, labels: container.Config.Labels, image: container.Image,
    reference: container.Config.Image }, { ...environment, ...(recorded.immutableImages ? { immutableImages: recorded.immutableImages } : {}) }, expectedImage);
  if (recorded.immutableImages && source.commit !== recorded.immutableImages.sourceCommit) {
    throw new Error("Immutable security runtime source does not match the selected commit");
  }
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
  const environment = mergeSecurityProcessEnvironment(readSecurityEnvironment(plan.runId));
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
  const meters = (await runSecurityCommand("docker", ["exec", `${project}-app-1`, "curl", "--silent",
    "--output", "/dev/null", "--write-out", "%{http_code}", "http://127.0.0.1:8080/actuator/prometheus"],
  environment, control, stopFile)).stdout.trim();
  const metersFromOutside = (await runOwnedProcess("curl", ["--silent", "--insecure",
    "--output", "/dev/null", "--write-out", "%{http_code}", "--resolve",
    `localhost:${environment.COURTSIDE_SECURITY_HTTPS_PORT}:127.0.0.1`,
    `https://localhost:${environment.COURTSIDE_SECURITY_HTTPS_PORT}/actuator/prometheus`], {
    timeoutMilliseconds: control.remainingMilliseconds(), stopFile, environment
  })).stdout.trim();
  const direct = (await runSecurityCommand("docker", ["exec", `${project}-app-1`, "curl", "--silent", "--dump-header", "-",
    "--output", "/dev/null", "--header", "Host: attacker.example", "--header", "X-Forwarded-Host: attacker.example",
    "--header", "X-Forwarded-Proto: https", "http://127.0.0.1:8080/actuator/health"],
  environment, control, stopFile)).stdout;
  const directObserved = responseHeader(direct, "X-Courtside-Observed-Host") === "attacker.example"
    && responseHeader(direct, "X-Courtside-Observed-Scheme") === "https";
  const userId = (await runSecurityCommand("docker", ["exec", `${project}-app-1`, "id", "-u"],
    environment, control, stopFile)).stdout.trim();
  const appWritable = await runSecurityCommand("docker", ["exec", `${project}-app-1`, "sh", "-c", "test -w /app"],
    environment, control, stopFile, [0, 1]);
  const tempWritable = await runSecurityCommand("docker", ["exec", `${project}-app-1`, "sh", "-c", "test -w /tmp"],
    environment, control, stopFile, [0, 1]);
  const writablePaths = (await runSecurityCommand("docker", ["exec", `${project}-app-1`, "find", "/app", "-xdev",
    "-perm", "/022", "-print"], environment, control, stopFile)).stdout.split(/\r?\n/)
    .map((line) => line.trim()).filter(Boolean);
  const filePermissions = evaluateRuntimeFilePermissions({ userId,
    appDirectoryWritable: appWritable.code === 0, tempDirectoryWritable: tempWritable.code === 0,
    groupOrWorldWritablePaths: writablePaths });
  return { requestCount: 8, observations: [
    { id: "runtime-hardening", layer: "container", passed: hardened,
      observation: hardened ? "runtime-controls-present" : "runtime-controls-incomplete" },
    { id: "loopback-publication", layer: "host", passed: published.length === 1
        && published[0].HostIp === "127.0.0.1",
      observation: published.length === 1 && published[0].HostIp === "127.0.0.1"
        ? "proxy-loopback-only" : "proxy-publication-mismatch" },
    { id: "management-separation", layer: "application", passed: management === "200",
      observation: management === "200" ? "management-internal-only" : "management-internal-unavailable" },
    { id: "meter-registry-separation", layer: "application",
      passed: meters === "200" && metersFromOutside === "404",
      observation: meters === "200" && metersFromOutside === "404"
        ? "meters-internal-only" : "meters-reachable-from-outside" },
    { id: "direct-forwarded-behavior", layer: "application", passed: directObserved,
      observation: directObserved ? "direct-app-distinguished-from-proxy" : "direct-app-probe-failed" },
    { id: "runtime-file-permissions", layer: "container", ...filePermissions }
  ] };
}

export function evaluateRuntimeFilePermissions({
  userId, appDirectoryWritable, tempDirectoryWritable, groupOrWorldWritablePaths
}) {
  const passed = userId === "10001" && appDirectoryWritable === false && tempDirectoryWritable === true
    && Array.isArray(groupOrWorldWritablePaths) && groupOrWorldWritablePaths.length === 0;
  return { passed, observation: passed ? "application-files-confined" : "application-file-permissions-broader" };
}

export async function runPassiveZap(plan, stopFile, limits) {
  const environment = { ...mergeSecurityProcessEnvironment(readSecurityEnvironment(plan.runId)),
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
    "--name", name, "zap", "sh", "-c", `/zap/zap-baseline.py -t ${passiveScannerOrigin} -m 0 -I -J zap.json; `
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

export function remainingScannerRequestBudget(limit, consumed) {
  if (!Number.isSafeInteger(limit) || limit < 1
      || !Number.isSafeInteger(consumed) || consumed < 1 || consumed >= limit) {
    throw new Error("The canary remediation retest has no request budget remaining");
  }
  return limit - consumed;
}

export async function runAuthenticatedZap(plan, stopFile, limits, renderPlan, renderRetestPlan) {
  const environment = { ...mergeSecurityProcessEnvironment(readSecurityEnvironment(plan.runId)),
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
    const detectedAt = new Date().toISOString();
    const gatewayRuntime = JSON.parse((await command(["inspect", gateway, "--format", "{{json .}}"])).stdout);
    const gatewayHardened = scannerRuntimeHardened(gatewayRuntime, {
      memory: 128 * 1024 * 1024, nanoCpus: 500_000_000, pids: 64,
      networks: [`${securityProject(plan.runId)}_scanner-client`, `${securityProject(plan.runId)}_scanner-upstream`]
    });
    const primaryMetrics = await scannerGatewayMetrics(gateway, command);
    const primaryRequestCount = primaryMetrics.requests;
    const retestRequestBudget = remainingScannerRequestBudget(limits.maxRequests, primaryRequestCount);
    const remediationStartedAt = new Date().toISOString();
    await command(["rm", "-f", gateway]);
    environment.COURTSIDE_SECURITY_CANARY_ENABLED = "false";
    environment.COURTSIDE_SECURITY_MAX_REQUESTS = String(retestRequestBudget);
    await command([...securityComposeArgs(plan.runId), "--profile", "assessment", "up", "-d", "--wait",
      "scanner-gateway"]);
    const fixedAt = new Date().toISOString();
    const retestName = `courtside-security-zap-${plan.runId}-${limits.attempt}-canary-retest`;
    containers.push(retestName);
    await command([...securityComposeArgs(plan.runId), "--profile", "assessment", "run", "-d", "--no-deps",
      "--name", retestName, "zap", "tail", "-f", "/dev/null"]);
    const retestRuntime = JSON.parse((await command(["inspect", retestName, "--format", "{{json .}}"])).stdout);
    const retestScannerHardened = scannerRuntimeHardened(retestRuntime, {
      memory: 1024 * 1024 * 1024, nanoCpus: 2_000_000_000, pids: 256,
      networks: [`${securityProject(plan.runId)}_scanner-client`]
    });
    const retestPlan = renderRetestPlan();
    executedPlans.push({ role: "CANARY_RETEST", plan: retestPlan });
    await command(["exec", "-i", retestName, "sh", "-c", "umask 077; cat > /tmp/courtside-plan.yaml"], {
      input: retestPlan
    });
    const retestStartedAt = new Date().toISOString();
    const retestZap = await command(["exec", retestName, "zap.sh", "-cmd", "-autorun", "/tmp/courtside-plan.yaml"], {
      acceptedExitCodes: [0, 2], outputLimitBytes: 4 * 1024 * 1024
    });
    if (retestZap.code !== 0) {
      throw new Error(`ZAP canary remediation retest failed: ${authenticatedZapDiagnostic(
        `${retestZap.stdout}\n${retestZap.stderr}`, Object.values(limits.sessions))}`);
    }
    const retestReportText = (await command(["exec", retestName, "cat", "/zap/wrk/report-canary-retest.json"], {
      outputLimitBytes: 10 * 1024 * 1024
    })).stdout;
    const retestFinishedAt = new Date().toISOString();
    generatedBytes += Buffer.byteLength(retestReportText);
    await command(["rm", "-f", retestName]);
    containers.pop();
    const retestGatewayRuntime = JSON.parse((await command(["inspect", gateway, "--format", "{{json .}}"])).stdout);
    const retestGatewayHardened = scannerRuntimeHardened(retestGatewayRuntime, {
      memory: 128 * 1024 * 1024, nanoCpus: 500_000_000, pids: 64,
      networks: [`${securityProject(plan.runId)}_scanner-client`, `${securityProject(plan.runId)}_scanner-upstream`]
    });
    const retestRequestCount = await zapRequestCount(gateway, command);
    const requestCount = primaryRequestCount + retestRequestCount;
    if (!Number.isSafeInteger(retestRequestCount) || retestRequestCount < 1
        || retestRequestCount > retestRequestBudget || requestCount > limits.maxRequests) {
      throw new Error("Authenticated ZAP exceeded its request budget");
    }
    const runtimeHardened = gatewayHardened && retestScannerHardened && retestGatewayHardened;
    const planDigest = `sha256:${createHash("sha256").update(JSON.stringify(executedPlans)).digest("hex")}`;
    if (planDigest !== limits.planDigest) throw new Error("Authenticated ZAP plan digest changed during execution");
    return { reports, requestCount, runtimeHardened, roles: Object.keys(limits.sessions), planDigest,
      admissionRefusals: primaryMetrics.admissionRefusals,
      generatedDataMegabytes: generatedBytes / (1024 * 1024),
      canaryRetest: {
        report: JSON.parse(retestReportText), requestCount: retestRequestCount,
        detectedAt, remediationStartedAt, fixedAt, retestStartedAt, retestFinishedAt
      } };
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

const GATEWAY_RELAYABLE_METHODS = ["HEAD", "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

export function relayableMethods(policy) {
  const beyondTheCap = policy.unexpectedMethods
    .filter((method) => !GATEWAY_RELAYABLE_METHODS.includes(method));
  if (beyondTheCap.length > 0) {
    throw new Error(`The scanner may not probe methods the gateway refuses to relay: ${beyondTheCap.join(", ")}`);
  }
  return GATEWAY_RELAYABLE_METHODS;
}

export async function runOpenApiFuzzer(plan, stopFile, limits) {
  if (limits.maxRequests <= limits.policy.nativeRequestReserve) {
    throw new Error("The OpenAPI fuzz request budget cannot reserve native fixture requests");
  }
  const environment = { ...mergeSecurityProcessEnvironment(readSecurityEnvironment(plan.runId)),
    COURTSIDE_SECURITY_MAX_REQUESTS: String(limits.maxRequests - limits.policy.nativeRequestReserve),
    COURTSIDE_SECURITY_MAX_CONCURRENCY: "1",
    COURTSIDE_SECURITY_ALLOWED_METHODS: relayableMethods(limits.policy).join(","),
    COURTSIDE_SECURITY_ALLOWED_PATH_PREFIXES: "/api,/manifest.webmanifest",
    COURTSIDE_SECURITY_CANARY_ENABLED: "false",
    COURTSIDE_SECURITY_MAX_TARGET_BYTES: "8192",
    COURTSIDE_SECURITY_MAX_GENERATED_BYTES: String(20 * 1024 * 1024) };
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
    const config = schemathesisConfiguration(fixture.client, limits.policy);
    await command(["exec", "-i", scanner, "sh", "-c", "umask 077; cat > /tmp/courtside-schemathesis.toml"],
      { input: config });
    await command(["exec", "-i", scanner, "sh", "-c", "umask 077; cat > /tmp/sitecustomize.py"],
      { input: schemathesisReasonProjection });
    const events = {};
    let generatedBytes = 0;
    const runMode = async (mode) => {
      const selected = limits.inventory.filter(({ modes }) => modes.includes(mode));
      const reportDirectory = `/tmp/courtside-schemathesis-${mode}`;
      const args = ["exec", "-e", "PYTHONPATH=/tmp", scanner, "st", "--config-file",
        "/tmp/courtside-schemathesis.toml", "run",
        "/schema/openapi.yaml", "--url", "http://scanner-gateway:8090", "--phases", limits.policy.phases.join(","),
        "--mode", mode,
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
    const stateBefore = await limits.captureState();
    await runMode("positive");
    await runMode("negative");
    const importResult = await limits.runImportCases(fixture);
    const inputResult = await limits.runInputCases(fixture);
    const mutationResult = await limits.runMutationCases(fixture);
    const stateAfter = await limits.captureState();
    const metrics = await scannerGatewayMetrics(gateway, command);
    const scannerBytes = Number((await command(["exec", scanner, "sh", "-c",
      "du -sb /tmp /app/.schemathesis /app/.hypothesis | awk '{ total += $1 } END { print total }'"])).stdout.trim());
    if (!Number.isSafeInteger(scannerBytes) || scannerBytes < 0) {
      throw new Error("Scanner writable-data metrics are invalid");
    }
    const requestCount = metrics.requests + fixture.requestCount + importResult.requestCount + inputResult.requestCount
      + mutationResult.requestCount;
    if (fixture.requestCount + importResult.requestCount + inputResult.requestCount + mutationResult.requestCount
        > limits.policy.nativeRequestReserve
        || requestCount > limits.maxRequests) throw new Error("The OpenAPI fuzz request budget was exceeded");
    return { events, importCases: importResult.cases, inputCases: inputResult.cases,
      mutationCases: mutationResult.cases,
      observedRoutes: fixture.observedRoutes,
      stateBefore, stateAfter, requestCount, runtimeHardened,
      specificationDigest: limits.specificationDigest,
      generatedDataMegabytes: (generatedBytes + metrics.requestBytes + scannerBytes
        + importResult.generatedBytes + inputResult.generatedBytes + mutationResult.generatedBytes) / (1024 * 1024) };
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
  const environment = mergeSecurityProcessEnvironment(readSecurityEnvironment(runId));
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

export async function resetSecurityLoginAttempts(runId, stopFile, timeoutMilliseconds) {
  const environment = mergeSecurityProcessEnvironment(readSecurityEnvironment(runId));
  await verifySecurityEnvironment(runId);
  await runOwnedProcess("docker", [...securityComposeArgs(runId), "exec", "-T", "db", "psql",
    "-v", "ON_ERROR_STOP=1", "-U", "courtside", "courtside_security", "-c",
    "TRUNCATE TABLE login_attempt_limit"], { timeoutMilliseconds, stopFile, environment });
}

export async function runResourceAbuse(plan, stopFile, limits) {
  const recorded = readSecurityEnvironment(plan.runId);
  const immutableImages = recorded.immutableImages;
  const environment = { ...process.env, ...mergeSecurityProcessEnvironment(recorded),
    COURTSIDE_SECURITY_MAX_REQUESTS: String(limits.maxRequests),
    COURTSIDE_SECURITY_MAX_CONCURRENCY: String(plan.budgets.concurrency),
    COURTSIDE_SECURITY_ALLOWED_METHODS: "GET,HEAD,POST,DELETE,OPTIONS",
    COURTSIDE_SECURITY_ALLOWED_PATH_PREFIXES: "/api",
    COURTSIDE_SECURITY_MAX_TARGET_BYTES: "73728",
    COURTSIDE_SECURITY_MAX_GENERATED_BYTES: String(plan.budgets.generatedDataMegabytes * 1024 * 1024) };
  const reservation = `courtside-security-assessment-${plan.runId}`;
  const gateway = `${securityProject(plan.runId)}-scanner-gateway-1`;
  const scanner = `courtside-security-k6-${plan.runId}-${limits.attempt}`;
  const deadline = Date.now() + limits.timeoutMilliseconds;
  const command = async (args, options = {}) => runOwnedProcess("docker", args, {
    timeoutMilliseconds: Math.max(1, Math.min(deadline - Date.now(), options.timeoutMilliseconds ?? Infinity)), stopFile, environment,
    acceptedExitCodes: options.acceptedExitCodes ?? [0], outputLimitBytes: options.outputLimitBytes ?? 1024 * 1024,
    ...(options.input === undefined ? {} : { input: options.input })
  });
  const samples = [];
  let scannerStarted = false;
  let decoder;
  let privateDirectory;
  let evidenceHandle;
  let pressure;
  let earlyError = null;
  let privateWriteFailure;
  const evidenceLimitBytes = plan.budgets.evidenceMegabytes * 1024 * 1024;
  const privateRecord = (name, value) => {
    const bytes = typeof value === "string" ? value : JSON.stringify(value);
    writeNativeEvidence(evidenceHandle, { name, value, bound: Buffer.byteLength(bytes) + 1 });
  };
  let breaker = { tripped: false, reason: null, sampleSequence: null };
  let safetyLimitViolation = { violated: false, reason: null, sampleSequence: null };
  try {
    const parent = join(stateRoot, plan.runId, "resource-abuse");
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    for (const path of [stateRoot, join(stateRoot, plan.runId), parent]) {
      const directory = lstatSync(path);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("Resource-abuse private directory invalid");
    }
    chmodSync(parent, 0o700);
    privateDirectory = join(parent, `attempt-${limits.attempt}`);
    evidenceHandle = createResourceEvidence({ directory: privateDirectory, maximumBytes: evidenceLimitBytes });
    await command(securityAssessmentReservationArgs(environment, limits.attempt));
    await command([...securityComposeArgs(plan.runId), "--profile", "assessment", "up", "-d", "--wait",
      "scanner-gateway"]);
    await command([...securityComposeArgs(plan.runId), "--profile", "assessment", "run", "-d", "--no-deps",
      "--name", scanner, "k6-abuse"]);
    scannerStarted = true;
    const scannerRuntime = JSON.parse((await command(["inspect", scanner, "--format", "{{json .}}"])).stdout);
    const gatewayRuntime = JSON.parse((await command(["inspect", gateway, "--format", "{{json .}}"])).stdout);
    const runtimeHardened = scannerRuntime.Config.Image === limits.policy.image
      && scannerRuntimeOwned(scannerRuntime, environment) && scannerRuntimeOwned(gatewayRuntime, environment)
      && scannerRuntimeHardened(scannerRuntime, {
      memory: 512 * 1024 * 1024, nanoCpus: 1_000_000_000, pids: 128,
      networks: [`${securityProject(plan.runId)}_scanner-client`]
    }) && scannerRuntimeHardened(gatewayRuntime, {
      memory: 128 * 1024 * 1024, nanoCpus: 500_000_000, pids: 64,
      networks: [`${securityProject(plan.runId)}_scanner-client`, `${securityProject(plan.runId)}_scanner-upstream`]
    });
    const scannerDigests = await mountedFileDigests(scanner,
      ["/scripts/resource-abuse.js", "/scripts/policy.json"], command);
    const gatewayDigests = await mountedFileDigests(gateway,
      ["/opt/courtside/security-request-gateway.py", "/opt/courtside/security-mail-receipt.py"], command);
    const app = `${securityProject(plan.runId)}-app-1`;
    const appRuntime = JSON.parse((await command(["inspect", app, "--format", "{{json .}}"])).stdout);
    const candidate = JSON.parse((await command(["image", "inspect", environment.COURTSIDE_SECURITY_IMAGE,
      "--format", "{{json .}}"])).stdout);
    if (!scannerRuntimeOwned(appRuntime, environment) || !/^sha256:[a-f0-9]{64}$/.test(candidate.Id)
        || (immutableImages ? candidate.Id !== immutableImages.productionImageID
          || appRuntime.Image !== immutableImages.runtimeImageIDs?.production : appRuntime.Image !== candidate.Id)
        || appRuntime.Config?.Image !== environment.COURTSIDE_SECURITY_IMAGE
        || !candidate.Config || !appRuntime.Config
        || ["Entrypoint", "Cmd", "User"].some(field =>
          JSON.stringify(appRuntime.Config[field] ?? null) !== JSON.stringify(candidate.Config[field] ?? null))) {
      throw new Error("Resource-abuse candidate identity mismatch");
    }
    const fixture = JSON.parse((await command(["image", "inspect", environment.COURTSIDE_SECURITY_FIXTURES_IMAGE,
      "--format", "{{json .}}"])).stdout);
    assertFixtureImageDerivation(candidate, fixture);
    if (immutableImages && fixture.Id !== immutableImages.fixturesImageID) {
      throw new Error("Resource-abuse immutable fixture identity mismatch");
    }
    const decoderPlan = resourceSessionDecoderPlan(environment, limits.attempt, fixture.Id);
    const sourceAddress = gatewayRuntime.NetworkSettings.Networks[`${securityProject(plan.runId)}_scanner-upstream`]?.IPAddress;
    if (typeof sourceAddress !== "string" || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(sourceAddress)
        || sourceAddress.split(".").some(part => Number(part) > 255)) throw new Error("Resource-abuse gateway source unavailable");
    const applicationText = (await command(["exec", app, "cat", "/app/BOOT-INF/classes/application.yaml"])).stdout;
    const classpathText = (await command(["exec", app, "cat", "/app/BOOT-INF/classpath.idx"],
      { outputLimitBytes: 1024 * 1024 })).stdout;
    const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");
    const application = yaml.load(applicationText);
    const publicationPolicy = resourcePublicationPolicy(appRuntime, application, classpathText);
    const authenticationPolicy = resourceAuthenticationPolicy(appRuntime, application, classpathText);
    authenticationPolicy.loginPolicy.sourceAddress = sourceAddress;
    const stepFailures = {};
    let publicationBinding = null;
    const runtimeBinding = await attemptStep(stepFailures, "decoderBinding", async () => {
      decoder = decoderPlan.name;
      await command(decoderPlan.args);
      if (immutableImages) {
        const runtime = JSON.parse((await command(["inspect", decoder, "--format", "{{json .}}"])).stdout);
        if (!scannerRuntimeOwned(runtime, environment) || runtime.Config?.Image !== immutableImages.fixturesImageID
            || runtime.Image !== immutableImages.runtimeImageIDs?.fixtures) {
          throw new Error("Immutable SECURITY decoder runtime identity changed");
        }
      }
      const classDigests = await mountedFileDigests(decoder, resourceSessionProjectionClassPaths, command);
      if (immutableImages && resourceSessionProjectionClassPaths.some(path =>
        classDigests[path] !== `sha256:${immutableImages.helperClassDigests?.[path]}`)) {
        throw new Error("Immutable SECURITY decoder helper bytes changed");
      }
      return { sourceDigest: `sha256:${createHash("sha256").update(readFileSync(join(root,
        "src/main/java/org/courtside/securityassessment/SecuritySessionAttributeProjection.java"))).digest("hex")}`, classDigests };
    }) ?? null;
    if (runtimeBinding) {
      publicationBinding = await attemptStep(stepFailures, "publicationBinding", async () => {
        const helperClass = "/app/BOOT-INF/classes/org/courtside/securityassessment/SecurityPublicationPolicyProjection.class";
        const listenerClass = "/app/BOOT-INF/classes/org/courtside/notification/internal/BookingMailer.class";
        const eventClass = "/app/BOOT-INF/classes/org/courtside/shared/BookingConfirmed.class";
        const candidateClasses = await mountedFileDigests(app, [listenerClass, eventClass, publicationPolicy.repositoryJarPath], command);
        const decoderClasses = await mountedFileDigests(decoder, [helperClass, listenerClass, eventClass, publicationPolicy.repositoryJarPath], command);
        if (immutableImages && decoderClasses[helperClass] !== `sha256:${immutableImages.helperClassDigests?.[helperClass]}`) {
          throw new Error("Immutable SECURITY publication helper bytes changed");
        }
        if ([listenerClass, eventClass, publicationPolicy.repositoryJarPath].some(path => candidateClasses[path] !== decoderClasses[path])) {
          throw new Error("Resource-abuse publication class mismatch");
        }
        const projectionOutput = (await command(["exec", "-w", "/app", decoder, "/opt/java/openjdk/bin/java",
          "--sun-misc-unsafe-memory-access=deny",
          "-Dloader.main=org.courtside.securityassessment.SecurityPublicationPolicyProjection",
          "-cp", ".", "org.springframework.boot.loader.launch.PropertiesLauncher"],
        { outputLimitBytes: 4096, timeoutMilliseconds: 10000 })).stdout;
        const projection = resourcePublicationProjection(projectionOutput, publicationPolicy);
        return {
          sourceDigest: `sha256:${createHash("sha256").update(readFileSync(join(root,
            "src/main/java/org/courtside/securityassessment/SecurityPublicationPolicyProjection.java"))).digest("hex")}`,
          helperClassDigest: decoderClasses[helperClass],
          candidateRepositoryJarDigest: candidateClasses[publicationPolicy.repositoryJarPath],
          decoderRepositoryJarDigest: decoderClasses[publicationPolicy.repositoryJarPath], candidateClassDigest: candidateClasses[listenerClass],
          decoderClassDigest: decoderClasses[listenerClass], eventClassDigest: candidateClasses[eventClass],
          decoderEventClassDigest: decoderClasses[eventClass], projection
        };
      }) ?? null;
    }
    privateRecord("decoder-binding-native.json", { fixtureId: fixture.Id, candidateId: candidate.Id,
      applicationDigest: `sha256:${createHash("sha256").update(applicationText).digest("hex")}`,
      classpathDigest: `sha256:${createHash("sha256").update(classpathText).digest("hex")}`, runtimeBinding, publicationBinding,
      ...(Object.keys(stepFailures).length ? { failures: { ...stepFailures } } : {}) });
    if (!runtimeBinding || !publicationBinding) throw new Error("Resource-abuse publication native binding incomplete");
    const before = await captureResourceState(command, securityComposeArgs(plan.runId));
    privateRecord("before-native.json", before);
    const stateBefore = resourceIntegritySnapshotFingerprint(before);
    const mailBaseline = await captureSecurityMailBaseline({ runId: plan.runId, command, identity: {
      seedFingerprint: environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
      instanceFingerprint: environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT
    } });
    privateRecord("mail-baseline-native.json", mailBaseline);
    const startedAt = new Date().toISOString();
    const datePlan = resourceDatePlan(before, Date.now());
    let result;
    let failure;
    pressure = command(["exec", "-e", `COURTSIDE_SECURITY_SHARED_PASSWORD=${environment.COURTSIDE_SECURITY_SHARED_PASSWORD}`,
      "-e", `COURTSIDE_SECURITY_RUN_ID=${plan.runId}`,
      "-e", `COURTSIDE_SECURITY_DATE_PLAN=${JSON.stringify(datePlan)}`, scanner, "k6", "run", "/scripts/resource-abuse.js"],
    { acceptedExitCodes: [0, 99], outputLimitBytes: 4 * 1024 * 1024 })
      .then((value) => {
        result = value;
        privateRecord("journal-native.log", `${value.stdout ?? ""}\n${value.stderr ?? ""}`);
      }, (error) => {
        failure = error;
        privateRecord("journal-native.log", String(error?.message ?? ""));
      }).catch(() => { privateWriteFailure = true; failure ??= new Error("Resource-abuse private evidence incomplete"); });
    while (!result && !failure && !breaker.tripped && !safetyLimitViolation.violated) {
      await new Promise((resolveWait) => setTimeout(resolveWait,
        limits.policy.circuitBreakers.sampleIntervalMilliseconds));
      samples.push(await resourceSample(plan.runId, gateway, samples.length + 1, command));
      breaker = evaluateResourceSignals(samples, limits.policy.circuitBreakers);
      safetyLimitViolation = evaluateSafetyLimits(samples, limits.policy.circuitBreakers);
    }
    if (breaker.tripped || safetyLimitViolation.violated) {
      await command(["exec", scanner, "sh", "-c", "kill -INT $(pidof k6)"]);
      const graceDeadline = Date.now() + limits.policy.interruptGraceMilliseconds;
      while (!result && !failure && Date.now() < graceDeadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      if (!result && !failure) await command(["kill", scanner]);
    } else {
      while (!result && !failure) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    await pressure;
    if (privateWriteFailure) throw new Error("Resource-abuse private evidence incomplete");
    const rawJournal = result ? `${result.stdout ?? ""}\n${result.stderr ?? ""}` : String(failure?.message ?? "");
    const journal = parseResourceJournal(rawJournal, { accounts: before.tables.user_account.rows });
    if (failure) journal.complete = false;
    const observedMetrics = await attemptStep(stepFailures, "gatewayTelemetry", () => scannerGatewayMetrics(gateway, command));
    const telemetryComplete = observedMetrics !== undefined;
    const metrics = observedMetrics ?? { requests: 0, requestBytes: 0 };
    const summary = await attemptStep(stepFailures, "scannerSummary", async () => {
      if (!await containerFileExists(scanner, "/results/summary.json", command)) return null;
      const parsed = JSON.parse((await command(["exec", scanner, "cat", "/results/summary.json"])).stdout);
      return Array.isArray(parsed?.checks) ? parsed : null;
    }) ?? null;
    if (stepFailures.gatewayTelemetry || stepFailures.scannerSummary) {
      privateRecord("step-failures-native.json", { gatewayTelemetry: stepFailures.gatewayTelemetry ?? null,
        scannerSummary: stepFailures.scannerSummary ?? null });
    }
    journal.gatewayBodyRejections = Array.isArray(metrics.bodyLimitReceipts) ? metrics.bodyLimitReceipts : [];
    journal.gatewayBodyRejectionsComplete = metrics.bodyLimitReceiptsComplete === true;
    if (journal.operations.some(operation => operation.kind === "gatewayRejectedBody")
        && !journal.gatewayBodyRejectionsComplete) journal.complete = false;
    const endedAt = new Date().toISOString();
    const manager = before.tables.user_account.rows.filter(row => row.username === "security.manager.1");
    const contract = { schemaVersion: 1, managerAccountId: manager.length === 1 ? manager[0].id : null,
      interval: { startedAt, endedAt }, mailEnabled: true, publicationListeners: [],
      publicationLifecycle: publicationBinding ? {
        completionMode: publicationPolicy.completionMode, repositoryMode: publicationBinding.projection.repositoryMode,
        listenerId: publicationBinding.projection.listenerId, eventType: publicationBinding.projection.eventType
      } : null,
      authentication: { ownedSessionPrimaryIds: [], loginSubjects: [], ...authenticationPolicy } };
    const effects = await observeResourceEffects({ runId: plan.runId, attempt: limits.attempt, command, outerDeadlineMilliseconds: deadline,
      composeArgs: securityComposeArgs(plan.runId), before, contract, journal, mailBaseline,
      evidenceHandle, evidenceDirectory: privateDirectory, evidenceLimitBytes,
      projectAuthentication: ({ snapshot, command: projectionCommand }) => captureResourceAuthentication({ before, effects: snapshot,
        journal, sourceAddress, ...authenticationPolicy, runtimeBinding, decoderContainer: decoder }, projectionCommand) });
    const phases = await cleanupAndRecoverResourceRuntime({ effects });
    const occupancy = { successful: 0, rejected: 0, partialOperations: 0,
      duplicateBookings: 0, duplicateResponses: 0, duplicateFailures: 0, toctouCreated: 0, toctouSkipped: 0 };
    if (effects.outcome === "passed") {
      const validated = new Set(effects.integrity?.validatedBookingIdHashes ?? []);
      const newBooking = operation => operation.status === 201 && typeof operation.responseBookingId === "string"
        && validated.has(`sha256:${createHash("sha256").update(JSON.stringify(operation.responseBookingId)).digest("hex")}`);
      const prefix = `security-${plan.runId}-`;
      const bookings = journal.operations.filter(operation => operation.kind === "createBooking");
      const competition = bookings.filter(operation => operation.request.idempotencyKey?.startsWith(prefix)
        && /^\d+-\d+$/.test(operation.request.idempotencyKey.slice(prefix.length)));
      occupancy.successful = new Set(competition.filter(newBooking).map(operation => operation.responseBookingId)).size;
      occupancy.rejected = competition.filter(operation => [409, 422].includes(operation.status)).length;
      occupancy.partialOperations = competition.filter(operation => ![201, 409, 422].includes(operation.status)).length;
      const duplicates = bookings.filter(operation => operation.request.idempotencyKey === `${prefix}duplicate`);
      occupancy.duplicateBookings = new Set(duplicates.filter(newBooking).map(operation => operation.responseBookingId)).size;
      occupancy.duplicateResponses = duplicates.filter(newBooking).length;
      occupancy.duplicateFailures = duplicates.filter(operation => !newBooking(operation)).length;
      const series = journal.operations.filter(operation => operation.kind === "createSeries");
      occupancy.toctouCreated = series.reduce((count, operation) => count + (operation.seriesResult?.bookingIds?.length ?? 0), 0);
      occupancy.toctouSkipped = series.reduce((count, operation) => count + (operation.seriesResult?.skipped?.length ?? 0), 0);
    }
    const integrity = { effects: effects.outcome, cleanup: phases.cleanup?.outcome ?? "incomplete",
      recovery: phases.recovery?.outcome ?? "incomplete" };
    const integrityEvidenceDigest = phases.integrityEvidenceDigest ?? effects.integrityEvidenceDigest ?? null;
    const stateAfter = effects.integrity?.afterFingerprint ?? effects.afterFingerprint ?? null;
    const recoveryOutcome = integrity.recovery;
    const recovery = { health: recoveryOutcome, restart: recoveryOutcome, database: recoveryOutcome,
      domainIntegrity: recoveryOutcome };
    return {
      runtimeHardened,
      requestCount: metrics.requests,
      generatedDataMegabytes: metrics.requestBytes / (1024 * 1024),
      scenarios: limits.policy.scenarios.map(({ id, checks: requiredChecks }) => {
        const checks = summary?.checks?.filter(({ name }) => name.startsWith(`${id}:`)) ?? [];
        const observedNames = new Set(checks.map(({ name }) => name));
        const missingCheck = requiredChecks.some((name) => !observedNames.has(`${id}:${name}`));
        const fixtureFailed = checks.some(({ name, fails }) => name.endsWith(":fixtures-ready") && fails > 0);
        const assertionFailed = checks.some(({ name, fails }) => !name.endsWith(":fixtures-ready") && fails > 0);
        const outcome = missingCheck || fixtureFailed || !telemetryComplete || Boolean(failure)
          || id === "login-rate-limit-boundary" && !summary.rateLimitedLogins ? "incomplete"
            : assertionFailed ? "failed" : "passed";
        return { id, outcome };
      }),
      samples,
      circuitBreaker: breaker,
      safetyLimitViolation,
      stateBefore,
      stateAfter,
      stateAfterCleanup: phases.cleanup?.actualFingerprint ?? null,
      stateAfterRecovery: phases.recovery?.actualFingerprint ?? null,
      integrity, integrityEvidenceDigest, journalDigest: effects.journalDigest ?? null,
      integrityModuleDigest: resourceAbuseIntegrityDigest(),
      receiptParserDigest: gatewayDigests["/opt/courtside/security-mail-receipt.py"],
      competingWrites: occupancy,
      recovery,
      scannerImage: scannerRuntime.Config.Image,
      scriptDigest: scannerDigests["/scripts/resource-abuse.js"],
      mountedPolicyDigest: scannerDigests["/scripts/policy.json"],
      gatewayDigest: gatewayDigests["/opt/courtside/security-request-gateway.py"]
    };
  } catch (failure) {
    earlyError = failureReason(failure);
    throw new Error("Resource-abuse observation incomplete");
  } finally {
    const cleanupFailures = [];
    for (const resource of [decoder, scannerStarted ? scanner : null, gateway, reservation].filter(Boolean)) {
      try {
        const runtime = JSON.parse((await runOwnedProcess("docker", ["inspect", resource, "--format", "{{json .}}"], {
          timeoutMilliseconds: 10_000, stopFile: "/dev/null/courtside-cleanup-stop-disabled", environment
        })).stdout);
        if (!scannerRuntimeOwned(runtime, environment)
            || runtime.Config?.Labels?.["com.docker.compose.project"] !== securityProject(plan.runId)
            || !/^[a-f0-9]{64}$/.test(runtime.Id)
            || immutableImages && resource === decoder && (runtime.Config?.Image !== immutableImages.fixturesImageID
              || runtime.Image !== immutableImages.runtimeImageIDs?.fixtures)) {
          cleanupFailures.push(resource);
          continue;
        }
        await runOwnedProcess("docker", ["rm", "-f", runtime.Id], {
          timeoutMilliseconds: 10_000, stopFile: "/dev/null/courtside-cleanup-stop-disabled", environment
        });
      } catch {
        try { if (await containerExistsForCleanup(resource, environment)) cleanupFailures.push(resource); }
        catch { cleanupFailures.push(resource); }
      }
    }
    if (pressure) await pressure;
    if (earlyError && evidenceHandle) retainResourceEvidenceFailure(evidenceHandle,
      { runId: plan.runId, attempt: limits.attempt, phase: "environment", reason: earlyError });
    if (cleanupFailures.length) throw new Error(`Resource-abuse cleanup was incomplete: ${cleanupFailures.join("; ")}`);
  }
}

async function resourceSample(runId, gateway, sequence, command) {
  const project = securityProject(runId);
  const stats = async (container) => {
    const output = (await command(["stats", "--no-stream", "--format", "{{.CPUPerc}}|{{.MemUsage}}", container]))
      .stdout.trim();
    const [cpu, memory] = output.split("|");
    return { cpu: Number(cpu.replace("%", "")), memory: parseDockerMegabytes(memory.split("/")[0].trim()) };
  };
  const [app, db] = await Promise.all([stats(`${project}-app-1`), stats(`${project}-db-1`)]);
  const database = (await command([...securityComposeArgs(runId), "exec", "-T", "db", "psql", "-At", "-F", "|",
    "-U", "courtside", "-d", "courtside_security", "-c",
    "SELECT count(*), (SELECT count(*) FROM pg_locks WHERE NOT granted), (SELECT count(*) FROM spring_session), pg_database_size(current_database()) FROM pg_stat_activity WHERE datname=current_database()"])).stdout.trim();
  const [activeConnections, waitingLocks, sessionRows, storageBytes]
    = database.split("|").map(Number);
  const prometheus = (await command([...securityComposeArgs(runId), "exec", "-T", "app", "curl", "-fsS",
    "http://127.0.0.1:8080/actuator/prometheus"], { outputLimitBytes: 4 * 1024 * 1024 })).stdout;
  const activePoolConnections = prometheusMetric(prometheus, "hikaricp_connections_active");
  const pendingPoolConnections = prometheusMetric(prometheus, "hikaricp_connections_pending");
  const poolMaxConnections = prometheusMetric(prometheus, "hikaricp_connections_max");
  const gatewayMetrics = await scannerGatewayMetrics(gateway, command);
  if (![app.cpu, app.memory, db.cpu, db.memory, activeConnections, activePoolConnections,
    pendingPoolConnections, poolMaxConnections, waitingLocks,
    sessionRows, storageBytes, gatewayMetrics.requestP95Milliseconds, gatewayMetrics.errorRate]
    .every(Number.isFinite)) throw new Error("Resource telemetry is incomplete");
  return { sequence, appCpuPercent: app.cpu, appMemoryMegabytes: app.memory,
    dbCpuPercent: db.cpu, dbMemoryMegabytes: db.memory, activeConnections, activePoolConnections,
    pendingPoolConnections, poolMaxConnections,
    waitingLocks, sessionRows, storageMegabytes: storageBytes / (1024 * 1024),
    requestP95Milliseconds: gatewayMetrics.requestP95Milliseconds, errorRate: gatewayMetrics.errorRate };
}

export function prometheusMetric(output, name) {
  const values = output.split("\n")
    .filter((line) => line.startsWith(`${name}{`) || line.startsWith(`${name} `))
    .map((line) => Number(line.trim().split(/\s+/).at(-1)));
  if (!values.length || !values.every(Number.isFinite)) throw new Error(`Prometheus metric ${name} is unavailable`);
  return values.reduce((sum, value) => sum + value, 0);
}

async function mountedFileDigests(container, paths, command) {
  const output = (await command(["exec", container, "sha256sum", ...paths])).stdout.trim();
  const digests = Object.fromEntries(output.split("\n").map((line) => {
    const [digest, path] = line.trim().split(/\s+/);
    return [path, `sha256:${digest}`];
  }));
  if (paths.some((path) => !/^sha256:[a-f0-9]{64}$/.test(digests[path] ?? ""))) {
    throw new Error("Mounted resource-abuse files could not be fingerprinted");
  }
  return digests;
}

function parseDockerMegabytes(value) {
  const match = /^([0-9.]+)([KMG]iB)$/.exec(value);
  if (!match) throw new Error("Docker memory telemetry is invalid");
  const factor = { KiB: 1 / 1024, MiB: 1, GiB: 1024 }[match[2]];
  return Number(match[1]) * factor;
}

export function authenticatedZapDiagnostic(output, sessionCookies) {
  let safe = String(output);
  for (const cookie of sessionCookies) safe = safe.replaceAll(cookie, "[REDACTED]");
  safe = safe.replace(/http:\/\/scanner-gateway:8090\S*/g, "[SCANNER_ROUTE]")
    .replace(/(cookie|authorization|password|token)\s*[:=][^\r\n]+/gi, "$1=[REDACTED]")
    .replace(/SESSION=[^;\s]+/gi, "SESSION=[REDACTED]");
  const mismatch = /Difference in response code values[\s\S]*?Expected\s*:\s*(\d+)\s+Received\s*:\s*(\d+)/i.exec(safe);
  const classification = mismatch
    ? `response-code-mismatch expected=${mismatch[1]} received=${mismatch[2]}`
    : /Automation plan warnings:/i.test(safe)
      ? "automation-plan-warning"
      : "non-zero-process-exit";
  const digest = createHash("sha256").update(safe).digest("hex");
  return `${classification}; redacted-output-digest=sha256:${digest}`;
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
  return new RegExp(`(?:Error:|Error response from daemon:) No such (?:object|container): ${escapedName}\\s*$`, "i")
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
  const metrics = JSON.parse(raw);
  const integers = [metrics.requests, metrics.requestBytes, metrics.upstreamErrors, metrics.admissionRefusals];
  if (!integers.every((value) => Number.isSafeInteger(value) && value >= 0)
      || ![metrics.requestP95Milliseconds, metrics.errorRate].every((value) => Number.isFinite(value) && value >= 0)
      || metrics.errorRate > 1) {
    throw new Error("Scanner gateway metrics are invalid");
  }
  return metrics;
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

function reserveSecurityEnvironment(environment, command = execute) {
  command("docker", securityReservationArgs(environment));
  const expected = {
    runId: environment.COURTSIDE_SECURITY_RUN_ID,
    seedFingerprint: environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
    instanceFingerprint: environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT
  };
  try {
    assertSecurityRecoveryOwnership(securityProjectResources(expected.runId, command), expected);
  } catch (failure) {
    command("docker", ["rm", `courtside-security-reservation-${expected.runId}`]);
    throw failure;
  }
}

export function recoverSecurityEnvironment(runId, expected) {
  if (expected?.runId !== runId) throw new Error("The retained recovery run identity does not match");
  removeOwnedSecurityEnvironment(runId, expected);
}

function removeOwnedSecurityEnvironment(runId, expected, { startupFailure = false } = {}) {
  const recorded = existsSync(securityStateFile(runId)) ? readSecurityEnvironment(runId) : undefined;
  const command = recorded?.immutableImages ? executeReusableSecurityCommand : execute;
  const resources = securityProjectResources(runId, command);
  assertSecurityRecoveryOwnership(resources, expected);
  if (recorded?.immutableImages) verifyReusableImages(recorded.immutableImages, {
    image: recorded.COURTSIDE_SECURITY_IMAGE, fixturesImage: recorded.immutableImages.fixturesImageID,
    sourceCommit: recorded.immutableImages.sourceCommit, root
  });
  if (recorded?.immutableImages) {
    const proof = recorded.immutableImages;
    for (const resource of resources.filter((item) => item.type === "container")) {
      const service = resource.labels?.["com.docker.compose.service"];
      const subject = service === "app" ? "production" : ["seeder", "session-decoder"].includes(service) ? "fixtures" : undefined;
      if (subject && (resource.reference !== (subject === "production" ? proof.productionImageID : proof.fixturesImageID)
          || resource.image !== proof.runtimeImageIDs?.[subject])) {
        throw new Error("Immutable SECURITY cleanup runtime identity changed");
      }
    }
    if (startupFailure !== true || recorded.immutableRuntime !== undefined || Object.hasOwn(recorded, "immutableRuntime")) {
      assertSecurityRuntimeBinding(resources, recorded.immutableRuntime, { allowMissing: true });
    }
  }
  removeSecurityResources(resources, command);
  if (!recorded?.immutableImages) removeSecurityImage(securityFixturesImageTag(runId));
  rmSync(securityStateFile(runId), { force: true });
  rmSync(securityIdentityFile(runId), { force: true });
}

function removeSecurityImage(tag) {
  if (!execute("docker", ["image", "ls", "-q", tag]).trim()) return;
  execute("docker", ["image", "rm", "-f", tag]);
}

function securityProjectResources(runId, command = execute) {
  const project = securityProject(runId);
  const filter = `label=com.docker.compose.project=${project}`;
  const containers = command("docker", ["ps", "-aq", "--no-trunc", "--filter", filter]).trim().split("\n").filter(Boolean);
  const networks = command("docker", ["network", "ls", "-q", "--filter", filter]).trim().split("\n").filter(Boolean);
  const volumes = command("docker", ["volume", "ls", "-q", "--filter", filter]).trim().split("\n").filter(Boolean);
  return [
    ...inspectResources("container", containers, ["inspect"], command),
    ...inspectResources("network", networks, ["network", "inspect"], command),
    ...inspectResources("volume", volumes, ["volume", "inspect"], command)
  ];
}

function inspectResources(type, ids, args, command = execute) {
  if (!ids.length) return [];
  return JSON.parse(command("docker", [...args, ...ids])).map((resource) => ({
    type,
    id: resource.Id ?? resource.ID ?? resource.Name,
    labels: resource.Config?.Labels ?? resource.Labels,
    ...(type === "container" ? { image: resource.Image, reference: resource.Config?.Image, name: resource.Name,
      config: resource.Config, hostConfig: resource.HostConfig } : {})
  }));
}

function removeSecurityResources(resources, command = execute) {
  for (const [type, args] of [["container", ["rm", "-f"]], ["network", ["network", "rm"]],
    ["volume", ["volume", "rm"]]]) {
    const ids = resources.filter((resource) => resource.type === type).map((resource) => resource.id);
    if (ids.length) command("docker", [...args, ...ids]);
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
