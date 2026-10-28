import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("yaml");
const read = (path) => readFileSync(join(root, path), "utf8");

test("given read-only application deployments, when keys are initialized, then every app has an isolated persistent writable directory", () => {
  // given
  const deployments = ["compose.yaml", "compose.uat.yaml", "compose.restore.yaml", "compose.recovery-check.yaml", "compose.upgrade.yaml", "compose.perf.yaml", "compose.security.yaml"];
  // when / then
  for (const file of deployments) {
    const compose = yaml.parse(read(`deploy/${file}`));
    for (const name of ["app", ...(file === "compose.security.yaml" ? ["seeder"] : [])]) {
      const app = compose.services[name];
      assert.equal(app.environment.COURTSIDE_MFA_KEY_ROOT, "/var/lib/courtside/mfa-keys", `${file} ${name}`);
      assert.ok(app.volumes.includes("mfa-keys:/var/lib/courtside/mfa-keys"), `${file} ${name}`);
      assert.ok(Object.hasOwn(compose.volumes, "mfa-keys"), file);
    }
  }
  assert.match(read("Dockerfile"), /install -d -m 0700 -o 10001 -g 10001 \/var\/lib\/courtside\/mfa-keys/);
});

test("given the image started without a key root variable, when it initializes keys, then it uses the directory it creates for its own user", () => {
  // given
  const dockerfile = read("Dockerfile");
  const owned = [...dockerfile.matchAll(/install -d (?:-m \d+ )?-o 10001 -g 10001 (\S+)/g)].map((match) => match[1]);
  // when
  const keyRoot = /^ENV COURTSIDE_MFA_KEY_ROOT=(\S+)$/m.exec(dockerfile)?.[1];
  // then
  assert.ok(keyRoot, "the image must not fall back to a key root below its root-owned working directory");
  assert.ok(owned.includes(keyRoot), `the image key root ${keyRoot} is a directory UID 10001 owns`);
  assert.match(dockerfile, new RegExp(`^VOLUME ${keyRoot}$`, "m"),
    "keys written without a mounted volume must outlive the container's writable layer");
});

test("given a key archive, when the operator verifies it, then only regular instance keyrings are accepted", () => {
  // given
  const directory = mkdtempSync(join(tmpdir(), "courtside-key-archive-"));
  const id = "11111111-1111-4111-8111-111111111111";
  const source = join(directory, "keys");
  mkdirSync(join(source, id), { recursive: true });
  writeFileSync(join(source, id, "mfa.keys"), "format=1\n", { mode: 0o600 });
  const archive = join(directory, "keys.tar");
  const verify = () => spawnSync("/bin/bash", [join(root, "deploy/mfa-keys.sh"), archive], { encoding: "utf8" });
  try {
    // when
    assert.equal(spawnSync("tar", ["-C", source, "-cf", archive, "."]).status, 0);
    const valid = verify();
    rmSync(join(source, id, "mfa.keys"));
    symlinkSync("/etc/passwd", join(source, id, "mfa.keys"));
    assert.equal(spawnSync("tar", ["-C", source, "-cf", archive, "."]).status, 0);
    const linked = verify();
    // then
    assert.equal(valid.status, 0, valid.stderr);
    assert.notEqual(linked.status, 0);
    assert.match(linked.stderr, /regular files and directories/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given an encrypted UAT backup, when compatibility validation fails, then the target application and database remain untouched", async () => {
  // given
  const { restoreUatRecovery } = await import("./mfa-key-custody.mjs");
  const directory = mkdtempSync(join(tmpdir(), "courtside-uat-recovery-"));
  const source = join(directory, "legacy.dump");
  writeFileSync(source, "PGDMP");
  const empty = join(directory, "empty");
  mkdirSync(empty);
  const archive = join(directory, "empty.tar");
  assert.equal(spawnSync("tar", ["-C", empty, "-cf", archive, "."]).status, 0);
  const calls = [];
  const execute = (plan) => {
    calls.push(plan.args);
    if (plan.stdout !== undefined) writeFileSync(plan.stdout, readFileSync(archive));
    if (plan.args.includes("app") && plan.args.includes("--wait")) throw new Error("missing matching MFA key");
  };
  try {
    // when / then
    assert.throws(() => restoreUatRecovery(source, ["compose", "-p", "courtside-uat"], { COURTSIDE_UAT_IMAGE: "courtside:uat-local" }, execute), /missing matching MFA key/);
    assert.equal(calls.some((args) => args.includes("stop")), false);
    assert.ok(calls.some((args) => args.includes("down") && args.includes("--volumes")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given maintained UAT addresses, when the trusted origin is configured, then it comes from the local port or verified Tailscale DNS", async () => {
  // given
  const { uatTrustedOrigin } = await import("./courtside.mjs");
  // when / then
  assert.equal(uatTrustedOrigin({ COURTSIDE_UAT_HTTPS_PORT: "9443" }), "https://localhost:9443");
  assert.equal(uatTrustedOrigin({}, "example-node.example-tailnet.ts.net"), "https://example-node.example-tailnet.ts.net");
  assert.throws(() => uatTrustedOrigin({}, "attacker.example.org"), /Tailscale/);
  assert.throws(() => uatTrustedOrigin({}, "node.example.ts.net/evil"), /Tailscale/);
});

test("given mixed operator and installation key material, when recovery mode is selected, then the ambiguous archive is rejected", async () => {
  // given
  const { verifyMfaKeyArchive } = await import("./mfa-key-custody.mjs");
  const directory = mkdtempSync(join(tmpdir(), "courtside-key-mode-"));
  const source = join(directory, "keys");
  mkdirSync(join(source, "provided"), { recursive: true });
  mkdirSync(join(source, "11111111-1111-4111-8111-111111111111"));
  writeFileSync(join(source, "provided/mfa.keys"), "format=1\n");
  writeFileSync(join(source, "11111111-1111-4111-8111-111111111111/mfa.keys"), "format=1\n");
  const archive = join(directory, "keys.tar");
  try {
    // when
    assert.equal(spawnSync("tar", ["-C", source, "-cf", archive, "."]).status, 0);
    // then
    assert.throws(() => verifyMfaKeyArchive(archive), /mix operator-provided and installation keyrings/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given an operator key backup and a failed target restore, when the application restarts, then it retains its previous key configuration", async () => {
  // given
  const { restoreUatRecovery } = await import("./mfa-key-custody.mjs");
  const directory = mkdtempSync(join(tmpdir(), "courtside-provided-restore-"));
  mkdirSync(join(directory, "provided"));
  writeFileSync(join(directory, "provided/mfa.keys"), "format=1\n");
  writeFileSync(join(directory, "database.dump"), "PGDMP");
  assert.equal(spawnSync("tar", ["-C", directory, "-cf", join(directory, "mfa-keys.tar"), "./provided"]).status, 0);
  const calls = [];
  const execute = (plan) => {
    calls.push(plan);
    if (plan.args.includes("db") && plan.args.includes("/bin/sh")) throw new Error("target restore interrupted");
  };
  try {
    // when / then
    assert.throws(() => restoreUatRecovery(directory, ["compose", "-p", "courtside-uat"], { COURTSIDE_UAT_IMAGE: "courtside:uat-local" }, execute), /target restore interrupted/);
    assert.equal(calls.at(-1).environment.COURTSIDE_UAT_MFA_KEY_FILE, undefined);
    assert.ok(calls.some((plan) => plan.environment.COURTSIDE_RECOVERY_MFA_KEY_FILE === "/var/lib/courtside/mfa-keys/provided/mfa.keys"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given a complete UAT backup destination, when material is published, then the database and key archive remain private and an existing backup is not replaced", async () => {
  // given
  const { createUatRecovery } = await import("./mfa-key-custody.mjs");
  const { statSync } = await import("node:fs");
  const directory = mkdtempSync(join(tmpdir(), "courtside-complete-backup-"));
  const keys = join(directory, "source");
  mkdirSync(join(keys, "provided"), { recursive: true });
  writeFileSync(join(keys, "provided/mfa.keys"), "format=1\n", { mode: 0o600 });
  const archive = join(directory, "source.tar");
  assert.equal(spawnSync("tar", ["-C", keys, "-cf", archive, "."]).status, 0);
  const destination = join(directory, "complete");
  const execute = (plan) => writeFileSync(plan.stdout, plan.args.includes("pg_dump") ? "PGDMP" : readFileSync(archive));
  try {
    // when
    createUatRecovery(destination, ["compose", "-p", "courtside-uat"], {}, execute);
    // then
    assert.equal(statSync(destination).mode & 0o777, 0o700);
    assert.equal(statSync(join(destination, "database.dump")).mode & 0o777, 0o600);
    assert.equal(statSync(join(destination, "mfa-keys.tar")).mode & 0o777, 0o600);
    assert.equal(readFileSync(join(destination, "database.dump"), "utf8"), "PGDMP");
    assert.throws(() => createUatRecovery(destination, [], {}, execute), /already exists/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given an atomic key rotation in progress, when keys are backed up, then temporary publication files and locks are excluded", async () => {
  // given
  const { exportMfaKeys } = await import("./mfa-key-custody.mjs");
  const directory = mkdtempSync(join(tmpdir(), "courtside-key-publish-"));
  const source = join(directory, "keys");
  const id = "11111111-1111-4111-8111-111111111111";
  mkdirSync(join(source, id), { recursive: true });
  writeFileSync(join(source, id, "mfa.keys"), "format=1\n");
  writeFileSync(join(source, id, ".mfa-22222222-2222-4222-8222-222222222222.keys"), "incomplete");
  writeFileSync(join(source, id, "mfa.keys.lock"), "");
  const archive = join(directory, "keys.tar");
  const execute = (plan) => {
    const result = spawnSync("/bin/sh", ["-ec", plan.args.at(-1)], {
      env: { ...process.env, COURTSIDE_MFA_KEY_FILE: "", COURTSIDE_MFA_KEY_ROOT: source }, stdio: ["ignore", plan.stdout, "pipe"]
    });
    assert.equal(result.status, 0, result.stderr?.toString());
  };
  try {
    // when
    exportMfaKeys(archive, [], {}, execute);
    const entries = spawnSync("tar", ["-tf", archive], { encoding: "utf8" }).stdout;
    // then
    assert.match(entries, /\/mfa.keys\n/);
    assert.doesNotMatch(entries, /\.lock|\.mfa-/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given a Windows-compatible operator runtime, when a key archive is verified, then validation requires only native tar", async () => {
  // given
  const { verifyMfaKeyArchive } = await import("./mfa-key-custody.mjs");
  const directory = mkdtempSync(join(tmpdir(), "courtside-native-tar-"));
  const archive = join(directory, "keys.tar");
  writeFileSync(archive, "archive");
  const calls = [];
  const execute = (command, args) => {
    calls.push([command, args]);
    return args[0] === "-tf" ? "./provided/mfa.keys\n" : "-rw------- 0/0 9 2026-10-27 ./provided/mfa.keys\n";
  };
  try {
    // when
    const mode = verifyMfaKeyArchive(archive, execute);
    // then
    assert.equal(mode, "provided");
    assert.deepEqual(calls.map(([command]) => command), ["tar", "tar"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given restored operator keys, when UAT resets its database and starts before another backup, then the retained key mode survives", async () => {
  // given
  const { resetUat, uatEnvironment } = await import("./courtside.mjs");
  const { restoreUatRecovery, createUatRecovery, verifyMfaKeyArchive } = await import("./mfa-key-custody.mjs");
  const directory = mkdtempSync(join(tmpdir(), "courtside-reset-key-mode-"));
  const backup = join(directory, "original");
  mkdirSync(join(backup, "provided"), { recursive: true });
  writeFileSync(join(backup, "provided/mfa.keys"), "format=1\n");
  writeFileSync(join(backup, "database.dump"), "PGDMP");
  assert.equal(spawnSync("tar", ["-C", backup, "-cf", join(backup, "mfa-keys.tar"), "./provided"]).status, 0);
  const stateFile = join(directory, "uat-state.json");
  const environment = { COURTSIDE_UAT_PROJECT: "courtside-uat-key-mode", COURTSIDE_UAT_IMAGE: "courtside:uat-local" };
  try {
    const mfaKeyFile = restoreUatRecovery(backup, ["compose", "-p", environment.COURTSIDE_UAT_PROJECT], environment, () => {});
    writeFileSync(stateFile, JSON.stringify({ image: "courtside:uat-local", mfaKeyFile, dbPort: false }));
    // when
    resetUat(false, { environment, stateFile, cleanupFunnel: () => {}, execute: () => {} });
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    const startup = uatEnvironment(undefined, "", environment, state);
    createUatRecovery(join(directory, "next"), [], startup, (plan) => {
      if (plan.args.includes("pg_dump")) writeFileSync(plan.stdout, "PGDMP");
      else {
        assert.equal(plan.environment.COURTSIDE_UAT_MFA_KEY_FILE, mfaKeyFile);
        writeFileSync(plan.stdout, readFileSync(join(backup, "mfa-keys.tar")));
      }
    });
    // then
    assert.equal(startup.COURTSIDE_UAT_MFA_KEY_FILE, mfaKeyFile);
    assert.equal(verifyMfaKeyArchive(join(directory, "next/mfa-keys.tar")), "provided");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given two independent UAT instances, when a share is planned, then readiness and the Funnel both address the selected instance", async () => {
  // given
  const { funnelPlan, isUatShareReady, uatFunnelAssociation } = await import("./courtside.mjs");
  const first = { COURTSIDE_UAT_PROJECT: "courtside-uat", COURTSIDE_UAT_SHARED_PORT: "8083" };
  const second = { COURTSIDE_UAT_PROJECT: "courtside-uat-second", COURTSIDE_UAT_SHARED_PORT: "9083", COURTSIDE_UAT_HTTPS_PORT: "9443" };
  const probes = [];
  const container = { Id: "a".repeat(64), Config: { Labels: { "com.docker.compose.project": second.COURTSIDE_UAT_PROJECT, "com.docker.compose.service": "proxy" } },
    State: { Running: true }, NetworkSettings: { Ports: { "8083/tcp": [{ HostIp: "127.0.0.1", HostPort: "9083" }] } } };
  const capture = (plan) => {
    if (plan.args[0] === "inspect") return JSON.stringify([container]);
    assert.equal(plan.args[plan.args.indexOf("-p") + 1], second.COURTSIDE_UAT_PROJECT);
    assert.equal(plan.args.at(-1), "proxy");
    return container.Id;
  };
  // when
  const ready = await isUatShareReady(second, async (options) => { probes.push(options.port); return { statusCode: options.port === 9083 ? 200 : 503 }; }, capture);
  // then
  assert.equal(ready, true);
  assert.deepEqual(probes, [9083]);
  assert.equal(funnelPlan("tailscale", first).args.at(-1), "http://127.0.0.1:8083");
  assert.equal(funnelPlan("tailscale", second).args.at(-1), "http://127.0.0.1:9083");
  assert.deepEqual(uatFunnelAssociation(second), { project: "courtside-uat-second", sharedPort: 9083, httpsPort: 9443, target: "http://127.0.0.1:9083" });
});

test("given another UAT project's healthy ingress on the selected port, when sharing a project without its own proxy, then neither origin nor Funnel is published", async () => {
  // given
  const { shareUat, isUatShareReady, classifyFunnelConfig } = await import("./courtside.mjs");
  const environment = { COURTSIDE_UAT_PROJECT: "courtside-uat-second", COURTSIDE_UAT_SHARED_PORT: "8083", COURTSIDE_UAT_HTTPS_PORT: "9443" };
  const calls = [];
  const capture = (plan) => {
    assert.equal(plan.args[plan.args.indexOf("-p") + 1], environment.COURTSIDE_UAT_PROJECT);
    return "";
  };
  const runtime = { environment, readMarker: () => undefined, removeMarker: () => {},
    locate: () => ({ command: "tailscale", status: JSON.stringify({ BackendState: "Running", Self: { ID: "node-example", DNSName: "uat.example.ts.net.", CapMap: { https: true, funnel: true } } }) }),
    readConfig: (_command, stored, node, env) => classifyFunnelConfig("{}", stored, node, env),
    ready: (env) => isUatShareReady(env, async () => { calls.push("foreign-http"); return { statusCode: 200 }; }, capture),
    start: () => calls.push("start"), configure: () => calls.push("origin"), writeMarker: () => calls.push("marker"),
    supervise: async () => calls.push("funnel") };
  // when / then
  await assert.rejects(shareUat(runtime), /ingress is not ready/);
  assert.deepEqual(calls, ["start"]);
});

test("given an unrelated or misbound proxy, when UAT sharing probes readiness, then Docker ownership and published ports must match before HTTP", async () => {
  // given
  const { isUatShareReady } = await import("./courtside.mjs");
  const environment = { COURTSIDE_UAT_PROJECT: "courtside-uat-second", COURTSIDE_UAT_SHARED_PORT: "9083" };
  const selected = "a".repeat(64);
  const proxy = { Id: selected, Config: { Labels: { "com.docker.compose.project": environment.COURTSIDE_UAT_PROJECT, "com.docker.compose.service": "proxy" } },
    State: { Running: true }, NetworkSettings: { Ports: { "8083/tcp": [{ HostIp: "127.0.0.1", HostPort: "9083" }] } } };
  const invalid = [
    { ...proxy, Id: "b".repeat(64) },
    { ...proxy, Config: { Labels: { ...proxy.Config.Labels, "com.docker.compose.project": "courtside-uat" } } },
    { ...proxy, Config: { Labels: { ...proxy.Config.Labels, "com.docker.compose.service": "app" } } },
    { ...proxy, State: { Running: false } },
    { ...proxy, NetworkSettings: { Ports: { "8083/tcp": [{ HostIp: "127.0.0.1", HostPort: "8083" }] } } },
    { ...proxy, NetworkSettings: { Ports: { "8083/tcp": [{ HostIp: "0.0.0.0", HostPort: "9083" }] } } }
  ];
  let requests = 0;
  // when / then
  for (const container of invalid) {
    const ready = await isUatShareReady(environment, async () => { requests++; return { statusCode: 200 }; },
      (plan) => plan.args[0] === "inspect" ? JSON.stringify([container]) : selected);
    assert.equal(ready, false);
  }
  assert.equal(requests, 0);
});

test("given a second UAT project, when its share starts, then only its origin and ingress are published", async () => {
  // given
  const { shareUat, classifyFunnelConfig } = await import("./courtside.mjs");
  const environment = { COURTSIDE_UAT_PROJECT: "courtside-uat-second", COURTSIDE_UAT_SHARED_PORT: "9083", COURTSIDE_UAT_HTTPS_PORT: "9443" };
  const calls = [];
  let marker;
  const runtime = {
    environment, readMarker: () => marker, removeMarker: () => { marker = undefined; },
    locate: () => ({ command: "tailscale", status: JSON.stringify({ BackendState: "Running", Self: { ID: "node-example", DNSName: "uat.example.ts.net.", CapMap: { https: true, funnel: true } } }) }),
    readConfig: (_command, stored, node, env) => classifyFunnelConfig("{}", stored, node, env),
    ready: async (env) => { calls.push(["ready", env.COURTSIDE_UAT_SHARED_PORT]); return true; },
    configure: (origin, env) => calls.push(["origin", origin, env.COURTSIDE_UAT_PROJECT]),
    writeMarker: (value) => { marker = value; },
    supervise: async (plan) => calls.push(["target", plan.args.at(-1)])
  };
  // when
  await shareUat(runtime);
  // then
  assert.deepEqual(calls, [["ready", "9083"], ["ready", "9083"], ["origin", "https://uat.example.ts.net", "courtside-uat-second"], ["target", "http://127.0.0.1:9083"]]);
  assert.equal(marker.project, "courtside-uat-second");
  assert.equal(marker.sharedPort, 9083);
});

test("given a stale or foreign share association, when another project shares or cleans up, then neither ingress nor any origin changes", async () => {
  // given
  const { shareUat, cleanupUatFunnel } = await import("./courtside.mjs");
  const environment = { COURTSIDE_UAT_PROJECT: "courtside-uat-second", COURTSIDE_UAT_SHARED_PORT: "9083", COURTSIDE_UAT_HTTPS_PORT: "9443" };
  const foreign = { project: "courtside-uat", sharedPort: 8083, httpsPort: 8443, target: "http://127.0.0.1:8083", nodeId: "node-example" };
  const wrongPort = { ...foreign, project: "courtside-uat-second" };
  const calls = [];
  const runtime = { environment, readMarker: () => foreign, configure: () => calls.push("origin"), removeMarker: () => calls.push("remove"),
    locate: () => { calls.push("tailscale"); throw new Error("unexpected Tailscale mutation"); } };
  // when / then
  await assert.rejects(shareUat(runtime), /association/);
  cleanupUatFunnel(undefined, runtime);
  assert.throws(() => cleanupUatFunnel(true, { ...runtime, readMarker: () => wrongPort }), /association/);
  assert.deepEqual(calls, []);
});

test("given the selected UAT share, when cleanup runs, then it resets that ingress and restores only that instance's local origin", async () => {
  // given
  const { cleanupUatFunnel, classifyFunnelConfig, uatFunnelAssociation } = await import("./courtside.mjs");
  const environment = { COURTSIDE_UAT_PROJECT: "courtside-uat-second", COURTSIDE_UAT_SHARED_PORT: "9083", COURTSIDE_UAT_HTTPS_PORT: "9443" };
  const marker = { ...uatFunnelAssociation(environment), nodeId: "node-example", publicUrl: "https://uat.example.ts.net" };
  const status = JSON.stringify({ TCP: { "443": { HTTPS: true } }, Web: { "uat.example.ts.net:443": { Handlers: { "/": { Proxy: marker.target } } } }, AllowFunnel: { "uat.example.ts.net:443": true } });
  const calls = [];
  const runtime = { environment, readMarker: () => marker,
    locate: () => ({ command: "tailscale", status: JSON.stringify({ Self: { ID: "node-example" } }) }),
    readConfig: (_command, stored, node, env) => classifyFunnelConfig(status, stored, node, env),
    execute: (_command, args) => { calls.push(args); return { status: 0 }; },
    configure: (url, env) => calls.push([url, env.COURTSIDE_UAT_PROJECT]), removeMarker: () => calls.push(["remove"])
  };
  // when
  cleanupUatFunnel(true, runtime);
  // then
  assert.deepEqual(calls, [["funnel", "reset"], ["https://localhost:9443", "courtside-uat-second"], ["remove"]]);
  const wrongPort = status.replace("127.0.0.1:9083", "127.0.0.1:8083");
  calls.length = 0;
  assert.throws(() => cleanupUatFunnel(true, { ...runtime, readConfig: (_command, stored, node, env) => classifyFunnelConfig(wrongPort, stored, node, env) }), /no longer belongs/);
  assert.deepEqual(calls, []);
});

test("given a disposable SECURITY target, when native WebAuthn options are created, then its RP uses the configured HTTPS port", () => {
  // given
  const compose = yaml.parse(read("deploy/compose.security.yaml"));
  // when / then
  assert.equal(compose.services.app.environment.COURTSIDE_PUBLIC_URL,
    "https://localhost:${COURTSIDE_SECURITY_HTTPS_PORT:?required}");
});

function recoverySource(directory, name, content) {
  const source = join(directory, name);
  mkdirSync(join(source, "provided"), { recursive: true });
  writeFileSync(join(source, "provided/mfa.keys"), `format=1\n${content}\n`, { mode: 0o600 });
  writeFileSync(join(source, "database.dump"), `PGDMP-${content}`, { mode: 0o600 });
  assert.equal(spawnSync("tar", ["-C", source, "-cf", join(source, "mfa-keys.tar"), "./provided"]).status, 0);
  return source;
}

for (const change of ["a symlinked directory", "replaced files", "in place writes"]) {
  test(`given ${change} after recovery validation, when the target restore reads its input, then it consumes exactly the validated database and key bytes`, async () => {
    // given
    const { restoreUatRecovery } = await import("./mfa-key-custody.mjs");
    const directory = mkdtempSync(join(tmpdir(), "courtside-recovery-swap-"));
    const source = recoverySource(directory, "source", "original");
    const replacement = recoverySource(directory, "replacement", "changed");
    const originalDatabase = readFileSync(join(source, "database.dump"));
    const originalKeys = readFileSync(join(source, "mfa-keys.tar"));
    const target = "courtside-uat-owned-race-proof";
    const databases = [];
    const keys = [];
    const execute = (plan) => {
      if (plan.stdin !== undefined) {
        const received = readFileSync(plan.stdin);
        if (plan.args.includes("db")) databases.push(received);
        else keys.push(received);
      }
      if (plan.args.includes("down")) {
        if (change === "a symlinked directory") {
          renameSync(source, join(directory, "retained"));
          symlinkSync(replacement, source, "dir");
        } else {
          for (const file of ["database.dump", "mfa-keys.tar"]) {
            if (change === "replaced files") rmSync(join(source, file));
            writeFileSync(join(source, file), readFileSync(join(replacement, file)));
          }
        }
      }
    };
    try {
      // when
      restoreUatRecovery(source, ["compose", "-p", target], { COURTSIDE_UAT_IMAGE: "courtside:uat-local" }, execute);
      // then
      assert.equal(databases.length, 2);
      assert.equal(keys.length, 2);
      assert.deepEqual(databases, [originalDatabase, originalDatabase]);
      assert.deepEqual(keys, [originalKeys, originalKeys]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("given an archive replaced between native tar checks, when key mode is verified, then both checks read the same private bytes", async () => {
  // given
  const { verifyMfaKeyArchive } = await import("./mfa-key-custody.mjs");
  const { execFileSync } = await import("node:child_process");
  const directory = mkdtempSync(join(tmpdir(), "courtside-archive-swap-"));
  const source = recoverySource(directory, "source", "original");
  const replacement = recoverySource(directory, "replacement", "changed");
  const archive = join(source, "mfa-keys.tar");
  const expected = readFileSync(archive);
  const observed = [];
  const execute = (command, args, options) => {
    observed.push(readFileSync(args[1]));
    const result = execFileSync(command, args, options);
    if (observed.length === 1) writeFileSync(archive, readFileSync(join(replacement, "mfa-keys.tar")));
    return result;
  };
  try {
    // when
    assert.equal(verifyMfaKeyArchive(archive, execute), "provided");
    // then
    assert.deepEqual(observed, [expected, expected]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const linked of ["directory", "database.dump", "mfa-keys.tar"]) {
  test(`given a linked ${linked} recovery input, when restore captures the source, then no target or probe command runs`, async () => {
    // given
    const { restoreUatRecovery } = await import("./mfa-key-custody.mjs");
    const directory = mkdtempSync(join(tmpdir(), "courtside-recovery-link-"));
    const source = recoverySource(directory, "source", "original");
    const replacement = recoverySource(directory, "replacement", "changed");
    let selected = source;
    if (linked === "directory") {
      selected = join(directory, "linked");
      symlinkSync(source, selected, "dir");
    } else {
      rmSync(join(source, linked));
      symlinkSync(join(replacement, linked), join(source, linked));
    }
    const calls = [];
    try {
      // when / then
      assert.throws(() => restoreUatRecovery(selected, [], {}, (plan) => calls.push(plan)), /symbolic link|regular file|ELOOP/);
      assert.equal(calls.length, 0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

for (const change of ["changed length", "same length overwrite"]) {
  test(`given ${change} during source capture, when recovery snapshots the open file, then it refuses before any environment command`, async () => {
    // given
    const { restoreUatRecovery } = await import("./mfa-key-custody.mjs");
    const fs = createRequire(import.meta.url)("node:fs");
    const directory = mkdtempSync(join(tmpdir(), "courtside-capture-write-"));
    const source = recoverySource(directory, "source", "original");
    const database = join(source, "database.dump");
    const before = fs.statSync(database, { bigint: true });
    const originalRead = fs.readSync;
    const calls = [];
    let changed = false;
    fs.readSync = (...args) => {
      const result = originalRead(...args);
      const metadata = fs.fstatSync(args[0], { bigint: true });
      if (!changed && metadata.dev === before.dev && metadata.ino === before.ino && result > 0) {
        changed = true;
        writeFileSync(database, "X".repeat(Number(before.size) + (change === "changed length" ? 1 : 0)));
        fs.utimesSync(database, new Date("2030-01-01T00:00:00Z"), new Date("2030-01-01T00:00:00Z"));
      }
      return result;
    };
    syncBuiltinESMExports();
    try {
      // when / then
      assert.throws(() => restoreUatRecovery(source, [], {}, (plan) => calls.push(plan)), /changed while being captured/);
      assert.equal(changed, true);
      assert.equal(calls.length, 0);
    } finally {
      fs.readSync = originalRead;
      syncBuiltinESMExports();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("given an archive changed after its native type check, when keys are imported independently, then the stream still contains only the checked bytes", async () => {
  // given
  const { importMfaKeys } = await import("./mfa-key-custody.mjs");
  const childProcess = createRequire(import.meta.url)("node:child_process");
  const originalExecute = childProcess.execFileSync;
  const directory = mkdtempSync(join(tmpdir(), "courtside-import-swap-"));
  const source = recoverySource(directory, "source", "original");
  const replacement = recoverySource(directory, "replacement", "changed");
  const archive = join(source, "mfa-keys.tar");
  const expected = readFileSync(archive);
  let changed = false;
  let received;
  childProcess.execFileSync = (command, args, options) => {
    const result = originalExecute(command, args, options);
    if (command === "tar" && args[0] === "-tvf") {
      writeFileSync(archive, readFileSync(join(replacement, "mfa-keys.tar")));
      changed = true;
    }
    return result;
  };
  syncBuiltinESMExports();
  try {
    // when
    importMfaKeys(archive, [], {}, (plan) => { received = readFileSync(plan.stdin); });
    // then
    assert.equal(changed, true);
    assert.deepEqual(received, expected);
  } finally {
    childProcess.execFileSync = originalExecute;
    syncBuiltinESMExports();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("given private archive inspection that fails, when verification unwinds, then no private snapshot remains", async () => {
  // given
  const { verifyMfaKeyArchive } = await import("./mfa-key-custody.mjs");
  const { existsSync, statSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "courtside-private-capture-"));
  const source = recoverySource(directory, "source", "original");
  let snapshot;
  try {
    // when / then
    assert.throws(() => verifyMfaKeyArchive(join(source, "mfa-keys.tar"), (_command, args) => {
      snapshot = args[1];
      assert.notEqual(snapshot, join(source, "mfa-keys.tar"));
      assert.equal(statSync(snapshot).mode & 0o777, 0o600);
      assert.equal(statSync(dirname(snapshot)).mode & 0o777, 0o700);
      throw new Error("archive inspection interrupted");
    }), /archive inspection interrupted/);
    assert.equal(existsSync(dirname(snapshot)), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test("given an older UAT dump, when the validated target is replaced, then schema cleanup and import share one transaction", async () => {
  // given
  const { restoreUatRecovery } = await import("./mfa-key-custody.mjs");
  const directory = mkdtempSync(join(tmpdir(), "courtside-legacy-restore-plan-"));
  const source = recoverySource(directory, "source", "legacy");
  let replacement;
  const execute = (plan) => {
    if (plan.args.includes("db") && plan.stdin !== undefined && plan.args.includes("--clean")) replacement = plan;
    if (plan.args.includes("db") && plan.args.includes("/bin/sh")) replacement = plan;
  };
  try {
    // when
    restoreUatRecovery(source, ["compose", "-p", "courtside-uat-owned-legacy"], { COURTSIDE_UAT_IMAGE: "courtside:uat-local" }, execute);
    // then
    assert.ok(replacement, "the validated backup must replace the target database");
    assert.equal(replacement.args[replacement.args.indexOf("db") + 1], "/bin/sh");
    const command = replacement.args.at(-1);
    assert.match(command, /pg_restore[^;]+--file=/);
    assert.match(command, /psql[^;]+--single-transaction/);
    assert.match(command, /ON_ERROR_STOP=1/);
    assert.match(command, /DROP SCHEMA public CASCADE; CREATE SCHEMA public;/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
