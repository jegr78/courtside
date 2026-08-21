import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  authenticatedZapDiagnostic,
  assertSecurityIdentity, assertSecurityRecoveryOwnership, assertSecurityStartAvailable, availableLoopbackPort, recoveryEnvironment,
  isMissingDockerResource,
  mergeSecurityProcessEnvironment,
  securityAssessmentReservationArgs, securityComposeArgs, securityDownPlan, securityEnvironment, securityProject,
  securityReservationArgs, securityStateFile
} from "./security-environment.mjs";

test("given security state and a host toolchain, when launching owned commands, then PATH survives and run values win", () => {
  // when
  const environment = mergeSecurityProcessEnvironment(
    { COURTSIDE_SECURITY_RUN_ID: "run-0001", PATH: "state-must-not-control-tools" },
    { PATH: "/trusted/bin", LANG: "en_US.UTF-8", COURTSIDE_SECURITY_RUN_ID: "foreign" });

  // then
  assert.equal(environment.PATH, "/trusted/bin");
  assert.equal(environment.LANG, "en_US.UTF-8");
  assert.equal(environment.COURTSIDE_SECURITY_RUN_ID, "run-0001");
});

test("given Docker cleanup inspection failures, when classifying absence, then only an explicit missing resource is accepted", () => {
  // when / then
  assert.equal(isMissingDockerResource(
    new Error("Owned security process failed (1): Error: No such object: scanner-one\n"), "scanner-one"), true);
  assert.equal(isMissingDockerResource(
    new Error("Owned security process exceeded its duration limit: "), "scanner-one"), false);
  assert.equal(isMissingDockerResource(
    new Error("Owned security process failed (1): permission denied"), "scanner-one"), false);
  assert.equal(isMissingDockerResource(
    new Error("Owned security process failed (1): Error: No such object: scanner-two\n"), "scanner-one"), false);
});

test("given parallel assessment runs, when naming projects, then their resources cannot collide", () => {
  // when / then
  assert.equal(securityProject("run-0001"), "courtside-security-run-0001");
  assert.notDeepEqual(securityComposeArgs("run-0001"), securityComposeArgs("run-0002"));
});

test("given a path-like run identity, when resolving private state, then it cannot leave the security root", () => {
  // when / then
  assert.throws(() => securityStateFile("../../outside"), /security run ID/);
});

test("given a security run, when deriving its identity, then secrets and seed identity are generated", () => {
  // when
  const image = `sha256:${"b".repeat(64)}`;
  const environment = securityEnvironment("run-0001", image, "synthetic-password-value", 23456);

  // then
  assert.equal(environment.COURTSIDE_SECURITY_IMAGE, image);
  assert.equal(environment.COURTSIDE_SECURITY_SHARED_PASSWORD, "synthetic-password-value");
  assert.equal(environment.COURTSIDE_SECURITY_HTTPS_PORT, "23456");
  assert.match(environment.COURTSIDE_SECURITY_SEED_FINGERPRINT, /^sha256:[a-f0-9]{64}$/);
  assert.match(environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT, /^sha256:[a-f0-9]{64}$/);
});

test("given a mismatched target, when verifying identity, then active use is rejected", () => {
  // given
  const expected = securityEnvironment("run-0001", `sha256:${"b".repeat(64)}`, "synthetic-password-value");

  // when / then
  assert.throws(() => assertSecurityIdentity({
    source: { environment: "SECURITY" },
    image: `sha256:${"b".repeat(64)}`,
    labels: {
      "org.courtside.environment": "SECURITY",
      "org.courtside.security.run-id": "run-0002",
      "org.courtside.security.seed-fingerprint": expected.COURTSIDE_SECURITY_SEED_FINGERPRINT,
      "org.courtside.security.instance-fingerprint": expected.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT
    }
  }, expected), /does not match/);
});

test("given a different running image, when verifying identity, then active use is rejected", () => {
  // given
  const expected = securityEnvironment("run-0001", `sha256:${"b".repeat(64)}`, "synthetic-password-value");

  // when / then
  assert.throws(() => assertSecurityIdentity({
    source: { environment: "SECURITY" },
    image: `sha256:${"c".repeat(64)}`,
    labels: {
      "org.courtside.environment": "SECURITY",
      "org.courtside.security.run-id": "run-0001",
      "org.courtside.security.seed-fingerprint": expected.COURTSIDE_SECURITY_SEED_FINGERPRINT,
      "org.courtside.security.instance-fingerprint": expected.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT
    }
  }, expected, `sha256:${"b".repeat(64)}`), /image does not match/);
});

test("given a mutable image tag, when preparing a security run, then startup is rejected", () => {
  // when / then
  assert.throws(() => securityEnvironment("run-0001", "courtside:latest"), /immutable image digest/);
  assert.throws(
    () => securityEnvironment("run-0001", `invalid @sha256:${"b".repeat(64)}`),
    /immutable image digest/,
  );
});

test("given parallel workspaces, when reserving loopback ports, then the operating system chooses usable ports", async () => {
  // when
  const first = await availableLoopbackPort();
  const second = await availableLoopbackPort();

  // then
  assert.ok(first > 0);
  assert.ok(second > 0);
});

test("given a reset, when planning cleanup, then only that run project is removed", () => {
  // when
  const plan = securityDownPlan("run-0001");

  // then
  assert.ok(plan.args.includes("courtside-security-run-0001"));
  assert.deepEqual(plan.args.slice(-3), ["down", "--volumes", "--remove-orphans"]);
});

test("given lost private state, when preparing recovery, then Compose interpolation remains possible", () => {
  // when
  const environment = recoveryEnvironment("run-0001");

  // then
  assert.equal(environment.COURTSIDE_SECURITY_RUN_ID, "run-0001");
  assert.match(environment.COURTSIDE_SECURITY_IMAGE, /^sha256:[a-f0-9]{64}$/);
  assert.match(environment.COURTSIDE_SECURITY_SEED_FINGERPRINT, /^sha256:[a-f0-9]{64}$/);
  assert.ok(environment.COURTSIDE_SECURITY_SHARED_PASSWORD.length >= 16);
});

test("given recovery resources, when one label differs, then cleanup is rejected", () => {
  // given
  const expected = {
    runId: "run-0001",
    seedFingerprint: `sha256:${"b".repeat(64)}`,
    instanceFingerprint: `sha256:${"d".repeat(64)}`
  };
  const labels = {
    "com.docker.compose.project": "courtside-security-run-0001",
    "org.courtside.environment": "SECURITY",
    "org.courtside.security.run-id": "run-0001",
    "org.courtside.security.seed-fingerprint": expected.seedFingerprint,
    "org.courtside.security.instance-fingerprint": expected.instanceFingerprint
  };

  // when / then
  assert.doesNotThrow(() => assertSecurityRecoveryOwnership([
    { type: "container", id: "own-container", labels },
    { type: "network", id: "own-network", labels }
  ], expected));
  assert.throws(() => assertSecurityRecoveryOwnership([
    { type: "container", id: "foreign-container", labels: {
      ...labels, "org.courtside.security.seed-fingerprint": `sha256:${"c".repeat(64)}`
    } }
  ], expected), /does not belong/);
});

test("given an existing run identity, when starting an environment, then no resource can be changed", () => {
  // when / then
  assert.doesNotThrow(() => assertSecurityStartAvailable([], false, false));
  assert.throws(() => assertSecurityStartAvailable([
    { type: "network", id: "existing-network", labels: {} }
  ], false, false), /already exists/);
  assert.throws(() => assertSecurityStartAvailable([], true, false), /already exists/);
  assert.throws(() => assertSecurityStartAvailable([], false, true), /already exists/);
});

test("given a new run instance, when reserving it, then Docker create is globally atomic", () => {
  // given
  const environment = securityEnvironment("run-0001", `sha256:${"b".repeat(64)}`);

  // when
  const args = securityReservationArgs(environment);

  // then
  assert.deepEqual(args.slice(0, 5), ["create", "--pull", "never", "--name",
    "courtside-security-reservation-run-0001"]);
  assert.ok(args.includes(`org.courtside.security.instance-fingerprint=${environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT}`));
});

test("given parallel attempts for one run, when reserving scanner access, then only one global name can exist", () => {
  // given
  const environment = securityEnvironment("run-0001", `sha256:${"b".repeat(64)}`);

  // when
  const first = securityAssessmentReservationArgs(environment, 1);
  const second = securityAssessmentReservationArgs(environment, 2);

  // then
  assert.equal(first[first.indexOf("--name") + 1], "courtside-security-assessment-run-0001");
  assert.equal(second[second.indexOf("--name") + 1], "courtside-security-assessment-run-0001");
  assert.ok(first.includes("org.courtside.security.attempt=1"));
  assert.ok(second.includes("org.courtside.security.attempt=2"));
});

test("given the security Compose file, when inspecting boundaries, then resources are bounded and internal", () => {
  // given
  const compose = readFileSync(fileURLToPath(new URL("../deploy/compose.security.yaml", import.meta.url)), "utf8");

  // when / then
  assert.match(compose, /127\.0\.0\.1:\$\{COURTSIDE_SECURITY_HTTPS_PORT:\?required\}:443/);
  assert.equal((compose.match(/internal: true/g) ?? []).length, 4);
  assert.equal((compose.match(/pull_policy: never/g) ?? []).length, 6);
  assert.equal((compose.match(/org\.courtside\.security\.run-id:/g) ?? []).length, 11);
  assert.equal((compose.match(/org\.courtside\.security\.instance-fingerprint:/g) ?? []).length, 11);
  assert.match(compose, /\/var\/lib\/postgresql\/data:size=512m/);
  assert.match(compose, /https:\/\/localhost\/api\/source/);
  assert.match(compose, /zaproxy\/zap-stable:2\.16\.1@sha256:[a-f0-9]{64}/);
  assert.match(compose, /profiles: \[assessment\]/);
  assert.match(compose, /\/zap\/wrk:uid=1000,gid=1000,mode=0700,size=25m/);
  assert.match(compose, /zap:[\s\S]*networks:[\s\S]*- scanner-client/);
  assert.match(compose, /scanner-gateway:[\s\S]*- scanner-client[\s\S]*- scanner-upstream/);
  assert.match(compose, /proxy:[\s\S]*networks:[\s\S]*- scanner-upstream/);
  assert.doesNotMatch(compose, /zap:[\s\S]*networks:[\s\S]*- frontend/);
  assert.doesNotMatch(compose, /^volumes:/m);
});

test("given the scanner gateway, when enforcing budgets, then target access is counted synchronously", () => {
  // given
  const gateway = readFileSync(fileURLToPath(new URL("./security-request-gateway.py", import.meta.url)), "utf8");

  // when / then
  assert.match(gateway, /request_count >= MAX_REQUESTS/);
  assert.match(gateway, /concurrency\.acquire\(blocking=False\)/);
  assert.match(gateway, /UPSTREAM_HOST = "proxy"/);
});

test("given an active scanner boundary, when checking targets, then methods paths and origins fail closed", () => {
  // given
  const gateway = fileURLToPath(new URL("./security-request-gateway.py", import.meta.url));
  const script = `
import importlib.util
import urllib.parse
spec = importlib.util.spec_from_file_location("gateway", ${JSON.stringify(gateway)})
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)
assert gateway.target_allowed(urllib.parse.urlsplit("http://scanner-gateway:8090/api/cards"), "GET")
assert not gateway.target_allowed(urllib.parse.urlsplit("http://foreign.example/api/cards"), "GET")
assert not gateway.target_allowed(urllib.parse.urlsplit("http://secret@scanner-gateway:8090/api/cards"), "GET")
assert not gateway.target_allowed(urllib.parse.urlsplit("http://scanner-gateway:8090/api/admin/courts"), "GET")
assert not gateway.target_allowed(urllib.parse.urlsplit("http://scanner-gateway:8090/api/cards"), "POST")
assert not gateway.target_allowed(urllib.parse.urlsplit("/api/cards?value=" + "x" * 4096), "GET")
assert not gateway.target_allowed(urllib.parse.urlsplit("/api/cards/../admin"), "GET")
assert not gateway.target_allowed(urllib.parse.urlsplit("/api/cards/%2e%2e/admin"), "GET")
assert not gateway.target_allowed(urllib.parse.urlsplit("/api/cards/%252e%252e/admin"), "GET")
assert not gateway.target_allowed(urllib.parse.urlsplit("/api/cards\\..\\admin"), "GET")
`;

  // when
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8", env: {
    ...process.env,
    COURTSIDE_SECURITY_MAX_REQUESTS: "100",
    COURTSIDE_SECURITY_MAX_CONCURRENCY: "1",
    COURTSIDE_SECURITY_ALLOWED_METHODS: "GET,HEAD",
    COURTSIDE_SECURITY_ALLOWED_PATH_PREFIXES: "/api/cards",
    COURTSIDE_SECURITY_MAX_TARGET_BYTES: "1024",
    PYTHONDONTWRITEBYTECODE: "1"
  } });

  // then
  assert.equal(result.status, 0, result.stderr);
});

test("given scanner diagnostics, when reporting a failed run, then session material is removed", () => {
  // given
  const cookie = "SESSION=opaque-session; XSRF-TOKEN=opaque-csrf";

  // when
  const diagnostic = authenticatedZapDiagnostic(
    `Automation failed http://scanner-gateway:8090/api/reset/opaque-path?token=opaque-query\n`
      + `Cookie: ${cookie}\nAuthorization: Bearer opaque-token\npassword=opaque-password`, [cookie]);

  // then
  assert.doesNotMatch(diagnostic, /opaque-session|opaque-csrf|opaque-token|opaque-password|opaque-path|opaque-query/);
  assert.match(diagnostic, /\[REDACTED]/);
});
