import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = join(root, "deploy", "compose.security.yaml");
const stateRoot = join(root, "build", "security");
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
  return {
    COURTSIDE_SECURITY_RUN_ID: runId,
    COURTSIDE_SECURITY_IMAGE: image,
    COURTSIDE_SECURITY_HTTPS_PORT: String(httpsPort),
    COURTSIDE_SECURITY_SHARED_PASSWORD: password,
    COURTSIDE_SECURITY_SEED_FINGERPRINT: seedFingerprint
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

export function recoveryEnvironment(runId) {
  return securityEnvironment(runId, `sha256:${"0".repeat(64)}`, "recovery-placeholder", 1);
}

export function assertSecurityIdentity({ source, labels, image }, expected, expectedImage = expected.COURTSIDE_SECURITY_IMAGE) {
  if (source.environment !== "SECURITY") throw new Error("The target does not report SECURITY");
  if (image !== expectedImage) throw new Error("The running target image does not match this security run");
  if (labels["org.courtside.environment"] !== "SECURITY"
      || labels["org.courtside.security.run-id"] !== expected.COURTSIDE_SECURITY_RUN_ID
      || labels["org.courtside.security.seed-fingerprint"] !== expected.COURTSIDE_SECURITY_SEED_FINGERPRINT) {
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
  let environment = securityEnvironment(runId, image, randomBytes(24).toString("base64url"),
    await availableLoopbackPort());
  for (let attempt = 1; attempt <= 3; attempt++) {
    writeState(runId, environment);
    try {
      execute("docker", [...securityComposeArgs(runId), "up", "-d", "--wait"], { ...process.env, ...environment });
      break;
    } catch (failure) {
      const output = `${failure.stderr ?? ""}`;
      if (attempt === 3 || !/address already in use|port is already allocated/i.test(output)) throw failure;
      execute("docker", securityDownPlan(runId).args, { ...process.env, ...environment });
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
    containerImage: container.Image,
    runId
  };
}

export function stopSecurityEnvironment(runId) {
  const environment = readSecurityEnvironment(runId);
  execute("docker", securityDownPlan(runId).args, { ...process.env, ...environment });
  rmSync(securityStateFile(runId), { force: true });
  rmSync(securityIdentityFile(runId), { force: true });
}

export function recoverSecurityEnvironment(runId) {
  execute("docker", securityDownPlan(runId).args, { ...process.env, ...recoveryEnvironment(runId) });
  rmSync(securityStateFile(runId), { force: true });
  rmSync(securityIdentityFile(runId), { force: true });
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
