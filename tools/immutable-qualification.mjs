import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const imagePattern = /^sha256:[a-f0-9]{64}$/;
const sourcePattern = /^[a-f0-9]{40}$/;

export async function immutableQualificationRequest({ secure, port, path, method = "GET", headers = {}, body, ca },
  { deadlineMilliseconds = 30_000, responseLimit = 4 * 1024 * 1024 } = {}) {
  if (typeof secure !== "boolean" || !Number.isSafeInteger(port) || port < 1024 || port > 65535
      || typeof path !== "string" || !path.startsWith("/") || path.length > 4096
      || !Number.isSafeInteger(deadlineMilliseconds) || deadlineMilliseconds < 1 || deadlineMilliseconds > 30_000
      || !Number.isSafeInteger(responseLimit) || responseLimit < 1 || responseLimit > 4 * 1024 * 1024
      || body !== undefined && (typeof body !== "string" || Buffer.byteLength(body) > 4 * 1024 * 1024)
      || secure && (!(typeof ca === "string" || Buffer.isBuffer(ca)) || !ca.length)) {
    throw new Error("Immutable qualification HTTP input is outside its trusted loopback budget");
  }
  return new Promise((resolveResponse, rejectResponse) => {
    const connection = (secure ? httpsRequest : httpRequest)({ hostname: "127.0.0.1", port, path, method,
      headers: { Host: `localhost:${port}`, ...headers },
      ...(secure ? { rejectUnauthorized: true, servername: "localhost", ca } : {}) }, (response) => {
      const chunks = [];
      let bytes = 0;
      const certificate = secure ? response.socket.getPeerCertificate().raw : undefined;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > responseLimit) {
          rejectResponse(new Error("Immutable qualification HTTP response exceeded its byte budget"));
          clearTimeout(deadline);
          response.destroy();
          connection.destroy();
        } else chunks.push(chunk);
      });
      response.on("error", rejectResponse);
      response.on("end", () => {
        clearTimeout(deadline);
        resolveResponse({ statusCode: response.statusCode ?? 0, headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
          ...(certificate ? { certificateSha256: createHash("sha256").update(certificate).digest("hex") } : {}) });
      });
    });
    const deadline = setTimeout(() => {
      rejectResponse(new Error("Immutable qualification HTTP deadline exceeded"));
      connection.destroy();
    }, deadlineMilliseconds);
    connection.once("error", (error) => { clearTimeout(deadline); rejectResponse(error); });
    connection.once("close", () => clearTimeout(deadline));
    connection.end(body);
  });
}

export function immutableQualificationOptions(args, environment = process.env) {
  if (!args.includes("--image") && !args.includes("--source-commit")) return undefined;
  if (args.length !== 6 || args.some((value) => typeof value !== "string" || value.length > 128)) {
    throw new Error("Immutable qualification options exceeded their bound");
  }
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!["--confirm", "--image", "--source-commit"].includes(flag)
        || Object.hasOwn(values, flag) || typeof args[index + 1] !== "string") {
      throw new Error("Immutable qualification requires unique confirm, image and source-commit options");
    }
    values[flag] = args[index + 1];
  }
  const project = values["--confirm"];
  const image = values["--image"];
  const sourceCommit = values["--source-commit"];
  if (!/^courtside-uat-qualification-[a-z0-9][a-z0-9-]{0,26}$/.test(project ?? "")
      || !imagePattern.test(image ?? "") || !sourcePattern.test(sourceCommit ?? "")) {
    throw new Error("Immutable qualification needs a dedicated project, full image ID and full source commit");
  }
  if (environment.COURTSIDE_UAT_VERSION
      || environment.COURTSIDE_UAT_PROJECT && environment.COURTSIDE_UAT_PROJECT !== project
      || environment.COURTSIDE_BOOKING_SEED_IMAGE || environment.COURTSIDE_BOOKING_SEED_CANDIDATE
      || environment.COURTSIDE_UAT_BOOKING_SEED_IMAGE || environment.COURTSIDE_UAT_BOOKING_SEED_COMPOSE) {
    throw new Error("Immutable qualification conflicts with inherited UAT selection");
  }
  return { project, image, sourceCommit };
}

function boundedOutput(execute, command, args, root, environment, raw = false) {
  const result = execute(command, args, { cwd: root, env: environment ?? process.env,
    encoding: "utf8", shell: false, timeout: 60_000, maxBuffer: 1024 * 1024 });
  if (!result || result.error || result.status !== 0 || result.signal
      || result.truncated || result.timedOut || typeof result.stdout !== "string"
      || Buffer.byteLength(result.stdout) > 1024 * 1024) {
    throw new Error(`Immutable qualification ${command} command did not complete within its bounds`);
  }
  return raw ? result.stdout : result.stdout.trim();
}

function singleInspection(value) {
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !parsed[0] || typeof parsed[0] !== "object") {
    throw new Error("Immutable qualification requires exactly one inspection result");
  }
  return parsed[0];
}

function nativeArchitecture(value) {
  return ({ x64: "amd64", x86_64: "amd64", amd64: "amd64", aarch64: "arm64", arm64: "arm64" })[value];
}

function sameImageBytes(actual, selected) {
  return imagePattern.test(actual?.Id ?? "") && actual.Os === selected.Os
    && actual.Architecture === selected.Architecture
    && JSON.stringify(actual.Config) === JSON.stringify(selected.Config)
    && JSON.stringify(actual.RootFS) === JSON.stringify(selected.RootFS);
}

export function inspectImmutableCandidate({ image, sourceCommit, root, execute = spawnSync,
  platform = process.platform, architecture = process.arch, probeToken = randomBytes(16).toString("hex") }) {
  if (!imagePattern.test(image ?? "") || !sourcePattern.test(sourceCommit ?? "")
      || typeof root !== "string" || !root.startsWith("/") || !/^[a-f0-9]{32}$/.test(probeToken)) {
    throw new Error("Immutable candidate inspection input is invalid");
  }
  const run = (command, args, raw = false) => boundedOutput(execute, command, args, root, undefined, raw);
  if (run("git", ["rev-parse", "HEAD"]) !== sourceCommit
      || run("git", ["status", "--porcelain", "--untracked-files=all"]) !== "") {
    throw new Error("Immutable qualification requires the exact clean source checkout");
  }
  const inspected = singleInspection(run("docker", ["image", "inspect", image]));
  const host = JSON.parse(run("docker", ["info", "--format", "{{json .}}"]));
  const native = nativeArchitecture(architecture);
  if (platform !== "linux" || !native || host.OSType !== "linux"
      || nativeArchitecture(host.Architecture) !== native || inspected.Os !== "linux"
      || inspected.Architecture !== native || inspected.Id !== image) {
    throw new Error("Immutable qualification requires matching native Linux host and actual image architecture");
  }
  const config = inspected.Config;
  if (config?.User !== "10001:10001" || !Array.isArray(config.Entrypoint) || !config.Entrypoint.length
      || config.Entrypoint.some((part) => typeof part !== "string")
      || !Array.isArray(inspected.RootFS?.Layers) || !inspected.RootFS.Layers.length
      || inspected.RootFS.Layers.some((layer) => !imagePattern.test(layer))) {
    throw new Error("Immutable candidate is missing native container metadata");
  }
  const revision = config.Labels?.["org.opencontainers.image.revision"];
  if (revision !== undefined && revision !== sourceCommit) throw new Error("Candidate revision label disagrees with source");
  let probe;
  let sourceBytes;
  let runtimeImageID;
  try {
    probe = run("docker", ["create", "--pull=never", "--network=none", "--read-only",
      "--user=10001:10001", "--cap-drop=ALL", "--security-opt=no-new-privileges:true",
      "--memory=64m", "--memory-swap=64m", "--cpus=1", "--pids-limit=16",
      "--label", `org.courtside.qualification.probe=${probeToken}`, "--entrypoint", "/bin/cat",
      image, "/app/BOOT-INF/classes/git.properties"]);
    if (!/^[a-f0-9]{64}$/.test(probe)) throw new Error("Candidate source probe did not return a full container ID");
    sourceBytes = run("docker", ["start", "--attach", probe], true);
    const commits = sourceBytes.split(/\r?\n/).filter((line) => /^git\.commit\.id[=:]/.test(line));
    if (commits.length !== 1 || commits[0] !== `git.commit.id=${sourceCommit}`) {
      throw new Error("Actual candidate filesystem source does not match the requested source commit");
    }
  } finally {
    if (probe && /^[a-f0-9]{64}$/.test(probe)) {
      const actual = singleInspection(run("docker", ["inspect", probe]));
      if (actual.Id !== probe || actual.Config?.Image !== image || !imagePattern.test(actual.Image ?? "")
          || actual.Config?.Labels?.["org.courtside.qualification.probe"] !== probeToken) {
        throw new Error("Candidate source probe ownership changed; cleanup refused");
      }
      const runtimeImage = singleInspection(run("docker", ["image", "inspect", actual.Image]));
      if (!sameImageBytes(runtimeImage, inspected)) throw new Error("Candidate source probe image bytes changed; cleanup refused");
      runtimeImageID = actual.Image;
      run("docker", ["rm", "--force", probe]);
    }
  }
  return { sourceCommit, architecture: native, image: inspected, runtimeImageID,
    sourcePropertiesSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    inspectionSha256: createHash("sha256").update(JSON.stringify(inspected)).digest("hex") };
}

export function createImmutableQualification({ project, image, sourceCommit, root, evidence,
  execute = spawnSync, environment = process.env, platform = process.platform, architecture = process.arch }) {
  immutableQualificationOptions(["--confirm", project, "--image", image, "--source-commit", sourceCommit], environment);
  const portNames = ["COURTSIDE_UAT_HTTP_PORT", "COURTSIDE_UAT_HTTPS_PORT", "COURTSIDE_UAT_SHARED_PORT", "COURTSIDE_OPERATIONAL_LOG_PORT"];
  const ports = portNames.map((name) => environment[name]);
  if (ports.some((port) => !/^[0-9]{4,5}$/.test(port ?? "") || Number(port) < 1024 || Number(port) > 65535
      || [8081, 8443, 8083, 1515].includes(Number(port))) || new Set(ports.map(Number)).size !== ports.length
      || environment.DOCKER_HOST && environment.DOCKER_HOST !== "unix:///var/run/docker.sock"
      || environment.DOCKER_CONTEXT && environment.DOCKER_CONTEXT !== "default") {
    throw new Error("Immutable qualification needs distinct explicit ports and the local Docker context");
  }
  const token = randomBytes(16).toString("hex");
  const ownerLabel = "org.courtside.qualification.owner";
  const composeFile = join(root, "deploy", "compose.uat.yaml");
  const env = { ...environment, COURTSIDE_UAT_PROJECT: project, COURTSIDE_UAT_IMAGE: image,
    COURTSIDE_UAT_ADMIN_PASSWORD: "" };
  const base = ["compose", "--env-file", "/dev/null", "-p", project, "-f", composeFile];
  const run = (args, currentEnv = env) => boundedOutput(execute, "docker", args, root, currentEnv);
  const endpoint = JSON.parse(run(["context", "inspect", "default", "--format", "{{json .Endpoints.docker}}"]));
  if (endpoint.Host !== "unix:///var/run/docker.sock") throw new Error("Immutable qualification cannot use a remote Docker endpoint");
  const kinds = ["container", "network", "volume"];
  const list = (kind) => {
    const prefix = kind === "container" ? ["ps", "-a"] : [kind, "ls"];
    const ids = new Set();
    for (const filter of [`label=com.docker.compose.project=${project}`, `name=^/?${project}[-_]`]) {
      for (const id of run([...prefix, "--quiet", "--filter", filter]).split("\n").filter(Boolean)) ids.add(id);
    }
    if (ids.size > 32) throw new Error("Immutable qualification resource inventory exceeded its bound");
    if ([...ids].some((id) => kind === "volume" ? !/^[a-z0-9][a-z0-9_-]{0,100}$/.test(id)
      : !/^[a-f0-9]{12,64}$/.test(id))) throw new Error("Immutable qualification resource identifier is invalid");
    return [...ids].sort();
  };
  if (kinds.some((kind) => list(kind).length)) throw new Error("Immutable qualification project already has resources");
  const proof = inspectImmutableCandidate({ image, sourceCommit, root, execute, platform, architecture });
  const rendered = JSON.parse(run([...base, "config", "--format", "json"]));
  const services = ["app", "log-collector", "db", "api-ui", "proxy"];
  const networks = ["backend", "frontend", "log-collection"];
  const volumes = ["db", "operational-logs", "caddy-data", "caddy-config"];
  for (const [key, expected] of [["services", services], ["networks", networks], ["volumes", volumes]]) {
    if (JSON.stringify(Object.keys(rendered[key] ?? {}).sort()) !== JSON.stringify([...expected].sort())) {
      throw new Error("Immutable qualification Compose resource schema changed");
    }
  }
  const dependencyImages = {};
  const dependencyMetadata = {};
  for (const service of services) {
    const reference = rendered.services[service].image;
    if (["app", "log-collector"].includes(service) ? reference !== image
      : !/^[a-z0-9][a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/.test(reference ?? "")) {
      throw new Error("Immutable qualification Compose image is not the pinned candidate or dependency");
    }
    const actual = singleInspection(run(["image", "inspect", reference]));
    if (!imagePattern.test(actual.Id ?? "") || actual.Os !== "linux" || actual.Architecture !== proof.architecture
        || reference === image && actual.Id !== image) {
      throw new Error("Immutable qualification dependency image is absent or not native");
    }
    dependencyImages[service] = actual.Id;
    dependencyMetadata[service] = actual;
  }
  for (const kind of ["networks", "volumes"]) {
    if (Object.entries(rendered[kind]).some(([name, value]) => value.external
        || value.name && value.name !== `${project}_${name}`)) {
      throw new Error("Immutable qualification cannot reuse an external or foreign named resource");
    }
  }
  const work = resolve(evidence);
  mkdirSync(work, { recursive: true, mode: 0o700 });
  const overrideFile = join(work, "compose.override.json");
  const labels = { [ownerLabel]: token };
  const override = { services: Object.fromEntries(services.map((service) => [service,
    { image: dependencyImages[service], pull_policy: "never", labels,
      ...(["app", "db"].includes(service) ? { cpus: 2, mem_limit: "1g", memswap_limit: "1g", pids_limit: 256 }
        : service === "log-collector" ? { cpus: 1 }
          : { cpus: 1, mem_limit: service === "proxy" ? "128m" : "256m", memswap_limit: service === "proxy" ? "128m" : "256m", pids_limit: 64 }) }])),
  networks: Object.fromEntries(networks.map((name) => [name, { labels }])),
  volumes: Object.fromEntries(volumes.map((name) => [name, { labels }])) };
  writeFileSync(overrideFile, `${JSON.stringify(override, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  const compose = [...base, "-f", overrideFile];
  const overrideDigest = createHash("sha256").update(readFileSync(overrideFile)).digest("hex");
  const renderedDigest = createHash("sha256").update(JSON.stringify(rendered)).digest("hex");
  proof.instanceFingerprint = createHash("sha256").update(JSON.stringify({ project, image, sourceCommit, token })).digest("hex");
  proof.resources = [];
  proof.runtime = [];
  const persistProof = () => writeFileSync(join(work, "candidate-proof.json"), `${JSON.stringify({
    ...proof, project, owner: token, dependencyImages, overrideDigest, renderedDigest
  }, null, 2)}\n`, { mode: 0o600 });
  persistProof();
  let reservation;
  try {
    reservation = run(["create", "--pull=never", "--name", `${project}-reservation`,
    "--network=none", "--read-only", "--user=10001:10001", "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true", "--memory=64m", "--memory-swap=64m",
    "--cpus=1", "--pids-limit=16", "--label", `${ownerLabel}=${token}`,
    "--entrypoint", "/bin/cat", image, "/dev/null"]);
  } catch (failure) {
    const actual = singleInspection(run(["inspect", `${project}-reservation`]));
    if (!/^[a-f0-9]{64}$/.test(actual.Id ?? "") || actual.Name !== `/${project}-reservation`
        || actual.Image !== proof.runtimeImageID || actual.Config?.Image !== image
        || actual.Config?.Labels?.[ownerLabel] !== token) {
      throw new AggregateError([failure], "Incomplete reservation could not be proven owned; cleanup refused");
    }
    run(["rm", "--force", actual.Id]);
    throw failure;
  }
  if (!/^[a-f0-9]{64}$/.test(reservation)) throw new Error("Immutable qualification reservation did not return a full ID");
  const recorded = new Map();
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
  const bytes = value => {
    if (typeof value === "number") return value;
    const match = /^(\d+(?:\.\d+)?)([kmgt]?)(?:i?b)?$/i.exec(String(value ?? 0));
    if (!match) throw new Error("Immutable qualification memory setting is unsupported");
    return Number(match[1]) * 1024 ** (match[2] ? "kmgt".indexOf(match[2].toLowerCase()) + 1 : 0);
  };
  const environmentEntries = value => {
    const entries = Array.isArray(value) ? value.map(entry => {
      const index = entry.indexOf("=");
      if (index < 1) throw new Error("Immutable qualification environment is incomplete");
      return [entry.slice(0, index), entry.slice(index + 1)];
    }) : Object.entries(value ?? {}).map(([key, entry]) => {
      if (entry === null || entry === undefined) throw new Error("Immutable qualification environment is unresolved");
      return [key, String(entry)];
    });
    if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error("Immutable qualification environment is ambiguous");
    return Object.fromEntries(entries);
  };
  const assertEffective = (item, service, expected) => {
    if (!expected || typeof expected !== "object") {
      throw new Error("Immutable qualification unexpected container creation");
    }
    const imageConfig = dependencyMetadata[service].Config;
    const config = item.Config;
    const host = item.HostConfig;
    const expectedEnv = { ...environmentEntries(imageConfig.Env), ...environmentEntries(expected.environment) };
    const settings = { Entrypoint: expected.entrypoint ?? imageConfig.Entrypoint, Cmd: expected.command ?? imageConfig.Cmd,
      User: expected.user ?? imageConfig.User ?? "", WorkingDir: expected.working_dir ?? imageConfig.WorkingDir ?? "" };
    const tmpfs = Object.fromEntries((expected.tmpfs ?? []).map(value => {
      const [path, ...options] = value.split(":");
      return [path, options.join(":")];
    }));
    const portBindings = {};
    for (const port of expected.ports ?? []) {
      if (port.mode && port.mode !== "ingress") throw new Error("Immutable qualification port mode is unsupported");
      if (port.published === undefined) continue;
      const key = `${port.target}/${port.protocol ?? "tcp"}`;
      (portBindings[key] ??= []).push({ HostIp: port.host_ip ?? "", HostPort: String(port.published) });
    }
    const healthcheck = expected.healthcheck;
    const duration = value => {
      if (typeof value === "number" && Number.isSafeInteger(value)) return value;
      const parts = [...String(value).matchAll(/(\d+(?:\.\d+)?)(ns|us|ms|s|m|h)/g)];
      if (!parts.length || parts.map(part => part[0]).join("") !== value) throw new Error("Immutable qualification health duration is unsupported");
      return parts.reduce((total, part) => total + Number(part[1]) * ({ ns: 1, us: 1000, ms: 1000000,
        s: 1000000000, m: 60000000000, h: 3600000000000 })[part[2]], 0);
    };
    const healthFields = healthcheck ? { ...(healthcheck.disable ? { Test: ["NONE"] }
      : healthcheck.test ? { Test: healthcheck.test } : {}),
      ...Object.fromEntries([["interval", "Interval"], ["timeout", "Timeout"], ["start_period", "StartPeriod"],
        ["start_interval", "StartInterval"]].filter(([field]) => healthcheck[field] !== undefined)
        .map(([field, key]) => [key, duration(healthcheck[field])])),
      ...(healthcheck.retries === undefined ? {} : { Retries: healthcheck.retries }) } : imageConfig.Healthcheck ?? {};
    if (!config || !host || Object.entries(settings).some(([field, value]) => !equal(config[field] ?? null, value ?? null))
        || !equal(environmentEntries(config.Env), expectedEnv)
        || host.Memory !== bytes(expected.mem_limit)
        || host.MemorySwap !== (expected.memswap_limit === undefined ? 2 * bytes(expected.mem_limit) : bytes(expected.memswap_limit))
        || host.NanoCpus !== Number(expected.cpus ?? 0) * 1000000000
        || host.PidsLimit !== (expected.pids_limit ?? 0) || host.ReadonlyRootfs !== Boolean(expected.read_only)
        || host.Privileged !== Boolean(expected.privileged)
        || !equal([...(host.CapDrop ?? [])].sort(), [...(expected.cap_drop ?? [])].sort())
        || !equal([...(host.SecurityOpt ?? [])].sort(), [...(expected.security_opt ?? [])].sort())
        || !equal(host.Tmpfs ?? {}, tmpfs)
        || !equal(host.PortBindings ?? {}, portBindings)
        || Object.entries(healthFields).some(([field, value]) => !equal(config.Healthcheck?.[field], value))
        || expected.logging && (host.LogConfig?.Type !== expected.logging.driver
          || !equal(host.LogConfig?.Config ?? {}, expected.logging.options ?? {}))
        || host.RestartPolicy?.Name !== (expected.restart ?? "no")) {
      throw new Error("Immutable qualification effective container configuration changed");
    }
  };
  const identity = (kind, item, expectedServices) => {
    const id = kind === "volume" ? item.Name : item.Id;
    const name = kind === "container" ? item.Name?.replace(/^\//, "") : item.Name;
    const actualLabels = kind === "container" ? item.Config?.Labels : item.Labels;
    if (actualLabels?.[ownerLabel] !== token || typeof name !== "string"
        || !name.startsWith(`${project}${kind === "container" ? "-" : "_"}`)) {
      throw new Error("Immutable qualification resource ownership does not match");
    }
    if (kind !== "container" && (actualLabels["com.docker.compose.project"] !== project
        || !(kind === "volume" ? volumes : networks).some((suffix) => name === `${project}_${suffix}`))) {
      throw new Error("Immutable qualification resource namespace changed");
    }
    if (kind === "container" && id === reservation
        && (name !== `${project}-reservation` || item.Image !== proof.runtimeImageID || item.Config?.Image !== image)) {
      throw new Error("Immutable qualification reservation identity changed");
    }
    if (kind === "container" && id !== reservation) {
      const service = actualLabels["com.docker.compose.service"];
      const files = actualLabels["com.docker.compose.project.config_files"]?.split(",") ?? [];
      if (actualLabels["com.docker.compose.project"] !== project || !services.includes(service)
          || name !== `${project}-${service}-1`
          || !files.includes(composeFile) || item.Config?.Image !== dependencyImages[service]
          || !imagePattern.test(item.Image ?? "")
          || !sameImageBytes(singleInspection(run(["image", "inspect", item.Image])), dependencyMetadata[service])) {
        throw new Error("Immutable qualification container provenance changed");
      }
      if (service === "app" && (JSON.stringify(item.Config.Entrypoint) !== JSON.stringify(proof.image.Config.Entrypoint)
          || JSON.stringify(item.Config.Cmd ?? null) !== JSON.stringify(proof.image.Config.Cmd ?? null))) {
        throw new Error("Immutable qualification native application entrypoint changed");
      }
      if (!recorded.has(`container:${id}`)) assertEffective(item, service, expectedServices[service]);
    }
    return { kind, id, name, labels: actualLabels, image: item.Image,
      ...(kind === "container" ? { config: item.Config, hostConfig: item.HostConfig } : {}),
      created: item.Created ?? item.CreatedAt, driver: item.Driver, options: item.Options };
  };
  const inventory = (expectedServices) => kinds.flatMap((kind) => {
    const ids = list(kind);
    if (!ids.length) return [];
    const actual = JSON.parse(run([...(kind === "container" ? [] : [kind]), "inspect", ...ids]));
    if (!Array.isArray(actual) || actual.length !== ids.length) throw new Error("Resource inspection is incomplete");
    return actual.map((item) => identity(kind, item, expectedServices));
  });
  const reconcile = ({ createServices = [], infrastructure = false, acceptReservation = false,
    retired = new Set(), expectedServices = {} } = {}) => {
    if (boundedOutput(execute, "git", ["rev-parse", "HEAD"], root, env) !== sourceCommit
        || boundedOutput(execute, "git", ["status", "--porcelain", "--untracked-files=all"], root, env) !== ""
        || createHash("sha256").update(readFileSync(overrideFile)).digest("hex") !== overrideDigest
        || createHash("sha256").update(JSON.stringify(JSON.parse(run([...base, "config", "--format", "json"],
          { ...env, COURTSIDE_UAT_ADMIN_PASSWORD: "" })))).digest("hex") !== renderedDigest) {
      throw new Error("Immutable qualification source or Compose binding changed");
    }
    const actual = inventory(expectedServices);
    if (actual.some(item => retired.has(`${item.kind}:${item.id}`))) {
      throw new Error("Immutable qualification planned replacement did not retire the original container");
    }
    for (const item of actual) {
      const key = `${item.kind}:${item.id}`;
      const previous = recorded.get(key);
      const allowedNew = item.kind === "container" ? item.id === reservation ? acceptReservation
        : createServices.includes(item.labels["com.docker.compose.service"]) : infrastructure;
      if (previous ? !equal(previous, item) : !allowedNew) {
        throw new Error("Immutable qualification resource identity changed");
      }
    }
    if ([...recorded.keys()].some((key) => !retired.has(key)
        && !actual.some((item) => `${item.kind}:${item.id}` === key))) {
      throw new Error("Immutable qualification recorded resource is missing");
    }
    for (const key of retired) {
      if (!actual.some((item) => `${item.kind}:${item.id}` === key)) recorded.delete(key);
    }
    for (const item of actual) recorded.set(`${item.kind}:${item.id}`, item);
    proof.liveResources = actual;
    persistProof();
    return actual;
  };
  try { reconcile({ acceptReservation: true }); }
  catch (error) {
    const actual = singleInspection(run(["inspect", reservation]));
    if (actual.Id === reservation && actual.Image === proof.runtimeImageID && actual.Config?.Image === image
        && actual.Config?.Labels?.[ownerLabel] === token) {
      run(["rm", "--force", reservation]);
    }
    throw error;
  }
  const remove = (items) => {
    for (const kind of kinds) {
      const selected = items.filter((item) => item.kind === kind);
      for (const item of selected) {
        reconcile();
        run([...(kind === "container" ? [] : [kind]), "rm", ...(kind === "container" ? ["--force"] : []), item.id]);
        proof.resources.push({ ...item, removedAt: new Date().toISOString() });
        persistProof();
        recorded.delete(`${kind}:${item.id}`);
      }
    }
  };
  const composeRun = (...args) => {
    const supported = [
      ["up", "-d", "--wait", "app", "proxy"], ["up", "-d", "--wait", "--force-recreate", "app"],
      ["stop", "app"], ["restart", "app"], ["ps", "-q", "app"], ["images", "app", "--format", "json"],
      ["logs", "--no-color"], ["logs", "--no-color", "app", "proxy"],
      ["exec", "-T", "proxy", "cat", "/data/caddy/pki/authorities/local/root.crt"],
      ...["user_account", "spring_session"].map((table) => ["exec", "-T", "db", "psql", "-U", "courtside",
        "-d", "courtside", "-tAc", `select count(*) from ${table}`]),
      ...["root-before.crt", "root-after.crt"].map((name) => ["cp",
        "proxy:/data/caddy/pki/authorities/local/root.crt", join(work, name)]),
    ];
    if (!supported.some((command) => JSON.stringify(command) === JSON.stringify(args))) {
      throw new Error("Immutable qualification Compose command is outside the bounded smoke lifecycle");
    }
    reconcile();
    const retired = new Set(args[0] === "up" && args.includes("--force-recreate")
      ? [...recorded.entries()].filter(([, item]) => item.kind === "container"
        && item.labels["com.docker.compose.service"] === "app").map(([key]) => key) : []);
    const guarded = args[0] === "up" ? ["up", "--pull", "never", "--no-build", ...args.slice(1)] : args;
    const transition = args[0] === "up" ? {
      createServices: args.includes("--force-recreate") ? ["app"] : services,
      infrastructure: !args.includes("--force-recreate"), retired,
      expectedServices: JSON.parse(run([...compose, "config", "--format", "json"])).services
    } : {};
    let output;
    try { output = run([...compose, ...guarded]); }
    finally { reconcile(transition); }
    return output;
  };
  return {
    environment: env, compose, proof,
    start(password) {
      if (typeof password !== "string" || password.length < 16 || password.length > 256) {
        throw new Error("Immutable bootstrap password is invalid");
      }
      env.COURTSIDE_UAT_ADMIN_PASSWORD = password;
      composeRun("up", "-d", "--wait", "app", "proxy");
      env.COURTSIDE_UAT_ADMIN_PASSWORD = "";
      composeRun("up", "-d", "--wait", "--force-recreate", "app");
    },
    composeRun,
    assertCandidate() {
      reconcile();
      const id = composeRun("ps", "-q", "app");
      const actual = singleInspection(run(["inspect", id]));
      if (actual.Image !== proof.runtimeImageID || actual.Config?.Image !== image) {
        throw new Error("Running qualification candidate image drifted");
      }
      if (typeof actual.State?.OOMKilled !== "boolean" || !Number.isSafeInteger(actual.RestartCount)
          || actual.RestartCount < 0 || typeof actual.State.StartedAt !== "string"
          || !Number.isFinite(Date.parse(actual.State.StartedAt))) {
        throw new Error("Native qualification runtime observation is incomplete");
      }
      proof.runtime.push({ containerId: actual.Id, imageId: actual.Image,
        startedAt: actual.State?.StartedAt, oomKilled: actual.State?.OOMKilled,
        restartCount: actual.RestartCount, entrypoint: actual.Config?.Entrypoint,
        command: actual.Config?.Cmd, limits: actual.HostConfig,
        observedAt: new Date().toISOString() });
      persistProof();
      return actual;
    },
    reset() {
      const items = reconcile();
      remove(items.filter((item) => item.kind === "container" && item.id !== reservation));
      remove(reconcile().filter((item) => item.kind === "network" || item.kind === "volume" && item.name === `${project}_db`));
    },
    cleanup() {
      remove(reconcile().filter((item) => item.id !== reservation));
      remove(reconcile());
      if (kinds.some((kind) => list(kind).length)) throw new Error("Immutable qualification cleanup has leftovers");
      reconcile();
    },
  };
}
