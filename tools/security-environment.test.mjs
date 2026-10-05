import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { zapVersion } from "./security-passive-deployment.mjs";
import { openApiFuzzPolicy, openApiFuzzVersion } from "./security-openapi-fuzz.mjs";
import { readFileSync, writeFileSync, symlinkSync, realpathSync, mkdtempSync, mkdirSync, chmodSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createResourceEvidence, writeNativeEvidence, retainResourceEvidenceFailure } from "./security-resource-runtime.mjs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import vm from "node:vm";
import { createHash } from "node:crypto";
import {
  authenticatedZapDiagnostic,
  assertSecurityIdentity, assertSecurityRecoveryOwnership, assertSecurityStartAvailable, availableLoopbackPort,
  evaluateRuntimeFilePermissions, recoveryEnvironment,
  isMissingDockerResource,
  mergeSecurityProcessEnvironment,
  prometheusMetric,
  remainingScannerRequestBudget,
  resourceAuthenticationPolicy,
  resourcePublicationPolicy,
  resourcePublicationProjection,
  resourceSessionDecoderPlan,
  relayableMethods,
  securityEnvironmentReadyMessage,
  securityAssessmentReservationArgs, securityComposeArgs, securityDownPlan, securityEnvironment, securityProject,
  assertFixtureImageDerivation, fixtureImageBase,
  securityFixturesImageTag,
  securitySeedImageTag, securitySeedPlan, seedSecurityEnvironment,
  securityReservationArgs, securityStateFile
} from "./security-environment.mjs";
import { fixtureImagePlan } from "./fixture-artifact.mjs";

const yaml = createRequire(new URL("../frontend/package.json", import.meta.url))("js-yaml");

function publicationPolicyFixture() {
  return { runtime: { Config: { Env: [], Entrypoint: ["java", "org.springframework.boot.loader.launch.JarLauncher"], Cmd: null } },
    application: yaml.load(readFileSync(new URL("../src/main/resources/application.yaml", import.meta.url), "utf8")),
    classpath: '- "BOOT-INF/lib/spring-modulith-events-jdbc-2.1.1.jar"\n' };
}

test("given the actual native application YAML and approved diagnostic heap flags, when repository policy binds, then legitimate schema initialization false and trust options remain supported", () => {
  // given
  const f = publicationPolicyFixture();
  f.runtime.Config.Entrypoint.splice(1, 0, "--sun-misc-unsafe-memory-access=deny", "-XX:MaxRAMPercentage=75.0", "-XX:+ExitOnOutOfMemoryError");
  f.runtime.Config.Env.push("JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStore=/trust/mail.p12 -Djavax.net.ssl.trustStorePassword=changeit -Djavax.net.ssl.trustStoreType=PKCS12");
  // when
  const result = resourcePublicationPolicy(f.runtime, f.application, f.classpath);
  // then
  assert.equal(result.repositoryMode, "JDBC_V2");
});

for (const legacy of [undefined, false]) {
  test(`given native default or explicit legacy false ${legacy}, when publication policy binds, then only the closed JDBC V2 delete mode is accepted`, () => {
    // given
    const f = publicationPolicyFixture();
    f.application.spring.modulith.events.jdbc = legacy === undefined ? {} : { "use-legacy-structure": legacy };
    // when
    const policy = resourcePublicationPolicy(f.runtime, f.application, f.classpath);
    // then
    assert.deepEqual(policy, { completionMode: "DELETE", repositoryMode: "JDBC_V2",
      repositoryJarPath: "/app/BOOT-INF/lib/spring-modulith-events-jdbc-2.1.1.jar" });
  });
}

for (const legacy of [true, "false", null, 0, "${LEGACY:false}"]) {
  test(`given an unsupported legacy setting ${JSON.stringify(legacy)}, when publication policy binds, then it refuses before native assessment`, () => {
    // given
    const f = publicationPolicyFixture();
    f.application.spring.modulith.events.jdbc = { "use-legacy-structure": legacy };
    // when / then
    assert.throws(() => resourcePublicationPolicy(f.runtime, f.application, f.classpath));
  });
}

for (const override of ["SPRING_MODULITH_EVENTS_JDBC_USELEGACYSTRUCTURE=true", "SPRING_APPLICATION_JSON={}",
  "SPRING_CONFIG_IMPORT=optional:file:/example", "SPRING_PROFILES_ACTIVE=other", "JAVA_TOOL_OPTIONS=-Dspring.modulith.events.jdbc.use-legacy-structure=true",
  "JDK_JAVA_OPTIONS=-Dspring.modulith.events.jdbc.use-legacy-structure=true", "_JAVA_OPTIONS=-Dspring.modulith.events.jdbc.use-legacy-structure=true"]) {
  test(`given a publication override ${override.split("=")[0]}, when effective policy binds, then it fails closed`, () => {
    // given
    const f = publicationPolicyFixture();
    f.runtime.Config.Env.push(override);
    // when / then
    assert.throws(() => resourcePublicationPolicy(f.runtime, f.application, f.classpath));
  });
}

test("given command overrides duplicate environment or ambiguous native JDBC libraries, when publication policy binds, then it refuses their unknown effective settings", () => {
  // given
  const mutations = [f => { f.runtime.Config.Cmd = ["--spring.modulith.events.jdbc.use-legacy-structure=true"]; },
    f => { f.runtime.Config.Entrypoint.splice(1, 0, "-Dspring.modulith.events.jdbc.use-legacy-structure=true"); },
    f => { f.runtime.Config.Env = ["EXAMPLE=one", "EXAMPLE=two"]; },
    f => { f.classpath += f.classpath; }, f => { f.classpath = f.classpath.replace("2.1.1", "2.2.0"); },
    f => { f.application.spring.modulith.events.jdbc = { schema: "other" }; },
    f => { f.runtime.Config.Entrypoint.splice(1, 0, "-XX:MaxRAMPercentage=50.0", "-XX:MaxRAMPercentage=75.0"); }];
  // when / then
  for (const mutate of mutations) {
    const f = publicationPolicyFixture();
    mutate(f);
    assert.throws(() => resourcePublicationPolicy(f.runtime, f.application, f.classpath));
  }
});

test("given flattened settings or alternative Spring configuration sources, when repository policy binds, then unobserved legacy overrides cannot qualify", () => {
  // given
  const mutations = [f => { f.runtime.Config.Env = ["spring.modulith.events.jdbc.use-legacy-structure=true"]; },
    f => { f.application.spring.config = { import: "optional:file:/example" }; },
    f => { f.application.spring.profiles = { active: "example" }; },
    f => { f.application.spring["modulith.events.jdbc.use-legacy-structure"] = true; },
    f => { f.application.spring.modulith.events["jdbc.use-legacy-structure"] = true; },
    f => { f.application.spring.modulith["events.jdbc.use-legacy-structure"] = true; }];
  // when / then
  for (const mutate of mutations) {
    const f = publicationPolicyFixture();
    mutate(f);
    assert.throws(() => resourcePublicationPolicy(f.runtime, f.application, f.classpath));
  }
});

function startupFailureHarness({ captureFailure = false, cleanupFailure = false, portConflict = false } = {}) {
  const source = readFileSync(new URL("./security-environment.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export async function startSecurityEnvironment(");
  const end = source.indexOf("\nexport function fixtureImageBase", start);
  const body = source.slice(start, end).replace("export async function", "async function");
  const events = [];
  const captureAttempts = [];
  const failure = Object.assign(new Error("native private startup error"), { stderr: portConflict ? "port is already allocated" : "seeder failed" });
  const environment = securityEnvironment("run-0001", `sha256:${"a".repeat(64)}`);
  const commandEvents = [];
  const context = { events, failure, process: { env: {}, stdout: { write: () => {} } },
    stateRoot: "/private/security", root: "/repo", join, chmodSync: () => {},
    assertSecurityStartAvailable: () => {}, securityProjectResources: () => [], existsSync: () => false,
    securityStateFile: () => "/private/state", securityIdentityFile: () => "/private/identity",
    securityEnvironment: () => environment, randomBytes: () => Buffer.from("opaque"), availableLoopbackPort: async () => 12345,
    reserveSecurityEnvironment: () => events.push("reserve"), writeState: () => {},
    createSecurityMailCertificate: () => ({ fingerprint: "native" }), securityMailTrustPlan: () => ({ command: "docker", args: ["trust"] }),
    buildSecurityFixturesImage: () => {}, securityComposeArgs: () => ["compose"],
    execute: (command, args) => { if (args.includes("up")) { events.push("startup-failed"); throw failure; } },
    captureSecurityStartupDiagnostics: input => {
      events.push("capture");
      captureAttempts.push(input.attempt);
      assert.equal(input.directory, "/private/security/run-0001");
      assert.deepEqual(JSON.parse(JSON.stringify(input.identity)), { runId: "run-0001",
        seedFingerprint: environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
        instanceFingerprint: environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT });
      const native = input.command(["logs", "native-id"], { timeoutMilliseconds: 1000, outputLimitBytes: 4096 });
      assert.equal(native.stderr.toString(), "native JVM stderr");
      assert.equal(native.stdout.toString(), "native JVM stdout");
      if (captureFailure) throw new Error("raw capture error");
      return { outcome: "captured" };
    },
    spawnSync: (command, args, options) => {
      commandEvents.push({ command, args, options });
      return { status: 0, signal: null, stdout: Buffer.from("native JVM stdout"), stderr: Buffer.from("native JVM stderr") };
    },
    removeOwnedSecurityEnvironment: () => { events.push("cleanup"); if (cleanupFailure) throw new Error("raw cleanup error"); },
    verifySecurityEnvironment: () => { throw new Error("must not verify after failure"); }, writeIdentity: () => {} };
  vm.createContext(context);
  vm.runInContext(body + "\nthis.start = startSecurityEnvironment;", context);
  return { failure, events, commandEvents, captureAttempts, run: () => context.start("run-0001", `sha256:${"a".repeat(64)}`) };
}

for (const scenario of [{}, { captureFailure: true }, { cleanupFailure: true, portConflict: true }]) {
  test(`given a native startup failure with capture failure ${!!scenario.captureFailure} and cleanup failure ${!!scenario.cleanupFailure}, when handling it, then capture before cleanup and preserve the original primary error`, async () => {
    // given
    const harness = startupFailureHarness(scenario);
    // when / then
    await assert.rejects(harness.run(), error => error === harness.failure);
    assert.deepEqual(harness.events, ["reserve", "startup-failed", "capture", "cleanup"]);
    const native = harness.commandEvents[0];
    assert.equal(native.command, "docker");
    assert.equal(native.options.timeout, 1000);
    assert.equal(native.options.maxBuffer, 4096);
    assert.deepEqual(JSON.parse(JSON.stringify(native.options.stdio)), ["ignore", "pipe", "pipe"]);
    assert.equal(harness.failure.startupDiagnostics.outcome, scenario.captureFailure ? "incomplete" : "captured");
    assert.equal(harness.failure.startupCleanup, scenario.cleanupFailure ? "failed" : "passed");
  });
}
test("given three native startup port conflicts, when retrying with successful cleanup, then retain separate diagnostics before every owned removal and preserve the last original error", async () => {
  // given
  const harness = startupFailureHarness({ portConflict: true });
  // when / then
  await assert.rejects(harness.run(), error => error === harness.failure);
  assert.deepEqual(harness.events, Array.from({ length: 3 }, () => ["reserve", "startup-failed", "capture", "cleanup"]).flat());
  assert.equal(harness.commandEvents.length, 3);
  assert.deepEqual(harness.captureAttempts, [1, 2, 3]);
});

function resourceIntegrationHarness({ processFailure = false, effectsOutcome = "passed", recoveryProof, decoderFailure = false, foreignDecoder = false,
  malformedSummary = false, missingTelemetry = false, missingGatewayReceipt = false, evidenceMegabytes = 200,
  imageReference = `sha256:${"a".repeat(64)}`, runtimeImageId = `sha256:${"a".repeat(64)}`, runtimeOverride = {},
  privateRoot, earlyFailure, delayedPressure = false, oversizedBaseline = false,
  completionMode = "delete", publicationOverride = false, publicationOutput, publicationClassDrift = false, publicationJarDrift = false } = {}) {
  const calls = [];
  const writes = [];
  const events = [];
  const observations = [];
  const mailInputs = [];
  let releasePressure;
  const digest = `sha256:${"a".repeat(64)}`;
  const environment = { ...securityEnvironment("run-0001", imageReference), COURTSIDE_SECURITY_SHARED_PASSWORD: "private-password" };
  const imageDefaults = { Entrypoint: ["java", "org.springframework.boot.loader.launch.JarLauncher"], Cmd: null, User: "10001:10001" };
  const labels = { "org.courtside.environment": "SECURITY", "org.courtside.security.run-id": "run-0001",
    "com.docker.compose.project": "courtside-security-run-0001",
    "org.courtside.security.seed-fingerprint": environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
    "org.courtside.security.instance-fingerprint": environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT };
  const before = { schemaVersion: 1, tables: { user_account: { rows: [{ id: "10000000-0000-0000-0000-000000000001", username: "security.manager.1" }] },
    club_config: { rows: [{ time_zone: "Europe/Berlin" }] } } };
  const bookingId = "30000000-0000-0000-0000-000000000001";
  const duplicateId = "30000000-0000-0000-0000-000000000002";
  const operation = (key, status, responseBookingId) => ({ kind: "createBooking", status, responseBookingId,
    request: { idempotencyKey: key } });
  const gatewayReceipts = [{ operationId: "14:1", method: "POST", path: "/api/session", status: 413,
    bodyBytes: 2000001, contentType: "application/x-www-form-urlencoded", maximumBodyBytes: 2000000,
    forwarded: false, observedAt: "2026-10-05T10:00:00.000Z" }];
  const journal = { schemaVersion: 1, complete: true, captureComplete: true, operations: [
    operation("security-run-0001-1-0", 201, bookingId), operation("security-run-0001-2-0", 409, null),
    operation("security-run-0001-duplicate", 201, duplicateId), operation("security-run-0001-duplicate", 201, duplicateId),
    { kind: "createSeries", status: 200, seriesResult: { seriesId: null, bookingIds: [], skipped: ["2026-10-11T16:00:00Z"] } },
    { id: "14:1", kind: "gatewayRejectedBody", status: 413, method: "POST", path: "/api/session",
      request: { bodyBytes: 2000001, contentType: "application/x-www-form-urlencoded" } }
  ], ownedSessionIds: [], loginUsernames: [] };
  const source = readFileSync(new URL("./security-environment.mjs", import.meta.url), "utf8");
  const functionSource = source.slice(source.indexOf("export async function runResourceAbuse("), source.indexOf("async function resourceSample("))
    .replace("export async function", "async function").replaceAll("import.meta.url", JSON.stringify(import.meta.url));
  const context = { process: { env: {} }, root: "/workspace", stateRoot: privateRoot ?? "/private", createHash, Buffer, JSON, Date, URL,
    join: (...parts) => parts.join("/"), mkdirSync: (path, options) => writes.push({ path, mode: options.mode }),
    chmodSync: (path, mode) => writes.push({ path, mode }), writeFileSync: (path, value, options) => writes.push({ path, value, mode: options?.mode }),
    existsSync: () => false, readFileSync: () => "class-or-source", createRequire: () => () => yaml,
    lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false, mode: 0o700 }),
    createResourceEvidence: privateRoot ? createResourceEvidence : ({ maximumBytes }) => {
      if (maximumBytes <= 8192) throw new Error("resource-evidence-context-invalid");
      return {};
    },
    writeNativeEvidence: privateRoot ? writeNativeEvidence : (handle, entry) => writes.push(entry),
    retainResourceEvidenceFailure,
    securityProject, securityComposeArgs, securityAssessmentReservationArgs, resourceSessionDecoderPlan, resourceAuthenticationPolicy, resourcePublicationPolicy, resourcePublicationProjection,
    readSecurityEnvironment: () => environment, scannerRuntimeOwned: value => !value.foreign, scannerRuntimeHardened: () => true,
    assertFixtureImageDerivation: () => events.push("fixture-binding"),
    resourceSessionProjectionClassPaths: ["/app/BOOT-INF/classes/Projection.class"],
    mountedFileDigests: async (container, paths) => Object.fromEntries(paths.map(path => [path,
      container.includes("decoder") && (publicationClassDrift && path.endsWith("/BookingMailer.class")
        || publicationJarDrift && path.endsWith("/spring-modulith-events-jdbc-2.1.1.jar")) ? `sha256:${"b".repeat(64)}` : digest])),
    captureResourceState: async () => { events.push("before-snapshot"); return before; },
    captureSecurityMailBaseline: async input => { mailInputs.push(input); events.push("mail-baseline"); return { status: "complete", messageIds: [], ...(oversizedBaseline ? { privateRaw: "x".repeat(20000) } : {}) }; },
    resourceDatePlan: (snapshot, clock) => { assert.equal(snapshot, before); return { clock, timeZone: "Europe/Berlin", slots: {}, seriesStartsOn: "2026-11-04" }; },
    parseResourceJournal: raw => { assert.match(raw, /actual-private-journal/); events.push("journal"); if (earlyFailure === "parser") throw new Error("private parser failure"); return journal; },
    resourceIntegritySnapshotFingerprint: () => { if (earlyFailure === "before") throw new Error("private snapshot failure"); return digest; }, resourceAbuseIntegrityDigest: () => digest,
    captureResourceAuthentication: async (input, command) => {
      events.push("authentication");
      assert.equal(input.sourceAddress, "192.0.2.10");
      assert.equal(input.sessionPolicy.concurrentLimit, 5);
      assert.equal(typeof command, "function");
      return { outcome: input.runtimeBinding ? "passed" : "incomplete", authentication: {}, journal: input.journal, privateProof: {}, observations: [] };
    },
    observeResourceEffects: async input => { events.push("effects"); observations.push(input); assert.equal(input.before, before); assert.equal(input.journal, journal);
      assert.ok(Number.isSafeInteger(input.outerDeadlineMilliseconds));
      assert.ok(input.outerDeadlineMilliseconds > Date.now());
      assert.equal(input.contract.authentication.loginPolicy.sourceAddress, "192.0.2.10");
      assert.equal(typeof input.projectAuthentication, "function");
      assert.ok(input.evidenceHandle);
      assert.equal(input.nativeEvidence, undefined);
      assert.equal(input.evidenceLimitBytes, evidenceMegabytes * 1024 * 1024);
      assert.deepEqual(JSON.parse(JSON.stringify(input.journal.gatewayBodyRejections)), missingTelemetry || missingGatewayReceipt ? [] : gatewayReceipts);
      assert.equal(input.journal.gatewayBodyRejectionsComplete, !missingTelemetry && !missingGatewayReceipt);
      const projected = await input.projectAuthentication({ snapshot: before, command: context.runOwnedProcess });
      return { outcome: input.journal.complete && projected.outcome === "passed" ? effectsOutcome : "incomplete", beforeFingerprint: digest, afterFingerprint: digest, integrityEvidenceDigest: digest, journalDigest: digest,
        integrity: { beforeFingerprint: digest, afterFingerprint: digest,
          validatedBookingIdHashes: [bookingId, duplicateId].map(id => `sha256:${createHash("sha256").update(JSON.stringify(id)).digest("hex")}`) },
        competingWrites: { successful: 999, rejected: 1, partialOperations: 0, duplicateBookings: 1,
          duplicateResponses: 2, duplicateFailures: 0, toctouCreated: 0, toctouSkipped: 1 } }; },
    cleanupAndRecoverResourceRuntime: async ({ effects }) => { events.push("cleanup-recovery"); return { outcome: effects.outcome,
      cleanup: { outcome: effects.outcome, actualFingerprint: effects.outcome === "passed" ? digest : null },
      recovery: recoveryProof ?? { outcome: effects.outcome, actualFingerprint: effects.outcome === "passed" ? digest : null },
      integrityEvidenceDigest: digest }; },
    resourceSample: async () => { if (earlyFailure === "sample") throw new Error("private sample failure"); return {}; }, evaluateResourceSignals: () => ({ tripped: false }),
    evaluateSafetyLimits: () => ({ violated: false }), scannerGatewayMetrics: async () => {
      if (missingTelemetry) throw new Error("private metrics failure");
      return { requests: 12, requestBytes: 1024, bodyLimitReceipts: missingGatewayReceipt ? [] : gatewayReceipts,
        bodyLimitReceiptsComplete: !missingGatewayReceipt };
    },
    containerFileExists: async () => true, containerExistsForCleanup: async () => false,
    setTimeout: callback => { queueMicrotask(callback); },
    runOwnedProcess: async (executable, args, options) => {
      calls.push({ args, options });
      if (args[0] === "rm" && releasePressure) releasePressure({ code: 0, stdout: "actual-private-journal", stderr: "private-cookie=not-public" });
      if (args.some(value => value.startsWith("courtside-security-decoder-")) && args.includes("--network") && args.includes("none")) {
        events.push("decoder"); if (decoderFailure) throw new Error("private decoder failure");
      }
      if (args.includes("k6") && args.includes("run")) { events.push("pressure");
        if (delayedPressure) return new Promise(resolve => { releasePressure = resolve; });
        if (processFailure) throw new Error("private-password\nactual-private-journal");
        return { code: 0, stdout: "", stderr: "actual-private-journal" }; }
      if (args.includes("-Dloader.main=org.courtside.securityassessment.SecurityPublicationPolicyProjection")) {
        events.push("publication-policy");
        return { code: 0, stdout: publicationOutput ?? JSON.stringify({ listenerId: "actual-native-listener-id", eventType: "org.courtside.shared.BookingConfirmed",
          repositoryMode: "JDBC_V2", repositoryClassDigest: digest }) + "\n" };
      }
      if (args.includes("cat") && args.at(-1).endsWith("application.yaml")) return { stdout: readFileSync(new URL("../src/main/resources/application.yaml", import.meta.url), "utf8").replace("completion-mode: delete", `completion-mode: ${completionMode}`) };
      if (args.includes("cat") && args.at(-1) === "/app/BOOT-INF/classpath.idx") return {
        stdout: '- "BOOT-INF/lib/spring-security-core-7.1.1.jar"\n- "BOOT-INF/lib/spring-modulith-events-jdbc-2.1.1.jar"\n' };
      if (args.includes("cat") && args.at(-1) === "/results/summary.json") return { stdout: malformedSummary ? "private malformed summary" : JSON.stringify({
        checks: [{ name: "competing-court-occupancy:serialized", passes: 2, fails: 0 }] }) };
      if (args[0] === "inspect" || args[0] === "image") return { stdout: JSON.stringify({
        Id: args[0] === "image" ? digest : createHash("sha256").update(args[1]).digest("hex"),
        Image: args[0] === "inspect" && args[1]?.endsWith("-app-1") ? runtimeImageId : digest,
        foreign: foreignDecoder && args[1]?.startsWith("courtside-security-decoder-"),
        Config: { ...imageDefaults, ...(args[0] === "inspect" && args[1]?.endsWith("-app-1") ? runtimeOverride : {}),
          Image: args[1]?.includes("k6") ? "native-k6" : imageReference,
          Env: ["COURTSIDE_COOKIE_SECURE=true", ...(publicationOverride ? ["SPRING_MODULITH_EVENTS_COMPLETION_MODE=delete"] : [])], Labels: labels },
        NetworkSettings: { Networks: { "courtside-security-run-0001_scanner-upstream": { IPAddress: "192.0.2.10" } } } }) };
      return { code: 0, stdout: "", stderr: "" };
    }
  };
  if (privateRoot) Object.assign(context, { join, mkdirSync, chmodSync, lstatSync });
  vm.createContext(context);
  vm.runInContext(functionSource + "\nthis.run = runResourceAbuse;", context);
  const plan = { runId: "run-0001", budgets: { concurrency: 12, generatedDataMegabytes: 500, evidenceMegabytes } };
  const limits = { attempt: 1, maxRequests: 6000, timeoutMilliseconds: 60000,
    policy: { image: "native-k6", scenarios: [{ id: "competing-court-occupancy", checks: ["serialized"] }],
      circuitBreakers: { sampleIntervalMilliseconds: 1 }, interruptGraceMilliseconds: 1 } };
  return { run: () => context.run(plan, "/stop", limits), events, calls, writes, observations, mailInputs, environment };
}

test("given native publication policy and matching candidate classes, when pressure stops, then bind only the actual projected listener and configured delete lifecycle", async () => {
  // given
  const harness = resourceIntegrationHarness();
  // when
  await harness.run();
  // then
  assert.deepEqual(JSON.parse(JSON.stringify(harness.observations[0].contract.publicationLifecycle)), {
    completionMode: "DELETE", repositoryMode: "JDBC_V2", listenerId: "actual-native-listener-id", eventType: "org.courtside.shared.BookingConfirmed"
  });
  const command = harness.calls.find(({ args }) => args.includes("-Dloader.main=org.courtside.securityassessment.SecurityPublicationPolicyProjection"));
  assert.ok(command);
  assert.equal(command.options.input, undefined);
  assert.equal(command.options.outputLimitBytes, 4096);
  assert.equal(command.options.timeoutMilliseconds, 10000);
  assert.ok(harness.events.indexOf("publication-policy") < harness.events.indexOf("pressure"));
  const binding = harness.writes.find(entry => entry.name === "decoder-binding-native.json").value.publicationBinding;
  assert.match(binding.sourceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(binding.candidateClassDigest, binding.decoderClassDigest);
  assert.match(binding.helperClassDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(binding.candidateRepositoryJarDigest, binding.decoderRepositoryJarDigest);
});

for (const policy of [{ completionMode: "update" }, { publicationOverride: true }]) {
  test(`given ${policy.publicationOverride ? "a runtime publication override" : "a non-delete publication mode"}, when binding native policy, then reject before pressure rather than guess the lifecycle`, async () => {
    // given
    const harness = resourceIntegrationHarness(policy);
    // when / then
    await assert.rejects(harness.run(), /Resource-abuse observation incomplete/);
    assert.ok(!harness.events.includes("pressure"));
  });
}

for (const projection of [
  { publicationClassDrift: true },
  { publicationJarDrift: true },
  { publicationOutput: JSON.stringify({ listenerId: "guessed", eventType: "other.Event" }) },
  { publicationOutput: JSON.stringify({ listenerId: "", eventType: "org.courtside.shared.BookingConfirmed" }) },
  { publicationOutput: JSON.stringify({ listenerId: "guessed", eventType: "org.courtside.shared.BookingConfirmed", extra: true }) }
]) {
  test(`given an unbound publication projection ${JSON.stringify(projection)}, when effects are observed, then refuse before pressure without a lifecycle exception`, async () => {
    // given
    const harness = resourceIntegrationHarness(projection);
    // when
    await assert.rejects(harness.run(), /Resource-abuse observation incomplete/);
    // then
    assert.ok(!harness.events.includes("pressure"));
    assert.equal(harness.observations.length, 0);
  });
}

test("given the assessed environment identity, when capturing native mail baseline, then pass the actual seed and instance fingerprints to the producer verifier", async () => {
  // given
  const harness = resourceIntegrationHarness();
  // when
  await harness.run();
  // then
  assert.deepEqual(JSON.parse(JSON.stringify(harness.mailInputs[0].identity)), {
    seedFingerprint: harness.environment.COURTSIDE_SECURITY_SEED_FINGERPRINT,
    instanceFingerprint: harness.environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT
  });
  assert.equal(harness.mailInputs[0].runId, "run-0001");
  assert.equal(typeof harness.mailInputs[0].command, "function");
});

for (const earlyFailure of ["before", "sample", "parser"]) {
  test(`given private native captures, when ${earlyFailure} fails early, then actual evidence survives securely without public raw output`, async () => {
    // given
    const privateRoot = mkdtempSync(join(tmpdir(), "courtside-retention-"));
    const harness = resourceIntegrationHarness({ privateRoot, earlyFailure, delayedPressure: earlyFailure === "sample" });
    const directory = join(privateRoot, "run-0001", "resource-abuse", "attempt-1");
    try {
      // when / then
      await assert.rejects(harness.run(), error => error.message === "Resource-abuse observation incomplete");
      assert.equal(JSON.parse(readFileSync(join(directory, "before-native.json"), "utf8")).tables.club_config.rows[0].time_zone, "Europe/Berlin");
      if (earlyFailure !== "before") assert.match(readFileSync(join(directory, "journal-native.log"), "utf8"), /actual-private-journal/);
      if (earlyFailure === "sample") assert.match(readFileSync(join(directory, "journal-native.log"), "utf8"), /private-cookie=not-public/);
      assert.equal(lstatSync(directory).mode & 0o777, 0o700);
      for (const name of readdirSync(directory)) assert.equal(lstatSync(join(directory, name)).mode & 0o777, 0o600);
      const failure = readFileSync(join(directory, "failure.json"), "utf8");
      assert.doesNotMatch(failure, /private-cookie|private-password|private sample|private parser/);
      assert.ok(!harness.events.includes("effects"));
    } finally { rmSync(privateRoot, { recursive: true, force: true }); }
  });
}

test("given one private evidence budget, when a later native capture exceeds it, then the earlier snapshot and reserved failure survive", async () => {
  // given
  const privateRoot = mkdtempSync(join(tmpdir(), "courtside-retention-"));
  const harness = resourceIntegrationHarness({ privateRoot, oversizedBaseline: true, evidenceMegabytes: 1 / 64 });
  const directory = join(privateRoot, "run-0001", "resource-abuse", "attempt-1");
  try {
    // when / then
    await assert.rejects(harness.run(), /Resource-abuse observation incomplete/);
    assert.ok(readFileSync(join(directory, "before-native.json")).length > 0);
    assert.ok(readFileSync(join(directory, "failure.json")).length > 0);
    assert.ok(readdirSync(directory).reduce((bytes, name) => bytes + lstatSync(join(directory, name)).size, 0) <= 16384);
    assert.ok(!harness.events.includes("pressure"));
  } finally { rmSync(privateRoot, { recursive: true, force: true }); }
});

test("given a native decoder failure, when preparing pressure, then retain the missing binding and refuse before any workload", async () => {
  // given
  const privateRoot = mkdtempSync(join(tmpdir(), "courtside-retention-"));
  const harness = resourceIntegrationHarness({ privateRoot, decoderFailure: true });
  const directory = join(privateRoot, "run-0001", "resource-abuse", "attempt-1");
  try {
    // when
    await assert.rejects(harness.run(), /^Error: Resource-abuse observation incomplete$/);
    // then
    assert.equal(JSON.parse(readFileSync(join(directory, "decoder-binding-native.json"), "utf8")).runtimeBinding, null);
    assert.ok(!readdirSync(directory).includes("journal-native.log"));
    assert.ok(!readdirSync(directory).includes("before-native.json"));
    assert.ok(!harness.events.includes("pressure"));
  } finally { rmSync(privateRoot, { recursive: true, force: true }); }
});

test("given the native resource runner, when pressure succeeds, then full before and mail captures precede the frozen-date execution and verified phase chain", async () => {
  // given
  const harness = resourceIntegrationHarness();
  // when
  const result = await harness.run();
  // then
  assert.ok(harness.events.indexOf("before-snapshot") < harness.events.indexOf("pressure"));
  assert.ok(harness.events.includes("before-snapshot") && harness.events.includes("mail-baseline"));
  assert.ok(harness.events.indexOf("mail-baseline") < harness.events.indexOf("pressure"));
  assert.deepEqual(JSON.parse(JSON.stringify(result.integrity)), { effects: "passed", cleanup: "passed", recovery: "passed" });
  const pressure = harness.calls.find(({ args }) => args.includes("k6") && args.includes("run"));
  assert.ok(pressure.args.some(value => value.startsWith("COURTSIDE_SECURITY_DATE_PLAN=")));
  assert.ok(!harness.events.includes("legacy-cleanup"));
  assert.ok(!harness.calls.some(({ args }) => args.includes("seeder")));
  assert.ok(harness.events.indexOf("decoder") < harness.events.indexOf("pressure"));
  assert.equal(harness.events.filter(event => event === "decoder").length, 1);
  assert.ok(harness.events.indexOf("authentication") > harness.events.indexOf("decoder"));
  assert.ok(harness.writes.some(write => write.name === "journal-native.log" && write.value.includes("actual-private-journal")));
  assert.doesNotMatch(JSON.stringify(result), /actual-private-journal|private-password/);
  assert.match(result.journalDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.competingWrites.successful, 1);
  assert.equal(result.competingWrites.rejected, 1);
  assert.equal(result.competingWrites.duplicateBookings, 1);
  assert.equal(result.competingWrites.duplicateResponses, 2);
  assert.equal(result.stateAfterRecovery, `sha256:${"a".repeat(64)}`);
  const classpath = harness.calls.find(({ args }) => args.includes("cat") && args.at(-1) === "/app/BOOT-INF/classpath.idx");
  assert.ok(classpath);
  assert.ok(classpath.options.outputLimitBytes <= 1024 * 1024);
});

test("given a failed native recovery proof with an actual snapshot fingerprint, when the environment exports results, then it preserves the failure and observed fingerprint", async () => {
  // given
  const actualFingerprint = `sha256:${"b".repeat(64)}`;
  const harness = resourceIntegrationHarness({ recoveryProof: { outcome: "failed", code: "cleanup-state-mismatch",
    expectedFingerprint: `sha256:${"a".repeat(64)}`, actualFingerprint } });
  // when
  const result = await harness.run();
  // then
  assert.equal(result.integrity.recovery, "failed");
  assert.equal(result.stateAfterRecovery, actualFingerprint);
  assert.equal(result.recovery.domainIntegrity, "failed");
  assert.equal(result.stateAfterCleanup, `sha256:${"a".repeat(64)}`);
});

test("given a qualified immutable registry reference and its distinct config ID, when binding the native app, then resolve the recorded reference before accepting the runtime", async () => {
  // given
  const reference = `ghcr.io/example/courtside@sha256:${"c".repeat(64)}`;
  const harness = resourceIntegrationHarness({ imageReference: reference });
  // when
  const result = await harness.run();
  // then
  assert.equal(result.integrity.effects, "passed");
  assert.ok(harness.calls.some(({ args }) => args[0] === "image" && args[1] === "inspect" && args[2] === reference));
  assert.ok(!harness.calls.some(({ args }) => args[0] === "image" && args[1] === "inspect" && args[2] === `sha256:${"a".repeat(64)}`));
});

for (const [override, mode] of [
  [{ runtimeImageId: `sha256:${"b".repeat(64)}` }, "foreign-image"],
  [{ runtimeOverride: { Entrypoint: ["sh"] } }, "entrypoint"],
  [{ runtimeOverride: { Cmd: ["untrusted-command"] } }, "command"],
  [{ runtimeOverride: { User: "0:0" } }, "user"]
]) {
  test(`given a native app with ${mode} drift, when binding it to the recorded candidate, then reject before pressure or snapshot capture`, async () => {
    // given
    const reference = mode === "foreign-image" ? `ghcr.io/example/courtside@sha256:${"c".repeat(64)}` : `sha256:${"a".repeat(64)}`;
    const harness = resourceIntegrationHarness({ imageReference: reference, ...override });
    // when / then
    await assert.rejects(harness.run(), /Resource-abuse observation incomplete/);
    assert.ok(!harness.events.includes("pressure"));
    assert.ok(!harness.events.includes("before-snapshot"));
    assert.ok(harness.calls.some(({ args }) => args[0] === "image" && args[1] === "inspect" && args[2] === reference));
    assert.ok(!harness.calls.some(({ args }) => args[0] === "image" && args[1] === "inspect" && args[2] === `sha256:${"b".repeat(64)}`));
  });
}

test("given a failed k6 process or incomplete effect proof, when the runner finalizes, then private error output never becomes public or earns passing phases", async () => {
  // given
  for (const mode of [{ processFailure: true }, { effectsOutcome: "incomplete" }, { missingGatewayReceipt: true }]) {
    const harness = resourceIntegrationHarness(mode);
    // when
    const result = await harness.run();
    // then
    assert.notEqual(result.integrity.effects, "passed");
    assert.doesNotMatch(JSON.stringify(result), /private-password|actual-private-journal/);
    assert.ok(!harness.events.includes("legacy-cleanup"));
  }
});

test("given a private evidence cap smaller than the baseline, when preparing pressure, then fail closed before k6 starts without disclosing values", async () => {
  // given
  const harness = resourceIntegrationHarness({ evidenceMegabytes: 0 });
  // when / then
  await assert.rejects(harness.run(), /^Error: Resource-abuse observation incomplete$/);
  assert.ok(!harness.events.includes("pressure"));
});

test("given a decoder name now resolves to an unowned runtime, when finalizing the attempt, then do not delete that container", async () => {
  // given
  const harness = resourceIntegrationHarness({ foreignDecoder: true });
  // when / then
  await assert.rejects(harness.run(), /Resource-abuse cleanup was incomplete/);
  const foreignId = createHash("sha256").update("courtside-security-decoder-run-0001-1").digest("hex");
  assert.ok(!harness.calls.some(({ args }) => args[0] === "rm" && args.at(-1) === foreignId));
});

test("given malformed summary or missing telemetry after captured effects, when finalizing, then retain real phase digests and mark scenario coverage incomplete", async () => {
  // given
  for (const mode of [{ malformedSummary: true }, { missingTelemetry: true }]) {
    const harness = resourceIntegrationHarness(mode);
    // when
    const result = await harness.run();
    // then
    assert.equal(result.integrity.effects, mode.missingTelemetry ? "incomplete" : "passed");
    assert.equal(result.scenarios[0].outcome, "incomplete");
    assert.match(result.stateAfter, /^sha256:[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(result), /private/);
  }
});

test("given the actual candidate configuration and security overrides, when binding authentication policy, then use native values without a guessed policy", () => {
  // given
  const application = yaml.load(readFileSync(new URL("../src/main/resources/application.yaml", import.meta.url), "utf8"));
  const classpath = '- "BOOT-INF/lib/spring-security-core-7.1.1.jar"\n';
  const runtime = { Config: { Env: ["COURTSIDE_COOKIE_SECURE=true", "COURTSIDE_LOGIN_ADDRESS_MAX_FAILURES=5",
    "COURTSIDE_LOGIN_GLOBAL_THRESHOLD=20"] } };
  // when
  const result = resourceAuthenticationPolicy(runtime, application, classpath);
  // then
  assert.deepEqual(result.sessionPolicy, { inactivitySeconds: 1800, absoluteLifetimeMilliseconds: 86400000,
    concurrentLimit: 5, cookieName: "__Host-SESSION", browserFamily: "OTHER", passwordFactorRequired: true });
  assert.deepEqual(result.loginPolicy, { proofMode: "http-bounded-v1",
    address: { maxFailures: 5, windowMilliseconds: 60000, blockMilliseconds: 60000 },
    global: { threshold: 20, windowMilliseconds: 60000 } });
});

test("given candidate authentication overrides, when binding policy, then honor valid values and reject ambiguous configuration", () => {
  // given
  const application = yaml.load(readFileSync(new URL("../src/main/resources/application.yaml", import.meta.url), "utf8"));
  const classpath = '- "BOOT-INF/lib/spring-security-core-7.1.1.jar"\n';
  const runtime = { Config: { Env: ["COURTSIDE_COOKIE_SECURE=true", "COURTSIDE_SESSION_INACTIVITY_TIMEOUT=15m",
    "COURTSIDE_SESSION_MAX_CONCURRENT=3", "COURTSIDE_LOGIN_ADDRESS_BLOCK=2m"] } };
  // when
  const result = resourceAuthenticationPolicy(runtime, application, classpath);
  // then
  assert.equal(result.sessionPolicy.inactivitySeconds, 900);
  assert.equal(result.sessionPolicy.concurrentLimit, 3);
  assert.equal(result.loginPolicy.address.blockMilliseconds, 120000);
  for (const extra of ["COURTSIDE_COOKIE_SECURE=false", "COURTSIDE_LOGIN_ADDRESS_BLOCK=garbage",
    "SPRING_APPLICATION_JSON={}", "SPRING_CONFIG_LOCATION=/tmp/alternate.yml"]) {
    assert.throws(() => resourceAuthenticationPolicy({ Config: { Env: [...runtime.Config.Env, extra] } }, application, classpath));
  }
  assert.throws(() => resourceAuthenticationPolicy(runtime, {}, classpath));
  for (const missing of [undefined, "", classpath + classpath, classpath.replace("7.1.1", "6.5.0"),
    classpath.replace("7.1.1", "8.0.0")]) assert.throws(() => resourceAuthenticationPolicy(runtime, application, missing));
});

test("given a candidate-derived fixture image, when preparing the session decoder, then keep it immutable isolated and bounded", () => {
  // given
  const environment = securityEnvironment("run-0001", `sha256:${"a".repeat(64)}`);
  const image = `sha256:${"b".repeat(64)}`;
  // when
  const plan = resourceSessionDecoderPlan(environment, 1, image);
  // then
  assert.equal(plan.name, "courtside-security-decoder-run-0001-1");
  assert.ok(plan.args.includes("none"));
  assert.ok(plan.args.includes("10001:10001"));
  assert.ok(plan.args.includes("--read-only"));
  assert.ok(plan.args.includes("no-new-privileges:true"));
  assert.ok(plan.args.includes("256m"));
  assert.ok(plan.args.includes("org.courtside.security.instance-fingerprint=" + environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT));
  assert.deepEqual(plan.args.slice(-3), [image, "-c", "exec sleep 3600"]);
  assert.throws(() => resourceSessionDecoderPlan(environment, 1, "courtside:mutable"));
  assert.throws(() => resourceSessionDecoderPlan(environment, 0, image));
});

function securityServices() {
  return yaml.load(readFileSync(
    fileURLToPath(new URL("../deploy/compose.security.yaml", import.meta.url)), "utf8")).services;
}

test("given a reused run identifier, when reserving a fresh security instance, then never reuse its retained relay private assets", () => {
  // given
  const image = `sha256:${"a".repeat(64)}`;
  // when
  const first = securityEnvironment("run-0001", image);
  const second = securityEnvironment("run-0001", image);
  // then
  assert.notEqual(first.COURTSIDE_SECURITY_MAIL_DIRECTORY, second.COURTSIDE_SECURITY_MAIL_DIRECTORY);
  assert.ok(first.COURTSIDE_SECURITY_MAIL_DIRECTORY.endsWith(first.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT.slice(7)));
  assert.ok(second.COURTSIDE_SECURITY_MAIL_DIRECTORY.endsWith(second.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT.slice(7)));
});

test("given the security Compose file, when reading the assessed target, then it runs no fixture component", () => {
  // given
  const { app, seeder } = securityServices();

  // when
  const fixtureConfiguration = Object.keys(app.environment)
    .filter((name) => name.startsWith("COURTSIDE_SECURITY_") || name.startsWith("SPRING_PROFILES_"));

  // then
  assert.deepEqual(fixtureConfiguration, []);
  assert.equal(app.image, "${COURTSIDE_SECURITY_IMAGE:?required}");
  assert.deepEqual(app.depends_on, {
    db: { condition: "service_healthy" },
    seeder: { condition: "service_completed_successfully" },
    mail: { condition: "service_started" }
  });
  assert.equal(seeder.image, "${COURTSIDE_SECURITY_FIXTURES_IMAGE:?required}");
  assert.equal(seeder.environment.SPRING_PROFILES_ACTIVE, "security");
  assert.equal(seeder.environment.COURTSIDE_SECURITY_SEED_ONLY, "true");
  assert.deepEqual(seeder.networks, ["backend"]);
  assert.equal(seeder.ports, undefined);
  assert.equal(seeder.read_only, true);
  assert.deepEqual(seeder.cap_drop, ["ALL"]);
  assert.deepEqual(seeder.security_opt, ["no-new-privileges:true"]);
});

test("given a candidate image, when choosing what a build can start from, then a tag comes first", () => {
  // when / then
  assert.equal(fixtureImageBase({
    RepoTags: ["courtside:uat-local"],
    RepoDigests: [`courtside@sha256:${"b".repeat(64)}`]
  }), "courtside:uat-local");
  assert.equal(fixtureImageBase({
    RepoTags: ["<none>:<none>"],
    RepoDigests: [`ghcr.io/jegr78/courtside@sha256:${"b".repeat(64)}`]
  }), `ghcr.io/jegr78/courtside@sha256:${"b".repeat(64)}`);
  assert.throws(() => fixtureImageBase({ RepoTags: [], RepoDigests: [] }),
    /carries no reference a build can start from/);
});

function inspected(layers, configuration = {}) {
  return {
    RootFS: { Layers: layers },
    Config: { Entrypoint: ["/entry.sh"], Cmd: null, User: "10001:10001", ...configuration }
  };
}

test("given a built seeder image, when it is not the candidate plus its classes, then the run is refused", () => {
  // given
  const candidate = ["sha256:one", "sha256:two"];

  // when / then
  assertFixtureImageDerivation(inspected(candidate), inspected([...candidate, "sha256:fixtures"]));
  assert.throws(() => assertFixtureImageDerivation(inspected(candidate), inspected(candidate)),
    /not the candidate carrying its fixture classes/);
  assert.throws(() => assertFixtureImageDerivation(inspected(candidate),
    inspected(["sha256:one", "sha256:other", "sha256:fixtures"])),
    /not the candidate carrying its fixture classes/);
  assert.throws(() => assertFixtureImageDerivation(inspected(candidate),
    inspected([...candidate, "sha256:fixtures", "sha256:more"])),
    /not the candidate carrying its fixture classes/);
  assert.throws(() => assertFixtureImageDerivation(inspected([]), inspected(["sha256:fixtures"])),
    /not the candidate carrying its fixture classes/);
});

// The base is resolved through a mutable local tag, so identical layers alone would also accept an
// image that merely shares them and starts something else.
test("given a built seeder image, when it starts something other than the candidate, then the run is refused", () => {
  // given
  const candidate = ["sha256:one", "sha256:two"];
  const fixtures = [...candidate, "sha256:fixtures"];

  // when / then
  for (const configuration of [{ Entrypoint: ["/other.sh"] }, { Cmd: ["--serve"] }, { User: "0:0" }]) {
    assert.throws(() => assertFixtureImageDerivation(inspected(candidate), inspected(fixtures, configuration)),
      /does not run the candidate's own entry point/,
      `a changed ${Object.keys(configuration)[0]} was accepted`);
  }
});

test("given a security run, when building its seeder, then the image is layered over the candidate itself", () => {
  // given
  const image = `sha256:${"b".repeat(64)}`;

  // when
  const plan = fixtureImagePlan(securityFixturesImageTag("run-0001"), image);

  // then
  assert.equal(securityFixturesImageTag("run-0001"), "courtside:security-fixtures-run-0001");
  assert.deepEqual(plan.args, ["build", "-t", "courtside:security-fixtures-run-0001",
    "--build-arg", `BASE_IMAGE=${image}`, "-f", "Dockerfile.fixtures", "."]);
  assert.throws(() => securityFixturesImageTag("../outside"), /security run ID/);
});

test("given the application runtime, when file permissions are inspected, then no broader actor can alter its files", () => {
  // given
  const confined = { userId: "10001", appDirectoryWritable: false, tempDirectoryWritable: true,
    groupOrWorldWritablePaths: [] };

  // when / then
  assert.deepEqual(evaluateRuntimeFilePermissions(confined), {
    passed: true, observation: "application-files-confined"
  });
  assert.equal(evaluateRuntimeFilePermissions({ ...confined, userId: "0" }).passed, false);
  assert.equal(evaluateRuntimeFilePermissions({ ...confined, appDirectoryWritable: true }).passed, false);
  assert.equal(evaluateRuntimeFilePermissions({ ...confined,
    groupOrWorldWritablePaths: ["/app/application.class"] }).passed, false);
});

test("given scanner traffic, when reserving the canary retest, then only the remaining budget is available", () => {
  // when / then
  assert.equal(remainingScannerRequestBudget(8000, 7999), 1);
  assert.throws(() => remainingScannerRequestBudget(8000, 0), /no request budget/);
  assert.throws(() => remainingScannerRequestBudget(8000, 8000), /no request budget/);
  assert.throws(() => remainingScannerRequestBudget(8000, 8001), /no request budget/);
});

test("given Hikari metrics, when sampling pool pressure, then active and pending connections remain distinct", () => {
  // given
  const metrics = `
hikaricp_connections_active{pool="HikariPool-1"} 8.0
hikaricp_connections_pending{pool="HikariPool-1"} 3.0
hikaricp_connections_max{pool="HikariPool-1"} 10.0
`;

  // when / then
  assert.equal(prometheusMetric(metrics, "hikaricp_connections_active"), 8);
  assert.equal(prometheusMetric(metrics, "hikaricp_connections_pending"), 3);
  assert.equal(prometheusMetric(metrics, "hikaricp_connections_max"), 10);
  assert.throws(() => prometheusMetric(metrics, "hikaricp_connections_idle"), /is unavailable/);
});

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

test("given a disposable security identity, when configuring the relay, then private trust assets belong to that run and the local non-root owner", () => {
  // given
  const image = `sha256:${"a".repeat(64)}`;
  // when
  const environment = securityEnvironment("relay-run-0001", image);
  // then
  assert.match(environment.COURTSIDE_SECURITY_MAIL_DIRECTORY, /build\/security\/relay-run-0001\/mail-[a-f0-9]{64}$/);
  assert.equal(environment.COURTSIDE_SECURITY_MAIL_USER, `${process.getuid()}:${process.getgid()}`);
  assert.notEqual(environment.COURTSIDE_SECURITY_MAIL_USER.split(":")[0], "0");
});

test("given Docker cleanup inspection failures, when classifying absence, then only an explicit missing resource is accepted", () => {
  // when / then
  assert.equal(isMissingDockerResource(
    new Error("Owned security process failed (1): Error: No such object: scanner-one\n"), "scanner-one"), true);
  assert.equal(isMissingDockerResource(
    new Error("Owned security process failed (1): error: no such object: scanner-one\n"), "scanner-one"), true);
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
  assert.equal(environment.COURTSIDE_SECURITY_FIXTURES_IMAGE, "courtside:security-fixtures-run-0001");
  assert.equal(environment.COURTSIDE_SECURITY_SHARED_PASSWORD, "synthetic-password-value");
  assert.equal(environment.COURTSIDE_SECURITY_HTTPS_PORT, "23456");
  assert.equal(environment.COURTSIDE_LOGIN_ADDRESS_MAX_FAILURES, "5");
  assert.match(environment.COURTSIDE_SECURITY_SEED_FINGERPRINT, /^sha256:[a-f0-9]{64}$/);
  assert.match(environment.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT, /^sha256:[a-f0-9]{64}$/);
});

test("given a ready security environment, when reporting startup, then its credential remains private", () => {
  // given
  const credential = "synthetic-password-value";
  const source = readFileSync(fileURLToPath(new URL("./security-environment.mjs", import.meta.url)), "utf8");

  // when
  const message = securityEnvironmentReadyMessage("run-0001");

  // then
  assert.match(message, /private run state/);
  assert.doesNotMatch(message, new RegExp(credential));
  assert.doesNotMatch(message, /credential:/i);
  assert.doesNotMatch(source, /Shared synthetic credential/);
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
  assert.equal(environment.COURTSIDE_SECURITY_FIXTURES_IMAGE, "courtside:security-fixtures-run-0001");
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

// The scanner's contract and the digest the run plans against come from one path. Pinning the mount
// to the checkout would make a paired comparison assess two different contracts against one target.
test("given the security Compose file, when mounting the contract, then the run may point it at another revision", () => {
  // given
  const compose = readFileSync(fileURLToPath(new URL("../deploy/compose.security.yaml", import.meta.url)), "utf8");

  // when / then
  assert.match(compose,
    /\$\{COURTSIDE_SECURITY_API_DOCUMENT:-\.\.\/src\/main\/resources\/api\/openapi\.yaml\}:\/schema\/openapi\.yaml:ro/);
});

test("given the security Compose file, when inspecting boundaries, then resources are bounded and internal", () => {
  // given
  const compose = readFileSync(fileURLToPath(new URL("../deploy/compose.security.yaml", import.meta.url)), "utf8");

  // when / then
  assert.match(compose, /127\.0\.0\.1:\$\{COURTSIDE_SECURITY_HTTPS_PORT:\?required\}:443/);
  assert.equal((compose.match(/internal: true/g) ?? []).length, 4);
  assert.equal((compose.match(/pull_policy: never/g) ?? []).length, 10);
  assert.equal((compose.match(/org\.courtside\.security\.run-id:/g) ?? []).length, 15);
  assert.equal((compose.match(/org\.courtside\.security\.instance-fingerprint:/g) ?? []).length, 15);
  assert.match(compose, /\/var\/lib\/postgresql\/18\/docker:size=512m/);
  assert.match(compose, /https:\/\/localhost\/api\/source/);
  assert.match(compose, /zaproxy\/zap-stable:[\w.]+@sha256:[a-f0-9]{64}/);
  assert.match(compose, /schemathesis\/schemathesis:v4\.28\.0@sha256:[a-f0-9]{64}/);
  assert.match(compose, /grafana\/k6:2\.3\.0@sha256:[a-f0-9]{64}/);
  assert.match(compose, /MANAGEMENT_PROMETHEUS_METRICS_EXPORT_ENABLED: "true"/);
  assert.match(compose, /profiles: \[assessment\]/);
  assert.match(compose, /\/zap\/wrk:uid=1000,gid=1000,mode=0700,size=25m/);
  assert.match(compose, /zap:[\s\S]*networks:[\s\S]*- scanner-client/);
  assert.match(compose, /schemathesis:[\s\S]*read_only: true[\s\S]*cap_drop:[\s\S]*- ALL[\s\S]*- scanner-client/);
  assert.match(compose, /k6-abuse:[\s\S]*read_only: true[\s\S]*pids_limit: 128[\s\S]*- scanner-client/);
  assert.match(compose, /scanner-gateway:[\s\S]*- scanner-client[\s\S]*- scanner-upstream/);
  assert.match(compose, /proxy:[\s\S]*networks:[\s\S]*- scanner-upstream/);
  assert.doesNotMatch(compose, /zap:[\s\S]*networks:[\s\S]*- frontend/);
  assert.doesNotMatch(compose, /^volumes:/m);
});

test("given a policy that probes a method the gateway refuses, when deriving the relay cap, then it is refused", () => {
  // given
  const policy = { unexpectedMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] };

  // when / then
  assert.deepEqual(relayableMethods(policy),
    ["HEAD", "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
  assert.throws(() => relayableMethods({ unexpectedMethods: ["GET", "TRACE"] }),
    /may not probe methods the gateway refuses to relay: TRACE/);
});

test("given the scanner gateway, when enforcing budgets, then target access is counted synchronously", () => {
  // given
  const gateway = readFileSync(fileURLToPath(new URL("./security-request-gateway.py", import.meta.url)), "utf8");

  // when / then
  assert.match(gateway, /request_count >= MAX_REQUESTS/);
  assert.match(gateway, /request_bytes \+= content_length/);
  assert.match(gateway, /request_bytes \+ content_length > MAX_GENERATED_BYTES/);
  assert.match(gateway, /def __getattr__[\s\S]*startswith\("do_"\)[\s\S]*return self\.forward/);
  assert.match(gateway, /security-gateway-metrics/);
  assert.match(gateway, /latencies = collections\.deque\(maxlen=2048\)/);
  assert.match(gateway, /upstream_outcomes = collections\.deque\(maxlen=2048\)/);
  assert.match(gateway, /upstream_errors/);
  assert.match(gateway, /concurrency\.acquire\(blocking=False\)/);
  assert.match(gateway, /self\.close_connection = True/);
  assert.match(gateway, /UPSTREAM_HOST = "proxy"/);
});

test("given an active scanner boundary, when checking targets, then methods paths and origins fail closed", () => {
  // given
  const gateway = fileURLToPath(new URL("./security-request-gateway.py", import.meta.url));
  const script = `
import importlib.util
import http.client
import http.server
import threading
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
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), gateway.RequestHandler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
connection = http.client.HTTPConnection("127.0.0.1", server.server_port)
connection.request("GET", "/__security/zap-canary")
response = connection.getresponse()
assert response.status == 200
assert response.getheader("X-Powered-By") == "Courtside-ZAP-Canary/1.0"
assert response.getheader("Server") is None
response.read()
connection.close()
server.shutdown()
server.server_close()
thread.join()
`;

  // when
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8", env: {
    ...process.env,
    COURTSIDE_SECURITY_MAX_REQUESTS: "100",
    COURTSIDE_SECURITY_MAX_CONCURRENCY: "1",
    COURTSIDE_SECURITY_ALLOWED_METHODS: "GET,HEAD",
    COURTSIDE_SECURITY_ALLOWED_PATH_PREFIXES: "/api/cards,/__security/zap-canary",
    COURTSIDE_SECURITY_CANARY_ENABLED: "true",
    COURTSIDE_SECURITY_MAX_TARGET_BYTES: "1024",
    COURTSIDE_SECURITY_MAX_GENERATED_BYTES: "1048576",
    PYTHONDONTWRITEBYTECODE: "1"
  } });

  // then
  assert.equal(result.status, 0, result.stderr);
});

test("given scanner diagnostics, when reporting a failed run, then session material is removed", () => {
  // given
  const cookie = "__Host-SESSION=opaque-session; __Host-XSRF-TOKEN=opaque-csrf";

  // when
  const diagnostic = authenticatedZapDiagnostic(
    `Automation failed http://scanner-gateway:8090/api/reset/opaque-path?token=opaque-query\n`
      + `Cookie: ${cookie}\nAuthorization: Bearer opaque-token\npassword=opaque-password`, [cookie]);

  // then
  assert.doesNotMatch(diagnostic, /opaque-session|opaque-csrf|opaque-token|opaque-password|opaque-path|opaque-query/);
  assert.match(diagnostic, /^non-zero-process-exit; redacted-output-digest=sha256:[a-f0-9]{64}$/);
  assert.ok(diagnostic.length < 500);
});

test("given a scanner response assertion, when reporting it, then the closed reason retains both statuses", () => {
  // when
  const diagnostic = authenticatedZapDiagnostic(
    "Difference in response code values Expected : 404 Received : 401", []);

  // then
  assert.match(diagnostic, /^response-code-mismatch expected=404 received=401;/);
  assert.ok(diagnostic.length < 500);
});

// A JSON schema and a run contract cannot read the deployment, so nothing would carry a scanner
// bump into them. This is what notices when one is left behind.
test("given the scanner version, when a static file names it, then it is the deployed one", () => {
  // given
  const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

  // then
  assert.equal(read("../security/passive-deployment-evidence.schema.json")
    .properties.zap.properties.version.const, zapVersion);
  assert.equal(read("../security/run-contract.json").tools
    .find((tool) => tool.id === "authenticated-zap").version, zapVersion);
  assert.equal(read("../security/run-contract.json").tools
    .find((tool) => tool.id === "openapi-fuzzer").version, openApiFuzzVersion);
  assert.match(openApiFuzzPolicy.image,
    new RegExp(read("../security/openapi-fuzz-evidence.schema.json").properties.image.pattern),
    "the evidence schema refuses the image the assessment actually runs");
});

test("given docker commands that end with their process, when running them, then no clock is put over any", () => {
  // given
  const source = readFileSync(fileURLToPath(new URL("./security-environment.mjs", import.meta.url)), "utf8");
  const declaration = source.slice(source.indexOf("function execute("));
  const body = declaration.slice(0, declaration.indexOf("\n}"));

  // when / then
  assert.doesNotMatch(body, /timeout/,
    "execFileSync already returns when the docker process exits, and docker compose --wait already "
    + "ends when the stack's health checks pass. A process timeout measures neither condition; it "
    + "only kills a valid wait on a loaded machine, and raising the number is not a fix. The job's "
    + "timeout-minutes is what bounds a wedged daemon.");
});

function recordedEnvironment(overrides = {}) {
  return {
    COURTSIDE_SECURITY_RUN_ID: "compare-base-1-1",
    COURTSIDE_SECURITY_IMAGE: `sha256:${"a".repeat(64)}`,
    COURTSIDE_SECURITY_SHARED_PASSWORD: "synthetic",
    COURTSIDE_SECURITY_SEED_FINGERPRINT: `sha256:${"b".repeat(64)}`,
    COURTSIDE_SECURITY_INSTANCE_FINGERPRINT: `sha256:${"c".repeat(64)}`,
    ...overrides
  };
}

function pairedSeedCheckout() {
  const checkout = realpathSync(mkdtempSync(join(tmpdir(), "courtside-seed-base-")));
  mkdirSync(join(checkout, "deploy"));
  mkdirSync(join(checkout, "build/security/compare-base-1-1"), { recursive: true });
  const compose = join(checkout, "deploy/compose.security.yaml");
  writeFileSync(compose, 'services:\n  seeder:\n    image: ${COURTSIDE_SECURITY_FIXTURES_IMAGE:?required}\n    environment:\n      PASSWORD: ${COURTSIDE_SECURITY_SHARED_PASSWORD:?required}\n      SEED: ${COURTSIDE_SECURITY_SEED_FINGERPRINT:?required}\n');
  const state = join(checkout, "build/security/compare-base-1-1/environment.json");
  const recorded = recordedEnvironment();
  writeFileSync(state, JSON.stringify(recorded));
  return { checkout, compose, state, recorded };
}

test("given an older checkout without mail state, when HEAD seeds it, then BASE compose and HEAD fixture production remain separate", () => {
  // given
  const fixture = pairedSeedCheckout();
  const calls = [];
  const labels = {
    "com.docker.compose.project": "courtside-security-compare-base-1-1",
    "org.courtside.environment": "SECURITY",
    "org.courtside.security.run-id": "compare-base-1-1",
    "org.courtside.security.seed-fingerprint": fixture.recorded.COURTSIDE_SECURITY_SEED_FINGERPRINT,
    "org.courtside.security.instance-fingerprint": fixture.recorded.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT
  };
  try {
    // when
    seedSecurityEnvironment("compare-base-1-1", fixture.recorded.COURTSIDE_SECURITY_IMAGE, fixture.state,
      { composeRoot: fixture.checkout }, {
        resources: () => [{ type: "container", id: "owned", labels }],
        buildFixtures: (...args) => calls.push(["build", ...args]),
        execute: (...args) => calls.push(["execute", ...args]),
        removeImage: (...args) => calls.push(["remove", ...args])
      });
    // then
    assert.deepEqual(calls[0], ["build", "compare-base-1-1", fixture.recorded.COURTSIDE_SECURITY_IMAGE,
      securitySeedImageTag("compare-base-1-1")]);
    assert.equal(calls[1][2][4], fixture.compose);
    assert.equal(calls[1][3].COURTSIDE_SECURITY_SEED_FINGERPRINT, labels["org.courtside.security.seed-fingerprint"]);
    assert.equal("COURTSIDE_SECURITY_MAIL_DIRECTORY" in calls[1][3], false);
    assert.deepEqual(calls[2], ["remove", securitySeedImageTag("compare-base-1-1")]);
  } finally { rmSync(fixture.checkout, { recursive: true, force: true }); }
});

test("given a BASE compose bridge, when the real HEAD fixture build plan runs, then class staging and image derivation stay bound to HEAD", () => {
  // given
  const fixture = pairedSeedCheckout();
  const calls = [];
  const candidate = { RepoTags: ["courtside:owned-candidate"], RootFS: { Layers: ["candidate-layer"] },
    Config: { User: "10001", Entrypoint: ["java"], Cmd: [] } };
  const labels = {
    "com.docker.compose.project": "courtside-security-compare-base-1-1",
    "org.courtside.environment": "SECURITY",
    "org.courtside.security.run-id": "compare-base-1-1",
    "org.courtside.security.seed-fingerprint": fixture.recorded.COURTSIDE_SECURITY_SEED_FINGERPRINT,
    "org.courtside.security.instance-fingerprint": fixture.recorded.COURTSIDE_SECURITY_INSTANCE_FINGERPRINT
  };
  try {
    // when
    seedSecurityEnvironment("compare-base-1-1", fixture.recorded.COURTSIDE_SECURITY_IMAGE, fixture.state,
      { composeRoot: fixture.checkout }, {
        resources: () => [{ type: "container", id: "owned", labels }],
        stageClasses: path => calls.push(["stage", path]),
        inspect: image => image === fixture.recorded.COURTSIDE_SECURITY_IMAGE ? candidate
          : { ...candidate, RootFS: { Layers: ["candidate-layer", "head-fixtures"] } },
        execute: (...args) => calls.push(["execute", ...args]),
        removeImage: tag => calls.push(["remove", tag])
      });
    // then
    const headRoot = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
    assert.deepEqual(calls[0], ["stage", headRoot]);
    assert.deepEqual(calls[1][2], fixtureImagePlan(securitySeedImageTag("compare-base-1-1"),
      "courtside:owned-candidate").args);
    assert.equal(calls[2][2][4], fixture.compose);
    assert.equal(calls[2][3].COURTSIDE_SECURITY_SEED_FINGERPRINT, fixture.recorded.COURTSIDE_SECURITY_SEED_FINGERPRINT);
    assert.equal(calls[2][3].COURTSIDE_SECURITY_SHARED_PASSWORD, fixture.recorded.COURTSIDE_SECURITY_SHARED_PASSWORD);
    assert.deepEqual(calls[3], ["remove", securitySeedImageTag("compare-base-1-1")]);
  } finally { rmSync(fixture.checkout, { recursive: true, force: true }); }
});

test("given a foreign BASE project, when HEAD attempts the bridge, then no fixture or native command runs", () => {
  // given
  const fixture = pairedSeedCheckout();
  const unexpected = () => assert.fail("Native operation must not run");
  try {
    // when / then
    assert.throws(() => seedSecurityEnvironment("compare-base-1-1", fixture.recorded.COURTSIDE_SECURITY_IMAGE,
      fixture.state, { composeRoot: fixture.checkout }, {
        resources: () => [{ type: "container", id: "foreign", labels: { "com.docker.compose.project": "foreign" } }],
        stageClasses: unexpected, inspect: unexpected, buildFixtures: unexpected,
        execute: unexpected, removeImage: unexpected
      }), /does not belong/);
  } finally { rmSync(fixture.checkout, { recursive: true, force: true }); }
});

test("given an explicit BASE checkout, when required state or checkout binding is invalid, then seeding refuses before native operations", () => {
  // given
  const fixture = pairedSeedCheckout();
  try {
    // when / then
    assert.throws(() => securitySeedPlan("compare-base-1-1", fixture.recorded.COURTSIDE_SECURITY_IMAGE,
      { ...fixture.recorded, COURTSIDE_SECURITY_SHARED_PASSWORD: "" }, { composeRoot: fixture.checkout }), /required/);
    assert.throws(() => seedSecurityEnvironment("compare-base-1-1", fixture.recorded.COURTSIDE_SECURITY_IMAGE,
      fixture.state, { composeRoot: join(fixture.checkout, "missing") }, {}), /checkout|compose|ENOENT/);
    assert.throws(() => seedSecurityEnvironment("compare-head-1-1", fixture.recorded.COURTSIDE_SECURITY_IMAGE,
      fixture.state, { composeRoot: fixture.checkout }, {}), /state|run/);
    const alias = join(fixture.checkout, "alias");
    symlinkSync(fixture.checkout, alias);
    assert.throws(() => securitySeedPlan("compare-base-1-1", fixture.recorded.COURTSIDE_SECURITY_IMAGE,
      fixture.recorded, { composeRoot: alias }), /canonical/);
    assert.throws(() => securitySeedPlan("compare-base-1-1", fixture.recorded.COURTSIDE_SECURITY_IMAGE,
      fixture.recorded, { composeRoot: "." }), /absolute/);
  } finally { rmSync(fixture.checkout, { recursive: true, force: true }); }
});

test("given BASE state missing a required value, when HEAD seeds it, then every native closure remains unused", () => {
  // given
  const fixture = pairedSeedCheckout();
  const calls = [];
  const unexpected = () => calls.push("native");
  writeFileSync(fixture.state, JSON.stringify({ ...fixture.recorded, COURTSIDE_SECURITY_SHARED_PASSWORD: "" }));
  try {
    // when / then
    assert.throws(() => seedSecurityEnvironment("compare-base-1-1", fixture.recorded.COURTSIDE_SECURITY_IMAGE,
      fixture.state, { composeRoot: fixture.checkout }, {
        resources: unexpected, buildFixtures: unexpected, execute: unexpected, removeImage: unexpected,
        stageClasses: unexpected, inspect: unexpected
      }), /required compose value/);
    assert.deepEqual(calls, []);
  } finally { rmSync(fixture.checkout, { recursive: true, force: true }); }
});

test("given a recorded environment, when the candidate seeds it, then the seeder runs beside the target it names", () => {
  // given
  const recorded = recordedEnvironment();

  // when
  const plan = securitySeedPlan("compare-base-1-1", recorded.COURTSIDE_SECURITY_IMAGE, recorded);

  // then
  assert.equal(plan.command, "docker");
  assert.deepEqual(plan.args, [...securityComposeArgs("compare-base-1-1"),
    "run", "--rm", "--no-deps", "-T", "seeder"]);
  assert.equal(plan.environment.COURTSIDE_SECURITY_FIXTURES_IMAGE, securitySeedImageTag("compare-base-1-1"));
  assert.notEqual(securitySeedImageTag("compare-base-1-1"), securityFixturesImageTag("compare-base-1-1"),
    "seeding another run must not retag the fixture image that run built for itself");
  assert.equal(plan.environment.COURTSIDE_SECURITY_SHARED_PASSWORD, "synthetic",
    "the synthetic accounts have to carry the password the recorded run already published to its tooling");
});

test("given an environment recorded for another run or image, when the candidate seeds it, then it refuses", () => {
  // given
  const recorded = recordedEnvironment();

  // when / then
  assert.throws(() => securitySeedPlan("compare-head-1-1", recorded.COURTSIDE_SECURITY_IMAGE, recorded),
    /belongs to a different security run/);
  assert.throws(() => securitySeedPlan("compare-base-1-1", `sha256:${"d".repeat(64)}`, recorded),
    /assesses a different candidate/);
});

test("given a recorded environment, when the candidate seeds it, then only what compose reads is handed on", () => {
  // given
  const recorded = recordedEnvironment({
    COURTSIDE_LOGIN_ADDRESS_MAX_FAILURES: "5",
    PATH: "/tmp/attacker",
    DOCKER_HOST: "tcp://attacker.invalid:2375"
  });

  // when
  const plan = securitySeedPlan("compare-base-1-1", recorded.COURTSIDE_SECURITY_IMAGE, recorded);

  // then
  assert.equal(plan.environment.COURTSIDE_LOGIN_ADDRESS_MAX_FAILURES, "5",
    "compose refuses to interpolate its own required name");
  for (const name of ["PATH", "DOCKER_HOST"]) {
    assert.equal(name in plan.environment, false,
      `${name} from the recorded file would decide which executable the docker call runs`);
  }
});

// A run measures its own meter boundary now: `meter-registry-separation` asks the container and
// the proxy and compares 200 against 404. What is left here is the arrangement that makes that
// measurement possible, which no request can show — the flag that lets the registry answer at all.
test("given the security Compose file, when the run samples the meter registry, "
  + "then the environment enables it and the run measures who can reach it", () => {
  // given
  const compose = readFileSync(fileURLToPath(new URL("../deploy/compose.security.yaml", import.meta.url)), "utf8");
  const environment = readFileSync(fileURLToPath(new URL("./security-environment.mjs", import.meta.url)), "utf8");

  // when / then
  assert.match(compose, /MANAGEMENT_ENDPOINTS_WEB_EXPOSURE_INCLUDE: health,prometheus,mappings/);
  assert.match(compose, /COURTSIDE_PERFORMANCE_TELEMETRY_ENABLED: "true"/);
  assert.match(environment, /id: "meter-registry-separation"[\s\S]*?meters === "200" && metersFromOutside === "404"/);
});
