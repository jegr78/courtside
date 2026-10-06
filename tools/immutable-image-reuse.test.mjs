import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { immutableImageSelection, inspectReusableImages, assertPerformanceReuse, boundedImageCommand, preparePerformanceReuse,
  resetPerformanceReuse, startPerformanceReuse, cleanupPerformanceRunner, assertPerformanceStateOwnership } from "./immutable-image-reuse.mjs";

const image = `sha256:${"a".repeat(64)}`;
const fixturesImage = `sha256:${"b".repeat(64)}`;
const sourceCommit = "c".repeat(40);
const helperNames = ["SecuritySessionAttributeProjection.class", "SecuritySessionAttributeProjection$RestrictedStream.class",
  "SecurityPublicationPolicyProjection.class"];
const hash = (value) => createHash("sha256").update(value).digest("hex");

for (const replacement of ["symlink", "regular"]) {
  test(`given a compiled file changed to a ${replacement} after inventory stat, when the actual image proof reads it, then refuse before any probe`, t => {
    // given
    const f = fixture();
    const path = join(f.root, "target/classes/org/courtside/CourtsideApplication.class");
    const bytes = readFileSync(path);
    const original = fs.lstatSync;
    let changed = false;
    const mock = t.mock.method(fs, "lstatSync", value => {
      const stat = original(value);
      if (value === path && !changed) {
        changed = true;
        fs.renameSync(path, path + ".retained");
        if (replacement === "symlink") fs.symlinkSync(path + ".retained", path);
        else writeFileSync(path, bytes);
      }
      return stat;
    });
    syncBuiltinESMExports();
    try {
      // when / then
      assert.throws(() => inspectReusableImages(f.options), /unsafe|changed|symbolic|ELOOP/i);
      assert.ok(changed);
      assert.ok(!f.calls.some(call => call.args[0] === "run"));
    } finally { mock.mock.restore(); syncBuiltinESMExports(); f.cleanup(); }
  });
}

for (const change of ["grow", "truncate", "replace-path"]) {
  test(`given a compiled FD with ${change} during its read, when the actual image proof hashes it, then refuse changed bytes and close the descriptor`, t => {
    // given
    const f = fixture();
    const path = join(f.root, "target/classes/org/courtside/CourtsideApplication.class");
    const bytes = readFileSync(path);
    const originalRead = fs.readSync, originalFile = fs.readFileSync, originalOpen = fs.openSync, originalClose = fs.closeSync;
    const descriptors = new Set(), closed = new Set();
    let changed = false;
    const mutate = () => {
      if (changed) return;
      changed = true;
      if (change === "replace-path") { fs.renameSync(path, path + ".retained"); writeFileSync(path, bytes); }
      else writeFileSync(path, change === "grow" ? Buffer.concat([bytes, Buffer.from("extra")]) : bytes.subarray(0, 1));
    };
    const mocks = [
      t.mock.method(fs, "openSync", (...args) => { const fd = originalOpen(...args); if (args[0] === path) descriptors.add(fd); return fd; }),
      t.mock.method(fs, "closeSync", fd => { if (descriptors.has(fd)) closed.add(fd); return originalClose(fd); }),
      t.mock.method(fs, "readSync", (...args) => { const n = originalRead(...args); if (descriptors.has(args[0])) mutate(); return n; }),
      t.mock.method(fs, "readFileSync", (...args) => { const value = originalFile(...args); if (args[0] === path) mutate(); return value; })
    ];
    syncBuiltinESMExports();
    try {
      // when / then
      assert.throws(() => inspectReusableImages(f.options), /unsafe|changed|grew|truncated/i);
      assert.ok(changed);
      assert.deepEqual(closed, descriptors);
      assert.ok(!f.calls.some(call => call.args[0] === "run"));
    } finally { for (const mock of mocks) mock.mock.restore(); syncBuiltinESMExports(); f.cleanup(); }
  });
}

test("given an oversized tracked source file, when the actual image proof binds source bytes, then refuse from FD size before any content read", t => {
  // given
  const f = fixture();
  const path = join(f.root, "pom.xml");
  fs.truncateSync(path, 16 * 1024 * 1024 + 1);
  const originalFile = fs.readFileSync, originalRead = fs.readSync, originalOpen = fs.openSync;
  let descriptor, reads = 0;
  const mocks = [
    t.mock.method(fs, "openSync", (...args) => { const fd = originalOpen(...args); if (args[0] === path) descriptor = fd; return fd; }),
    t.mock.method(fs, "readSync", (...args) => { if (args[0] === descriptor) reads++; return originalRead(...args); }),
    t.mock.method(fs, "readFileSync", (...args) => { if (args[0] === path) reads++; return originalFile(...args); })
  ];
  syncBuiltinESMExports();
  try {
    // when / then
    assert.throws(() => inspectReusableImages(f.options), /bound/);
    assert.equal(reads, 0);
    assert.ok(!f.calls.some(call => call.args[0] === "run"));
  } finally { for (const mock of mocks) mock.mock.restore(); syncBuiltinESMExports(); f.cleanup(); }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "courtside-image-reuse-"));
  const production = { "/app/BOOT-INF/classes/git.properties": `git.commit.id=${sourceCommit}\n`,
    "/app/BOOT-INF/classes/org/courtside/CourtsideApplication.class": "compiled application" };
  const helpers = Object.fromEntries(helperNames.map((name) => [`/app/BOOT-INF/classes/org/courtside/securityassessment/${name}`, name]));
  for (const [path, bytes] of Object.entries(production)) {
    const relative = path.slice("/app/BOOT-INF/classes/".length);
    const target = join(root, "target/classes", relative);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, bytes);
    const packaged = join(root, "build/layers/application/BOOT-INF/classes", relative);
    mkdirSync(join(packaged, ".."), { recursive: true });
    writeFileSync(packaged, bytes);
  }
  for (const [path, bytes] of Object.entries(helpers)) {
    const target = join(root, "target/fixtures-classes", path.slice("/app/BOOT-INF/classes/".length));
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, bytes);
    const compiled = join(root, "target/classes", path.slice("/app/BOOT-INF/classes/".length));
    mkdirSync(join(compiled, ".."), { recursive: true });
    writeFileSync(compiled, bytes);
  }
  writeFileSync(join(root, "pom.xml"), "frozen source");
  const files = { [image]: production, [fixturesImage]: { ...production, ...helpers } };
  const config = { User: "10001:10001", Entrypoint: ["java", "org.springframework.boot.loader.launch.JarLauncher"],
    Cmd: null, WorkingDir: "/app", Env: ["LANG=C.UTF-8"], Labels: {} };
  const images = { [image]: { Id: image, Os: "linux", Architecture: "amd64", Config: structuredClone(config), RootFS: { Layers: [`sha256:${"d".repeat(64)}`] } },
    [fixturesImage]: { Id: fixturesImage, Os: "linux", Architecture: "amd64", Config: structuredClone(config), RootFS: { Layers: [`sha256:${"d".repeat(64)}`, `sha256:${"e".repeat(64)}`] } } };
  const calls = [];
  const runtimeIDs = {};
  const containers = new Map();
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    const ok = (stdout) => ({ status: 0, signal: null, stdout, stderr: "" });
    if (command === "git") {
      if (args[0] === "rev-parse") return ok(sourceCommit);
      if (args[0] === "status") return ok("");
      if (args[0] === "ls-files") return ok("pom.xml\0");
    }
    if (args[0] === "context") return ok(JSON.stringify({ Host: "unix:///var/run/docker.sock" }));
    if (args[0] === "info") return ok(JSON.stringify({ OSType: "linux", Architecture: "amd64", ServerVersion: "29", Driver: "overlayfs" }));
    if (args[0] === "image") return ok(JSON.stringify([images[args[2]]]));
    if (args[0] === "run") {
      const selected = args.at(-2);
      const id = (containers.size ? "2" : "1").repeat(64);
      const label = args[args.indexOf("--label") + 1].split("=");
      containers.set(id, { Id: id, Image: runtimeIDs[selected] ?? selected, Config: { Labels: { [label[0]]: label[1] }, Image: selected } });
      return ok(id);
    }
    if (args[0] === "inspect") return ok(JSON.stringify([containers.get(args[1])]));
    if (args[0] === "rm") return ok("");
    if (args[0] === "exec") {
      const selected = containers.get(args[1]).Config.Image;
      const current = files[selected];
      if (args[2] === "find") return ok(args.includes("-type") && args[args.indexOf("-type") + 1] === "l"
        ? "" : Object.keys(current).join("\0") + "\0");
      if (args[2] === "sha256sum") return ok(args.slice(3).map((path) => `${hash(current[path])}  ${path}`).join("\n") + "\n");
      if (args[2] === "cat") return ok(current[args[3]]);
    }
    throw new Error(`Unexpected diagnostic call: ${command} ${args.join(" ")}`);
  };
  return { root, images, files, calls, runtimeIDs, execute, options: { image, fixturesImage, sourceCommit, root,
    execute, platform: "linux", architecture: "x64", environment: {} }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function performanceFixture(t) {
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const architecture = Object.getOwnPropertyDescriptor(process, "arch");
  Object.defineProperties(process, { platform: { ...platform, value: "linux" }, arch: { ...architecture, value: "x64" } });
  t.after(() => Object.defineProperties(process, { platform, arch: architecture }));
  const f = fixture();
  const override = join(f.root, "build", "immutable-performance-compose.json");
  const overrideBytes = Buffer.from("{}\n");
  writeFileSync(override, overrideBytes);
  const owner = "9".repeat(32), databaseImage = "sha256:" + "6".repeat(64);
  const databaseReference = "example.org/database@" + databaseImage;
  const databaseMetadata = { ...structuredClone(f.images[image]), Id: databaseImage };
  f.images[databaseImage] = databaseMetadata;
  const labels = service => ({ "org.courtside.image-reuse.owner": owner,
    "com.docker.compose.project": "courtside-perf", "com.docker.compose.service": service,
    "com.docker.compose.project.config_files": override });
  const app = { Id: "3".repeat(64), Name: "/courtside-perf-app-1", Image: fixturesImage,
    Created: "2026-10-06T00:00:00Z", Config: { ...structuredClone(f.images[fixturesImage].Config),
      Image: fixturesImage, Labels: labels("app") },
    HostConfig: { ReadonlyRootfs: true, Memory: 1073741824, NanoCpus: 3000000000,
      CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"] },
    State: { OOMKilled: false, StartedAt: "2026-10-06T00:00:00Z" }, RestartCount: 0 };
  const database = { Id: "4".repeat(64), Name: "/courtside-perf-db-1", Image: databaseImage,
    Created: "2026-10-06T00:00:00Z", Config: { ...structuredClone(databaseMetadata.Config),
      Image: databaseReference, Labels: labels("db") },
    HostConfig: { Memory: 2147483648, NanoCpus: 2000000000 } };
  const reservation = { Id: "5".repeat(64), Name: "/courtside-perf-reuse-reservation", Image: image,
    Created: "2026-10-06T00:00:00Z", Config: { Image: image, Labels: { "org.courtside.image-reuse.owner": owner } } };
  const containers = [app, database, reservation];
  const execute = (command, args, options) => {
    const ok = stdout => { f.calls.push({ command, args, options }); return { status: 0, signal: null, stdout, stderr: "" }; };
    if (command === "docker" && args[0] === "ps") return ok(containers.map(item => item.Id).join("\n"));
    if (command === "docker" && ["network", "volume"].includes(args[0]) && args[1] === "ls") return ok("");
    if (command === "docker" && args[0] === "inspect") {
      const selected = args.slice(1).map(id => containers.find(item => item.Id === id || item.Name === "/" + id));
      if (selected.every(Boolean)) return ok(JSON.stringify(selected));
    }
    return f.execute(command, args, options);
  };
  const proof = inspectReusableImages(f.options);
  const record = { immutableImages: proof, immutableDeployment: { owner, override, overrideSha256: hash(overrideBytes),
    productionImageID: image, runtimeImageIDs: proof.runtimeImageIDs,
    services: { app: { image: fixturesImage, environment: {} }, db: { image: databaseReference, cpus: 2, mem_limit: "2147483648" } },
    images: { app: f.images[fixturesImage], db: databaseMetadata }, networks: [], volumes: [] } };
  return { ...f, record, database, runtime: { root: f.root, environment: {}, execute } };
}

test("given unchanged rendered database limits, when the actual reuse guard checks a retained same CID, then accept the configured CPU and memory values", t => {
  // given
  const f = performanceFixture(t);
  try {
    const id = f.database.Id;
    for (const [cpus, memory] of [[2, "2147483648"], ["1.5", "3221225472"]]) {
      f.record.immutableDeployment.services.db.cpus = cpus;
      f.record.immutableDeployment.services.db.mem_limit = memory;
      f.database.HostConfig.NanoCpus = Number(cpus) * 1000000000;
      f.database.HostConfig.Memory = Number(memory);
      // when
      f.record.immutableResources = assertPerformanceReuse(f.record, f.runtime).resources;
      const actual = assertPerformanceReuse(f.record, f.runtime);
      // then
      assert.equal(actual.resources.find(item => item.name === "courtside-perf-db-1").id, id);
      assert.equal(f.database.Id, id);
    }
  } finally { f.cleanup(); }
});

for (const field of ["NanoCpus", "Memory"]) {
  test(`given same-CID database ${field} drift, when the actual reuse guard inspects retained PERFORMANCE, then reject before workload or cleanup`, t => {
    // given
    const f = performanceFixture(t);
    try {
      f.record.immutableResources = assertPerformanceReuse(f.record, f.runtime).resources;
      const before = structuredClone(f.database);
      f.database.HostConfig[field] *= 2;
      // when / then
      assert.throws(() => assertPerformanceReuse(f.record, f.runtime), /Immutable PERFORMANCE database limits drifted/);
      assert.equal(f.database.Id, before.Id);
      assert.deepEqual(f.database.Config, before.Config);
      assert.equal(f.database.Image, before.Image);
      assert.ok(!f.calls.some(call => ["update", "compose", "pull", "build"].includes(call.args[0])));
    } finally { f.cleanup(); }
  });
}

test("given engine-native IDs distinct from OCI config identity, when selecting reusable images, then retain the opaque exact IDs without digest fabrication", () => {
  // given
  const values = { image, fixturesImage, sourceCommit };
  // when / then
  assert.deepEqual(immutableImageSelection(values), values);
});

test("given a full PERFORMANCE runner CID, when the actual cleanup helper queries Docker, then request untruncated IDs and remove only the matching owned container", () => {
  // given
  const f = fixture();
  const cid = "8".repeat(64);
  const owner = "9".repeat(32);
  const cidFile = join(f.root, "runner.cid");
  writeFileSync(cidFile, cid);
  const calls = [];
  const execute = (command, args) => {
    calls.push(args);
    return { status: 0, stdout: args[0] === "ps" ? args.includes("--no-trunc") ? cid : cid.slice(0, 12)
      : args[0] === "inspect" ? JSON.stringify([{ Id: cid, Config: { Labels: {
        "org.courtside.performance.run": owner, "com.docker.compose.project": "courtside-perf" } } }]) : "", stderr: "" };
  };
  try {
    // when / then
    assert.doesNotThrow(() => cleanupPerformanceRunner({ cidFile, owner, root: f.root, environment: {}, execute }));
    assert.deepEqual(calls.at(-1), ["rm", "--force", cid]);
  } finally { f.cleanup(); }
});

test("given absent valid PERFORMANCE proof, when retained immutable markers are checked, then refuse before removal and allow only a marker-free legacy project", () => {
  // given
  const f = fixture();
  const calls = [];
  let reservation = "7".repeat(64);
  const execute = (command, args) => { calls.push(args); return { status: 0, stdout: reservation, stderr: "" }; };
  try {
    // when / then
    assert.throws(() => assertPerformanceStateOwnership(undefined, { root: f.root, execute }),
      { message: "Immutable PERFORMANCE state is unavailable; reset refused" });
    reservation = "";
    assert.doesNotThrow(() => assertPerformanceStateOwnership({ password: "legacy-password" }, { root: f.root, execute }));
    writeFileSync(join(f.root, "build/immutable-performance-compose.json"), "{}");
    const count = calls.length;
    assert.throws(() => assertPerformanceStateOwnership({ password: "legacy-password" }, { root: f.root, execute }));
    assert.equal(calls.length, count);
    assert.ok(calls.every(args => args[0] === "ps" && args.includes("--no-trunc")));
  } finally { f.cleanup(); }
});

test("given proof time expires after creating an owned image probe, when finally executes, then clean its exact CID with a separate budget and retain the original proof failure", () => {
  // given
  const f = fixture();
  let elapsed = 0;
  const execute = (...parameters) => {
    const result = f.execute(...parameters);
    if (parameters[1][0] === "run") elapsed = 120001;
    return result;
  };
  try {
    // when / then
    assert.throws(() => inspectReusableImages({ ...f.options, execute, now: () => elapsed }), error => {
      assert.equal(error.message, "Immutable image proof exceeded its command budget");
      assert.deepEqual(error.imageProbeCleanup, { outcome: "passed", containerID: "1".repeat(64) });
      const receipt = JSON.parse(readFileSync(error.imageProbeFailureReceipt, "utf8"));
      assert.equal(receipt.qualified, false);
      assert.equal(receipt.failure, "proof-budget-exceeded");
      assert.deepEqual(receipt.cleanup, error.imageProbeCleanup);
      assert.equal(statSync(error.imageProbeFailureReceipt).mode & 0o777, 0o600);
      return true;
    });
    assert.ok(f.calls.some(({ args }) => args[0] === "rm" && args[2] === "1".repeat(64)));
    assert.ok(f.calls.every(({ options }) => options.timeout >= 1 && options.timeout <= 10000));
  } finally { f.cleanup(); }
});

test("given expired image proof and changed probe ownership, when independent cleanup inspects the CID, then retain the original failure and failed cleanup without deletion", () => {
  // given
  const f = fixture();
  let elapsed = 0;
  const execute = (...parameters) => {
    const result = f.execute(...parameters);
    if (parameters[1][0] === "run") elapsed = 120001;
    if (parameters[1][0] === "inspect") {
      const value = JSON.parse(result.stdout);
      value[0].Config.Labels["org.courtside.image-reuse.probe"] = "foreign";
      result.stdout = JSON.stringify(value);
    }
    return result;
  };
  try {
    // when / then
    assert.throws(() => inspectReusableImages({ ...f.options, execute, now: () => elapsed }), error => {
      assert.equal(error.message, "Immutable image proof exceeded its command budget");
      assert.equal(error.imageProbeCleanup.outcome, "failed");
      assert.equal(error.imageProbeCleanup.containerID, "1".repeat(64));
      return true;
    });
    assert.ok(!f.calls.some(({ args }) => args[0] === "rm"));
  } finally { f.cleanup(); }
});

test("given a backward wall-clock jump during native evidence collection, when monotonic proof time expires, then refuse before another command", (t) => {
  // given
  const f = fixture();
  let wall = 1700000000000;
  let elapsed = 0;
  t.mock.method(Date, "now", () => wall);
  t.mock.method(performance, "now", () => elapsed);
  const execute = (...args) => {
    const result = f.execute(...args);
    wall -= 400 * 86400000;
    elapsed = 120001;
    return result;
  };
  try {
    // when / then
    assert.throws(() => inspectReusableImages({ ...f.options, execute }),
      { message: "Immutable image proof exceeded its command budget" });
    assert.equal(f.calls.length, 1);
    assert.ok(!f.calls.some((call) => call.args[0] === "run"));
  } finally {
    f.cleanup();
  }
});

test("given a backward wall-clock jump during readiness polling, when monotonic startup time expires, then reject before accepting late health", async (t) => {
  // given
  let wall = 1700000000000;
  let elapsed = 0;
  const calls = [];
  t.mock.method(Date, "now", () => wall);
  t.mock.method(performance, "now", () => elapsed);
  const execute = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === "ps") {
      wall -= 400 * 86400000;
      elapsed = 180001;
    }
    return { status: 0, signal: null, stderr: "", stdout: args[0] === "inspect"
      ? JSON.stringify([{ State: { Health: { Status: "healthy" } } }]) : "" };
  };
  // when / then
  await assert.rejects(() => startPerformanceReuse({ productionImageID: image, owner: "a".repeat(32),
    compose: ["compose", "-p", "courtside-perf"] }, { root: "/private", environment: {}, execute }),
  { message: "Immutable PERFORMANCE startup deadline exceeded" });
  assert.ok(!calls.some((call) => call[1] === "inspect"));
});

test("given Maven-staged fixtures excluded by the production JAR, when proving the packaged classpath, then bind production bytes without requiring fixture classes in production", () => {
  // given
  const f = fixture();
  try {
    for (const name of helperNames) {
      const target = join(f.root, "target/classes/org/courtside/securityassessment", name);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, name);
    }
    let proof;
    // when / then
    assert.doesNotThrow(() => { proof = inspectReusableImages(f.options); });
    assert.equal(Object.keys(proof.helperClassDigests).length, 3);
  } finally {
    f.cleanup();
  }
});

test("given fixture helper bytes differing from final compiler output, when proving image reuse, then reject stale staged helpers before starting a probe", () => {
  // given
  const f = fixture();
  try {
    writeFileSync(join(f.root, "target/classes/org/courtside/securityassessment", helperNames[0]), "different final compiled helper");
    // when / then
    assert.throws(() => inspectReusableImages(f.options), { message: "Immutable fixture helper differs from actual compiled output" });
    assert.ok(!f.calls.some((call) => call.command === "docker" && call.args[0] === "run"));
  } finally {
    f.cleanup();
  }
});

test("given proven owned PERFORMANCE resources, when resetting immutable reuse, then remove only the owned project and reservation without deleting imported images", () => {
  // given
  const calls = [];
  const owner = "9".repeat(32);
  const id = "8".repeat(64);
  let removed = false;
  const reservation = { Id: id, Name: "/courtside-perf-reuse-reservation", Image: image,
    Config: { Image: image, Labels: { "org.courtside.image-reuse.owner": owner } } };
  const execute = (command, args) => {
    calls.push([command, ...args]);
    let stdout = "";
    if (args[0] === "ps") stdout = removed ? "" : id;
    if (args[0] === "inspect") stdout = JSON.stringify([reservation]);
    if (args[0] === "rm") removed = true;
    return { status: 0, signal: null, stdout, stderr: "" };
  };
  const record = { immutableDeployment: { owner, productionImageID: image,
    runtimeImageIDs: { production: image }, compose: ["compose", "-p", "courtside-perf"] } };
  // when
  resetPerformanceReuse(record, { root: "/private", environment: {}, execute,
    verify: () => ({ resources: [{ kind: "container", id, name: "courtside-perf-reuse-reservation" }] }) });
  // then
  assert.ok(calls.some((call) => JSON.stringify(call) === JSON.stringify(["docker", "compose", "-p", "courtside-perf", "down", "--volumes"])));
  assert.ok(calls.some((call) => JSON.stringify(call) === JSON.stringify(["docker", "rm", "--force", id])));
  assert.ok(!calls.some((call) => call.includes("image") || call.includes("--remove-orphans")));
});

test("given rejected PERFORMANCE resource ownership, when resetting immutable reuse, then execute no cleanup command", () => {
  // given
  const calls = [];
  // when / then
  assert.throws(() => resetPerformanceReuse({}, { root: "/private", execute: (...args) => calls.push(args),
    verify: () => { throw new Error("Foreign resource rejected"); } }), { message: "Foreign resource rejected" });
  assert.deepEqual(calls, []);
});

test("given engine selection IDs differing from runtime image IDs, when proving actual descriptors, then retain both identities without assuming config digests", () => {
  // given
  const f = fixture();
  try {
    const productionRuntime = `sha256:${"6".repeat(64)}`;
    const fixtureRuntime = `sha256:${"7".repeat(64)}`;
    f.runtimeIDs[image] = productionRuntime;
    f.runtimeIDs[fixturesImage] = fixtureRuntime;
    f.images[productionRuntime] = { ...structuredClone(f.images[image]), Id: productionRuntime };
    f.images[fixtureRuntime] = { ...structuredClone(f.images[fixturesImage]), Id: fixtureRuntime };
    // when
    const proof = inspectReusableImages(f.options);
    // then
    assert.deepEqual(proof.runtimeImageIDs, { production: productionRuntime, fixtures: fixtureRuntime });
    assert.equal(proof.productionImageID, image);
    assert.equal(proof.fixturesImageID, fixturesImage);
  } finally {
    f.cleanup();
  }
});

for (const flag of ["truncated", "timedOut"]) {
  test(`given ${flag} command output containing a valid JSON prefix, when reading bounded image evidence, then reject the entire result`, () => {
    // given
    const execute = () => ({ status: 0, signal: null, stdout: "[]", stderr: "", [flag]: true });
    // when / then
    assert.throws(() => boundedImageCommand(execute, "docker", ["image", "inspect", image], "/private"),
      { message: "Immutable image command did not complete within its bounds" });
  });
}

test("given the existing telemetry compose service set, when preparing immutable PERFORMANCE, then retain all services networks and volumes without pulling images", () => {
  // given
  const f = fixture();
  const services = ["app", "db", "mail", "proxy", "postgres-exporter", "prometheus", "grafana"];
  const reference = `example.org/dependency@sha256:${"8".repeat(64)}`;
  const execute = (command, args, options) => args[0] === "compose"
    ? { status: 0, signal: null, stdout: JSON.stringify({ services: Object.fromEntries(services.map((name) =>
      [name, { image: name === "app" ? fixturesImage : reference }])) }), stderr: "" }
    : f.execute(command, args, options);
  f.images[reference] = structuredClone(f.images[image]);
  try {
    let deployment;
    // when / then
    assert.doesNotThrow(() => { deployment = preparePerformanceReuse({ productionImageID: image,
      fixturesImageID: fixturesImage, runtimeImageIDs: { production: image, fixtures: fixturesImage } },
    { root: f.root, environment: {}, telemetry: true, dbPort: true, execute }); });
    const override = JSON.parse(readFileSync(deployment.override, "utf8"));
    assert.deepEqual(Object.keys(override.services).sort(), services.sort());
    assert.ok(Object.hasOwn(override.networks, "telemetry"));
    assert.ok(Object.hasOwn(override.volumes, "grafana-data"));
    assert.ok(Object.values(override.services).every((service) => service.pull_policy === "never"));
    assert.ok(deployment.compose.includes(join(f.root, "deploy/compose.perf-db.yaml")));
  } finally {
    f.cleanup();
  }
});

test("given actual compiled artifacts and native images, when proving reuse, then bind source layers helper bytes and engine IDs without build or pull", () => {
  // given
  const f = fixture();
  try {
    // when
    const proof = inspectReusableImages(f.options);
    // then
    assert.equal(proof.productionImageID, image);
    assert.equal(proof.fixturesImageID, fixturesImage);
    assert.equal(proof.sourceCommit, sourceCommit);
    assert.equal(Object.keys(proof.helperClassDigests).length, 3);
    assert.ok(f.calls.every(({ command, args, options }) => ["docker", "git"].includes(command)
      && !["build", "pull"].includes(args[0]) && options.shell === false && options.timeout <= 10000));
  } finally { f.cleanup(); }
});

for (const change of ["parent-layer", "extra-layer", "entrypoint", "architecture", "class-body", "helper-body", "foreign-file", "source"]) {
  test(`given ${change} drift, when proving prebuilt fixtures, then reject before seeding or building`, () => {
    // given
    const f = fixture();
    if (change === "parent-layer") f.images[fixturesImage].RootFS.Layers[0] = `sha256:${"f".repeat(64)}`;
    if (change === "extra-layer") f.images[fixturesImage].RootFS.Layers.push(`sha256:${"f".repeat(64)}`);
    if (change === "entrypoint") f.images[fixturesImage].Config.Entrypoint = ["other"];
    if (change === "architecture") f.images[fixturesImage].Architecture = "arm64";
    if (change === "class-body") f.files[fixturesImage]["/app/BOOT-INF/classes/org/courtside/CourtsideApplication.class"] = "changed";
    if (change === "helper-body") f.files[fixturesImage][Object.keys(f.files[fixturesImage]).at(-1)] = "changed";
    if (change === "foreign-file") f.files[fixturesImage]["/app/foreign.class"] = "unknown";
    if (change === "source") f.files[image]["/app/BOOT-INF/classes/git.properties"] = "git.commit.id=other";
    // when / then
    try { assert.throws(() => inspectReusableImages(f.options), /immutable|reuse|fixture|source|image/i); }
    finally { f.cleanup(); }
  });
}
