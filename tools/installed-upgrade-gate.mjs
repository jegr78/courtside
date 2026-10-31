import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

export function gateJourney(name = "installed-postgresql-upgrade", candidate) {
  if (name === "installed-postgresql-upgrade") return { name, recipe: "funnel",
    arguments: ["tools/installed-upgrade-smoke.mjs", "--candidate", candidate, "--confirm", "installed-postgresql-upgrade"] };
  if (name === "stalwart-store-transition") return { name, recipe: "full-self-hosted",
    arguments: ["tools/stalwart-store-transition-smoke.mjs", "--candidate", candidate] };
  throw new Error(`unknown installed upgrade journey ${name}`);
}

export function verifyTransitionBinding(report, expected) {
  if (report?.status !== "passed") throw new Error("Stalwart transition did not pass");
  if (report.runtimeImage !== expected.image) throw new Error("Stalwart transition runtime image differs from the candidate");
  if (report.candidateRevision !== expected.revision) throw new Error("Stalwart transition revision differs from the candidate");
}

export function withRegistryHost(hosts) {
  const lines = hosts.split("\n");
  if (lines.some((line) => line.endsWith(hostsMarker))) return hosts;
  if (lines.some((line) => line.replace(/#.*/, "").trim().split(/\s+/).slice(1).some((name) => name === registryHost))) {
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
  const authority = run("openssl", ["req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "1",
    "-subj", "/CN=Courtside installed upgrade gate", "-addext", "basicConstraints=critical,CA:TRUE",
    "-addext", "keyUsage=critical,keyCertSign", "-keyout", at("ca.key")]).stdout;
  writeFileSync(at("ca.crt"), authority);
  run("openssl", ["req", "-newkey", "rsa:3072", "-nodes", "-subj", `/CN=${registryHost}`,
    "-keyout", at("registry.key"), "-out", at("registry.csr")]);
  // The registry runs as root without CAP_DAC_OVERRIDE, so it cannot read a key only its owner may read.
  chmodSync(at("registry.key"), 0o644);
  writeFileSync(at("registry.ext"), `subjectAltName=DNS:${registryHost}\nextendedKeyUsage=serverAuth\n`);
  run("openssl", ["x509", "-req", "-in", at("registry.csr"), "-CA", at("ca.crt"), "-CAkey", at("ca.key"),
    "-CAcreateserial", "-days", "1", "-extfile", at("registry.ext"), "-out", at("registry.crt")]);
  rmSync(at("ca.key"));
  return { path: at("ca.crt"), pem: authority };
}

function announcedHosts() {
  if (run("sudo", ["-n", "true"], { allowFailure: true }).status !== 0) {
    throw new Error("the installed upgrade gate needs passwordless sudo to trust and resolve its stand-in registry");
  }
  if (run("sudo", ["-n", "test", "-e", trustDirectory], { allowFailure: true }).status === 0) {
    throw new Error(`${trustDirectory} exists; if an interrupted run of this gate left it, remove it and any `
      + `"${hostsMarker}" line in ${hostsFile}`);
  }
  return withRegistryHost(readFileSync(hostsFile, "utf8"));
}

function announce(authority, hosts) {
  run("sudo", ["-n", "install", "-D", "-m", "0644", authority.path, join(trustDirectory, "ca.crt")]);
  run("sudo", ["-n", "tee", hostsFile], { input: hosts });
}

function withdraw() {
  run("sudo", ["-n", "rm", "-f", join(trustDirectory, "ca.crt")], { allowFailure: true });
  run("sudo", ["-n", "rmdir", trustDirectory], { allowFailure: true });
  const hosts = readFileSync(hostsFile, "utf8");
  if (hosts !== withoutRegistryHost(hosts)) run("sudo", ["-n", "tee", hostsFile], { input: withoutRegistryHost(hosts) });
}

function cleanup(environment, deployment) {
  const problems = [];
  const attempt = (label, step) => {
    try {
      step();
    } catch (error) {
      problems.push(`${label}: ${error.message}`);
    }
  };
  attempt("withdraw the stand-in registry", withdraw);
  attempt("keep the registry log", () => writeFileSync(join(evidence, "registry.log"),
    run("docker", [...compose, "logs", "--no-color", "registry"], { env: environment, allowFailure: true }).stdout ?? ""));
  attempt("stop the registry", () => run("docker", [...compose, "down", "--volumes"], { env: environment }));
  attempt("remove the certificates", () => rmSync(certificates, { recursive: true, force: true }));
  if (deployment) attempt("remove the deployment", () => rmSync(deployment, { recursive: true, force: true }));
  return problems;
}

const manifestTypes = ["application/vnd.oci.image.index.v1+json", "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json", "application/vnd.docker.distribution.manifest.v2+json"];

function ask(authority, path, method = "GET") {
  return new Promise((settle) => {
    const probe = request({ host: registryAddress, port: 443, servername: registryHost, path, method,
      headers: { Accept: manifestTypes.join(", ") }, ca: authority.pem, timeout: 5000 }, (response) => {
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
  gateJourney(named.journey, "");
  const name = `${registryHost}/${named.repository.toLowerCase()}`;
  const hosts = announcedHosts();
  rmSync(evidence, { recursive: true, force: true });
  mkdirSync(evidence, { recursive: true });
  const environment = { ...process.env, COURTSIDE_UPGRADE_REGISTRY_CERTIFICATES: certificates };
  let deployment;
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    process.once(signal, () => {
      cleanup(environment, deployment);
      process.exit(code);
    });
  }
  let failure;
  try {
    const authority = issueCertificates();
    deployment = mkdtempSync(join(tmpdir(), "courtside-installed-upgrade-gate-"));
    announce(authority, hosts);
    await serve(authority, environment);
    const image = await publish(authority, named.image, name, "app");
    const bookingSeedImage = await publish(authority, named["booking-seed-image"], name, "booking-seed");
    writeFileSync(join(evidence, "image-binding.json"), `${JSON.stringify({
      sourceImage: named.image, sourceBookingSeedImage: named["booking-seed-image"],
      servedImage: image, servedBookingSeedImage: bookingSeedImage, revision: named.revision,
    }, null, 2)}\n`);
    const output = join(evidence, "archive");
    mkdirSync(output, { recursive: true });
    run(process.execPath, archiveArguments({ image, bookingSeedImage, version: named.version, revision: named.revision,
      repository: named.repository, workflow: named.workflow, ref: named.ref, output }), { inherit: true });
    const archive = join(output, `courtside-deployment-${named.version}.zip`);
    const candidate = join(deployment, "extracted", `courtside-deployment-${named.version}`);
    const journey = gateJourney(named.journey, candidate);
    run(process.execPath, ["tools/deployment-qualification.mjs", "--inspect-archive", "--archive", archive,
      "--destination", join(deployment, "extracted"), "--image", image, "--booking-seed-image", bookingSeedImage,
      "--recipes", journey.recipe, "--output", join(evidence, "archive.json")], { inherit: true });
    run(process.execPath, journey.arguments, { inherit: true });
    if (journey.name === "stalwart-store-transition") {
      const report = JSON.parse(readFileSync(join(repository, "build", "stalwart-store-transition", "result.json")));
      verifyTransitionBinding(report, { image, revision: named.revision });
    }
  } catch (error) {
    failure = error;
  }
  const problems = cleanup(environment, deployment);
  if (failure || problems.length > 0) {
    writeFileSync(join(evidence, "failure.txt"), `${[failure?.stack, ...problems].filter(Boolean).join("\n")}\n`);
    throw failure ?? new Error(problems.join("; "));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  execute().catch((error) => {
    process.stderr.write(`Installed upgrade gate failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
