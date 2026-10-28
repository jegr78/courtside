import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
const registryHost = "ghcr.io";
const hostsMarker = "# courtside-installed-upgrade-gate";
const hostsFile = "/etc/hosts";
const trustDirectory = `/etc/docker/certs.d/${registryHost}`;
const evidence = join(repository, "build", "installed-upgrade-gate");
const certificates = join(evidence, "certificates");
const compose = ["compose", "-f", join(repository, "deploy", "compose.installed-upgrade-registry.yaml")];

export const registryAddress = "127.0.0.1";

export function withRegistryHost(hosts) {
  const lines = hosts.split("\n");
  if (lines.some((line) => line.endsWith(hostsMarker))) return hosts;
  if (lines.some((line) => line.replace(/#.*/, "").trim().split(/\s+/).slice(1).includes(registryHost))) {
    throw new Error(`${hostsFile} already resolves ${registryHost}; the stand-in registry will not shadow it`);
  }
  const separated = hosts === "" || hosts.endsWith("\n") ? hosts : `${hosts}\n`;
  return `${separated}${registryAddress} ${registryHost} ${hostsMarker}\n`;
}

export function withoutRegistryHost(hosts) {
  return hosts.split("\n").filter((line) => !line.endsWith(hostsMarker)).join("\n");
}

export function servedReference(name, headers) {
  const digest = headers["docker-content-digest"];
  if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? "")) throw new Error(`the stand-in registry served no digest for ${name}`);
  return `${name}@${digest}`;
}

export function archiveArguments({ image, bookingSeedImage, version, revision, repository: name, workflow, ref, output }) {
  return ["tools/deployment-archive.mjs", "--version", version, "--revision", revision, "--image", image,
    "--booking-seed-image", bookingSeedImage, "--repository", name, "--workflow", workflow, "--ref", ref,
    "--output", output];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    stdio: options.inherit ? "inherit" : "pipe", ...options });
  if (result.error) throw new Error(`${command} could not run: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args[0]} exited with ${result.status}: ${result.stderr ?? ""}`);
  }
  return result;
}

function issueCertificates() {
  mkdirSync(certificates, { recursive: true });
  const at = (name) => join(certificates, name);
  run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=Courtside installed upgrade gate", "-addext", "basicConstraints=critical,CA:TRUE",
    "-addext", "keyUsage=critical,keyCertSign", "-keyout", at("ca.key"), "-out", at("ca.crt")]);
  run("openssl", ["req", "-newkey", "rsa:2048", "-nodes", "-subj", `/CN=${registryHost}`,
    "-keyout", at("registry.key"), "-out", at("registry.csr")]);
  writeFileSync(at("registry.ext"), `subjectAltName=DNS:${registryHost}\nextendedKeyUsage=serverAuth\n`);
  run("openssl", ["x509", "-req", "-in", at("registry.csr"), "-CA", at("ca.crt"), "-CAkey", at("ca.key"),
    "-CAcreateserial", "-days", "1", "-extfile", at("registry.ext"), "-out", at("registry.crt")]);
  rmSync(at("ca.key"));
  return at("ca.crt");
}

function announcedHosts() {
  if (existsSync(trustDirectory)) throw new Error(`${trustDirectory} exists; the stand-in registry will not replace it`);
  return withRegistryHost(readFileSync(hostsFile, "utf8"));
}

function announce(authority, hosts) {
  run("sudo", ["-n", "install", "-D", "-m", "0644", authority, join(trustDirectory, "ca.crt")]);
  run("sudo", ["-n", "tee", hostsFile], { input: hosts });
}

function withdraw() {
  run("sudo", ["-n", "rm", "-f", join(trustDirectory, "ca.crt")], { allowFailure: true });
  run("sudo", ["-n", "rmdir", trustDirectory], { allowFailure: true });
  const hosts = readFileSync(hostsFile, "utf8");
  if (hosts !== withoutRegistryHost(hosts)) run("sudo", ["-n", "tee", hostsFile], { input: withoutRegistryHost(hosts) });
}

const manifestTypes = ["application/vnd.oci.image.index.v1+json", "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json", "application/vnd.docker.distribution.manifest.v2+json"];

function ask(authority, path, method = "GET") {
  return new Promise((settle) => {
    const probe = request({ host: registryAddress, port: 443, servername: registryHost, path, method,
      headers: { Accept: manifestTypes.join(", ") }, ca: readFileSync(authority), timeout: 5000 }, (response) => {
      response.resume();
      settle({ status: response.statusCode, headers: response.headers });
    });
    probe.on("error", (error) => settle({ status: 0, error: error.message, headers: {} }));
    probe.on("timeout", () => probe.destroy(new Error("timed out")));
    probe.end();
  });
}

async function serve(authority, environment) {
  run("docker", [...compose, "up", "--detach", "registry"], { env: environment });
  let last;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    last = await ask(authority, "/v2/");
    if (last.status === 200) return;
    await new Promise((wait) => setTimeout(wait, 1000));
  }
  throw new Error(`the stand-in registry did not answer for ${registryHost} on ${registryAddress}:443 within 60 s: `
    + (last.error ?? `HTTP ${last.status}`));
}

async function publish(authority, image, name, label) {
  const tag = `installed-upgrade-${label}`;
  run("docker", ["image", "tag", image, `${name}:${tag}`]);
  run("docker", ["image", "push", `${name}:${tag}`], { inherit: true });
  const repositoryPath = name.slice(registryHost.length + 1);
  const answer = await ask(authority, `/v2/${repositoryPath}/manifests/${tag}`, "HEAD");
  if (answer.status !== 200) {
    throw new Error(`the stand-in registry answered ${answer.error ?? `HTTP ${answer.status}`} for ${name}:${tag}`);
  }
  return servedReference(name, answer.headers);
}

function options(args) {
  const named = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index].startsWith("--") || args[index + 1] === undefined) throw new Error(`unexpected argument ${args[index]}`);
    named[args[index].slice(2)] = args[index + 1];
  }
  const required = ["image", "booking-seed-image", "repository", "version", "revision", "ref", "workflow", "confirm"];
  const missing = required.filter((key) => !named[key]);
  if (missing.length > 0 || named.confirm !== "installed-upgrade-gate") {
    throw new Error(`pass --${required.slice(0, -1).join(" --")} and --confirm installed-upgrade-gate`);
  }
  return named;
}

async function execute() {
  const named = options(process.argv.slice(2));
  const name = `${registryHost}/${named.repository.toLowerCase()}`;
  rmSync(evidence, { recursive: true, force: true });
  const authority = issueCertificates();
  const environment = { ...process.env, COURTSIDE_UPGRADE_REGISTRY_CERTIFICATES: certificates };
  const deployment = mkdtempSync(join(tmpdir(), "courtside-installed-upgrade-gate-"));
  const hosts = announcedHosts();
  try {
    announce(authority, hosts);
    await serve(authority, environment);
    const image = await publish(authority, named.image, name, "app");
    const bookingSeedImage = await publish(authority, named["booking-seed-image"], name, "booking-seed");
    const output = join(evidence, "archive");
    mkdirSync(output, { recursive: true });
    run(process.execPath, archiveArguments({ image, bookingSeedImage, version: named.version, revision: named.revision,
      repository: named.repository, workflow: named.workflow, ref: named.ref, output }), { inherit: true });
    const archive = join(output, `courtside-deployment-${named.version}.zip`);
    run(process.execPath, ["tools/deployment-qualification.mjs", "--inspect-archive", "--archive", archive,
      "--destination", join(deployment, "extracted"), "--image", image, "--booking-seed-image", bookingSeedImage,
      "--recipes", "funnel", "--output", join(evidence, "archive.json")], { inherit: true });
    run(process.execPath, ["tools/installed-upgrade-smoke.mjs", "--candidate", join(deployment, "extracted"),
      "--confirm", "installed-postgresql-upgrade"], { inherit: true });
  } finally {
    writeFileSync(join(evidence, "registry.log"),
      run("docker", [...compose, "logs", "--no-color", "registry"], { env: environment, allowFailure: true }).stdout ?? "");
    run("docker", [...compose, "down", "--volumes"], { env: environment, allowFailure: true });
    rmSync(certificates, { recursive: true, force: true });
    withdraw();
    rmSync(deployment, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  execute().catch((error) => {
    process.stderr.write(`Installed upgrade gate failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
