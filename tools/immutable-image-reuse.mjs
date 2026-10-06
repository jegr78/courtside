import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { performance } from "node:perf_hooks";

const imageID = /^sha256:[a-f0-9]{64}$/;
const sourceID = /^[a-f0-9]{40}$/;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const helperRoot = "org/courtside/securityassessment/";
const helpers = ["SecuritySessionAttributeProjection.class", "SecuritySessionAttributeProjection$RestrictedStream.class",
  "SecurityPublicationPolicyProjection.class"].map((name) => `/app/BOOT-INF/classes/${helperRoot}${name}`);
const pathPattern = /^\/app\/[A-Za-z0-9_.$@/-]+$/;

export function immutableImageSelection({ image, fixturesImage, sourceCommit }) {
  if (!imageID.test(image ?? "") || !imageID.test(fixturesImage ?? "") || image === fixturesImage
      || !sourceID.test(sourceCommit ?? "")) throw new Error("Immutable image reuse requires two exact engine IDs and one full source commit");
  return { image, fixturesImage, sourceCommit };
}

export function boundedImageCommand(execute, command, args, root, environment = process.env, timeoutMilliseconds = 10000) {
  if (!["docker", "git"].includes(command)) throw new Error("Unsupported immutable image command");
  if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 10000) {
    throw new Error("Immutable image command timeout is outside its bound");
  }
  const result = execute(command, args, { cwd: root, env: environment, shell: false,
    encoding: "utf8", timeout: timeoutMilliseconds, maxBuffer: 4 * 1024 * 1024 });
  if (!result || result.error || result.status !== 0 || result.signal || result.truncated || result.timedOut
      || typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > 4 * 1024 * 1024
      || typeof result.stderr !== "string" || Buffer.byteLength(result.stderr) > 4 * 1024 * 1024) {
    throw new Error("Immutable image command did not complete within its bounds");
  }
  return result.stdout;
}

export function cleanupPerformanceRunner({ cidFile, owner, root, execute = spawnSync, environment = process.env }) {
  if (!isAbsolute(cidFile) || !/^[a-f0-9]{32}$/.test(owner ?? "")) throw new Error("Immutable PERFORMANCE runner cleanup identity is invalid");
  if (!existsSync(cidFile)) throw new Error("Immutable PERFORMANCE runner creation is incomplete; cleanup requires inspection");
  const id = readFileSync(cidFile, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Immutable PERFORMANCE runner identifier is incomplete");
  const run = (args) => boundedImageCommand(execute, "docker", args, root, environment);
  const remaining = run(["ps", "-aq", "--no-trunc", "--filter", `id=${id}`]).trim().split("\n").filter(Boolean);
  if (!remaining.length) return;
  if (remaining.length !== 1 || remaining[0] !== id) throw new Error("Immutable PERFORMANCE runner inventory changed");
  const actual = inspection(run(["inspect", id]));
  if (actual.Id !== id || actual.Config?.Labels?.["org.courtside.performance.run"] !== owner
      || actual.Config?.Labels?.["com.docker.compose.project"] !== "courtside-perf") {
    throw new Error("Immutable PERFORMANCE runner ownership changed; cleanup refused");
  }
  run(["rm", "--force", id]);
}

export function assertPerformanceStateOwnership(state, { root, execute = spawnSync, environment = process.env }) {
  if (state?.immutableImages && state.immutableDeployment) return;
  if (existsSync(join(root, "build", "immutable-performance-compose.json"))) {
    throw new Error("Immutable PERFORMANCE state is unavailable; reset refused");
  }
  const reservation = boundedImageCommand(execute, "docker",
    ["ps", "-aq", "--no-trunc", "--filter", "name=^/courtside-perf-reuse-reservation$"], root, environment).trim();
  if (reservation) throw new Error("Immutable PERFORMANCE state is unavailable; reset refused");
}

function inspection(bytes) {
  const actual = JSON.parse(bytes);
  if (!Array.isArray(actual) || actual.length !== 1 || !actual[0] || typeof actual[0] !== "object") {
    throw new Error("Immutable image inspection is incomplete");
  }
  return actual[0];
}

function paths(bytes) {
  const values = bytes === "" ? [] : bytes.split("\0").slice(0, -1);
  if (bytes !== "" && !bytes.endsWith("\0") || values.length > 8192
      || new Set(values).size !== values.length || values.some((path) => !pathPattern.test(path)
        || path.split("/").some((part) => part === ".." || part === "."))) {
    throw new Error("Immutable image file inventory is invalid");
  }
  return values.sort();
}

function readImmutableFile(path, expected) {
  const identity = stat => [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs];
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    throw new Error("Immutable file is unsafe or changed before opening", { cause: error });
  }
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 0 || before.size > 16 * 1024 * 1024) {
      throw new Error("Immutable file exceeds its bound or is not regular");
    }
    if (expected && JSON.stringify(identity(before)) !== JSON.stringify(identity(expected))) {
      throw new Error("Immutable file changed since inventory");
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error("Immutable file was truncated during reading");
      offset += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0) throw new Error("Immutable file grew during reading");
    if (JSON.stringify(identity(fstatSync(fd))) !== JSON.stringify(identity(before))
        || JSON.stringify(identity(lstatSync(path))) !== JSON.stringify(identity(before))) {
      throw new Error("Immutable file changed during reading");
    }
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function compiledFiles(root, directory) {
  const base = join(root, directory);
  const files = {};
  let bytes = 0;
  const visit = (current) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile() && stat.size <= 16 * 1024 * 1024) {
        const key = `/app/BOOT-INF/classes/${relative(base, path).split("\\").join("/")}`;
        if (!pathPattern.test(key) || Object.keys(files).length >= 8192 || (bytes += stat.size) > 256 * 1024 * 1024) {
          throw new Error("Immutable compiled artifact inventory exceeds its bounds");
        }
        files[key] = sha(readImmutableFile(path, stat));
      } else throw new Error("Immutable compiled artifact contains unsupported files");
    }
  };
  visit(base);
  if (Object.keys(files).length === 0) throw new Error("Immutable compiled artifact is empty");
  return files;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function inspectReusableImages({ image, fixturesImage, sourceCommit, root, execute = spawnSync,
  environment = process.env, platform = process.platform, architecture = process.arch, now = () => performance.now() }) {
  immutableImageSelection({ image, fixturesImage, sourceCommit });
  if (!isAbsolute(root) || platform !== "linux" || !["x64", "amd64", "x86_64"].includes(architecture)
      || environment.DOCKER_HOST && environment.DOCKER_HOST !== "unix:///var/run/docker.sock"
      || environment.DOCKER_CONTEXT && environment.DOCKER_CONTEXT !== "default") {
    throw new Error("Immutable image reuse requires native AMD64 and a trusted local engine");
  }
  const deadline = now() + 120000;
  let calls = 0;
  const run = (command, args) => {
    const remaining = deadline - now();
    if (++calls > 256 || !Number.isFinite(remaining) || remaining < 1) throw new Error("Immutable image proof exceeded its command budget");
    return boundedImageCommand(execute, command, args, root, environment, Math.min(10000, Math.floor(remaining)));
  };
  const endpoint = JSON.parse(run("docker", ["context", "inspect", "default", "--format", "{{json .Endpoints.docker}}"]));
  if (endpoint.Host !== "unix:///var/run/docker.sock") throw new Error("Immutable image reuse refuses remote Docker endpoints");
  if (run("git", ["rev-parse", "HEAD"]).trim() !== sourceCommit
      || run("git", ["status", "--porcelain", "--untracked-files=all"]).trim() !== "") {
    throw new Error("Immutable image reuse requires the exact clean source");
  }
  const host = JSON.parse(run("docker", ["info", "--format", "{{json .}}"]));
  if (host.OSType !== "linux" || !["amd64", "x86_64", "x64"].includes(host.Architecture)) {
    throw new Error("Immutable image reuse requires an actual native AMD64 engine");
  }
  const candidate = inspection(run("docker", ["image", "inspect", image]));
  const fixture = inspection(run("docker", ["image", "inspect", fixturesImage]));
  for (const [actual, selected] of [[candidate, image], [fixture, fixturesImage]]) {
    if (actual.Id !== selected || actual.Os !== "linux" || actual.Architecture !== "amd64"
        || actual.Config?.User !== "10001:10001" || actual.Config?.WorkingDir !== "/app"
        || !Array.isArray(actual.Config?.Entrypoint) || !actual.Config.Entrypoint.length
        || !Array.isArray(actual.RootFS?.Layers) || !actual.RootFS.Layers.length
        || actual.RootFS.Layers.some((layer) => !imageID.test(layer))) {
      throw new Error("Immutable image native metadata does not match selection");
    }
  }
  if (fixture.RootFS.Layers.length !== candidate.RootFS.Layers.length + 1
      || candidate.RootFS.Layers.some((layer, index) => fixture.RootFS.Layers[index] !== layer)
      || ["Entrypoint", "Cmd", "User", "WorkingDir", "Env", "Healthcheck"].some((field) =>
        JSON.stringify(fixture.Config[field] ?? null) !== JSON.stringify(candidate.Config[field] ?? null))) {
    throw new Error("Immutable fixture derivation does not preserve the actual parent image");
  }
  const allCompiled = compiledFiles(root, "target/classes");
  const productionCompiled = compiledFiles(root, "build/layers/application/BOOT-INF/classes");
  const fixtureCompiled = compiledFiles(root, "target/fixtures-classes");
  if (Object.entries(productionCompiled).some(([path, digest]) => allCompiled[path] !== digest)) {
    throw new Error("Immutable packaged classpath differs from actual compiled output");
  }
  if (helpers.some((path) => !fixtureCompiled[path])) throw new Error("Immutable fixture helper classes are missing");
  if (helpers.some((path) => allCompiled[path] !== fixtureCompiled[path])) {
    throw new Error("Immutable fixture helper differs from actual compiled output");
  }
  const sourceBytes = readImmutableFile(join(root, "target/classes/git.properties")).toString("utf8");
  if (sha(sourceBytes) !== allCompiled["/app/BOOT-INF/classes/git.properties"]) {
    throw new Error("Immutable compiled source properties changed since inventory");
  }
  if (sourceBytes.split(/\r?\n/).filter((line) => /^git\.commit\.id[=:]/.test(line)).join("\n") !== `git.commit.id=${sourceCommit}`) {
    throw new Error("Immutable compiled source binding is stale");
  }
  const tracked = run("git", ["ls-files", "-z"]).split("\0").filter(Boolean);
  if (!tracked.length || tracked.length > 10000 || tracked.some((path) => path.startsWith("/") || path.split("/").includes(".."))) {
    throw new Error("Immutable source graph is invalid");
  }
  const sourceDigests = {};
  for (const path of tracked) {
    const bytes = readImmutableFile(join(root, path));
    sourceDigests[path] = sha(bytes);
  }
  const runtimeImageIDs = {};
  const inspectFiles = (selected) => {
    const token = randomBytes(16).toString("hex");
    let container;
    let proofFailure;
    try {
      container = run("docker", ["run", "-d", "--pull=never", "--network=none", "--read-only",
        "--user=10001:10001", "--cap-drop=ALL", "--security-opt=no-new-privileges:true",
        "--memory=64m", "--memory-swap=64m", "--cpus=0.25", "--pids-limit=16",
        "--label", `org.courtside.image-reuse.probe=${token}`, "--entrypoint", "/bin/sleep", selected, "120"]).trim();
      if (!/^[a-f0-9]{64}$/.test(container)) throw new Error("Immutable image probe identity is incomplete");
      if (run("docker", ["exec", container, "find", "/app", "-type", "l", "-print0"]) !== "") {
        throw new Error("Immutable image proof refuses symbolic application paths");
      }
      const inventory = paths(run("docker", ["exec", container, "find", "/app", "-type", "f", "-print0"]));
      if (!inventory.length) throw new Error("Immutable image file inventory is empty");
      const files = {};
      for (let offset = 0; offset < inventory.length; offset += 128) {
        const batch = inventory.slice(offset, offset + 128);
        const lines = run("docker", ["exec", container, "sha256sum", ...batch]).trimEnd().split("\n");
        if (lines.length !== batch.length) throw new Error("Immutable image hash inventory is incomplete");
        for (let index = 0; index < lines.length; index++) {
          const match = /^([a-f0-9]{64})  (\/app\/[^\r\n]+)$/.exec(lines[index]);
          if (!match || match[2] !== batch[index]) throw new Error("Immutable image hash binding is invalid");
          files[match[2]] = match[1];
        }
      }
      return files;
    } catch (error) {
      proofFailure = error;
      throw error;
    } finally {
      if (container && /^[a-f0-9]{64}$/.test(container)) {
        const cleanupDeadline = now() + 30000;
        const cleanupRun = (args) => {
          const remaining = cleanupDeadline - now();
          if (!Number.isFinite(remaining) || remaining < 1) throw new Error("Immutable image probe cleanup deadline exceeded");
          return boundedImageCommand(execute, "docker", args, root, environment, Math.min(10000, Math.floor(remaining)));
        };
        let cleanup = { outcome: "passed", containerID: container };
          try {
          const actual = inspection(cleanupRun(["inspect", container]));
          if (actual.Id !== container || !imageID.test(actual.Image ?? "") || actual.Config?.Image !== selected
              || actual.Config?.Labels?.["org.courtside.image-reuse.probe"] !== token) {
            throw new Error("Immutable image probe ownership changed; cleanup refused");
          }
          const runtimeImage = inspection(cleanupRun(["image", "inspect", actual.Image]));
          const expectedImage = selected === image ? candidate : fixture;
          if (JSON.stringify(runtimeImage.RootFS) !== JSON.stringify(expectedImage.RootFS)
              || JSON.stringify(runtimeImage.Config) !== JSON.stringify(expectedImage.Config)
              || runtimeImage.Architecture !== expectedImage.Architecture || runtimeImage.Os !== expectedImage.Os) {
            throw new Error("Immutable image runtime descriptor does not match selection");
          }
          runtimeImageIDs[selected === image ? "production" : "fixtures"] = actual.Image;
          cleanupRun(["rm", "--force", container]);
          } catch (error) {
          cleanup = { outcome: "failed", containerID: container, reason: error.message };
          if (!proofFailure) {
            Object.defineProperty(error, "imageProbeCleanup", { value: cleanup });
            throw error;
          }
        } finally {
          if (proofFailure) {
            Object.defineProperty(proofFailure, "imageProbeCleanup", { value: cleanup });
            try {
              const directory = join(root, "build", "immutable-image-reuse-failures");
              mkdirSync(directory, { recursive: true, mode: 0o700 });
              const receipt = join(directory, `${token}.json`);
              const safeCleanup = cleanup.outcome === "passed" ? cleanup : {
                outcome: "failed", containerID: container, reason: "cleanup-not-proven"
              };
              writeFileSync(receipt, JSON.stringify({ qualified: false,
                failure: proofFailure.message === "Immutable image proof exceeded its command budget"
                  ? "proof-budget-exceeded" : "image-proof-failed",
                selectedImage: selected, containerID: container, owner: token, cleanup: safeCleanup }) + "\n",
              { mode: 0o600, flag: "wx" });
              Object.defineProperty(proofFailure, "imageProbeFailureReceipt", { value: receipt });
            } catch {
              Object.defineProperty(proofFailure, "imageProbeFailureReceiptUnavailable", { value: true });
            }
          }
        }
      }
    }
  };
  const productionFiles = inspectFiles(image);
  const fixtureFiles = inspectFiles(fixturesImage);
  for (const [path, digest] of Object.entries(productionCompiled)) {
    if (productionFiles[path] !== digest) throw new Error("Immutable production class/source bytes differ from compiled artifacts");
  }
  if (Object.keys(productionFiles).some((path) => path.startsWith("/app/BOOT-INF/classes/")
      && !Object.hasOwn(productionCompiled, path))) {
    throw new Error("Immutable production image contains an unknown packaged classpath file");
  }
  for (const [path, digest] of Object.entries(productionFiles)) {
    if (fixtureFiles[path] !== digest) throw new Error("Immutable fixture overwrote actual parent bytes");
  }
  for (const [path, digest] of Object.entries(fixtureCompiled)) {
    if (fixtureFiles[path] !== digest) throw new Error("Immutable fixture helper bytes differ from compiled artifacts");
  }
  if (Object.keys(fixtureFiles).some((path) => !Object.hasOwn(productionFiles, path) && !Object.hasOwn(fixtureCompiled, path))) {
    throw new Error("Immutable fixture contains unknown application files");
  }
  const remaining = deadline - now();
  if (!Number.isFinite(remaining) || remaining < 1) throw new Error("Immutable image proof exceeded its command budget");
  return canonical({ schemaVersion: 1, productionImageID: image, fixturesImageID: fixturesImage, sourceCommit,
    architecture: "amd64", runtimeImageIDs, parentLayers: candidate.RootFS.Layers, fixtureLayers: fixture.RootFS.Layers,
    runtimeConfig: candidate.Config, sourcePropertiesSha256: sha(sourceBytes), sourceDigest: sha(JSON.stringify(canonical(sourceDigests))),
    productionFilesDigest: sha(JSON.stringify(canonical(productionFiles))), fixtureFilesDigest: sha(JSON.stringify(canonical(fixtureFiles))),
    helperClassDigests: Object.fromEntries(helpers.map((path) => [path, fixtureFiles[path]])) });
}

export function verifyReusableImages(proof, options) {
  const current = inspectReusableImages(options);
  if (JSON.stringify(canonical(proof)) !== JSON.stringify(current)) throw new Error("Immutable image reuse proof changed");
  return current;
}

function performanceInventory(run, root, owner, deployment) {
  const project = "courtside-perf";
  const result = [];
  for (const kind of ["container", "network", "volume"]) {
    const ids = new Set();
    for (const filter of [`label=com.docker.compose.project=${project}`, `name=^/?${project}[-_]`]) {
      const prefix = kind === "container" ? ["ps", "-a"] : [kind, "ls"];
      for (const id of run([...prefix, "--quiet", "--filter", filter]).trim().split("\n").filter(Boolean)) ids.add(id);
    }
    if (ids.size > 32 || [...ids].some((id) => kind === "volume"
      ? !/^courtside-perf_[a-z-]{1,32}$/.test(id) : !/^[a-f0-9]{12,64}$/.test(id))) {
      throw new Error("Immutable PERFORMANCE inventory is outside its bounds");
    }
    if (!ids.size) continue;
    const actual = JSON.parse(run([...(kind === "container" ? [] : [kind]), "inspect", ...[...ids].sort()]));
    if (!Array.isArray(actual) || actual.length !== ids.size) throw new Error("Immutable PERFORMANCE inventory is incomplete");
    for (const item of actual) {
      const labels = kind === "container" ? item.Config?.Labels : item.Labels;
      if (!owner || labels?.["org.courtside.image-reuse.owner"] !== owner) {
        throw new Error("Immutable PERFORMANCE project has foreign resources");
      }
      const name = kind === "container" ? item.Name?.replace(/^\//, "") : item.Name;
      if (kind === "container" && name === "courtside-perf-reuse-reservation") {
        if (item.Config.Image !== deployment.productionImageID || item.Image !== deployment.runtimeImageIDs.production) {
          throw new Error("Immutable PERFORMANCE reservation identity drifted");
        }
      } else {
        if (labels["com.docker.compose.project"] !== project) throw new Error("Immutable PERFORMANCE project label drifted");
        if (kind === "container") {
          const service = labels["com.docker.compose.service"];
          const expected = deployment.services[service];
          if (!expected || item.Config.Image !== expected.image || !/^sha256:[a-f0-9]{64}$/.test(item.Image ?? "")
              || !labels["com.docker.compose.project.config_files"]?.split(",").includes(deployment.override)) {
            throw new Error("Immutable PERFORMANCE service provenance drifted");
          }
          const runtimeImage = inspection(run(["image", "inspect", item.Image]));
          const metadata = deployment.images[service];
          if (JSON.stringify(canonical(runtimeImage.Config)) !== JSON.stringify(canonical(metadata.Config))
              || JSON.stringify(runtimeImage.RootFS) !== JSON.stringify(metadata.RootFS)
              || runtimeImage.Os !== "linux" || runtimeImage.Architecture !== "amd64") {
            throw new Error("Immutable PERFORMANCE runtime image bytes drifted");
          }
          if (service === "db" && (item.HostConfig?.NanoCpus !== Number(expected.cpus) * 1000000000
              || item.HostConfig?.Memory !== Number(expected.mem_limit))) {
            throw new Error("Immutable PERFORMANCE database limits drifted");
          }
          if (service === "app") {
            const expectedEnv = Object.fromEntries((metadata.Config.Env ?? []).map((value) => {
              const index = value.indexOf("=");
              return [value.slice(0, index), value.slice(index + 1)];
            }));
            Object.assign(expectedEnv, expected.environment);
            const actualEnv = Object.fromEntries((item.Config.Env ?? []).map((value) => {
              const index = value.indexOf("=");
              return [value.slice(0, index), value.slice(index + 1)];
            }));
            if (item.Image !== deployment.runtimeImageIDs.fixtures
                || ["Entrypoint", "Cmd", "User", "WorkingDir"].some((field) =>
                  JSON.stringify(item.Config[field] ?? null) !== JSON.stringify(metadata.Config[field] ?? null))
                || JSON.stringify(canonical(actualEnv)) !== JSON.stringify(canonical(expectedEnv))
                || item.HostConfig?.ReadonlyRootfs !== true || item.HostConfig?.Memory !== 1024 * 1024 * 1024
                || item.HostConfig?.NanoCpus !== 3000000000
                || !item.HostConfig?.CapDrop?.includes("ALL")
                || !item.HostConfig?.SecurityOpt?.includes("no-new-privileges:true")) {
              throw new Error("Immutable PERFORMANCE app identity or limits drifted");
            }
          }
        } else if (!(deployment[kind === "network" ? "networks" : "volumes"] ?? []).includes(name)) {
          throw new Error("Immutable PERFORMANCE resource namespace drifted");
        }
      }
      result.push({ kind, id: kind === "volume" ? item.Name : item.Id, name, image: item.Image,
        labels, created: item.Created ?? item.CreatedAt, driver: item.Driver, options: item.Options });
    }
  }
  return result.sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
}

export function assertPerformanceReuseEmpty({ root, execute = spawnSync, environment = process.env }) {
  const run = (args) => boundedImageCommand(execute, "docker", args, root, environment);
  performanceInventory(run, root);
}

export function preparePerformanceReuse(proof, { root, environment, telemetry = false, dbPort = false, execute = spawnSync }) {
  const owner = randomBytes(16).toString("hex");
  const override = join(root, "build", "immutable-performance-compose.json");
  const labels = { "org.courtside.image-reuse.owner": owner };
  const services = ["app", "db", "mail", "proxy", ...(telemetry ? ["postgres-exporter", "prometheus", "grafana"] : [])];
  const networks = ["backend", "frontend", "load", ...(telemetry ? ["telemetry"] : [])];
  const volumes = ["db", "caddy-data", "caddy-config", ...(telemetry ? ["prometheus-data", "grafana-data"] : [])];
  mkdirSync(join(root, "build"), { recursive: true, mode: 0o700 });
  writeFileSync(override, `${JSON.stringify({ services: Object.fromEntries(services.map((name) => [name,
    { labels, ...(name === "app" ? { image: proof.fixturesImageID } : {}), pull_policy: "never" }])),
  networks: Object.fromEntries(networks.map((name) => [name, { labels }])),
  volumes: Object.fromEntries(volumes.map((name) => [name, { labels }])) }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  const compose = ["compose", "--env-file", "/dev/null", "-p", "courtside-perf", "-f", join(root, "deploy/compose.perf.yaml"),
    ...(dbPort ? ["-f", join(root, "deploy/compose.perf-db.yaml")] : []),
    ...(telemetry ? ["-f", join(root, "deploy/compose.perf-telemetry.yaml")] : []), "-f", override];
  const run = (args) => boundedImageCommand(execute, "docker", args, root, environment);
  const rendered = JSON.parse(run([...compose, "config", "--format", "json"]));
  if (JSON.stringify(Object.keys(rendered.services ?? {}).sort()) !== JSON.stringify([...services].sort())) {
    throw new Error("Immutable PERFORMANCE service schema changed");
  }
  const images = {};
  for (const service of services) {
    const reference = rendered.services[service].image;
    if (service === "app" ? reference !== proof.fixturesImageID : !/^[^\s@]+@sha256:[a-f0-9]{64}$/.test(reference ?? "")) {
      throw new Error("Immutable PERFORMANCE dependency selection is not pinned");
    }
    const actual = inspection(run(["image", "inspect", reference]));
    if (actual.Os !== "linux" || actual.Architecture !== "amd64" || !imageID.test(actual.Id ?? "")) {
      throw new Error("Immutable PERFORMANCE dependency is unavailable or not native");
    }
    images[service] = actual;
  }
  return { owner, override, overrideSha256: sha(readFileSync(override)), compose, services: rendered.services, images,
    networks: networks.map((name) => `courtside-perf_${name}`), volumes: volumes.map((name) => `courtside-perf_${name}`),
    productionImageID: proof.productionImageID, runtimeImageIDs: proof.runtimeImageIDs };
}

export async function startPerformanceReuse(deployment, { root, environment, execute = spawnSync, now = () => performance.now() }) {
  const deadline = now() + 180000;
  const run = (args) => {
    const remaining = deadline - now();
    if (!Number.isFinite(remaining) || remaining < 1) throw new Error("Immutable PERFORMANCE startup deadline exceeded");
    return boundedImageCommand(execute, "docker", args, root, environment, Math.min(10000, Math.floor(remaining)));
  };
  run(["create", "--pull=never", "--name", "courtside-perf-reuse-reservation", "--network=none", "--read-only",
    "--user=10001:10001", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", "--memory=64m", "--memory-swap=64m",
    "--cpus=0.25", "--pids-limit=16", "--label", `org.courtside.image-reuse.owner=${deployment.owner}`,
    "--entrypoint", "/bin/sleep", deployment.productionImageID, "1"]);
  run([...deployment.compose, "up", "-d", "--no-build", "--pull", "never"]);
  while (now() < deadline) {
    performanceInventory(run, root, deployment.owner, deployment);
    const app = inspection(run(["inspect", "courtside-perf-app-1"]));
    if (app.State?.Health?.Status === "healthy" && now() < deadline) return;
    if (["dead", "exited"].includes(app.State?.Status) || app.State?.Health?.Status === "unhealthy") {
      throw new Error("Immutable PERFORMANCE app failed startup");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Immutable PERFORMANCE startup deadline exceeded");
}

export function assertPerformanceReuse(record, { root, execute = spawnSync, environment = process.env } = {}) {
  const proof = record.immutableImages;
  const deployment = record.immutableDeployment;
  if (!proof || !deployment || !/^[a-f0-9]{32}$/.test(deployment.owner ?? "")
      || deployment.override !== join(root, "build", "immutable-performance-compose.json")
      || sha(readFileSync(deployment.override)) !== deployment.overrideSha256) {
    throw new Error("Immutable PERFORMANCE retained proof is incomplete or changed");
  }
  verifyReusableImages(proof, { image: proof.productionImageID, fixturesImage: proof.fixturesImageID,
    sourceCommit: proof.sourceCommit, root, execute, environment });
  const run = (args) => boundedImageCommand(execute, "docker", args, root, environment);
  const actual = performanceInventory(run, root, deployment.owner, deployment);
  if (record.immutableResources && JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(record.immutableResources))) {
    throw new Error("Immutable PERFORMANCE resource identity changed");
  }
  if (!actual.some((item) => item.name === "courtside-perf-app-1")
      || !actual.some((item) => item.name === "courtside-perf-reuse-reservation")) {
    throw new Error("Immutable PERFORMANCE runtime resources are missing");
  }
  const runtime = inspection(run(["inspect", "courtside-perf-app-1"]));
  if (typeof runtime.State?.OOMKilled !== "boolean" || !Number.isSafeInteger(runtime.RestartCount)
      || !Number.isFinite(Date.parse(runtime.State?.StartedAt))) throw new Error("Immutable PERFORMANCE telemetry is incomplete");
  return { resources: actual, runtime: { containerID: runtime.Id, runtimeImageID: runtime.Image,
    entrypoint: runtime.Config.Entrypoint, oomKilled: runtime.State.OOMKilled,
    restartCount: runtime.RestartCount, startedAt: runtime.State.StartedAt } };
}

export function resetPerformanceReuse(record, { root, environment = process.env, execute = spawnSync,
  verify = assertPerformanceReuse }) {
  const observed = verify(record, { root, environment, execute });
  const deployment = record.immutableDeployment;
  const reservation = observed.resources.find((item) => item.kind === "container"
    && item.name === "courtside-perf-reuse-reservation");
  if (!reservation || !/^[a-f0-9]{64}$/.test(reservation.id ?? "")) {
    throw new Error("Immutable PERFORMANCE reservation is missing; reset refused");
  }
  const run = (args) => boundedImageCommand(execute, "docker", args, root, environment);
  run([...deployment.compose, "down", "--volumes"]);
  const remaining = performanceInventory(run, root, deployment.owner, deployment);
  if (remaining.length !== 1 || remaining[0].kind !== "container" || remaining[0].id !== reservation.id) {
    throw new Error("Immutable PERFORMANCE cleanup inventory changed; reservation removal refused");
  }
  run(["rm", "--force", reservation.id]);
  performanceInventory(run, root);
}
