import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import * as qualification from "./immutable-qualification.mjs";

const image = `sha256:${"a".repeat(64)}`;
const sourceCommit = "b".repeat(40);
const project = "courtside-uat-qualification-example";
const args = ["--confirm", project, "--image", image, "--source-commit", sourceCommit];
const nativeEnvironment = { COURTSIDE_UAT_HTTP_PORT: "28081", COURTSIDE_UAT_HTTPS_PORT: "28443",
  COURTSIDE_UAT_SHARED_PORT: "28083", COURTSIDE_OPERATIONAL_LOG_PORT: "21515" };
const nativeEntrypoint = ["java", "--sun-misc-unsafe-memory-access=deny", "-XX:MaxRAMPercentage=50.0",
  "-XX:+ExitOnOutOfMemoryError", "org.springframework.boot.loader.launch.JarLauncher"];

test("given explicit immutable smoke options, when the existing producer is invoked, then invalid selection fails before native commands", async () => {
  // given
  const source = readFileSync(new URL("./courtside.uat-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /export async function runUatSmoke/);
  const { runUatSmoke } = await import("./courtside.uat-smoke.mjs");
  const calls = [];
  // when / then
  await assert.rejects(runUatSmoke({ args: [...args, "--skip-verify"], environment: {},
    execute: (...parameters) => { calls.push(parameters); throw new Error("Native command must not run"); } }));
  assert.deepEqual(calls, []);
});

for (const refusal of ["remoteHost", "remoteContext", "projectCollision"]) {
  test(`given ${refusal}, when the full immutable producer refuses preparation, then no fallback Compose diagnostics run`, async () => {
    // given
    const { runUatSmoke } = await import("./courtside.uat-smoke.mjs");
    const root = mkdtempSync(join(tmpdir(), "immutable-refusal-"));
    const { execute, calls } = lifecycleExecute({ root, collision: refusal === "projectCollision" });
    const environment = { ...nativeEnvironment,
      ...(refusal === "remoteHost" ? { DOCKER_HOST: "ssh://example.org" } : {}),
      ...(refusal === "remoteContext" ? { DOCKER_CONTEXT: "foreign" } : {}) };
    try {
      // when
      await assert.rejects(runUatSmoke({ args, environment, repository: root, execute,
        request: smokeRequest(), platform: "linux", architecture: "x64" }));
      // then
      assert.ok(calls.every(({ args: commandArgs }) => commandArgs[0] !== "compose"));
      if (refusal !== "projectCollision") assert.deepEqual(calls, []);
      assert.equal(readFileSync(join(root, "build", "immutable-qualification", project, "container-logs.txt"), "utf8"),
        "Container logs were unavailable before cleanup.\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("given an explicit immutable candidate, when options are parsed, then image and source stay bound", () => {
  // given
  const environment = {};
  // when
  const result = qualification.immutableQualificationOptions(args, environment);
  // then
  assert.deepEqual(result, { project, image, sourceCommit });
});

for (const invalid of [
  ["--confirm", "courtside-uat", "--image", image, "--source-commit", sourceCommit],
  ["--confirm", project, "--image", "courtside:uat-local", "--source-commit", sourceCommit],
  ["--confirm", project, "--image", image],
  [...args, "--skip-verify"],
  [...args, "--version", "example"],
  [...args, "--image", image],
]) {
  test(`given unsafe immutable options ${invalid.join(" ")}, when parsed, then selection is refused`, () => {
    // given
    const environment = {};
    // when / then
    assert.throws(() => qualification.immutableQualificationOptions(invalid, environment));
  });
}

function lifecycleExecute({ collision = false, foreign = false, root = "/example", cleanupFails = false,
  hardeningFails = false, imageDrift = false, entrypointDrift = false, runtimeIncomplete = false,
  reservationTimedOut = false, runtimeImage = image, logCollector = true } = {}) {
  const candidate = candidateExecute({ runtimeImage });
  let reserved = false;
  let started = false;
  const removed = new Set();
  let token;
  let restarted = false;
  const configDrift = {};
  const reservationId = "1".repeat(64);
  let appId = "2".repeat(64);
  let appGeneration = 5;
  const dbId = "3".repeat(64);
  const proxyId = "4".repeat(64);
  const collectorId = "8".repeat(64);
  let bootstrapPassword = "";
  const caVolume = `${project}_caddy-data`;
  const composePath = join(root, "deploy", "compose.uat.yaml");
  const execute = (command, commandArgs, options) => {
    if (command === "git" || ["image", "info", "start"].includes(commandArgs[0])
        || commandArgs[0] === "create" && !commandArgs.includes("--name")
        || commandArgs[0] === "inspect" && commandArgs[1] === "d".repeat(64)
        || commandArgs[0] === "rm" && commandArgs.at(-1) === "d".repeat(64)) {
      return candidate.execute(command, commandArgs, options);
    }
    candidate.calls.push({ command, args: commandArgs, options });
    let stdout = "";
    if (commandArgs[0] === "context") stdout = JSON.stringify({ Host: "unix:///var/run/docker.sock" });
    else if (commandArgs[0] === "compose" && commandArgs.includes("config")) {
      stdout = JSON.stringify({ services: Object.fromEntries(["app", "log-collector", "db", "api-ui", "proxy"]
        .map((service) => [service, { image: ["app", "log-collector"].includes(service)
          ? image : `example/${service}@${image}`,
          ...(service === "app" ? { environment: { COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD: options.env.COURTSIDE_UAT_ADMIN_PASSWORD ?? "" },
            read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], tmpfs: ["/tmp"] } : {}),
          ...(service === "log-collector" ? { command: ["--collect-operational-logs"], restart: "unless-stopped",
            logging: { driver: "json-file", options: { "max-size": "10m", "max-file": "5" } },
            read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], tmpfs: ["/tmp"],
            mem_limit: 268435456, pids_limit: 64 } : {}),
          ...(commandArgs.includes(join(root, "proof", "compose.override.json")) || commandArgs.some(value => value.endsWith("compose.override.json"))
            ? { cpus: ["app", "db"].includes(service) ? 2 : 1,
              mem_limit: ["app", "db"].includes(service) ? 1073741824 : service === "proxy" ? 134217728 : 268435456,
              ...(service === "log-collector" ? {} : { memswap_limit: ["app", "db"].includes(service) ? 1073741824 : service === "proxy" ? 134217728 : 268435456 }),
              pids_limit: ["app", "db"].includes(service) ? 256 : 64 } : {}) }])),
      networks: { backend: {}, frontend: {}, "log-collection": {} },
      volumes: { db: {}, "caddy-data": {}, "caddy-config": {}, "operational-logs": {} } });
    } else if (["ps", "network", "volume"].includes(commandArgs[0]) && commandArgs.includes("--quiet")) {
      const named = commandArgs.includes(`name=^/?${project}[-_]`);
      if (collision && !reserved && commandArgs[0] === "ps") stdout = "9".repeat(64);
      else if (commandArgs[0] === "ps") stdout = [reserved ? reservationId : "",
        started ? appId : "", started ? dbId : "", started ? proxyId : "", started && logCollector ? collectorId : "", foreign && started && named ? "9".repeat(64) : ""]
        .filter((id) => id && !removed.has(id)).join("\n");
      else if (commandArgs[0] === "volume" && started && !removed.has(caVolume)
          && !commandArgs.includes(`name=^${project}_db$`)) stdout = caVolume;
    } else if (commandArgs[0] === "create") {
      reserved = true;
      token = commandArgs.find((arg) => arg.startsWith("org.courtside.qualification.owner=")).split("=")[1];
      stdout = reservationId;
      if (reservationTimedOut) return { status: 0, stdout, timedOut: true };
    } else if (commandArgs[0] === "inspect") {
      stdout = JSON.stringify(commandArgs.slice(1).map((id) => id === `${project}-reservation` ? reservationId : id)
        .map((id) => ({ Id: id,
        Image: imageDrift && restarted && id === appId ? `sha256:${"f".repeat(64)}` : runtimeImage,
        Name: `/${project}-${id === reservationId ? "reservation" : id === dbId ? "db-1" : id === proxyId ? "proxy-1" : id === collectorId ? "log-collector-1" : "app-1"}`,
        State: { StartedAt: restarted ? "2026-01-01T00:01:00Z" : "2026-01-01T00:00:00Z",
          ...(runtimeIncomplete ? {} : { OOMKilled: false }) }, RestartCount: 0,
        HostConfig: { ReadonlyRootfs: id === reservationId || id === collectorId || id === appId && !hardeningFails,
          CapDrop: id === appId || id === reservationId || id === collectorId ? ["ALL"] : [],
          SecurityOpt: id === appId || id === reservationId || id === collectorId ? ["no-new-privileges:true"] : [],
          Tmpfs: id === appId || id === collectorId ? { "/tmp": "" } : {},
          Memory: id === reservationId ? 67108864 : id === proxyId ? 134217728 : id === collectorId ? 268435456 : 1073741824,
          MemorySwap: id === reservationId ? 67108864 : id === proxyId ? 134217728 : id === collectorId ? 536870912 : 1073741824,
          NanoCpus: id === reservationId || id === proxyId || id === collectorId ? 1000000000 : 2000000000,
          PidsLimit: id === reservationId ? 16 : id === proxyId || id === collectorId ? 64 : 256,
          ...(id === collectorId ? { LogConfig: { Type: "json-file", Config: { "max-size": "10m", "max-file": "5" } } } : {}),
          Privileged: false, RestartPolicy: { Name: id === collectorId ? "unless-stopped" : "no", MaximumRetryCount: 0 } },
        NetworkSettings: { Ports: { "8080/tcp": null } },
        Config: { Image: image, User: "10001:10001", WorkingDir: "",
          Env: id === appId ? [`COURTSIDE_BOOTSTRAP_ADMIN_PASSWORD=${bootstrapPassword}`] : [],
          Entrypoint: id === reservationId ? ["/bin/cat"] : entrypointDrift && id === appId ? ["java", "-Xmx2g"] : nativeEntrypoint,
          ...(id === appId ? configDrift.config : {}),
          Cmd: id === reservationId ? ["/dev/null"] : id === collectorId ? ["--collect-operational-logs"] : [], Labels: { "org.courtside.qualification.owner": id === "9".repeat(64) ? "foreign" : token,
          ...(id === reservationId ? {} : { "com.docker.compose.project": project,
            "com.docker.compose.service": id === dbId ? "db" : id === proxyId ? "proxy" : id === collectorId ? "log-collector" : "app",
            "com.docker.compose.project.config_files": composePath }) } } })));
    } else if (commandArgs[0] === "volume" && commandArgs[1] === "inspect") {
      stdout = JSON.stringify([{ Name: caVolume, CreatedAt: "2026-01-01T00:00:00Z", Driver: "local", Options: null,
        Labels: { "org.courtside.qualification.owner": token, "com.docker.compose.project": project } }]);
    } else if (commandArgs[0] === "compose" && commandArgs.includes("up")) {
      bootstrapPassword = options.env.COURTSIDE_UAT_ADMIN_PASSWORD ?? "";
      if (commandArgs.includes("--force-recreate")) { removed.add(appId); appId = String(appGeneration++).repeat(64); }
      started = true;
      removed.delete(appId);
      removed.delete(dbId);
      removed.delete(proxyId);
      removed.delete(collectorId);
    }
    else if (commandArgs[0] === "compose" && commandArgs.includes("ps")) stdout = appId;
    else if (commandArgs[0] === "compose" && commandArgs.includes("images")) stdout = JSON.stringify([{ ID: image }]);
    else if (commandArgs[0] === "compose" && commandArgs.includes("restart")) restarted = true;
    else if (commandArgs[0] === "compose" && commandArgs.includes("exec")) stdout = commandArgs.includes("cat") ? "example CA" : "1";
    else if (commandArgs[0] === "compose" && commandArgs.includes("stop")) stdout = "";
    else if (commandArgs[0] === "compose" && commandArgs.includes("logs")) {
      stdout = "Graceful shutdown complete";
      if (configDrift.replaceDuringLogs) { removed.add(appId); appId = "7".repeat(64); }
    }
    else if (commandArgs[0] === "compose" && commandArgs.includes("cp")) writeFileSync(commandArgs.at(-1), "example CA");
    else if (commandArgs[0] === "rm" || commandArgs[0] === "volume" && commandArgs[1] === "rm") {
      if (cleanupFails && commandArgs.at(-1) === appId) return { status: 1, stdout: "" };
      removed.add(commandArgs.at(-1));
    }
    else throw new Error(`Unexpected lifecycle command ${commandArgs.join(" ")}`);
    return { status: 0, stdout };
  };
  const wrapped = (command, commandArgs, options) => {
    const result = execute(command, commandArgs, options);
    if (commandArgs[0] === "inspect" && (configDrift.hostConfig || configDrift.service)) {
      const values = JSON.parse(result.stdout);
      for (const item of values) {
        const service = item.Config?.Labels?.["com.docker.compose.service"];
        if (service === (configDrift.service ?? "app")) {
          Object.assign(item.Config, configDrift.config);
          Object.assign(item.HostConfig, configDrift.hostConfig);
        }
      }
      result.stdout = JSON.stringify(values);
    }
    return result;
  };
  return { execute: wrapped, calls: candidate.calls, configDrift };
}

test("given the recorded Docker memory default and UAT collector without declared swap, when first accepted then rechecked, then accept twice memory and reject retained swap drift", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "immutable-uat-swap-"));
  const harness = lifecycleExecute({ root, logCollector: true });
  const lifecycle = qualification.createImmutableQualification({ project, image, sourceCommit, root,
    evidence: join(root, "proof"), execute: harness.execute, environment: nativeEnvironment, platform: "linux", architecture: "x64" });
  try {
    // when
    lifecycle.start("a-private-bootstrap-password");
    lifecycle.composeRun("logs", "--no-color");
    Object.assign(harness.configDrift, { service: "log-collector", hostConfig: { MemorySwap: 268435456 } });
    // then
    assert.throws(() => lifecycle.composeRun("stop", "app"), /resource identity changed/);
    assert.ok(!harness.calls.some(({ args }) => args[0] === "compose" && args.includes("stop")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given an explicitly declared UAT swap limit, when native first acceptance reports the Docker default instead, then reject the wrong explicit limit", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "immutable-uat-explicit-swap-"));
  const harness = lifecycleExecute({ root });
  const lifecycle = qualification.createImmutableQualification({ project, image, sourceCommit, root,
    evidence: join(root, "proof"), execute: harness.execute, environment: nativeEnvironment, platform: "linux", architecture: "x64" });
  Object.assign(harness.configDrift, { service: "app", hostConfig: { MemorySwap: 2147483648 } });
  try {
    // when / then
    assert.throws(() => lifecycle.start("a-private-bootstrap-password"), /effective container configuration changed/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given Config-only or limit drift on the same UAT app CID, when the actual immutable lifecycle reconciles, then refuse before the next operation", () => {
  // given
  for (const drift of [{ config: { Env: ["JAVA_TOOL_OPTIONS=-Xmx4g"] } }, { hostConfig: { Memory: 4 * 1024 * 1024 * 1024 } }]) {
    const root = mkdtempSync(join(tmpdir(), "immutable-uat-effective-"));
    const harness = lifecycleExecute({ root });
    const lifecycle = qualification.createImmutableQualification({ project, image, sourceCommit, root,
      evidence: join(root, "proof"), execute: harness.execute, environment: nativeEnvironment, platform: "linux", architecture: "x64" });
    try {
      lifecycle.start("a-private-bootstrap-password");
      Object.assign(harness.configDrift, drift);
      const count = harness.calls.filter(({ args }) => args[0] === "compose" && args.includes("stop")).length;
      // when / then
      assert.throws(() => lifecycle.composeRun("stop", "app"), /resource identity changed|effective.*changed/);
      assert.equal(harness.calls.filter(({ args }) => args[0] === "compose" && args.includes("stop")).length, count);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("given Config-only drift of a UAT database or proxy, when the immutable lifecycle reconciles, then refuse the next operation before executing it", () => {
  // given
  for (const service of ["db", "proxy"]) {
    const root = mkdtempSync(join(tmpdir(), "immutable-uat-dependency-"));
    const harness = lifecycleExecute({ root });
    const lifecycle = qualification.createImmutableQualification({ project, image, sourceCommit, root,
      evidence: join(root, "proof"), execute: harness.execute, environment: nativeEnvironment, platform: "linux", architecture: "x64" });
    try {
      lifecycle.start("a-private-bootstrap-password");
      Object.assign(harness.configDrift, { service, config: { Env: ["UNDECLARED=changed"] } });
      // when / then
      assert.throws(() => lifecycle.composeRun("stop", "app"), /resource identity changed/);
      assert.ok(!harness.calls.some(({ args }) => args[0] === "compose" && args.includes("stop")));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("given wrong UAT app environment or dependency limits at first acceptance, when startup creates containers, then independently reject the mismatch against rendered Compose", () => {
  // given
  for (const drift of [{ service: "app", config: { Env: ["JAVA_TOOL_OPTIONS=-Xmx4g"] } },
    { service: "db", hostConfig: { Memory: 4 * 1024 * 1024 * 1024 } },
    { service: "proxy", config: { Env: ["UNDECLARED=changed"] } }]) {
    const root = mkdtempSync(join(tmpdir(), "immutable-uat-first-"));
    const harness = lifecycleExecute({ root });
    const lifecycle = qualification.createImmutableQualification({ project, image, sourceCommit, root,
      evidence: join(root, "proof"), execute: harness.execute, environment: nativeEnvironment, platform: "linux", architecture: "x64" });
    Object.assign(harness.configDrift, drift);
    try {
      // when / then
      assert.throws(() => lifecycle.start("a-private-bootstrap-password"), /effective container configuration changed/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("given same-label UAT replacement during a read operation, when the lifecycle reconciles afterward, then reject unplanned container creation", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "immutable-uat-transition-"));
  const harness = lifecycleExecute({ root });
  const lifecycle = qualification.createImmutableQualification({ project, image, sourceCommit, root,
    evidence: join(root, "proof"), execute: harness.execute, environment: nativeEnvironment, platform: "linux", architecture: "x64" });
  try {
    lifecycle.start("a-private-bootstrap-password");
    harness.configDrift.replaceDuringLogs = true;
    // when / then
    assert.throws(() => lifecycle.composeRun("logs", "--no-color"), /unexpected container creation/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("given a reservation command with incomplete output, when its actual owned container can be inspected, then only that reservation is cleaned", () => {
  // given
  const evidence = mkdtempSync(join(tmpdir(), "immutable-reservation-"));
  const { execute, calls } = lifecycleExecute({ reservationTimedOut: true });
  try {
    // when / then
    assert.throws(() => qualification.createImmutableQualification({ project, image, sourceCommit,
      root: "/example", evidence, execute, platform: "linux", architecture: "x64", environment: nativeEnvironment }));
    assert.ok(calls.some(({ args: commandArgs }) => commandArgs[0] === "rm" && commandArgs.at(-1) === "1".repeat(64)));
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
});

function smokeRequest({ failedCheck } = {}) {
  let authenticated = false;
  const csrf = "__Host-XSRF-TOKEN=example; Path=/; Secure; SameSite=Lax";
  const cookie = "__Host-SESSION=example; Path=/; Secure; HttpOnly; SameSite=Lax";
  const csp = "base-uri 'none'; img-src 'self' https:;";
  return async ({ secure, port, path, method = "GET", body, headers = {} }) => {
    const response = (statusCode, responseBody = "", extra = {}) => ({ statusCode, body: responseBody,
      headers: { "cache-control": "no-store", "content-security-policy": csp, ...extra } });
    if (port === 28081) {
      if (headers.Host || path.startsWith("/api/") || method === "POST") return response(400, "Plain HTTP is not accepted.");
      return response(301, "", { location: `https://localhost:28443${path}` });
    }
    if (path === "/") return response(failedCheck === "deployment" ? 500 : 200, '<div id="root"></div>');
    if (path === "/api/source") return response(200, JSON.stringify({ commit: failedCheck === "tlsSource" ? "f".repeat(40) : sourceCommit,
      environment: "UAT", version: "0.1.0-SNAPSHOT", sourceUrl: "https://example.org/git/courtside" }));
    if (path === "/api-ui/") return response(secure ? 200 : 404, "Swagger UI");
    if (path === "/api/openapi.yaml") return response(secure ? 200 : 404, "openapi: 3.1.0");
    if (path === "/actuator/health") return response(404);
    if (path === "/api/session/logout") {
      authenticated = false;
      return response(204, "", { "set-cookie": [`${cookie}; Max-Age=0`] });
    }
    if (path === "/api/session") {
      if (method === "POST") authenticated = true;
      return response(method === "POST" && failedCheck === "authentication" ? 403 : 200,
        JSON.stringify({ authenticated }), { "set-cookie": [csrf, ...(authenticated ? [cookie] : [])],
          "strict-transport-security": "max-age=31536000", "x-robots-tag": "noindex, nofollow" });
    }
    if (path === "/api/account/initial-password") return response(204);
    if (method === "QUERY") return response(405, JSON.stringify({ type: "urn:courtside:error:method-not-supported",
      title: "Method not allowed" }), { "content-type": "application/problem+json", allow: "GET" });
    if (path === "/api/public/courts") return response(200, '[{"id":"example-court"}]');
    if (path === "/api/public/booking-cards") return response(200, '[{"id":"11111111-1111-1111-1111-111111111111"}]');
    if (path === "/api/bookings") return body.length > 2 * 1024 * 1024 ? response(413) : response(201, '{"id":"example-booking"}');
    if (path === "/api/my/bookings") return response(200, failedCheck === "bookingPersistence" ? "[]" : '[{"id":"example-booking"}]');
    throw new Error(`Unexpected HTTP request ${path}`);
  };
}

for (const failedCheck of [undefined, "deployment", "authentication", "bookingPersistence", "hardening", "imageDrift", "entrypointDrift", "tlsSource", "runtimeIncomplete", "cleanup"]) {
  test(`given the existing producer and ${failedCheck ?? "passing checks"}, when immutable smoke runs, then receipt follows all checks and cleanup`, async () => {
    // given
    const source = readFileSync(new URL("./courtside.uat-smoke.mjs", import.meta.url), "utf8");
    assert.match(source, /export async function runUatSmoke/);
    const { runUatSmoke } = await import("./courtside.uat-smoke.mjs");
    const root = mkdtempSync(join(tmpdir(), "immutable-producer-"));
    const { execute } = lifecycleExecute({ root, cleanupFails: failedCheck === "cleanup",
      hardeningFails: failedCheck === "hardening", imageDrift: failedCheck === "imageDrift",
      entrypointDrift: failedCheck === "entrypointDrift", runtimeIncomplete: failedCheck === "runtimeIncomplete" });
    const receiptPath = join(root, "build", "immutable-qualification", project, "qualification.json");
    try {
      // when
      const promise = runUatSmoke({ args, environment: nativeEnvironment, repository: root, execute,
        request: smokeRequest({ failedCheck }), platform: "linux", architecture: "x64" });
      // then
      if (failedCheck) {
        await assert.rejects(promise);
        assert.equal(existsSync(receiptPath), false);
      } else {
        const receipt = await promise;
        assert.equal(receipt.manifestDigest, image);
        assert.deepEqual(receipt.checks, { deployment: true, authentication: true, bookingPersistence: true, hardening: true });
        assert.deepEqual(JSON.parse(readFileSync(receiptPath, "utf8")), receipt);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

for (const mode of ["oversized", "stalled"]) {
  test(`given a ${mode} loopback response, when immutable HTTP is observed, then the response budget aborts it`, async () => {
    // given
    const server = createServer((_request, response) => {
      if (mode === "oversized") response.end("x".repeat(2048));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      // when / then
      await assert.rejects(qualification.immutableQualificationRequest({ secure: false,
        port: server.address().port, path: "/example" }, { deadlineMilliseconds: 50, responseLimit: 1024 }));
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
}

test("given a fresh owned project, when immutable lifecycle starts and cleans, then only recorded resources are removed", () => {
  // given
  const evidence = mkdtempSync(join(tmpdir(), "immutable-qualification-"));
  const { execute, calls } = lifecycleExecute();
  try {
    // when
    const lifecycle = qualification.createImmutableQualification({ project, image, sourceCommit,
      root: "/example", evidence, execute, platform: "linux", architecture: "x64", environment: nativeEnvironment });
    lifecycle.start("private-bootstrap-example");
    lifecycle.assertCandidate();
    lifecycle.cleanup();
    // then
    const override = JSON.parse(readFileSync(join(evidence, "compose.override.json"), "utf8"));
    assert.equal(override.services.app.image, image);
    assert.equal(override.services.app.pull_policy, "never");
    assert.deepEqual(lifecycle.proof.liveResources, []);
    assert.ok(calls.filter(({ args: commandArgs }) => commandArgs.includes("up"))
      .every(({ args: commandArgs }) => commandArgs.includes("--pull")
        && commandArgs.includes("never") && commandArgs.includes("--no-build")));
    assert.ok(calls.every(({ command }) => !["tailscale", "mvn", "java"].includes(command)));
  assert.ok(calls.every(({ args: commandArgs }) => !commandArgs.includes("down")));
    const callCount = calls.length;
    assert.throws(() => lifecycle.composeRun("pull", "app"));
    assert.equal(calls.length, callCount);
    assert.throws(() => lifecycle.composeRun("exec", "app", "sh", "-c", "example"));
    assert.equal(calls.length, callCount);
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
});

test("given an existing project collision, when immutable lifecycle is prepared, then no reservation or reset runs", () => {
  // given
  const { execute, calls } = lifecycleExecute({ collision: true });
  // when / then
  assert.throws(() => qualification.createImmutableQualification({ project, image, sourceCommit,
    root: "/example", evidence: "/example/build/private", execute, platform: "linux", architecture: "x64", environment: nativeEnvironment }));
  assert.ok(!calls.some(({ args: commandArgs }) => commandArgs.includes("--name") || commandArgs.includes("down")));
});

test("given a foreign resource appearing after startup, when cleanup is requested, then destructive cleanup is refused", () => {
  // given
  const evidence = mkdtempSync(join(tmpdir(), "immutable-qualification-"));
  const { execute, calls } = lifecycleExecute({ foreign: true });
  try {
    const lifecycle = qualification.createImmutableQualification({ project, image, sourceCommit,
      root: "/example", evidence, execute, platform: "linux", architecture: "x64", environment: nativeEnvironment });
    // when / then
    assert.throws(() => lifecycle.start("private-bootstrap-example"));
    assert.throws(() => lifecycle.cleanup());
    assert.ok(!calls.some(({ args: commandArgs }) => commandArgs[0] === "rm" && commandArgs.includes("2".repeat(64))));
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
});

test("given legacy confirmation, when immutable selection is absent, then legacy handling remains available", () => {
  // given
  const legacy = ["--confirm", "courtside-uat"];
  // when
  const result = qualification.immutableQualificationOptions(legacy, {});
  // then
  assert.equal(result, undefined);
});

for (const environment of [
  { COURTSIDE_UAT_VERSION: "example" },
  { COURTSIDE_UAT_PROJECT: "courtside-uat" },
  { COURTSIDE_BOOKING_SEED_IMAGE: "example" },
]) {
  test(`given conflicting environment ${Object.keys(environment)[0]}, when selected, then immutable qualification refuses it`, () => {
    // given
    const options = [...args];
    // when / then
    assert.throws(() => qualification.immutableQualificationOptions(options, environment));
  });
}

for (const environment of [{}, { ...nativeEnvironment, COURTSIDE_UAT_HTTP_PORT: "8081" },
  { ...nativeEnvironment, COURTSIDE_UAT_HTTP_PORT: "28083" },
  { ...nativeEnvironment, DOCKER_HOST: "ssh://example.org" },
  { ...nativeEnvironment, DOCKER_CONTEXT: "foreign" }]) {
  test(`given unsafe host isolation ${JSON.stringify(environment)}, when lifecycle is prepared, then no native commands run`, () => {
    // given
    const calls = [];
    // when / then
    assert.throws(() => qualification.createImmutableQualification({ project, image, sourceCommit,
      root: "/example", evidence: "/example/build/private", environment,
      execute: (...parameters) => { calls.push(parameters); throw new Error("Native commands must not run"); } }));
    assert.deepEqual(calls, []);
  });
}

function candidateExecute({ imageOverride = {}, source = sourceCommit, dirty = "", flagged = {}, runtimeImage = image } = {}) {
  const calls = [];
  let probeToken;
  const inspected = { Id: image, Os: "linux", Architecture: "amd64",
    RootFS: { Type: "layers", Layers: [`sha256:${"c".repeat(64)}`] },
    Config: { User: "10001:10001", Entrypoint: nativeEntrypoint, Cmd: [], Labels: {} },
    ...imageOverride };
  const execute = (command, arguments_, options) => {
    calls.push({ command, args: arguments_, options });
    let stdout;
    if (command === "git") stdout = arguments_[0] === "status" ? dirty : sourceCommit;
    else if (arguments_.slice(0, 2).join(" ") === "image inspect") stdout = JSON.stringify([
      arguments_[2] === runtimeImage && runtimeImage !== image ? { ...inspected, Id: runtimeImage } : inspected]);
    else if (arguments_[0] === "info") stdout = JSON.stringify({ OSType: "linux", Architecture: "x86_64" });
    else if (arguments_[0] === "create") {
      probeToken = arguments_.find((arg) => arg.startsWith("org.courtside.qualification.probe=")).split("=")[1];
      stdout = "d".repeat(64);
    }
    else if (arguments_[0] === "start") stdout = `git.commit.id=${source}\n`;
    else if (arguments_[0] === "inspect") stdout = JSON.stringify([{ Id: "d".repeat(64), Image: runtimeImage,
      Config: { Image: image, Labels: { "org.courtside.qualification.probe": probeToken } } }]);
    else if (arguments_[0] === "rm") stdout = "d".repeat(64);
    else throw new Error(`Unexpected command ${command} ${arguments_.join(" ")}`);
    return { status: 0, stdout, ...flagged };
  };
  return { execute, calls };
}

test("given an existing source-bound image, when inspected, then actual filesystem and native image evidence are retained", () => {
  // given
  const { execute, calls } = candidateExecute();
  // when
  const proof = qualification.inspectImmutableCandidate({ image, sourceCommit, root: "/example",
    execute, platform: "linux", architecture: "x64", probeToken: "e".repeat(32) });
  // then
  assert.equal(proof.image.Id, image);
  assert.equal(proof.sourceCommit, sourceCommit);
  assert.equal(proof.architecture, "amd64");
  const create = calls.find(({ args: commandArgs }) => commandArgs[0] === "create").args;
  assert.ok(create.includes("--pull=never"));
  assert.ok(create.includes("--network=none"));
  assert.ok(create.includes("--read-only"));
  assert.equal(calls.at(-1).args[0], "rm");
  assert.ok(calls.every(({ options }) => options.shell === false && options.timeout <= 60_000));
  assert.ok(calls.every(({ args: commandArgs }) => !commandArgs.includes("pull") && !commandArgs.includes("build")));
});

test("given opaque engine selection and distinct proven runtime IDs, when the immutable UAT producer qualifies, then retain the selected subject without inventing a config digest", async () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "immutable-runtime-mapping-"));
  const runtimeImage = `sha256:${"6".repeat(64)}`;
  const { execute } = lifecycleExecute({ root, runtimeImage });
  const { runUatSmoke } = await import("./courtside.uat-smoke.mjs");
  try {
    let receipt;
    // when / then
    await assert.doesNotReject(async () => { receipt = await runUatSmoke({ args, environment: nativeEnvironment,
      repository: root, execute, request: smokeRequest(), platform: "linux", architecture: "x64" }); });
    assert.equal(receipt.manifestDigest, image);
    const proof = JSON.parse(readFileSync(join(root, "build/immutable-qualification", project, "provenance.json"), "utf8"));
    assert.equal(proof.runtimeImageID, runtimeImage);
    assert.ok(proof.runtime.every((observed) => observed.imageId === runtimeImage));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [name, changes] of [
  ["wrong config ID", { imageOverride: { Id: `sha256:${"f".repeat(64)}` } }],
  ["wrong image architecture", { imageOverride: { Architecture: "arm64" } }],
  ["wrong image operating system", { imageOverride: { Os: "windows" } }],
  ["wrong filesystem source", { source: "f".repeat(40) }],
  ["dirty source", { dirty: " M tools/example.mjs" }],
  ["truncated output", { flagged: { truncated: true } }],
  ["timed out output", { flagged: { timedOut: true } }],
]) {
  test(`given ${name}, when the actual candidate is inspected, then no candidate proof is returned`, () => {
    // given
    const { execute } = candidateExecute(changes);
    // when / then
    assert.throws(() => qualification.inspectImmutableCandidate({ image, sourceCommit, root: "/example",
      execute, platform: "linux", architecture: "x64", probeToken: "e".repeat(32) }));
  });
}
