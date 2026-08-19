import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = join(root, "deploy", "compose.security.yaml");
const stateRoot = join(root, "build", "security");

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
  if (!/^sha256:[a-f0-9]{64}$/.test(image) && !/@sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error("The security candidate must be selected by immutable image digest");
  }
  const seed = readFileSync(join(root, "src/main/java/org/courtside/securityassessment/SecurityAssessmentDataSeeder.java"), "utf8");
  const seedFingerprint = seed.match(/SEED_FINGERPRINT\s*=\s*"(?<value>sha256:[a-f0-9]{64})";/)?.groups.value;
  if (!seedFingerprint) throw new Error("The security seed fingerprint is missing");
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

export function assertSecurityIdentity({ source, labels }, expected) {
  if (source.environment !== "SECURITY") throw new Error("The target does not report SECURITY");
  if (labels["org.courtside.environment"] !== "SECURITY"
      || labels["org.courtside.security.run-id"] !== expected.COURTSIDE_SECURITY_RUN_ID
      || labels["org.courtside.security.seed-fingerprint"] !== expected.COURTSIDE_SECURITY_SEED_FINGERPRINT) {
    throw new Error("The running target identity does not match this security run");
  }
}

function execute(command, args, environment = process.env) {
  return execFileSync(command, args, { cwd: root, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function stateFile(runId) {
  return join(stateRoot, runId, "environment.json");
}

function writeState(runId, environment) {
  const file = stateFile(runId);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(environment, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function readState(runId) {
  return JSON.parse(readFileSync(stateFile(runId), "utf8"));
}

async function start(runId, image) {
  const environment = securityEnvironment(runId, image, randomBytes(24).toString("base64url"),
    await availableLoopbackPort());
  writeState(runId, environment);
  execute("docker", [...securityComposeArgs(runId), "up", "-d", "--wait"], { ...process.env, ...environment });
  verify(runId);
  process.stdout.write(`Security environment ${runId} is ready\n`);
  process.stdout.write(`Shared synthetic credential: ${environment.COURTSIDE_SECURITY_SHARED_PASSWORD}\n`);
}

function verify(runId) {
  const environment = readState(runId);
  const port = environment.COURTSIDE_SECURITY_HTTPS_PORT;
  const source = JSON.parse(execute("curl", ["--fail", "--silent", "--insecure",
    "--resolve", `localhost:${port}:127.0.0.1`, `https://localhost:${port}/api/source`]));
  const labels = JSON.parse(execute("docker", ["inspect", `${securityProject(runId)}-app-1`, "--format", "{{json .Config.Labels}}"]));
  assertSecurityIdentity({ source, labels }, environment);
}

function stop(runId) {
  const environment = readState(runId);
  execute("docker", securityDownPlan(runId).args, { ...process.env, ...environment });
  rmSync(join(stateRoot, runId), { recursive: true, force: true });
}

async function main(argv) {
  const [command, runId, image] = argv;
  if (command === "start" && runId && image) return await start(runId, image);
  if (command === "verify" && runId) return verify(runId);
  if ((command === "stop" || command === "reset") && runId) return stop(runId);
  throw new Error("Usage: security-environment.mjs <start RUN_ID IMAGE|verify RUN_ID|stop RUN_ID|reset RUN_ID>");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (failure) {
    process.stderr.write(`${failure.message}\n`);
    process.exitCode = 1;
  }
}
