import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { resourceIntegritySchema, resourceSessionAttributeDigest, compareResourceIntegrity } from "./security-resource-integrity.mjs";
import { parseResourceJournal, resourceJournalMarker } from "./security-resource-journal.mjs";
import { captureResourceAuthentication, resourceSessionProjectionClassPaths } from "./security-resource-auth.mjs";

const primary = "10000000-0000-0000-0000-000000000001";
const account = "20000000-0000-0000-0000-000000000001";
const raw = "a".repeat(36);
const names = ["SPRING_SECURITY_CONTEXT", "courtside.authenticated-at", "courtside.browser-family"];

function row(table, values) {
  return Object.fromEntries(resourceIntegritySchema[table].columns.map((key) => [key, values[key] ?? null]));
}

function fixture() {
  const before = { schemaVersion: 1, tables: Object.fromEntries(Object.entries(resourceIntegritySchema)
    .map(([name, schema]) => [name, { ...structuredClone(schema), rows: [] }])) };
  before.tables.user_account.rows.push(row("user_account", { id: account, username: "security.manager.1" }));
  const effects = structuredClone(before);
  effects.tables.spring_session.rows.push(row("spring_session", { primary_id: primary, session_id: raw,
    creation_time: 1000, last_access_time: 2000, max_inactive_interval: 1800, expiry_time: 1802000,
    principal_name: "security.manager.1" }));
  effects.tables.spring_session_attributes.rows = names.map((name, index) => row("spring_session_attributes", {
    session_primary_id: primary, attribute_name: name, attribute_bytes: `\\x0${index + 1}`
  }));
  return { before, effects, sourceAddress: "192.0.2.10", decoderContainer: "courtside-security-decoder-example",
    sessionPolicy: { inactivitySeconds: 1800, absoluteLifetimeMilliseconds: 86400000,
      concurrentLimit: 5, cookieName: "SESSION", browserFamily: "CHROME" },
    loginPolicy: { verificationConcurrency: 2, address: { maxFailures: 20, windowMilliseconds: 60000, blockMilliseconds: 600000 },
      global: { windowMilliseconds: 60000 }, proofMode: "http-bounded-v1" },
    runtimeBinding: { sourceDigest: `sha256:${"1".repeat(64)}`, classDigests: Object.fromEntries(
      resourceSessionProjectionClassPaths.map((path, index) => [path, `sha256:${String(index + 2).repeat(64)}`])) },
    journal: { schemaVersion: 1, complete: true, captureComplete: true, effectsSettled: true,
      operations: [{ id: "login-1", kind: "login", method: "POST", path: "/api/session", status: 200,
        username: "security.manager.1", accountId: account, sessionId: null, requestSessionId: null,
        responseSessionId: raw, startedAt: "2026-10-05T10:00:00.000Z", endedAt: "2026-10-05T10:00:01.000Z" }],
      ownedSessionIds: [raw], loginUsernames: ["security.manager.1"], mailReceipts: [], publications: [] } };
}

function value(name) {
  if (name === names[1]) return { className: "java.lang.Long", value: 1000 };
  if (name === names[2]) return { className: "java.lang.String", value: "CHROME" };
  return { contextClass: "org.springframework.security.core.context.SecurityContextImpl",
    authenticationClass: "org.springframework.security.authentication.UsernamePasswordAuthenticationToken",
    principalClass: "org.courtside.identity.internal.CourtsideUserDetails", authenticated: true,
    accountId: account, username: "security.manager.1", securityEpoch: 0, authorities: ["ROLE_SPORT_DIRECTOR"],
    principalAuthorities: ["ROLE_SPORT_DIRECTOR"], passwordFactorIssuedAt: null,
    credentials: null, details: null, principalPassword: null, enabled: true,
    accountNonExpired: true, accountNonLocked: true, credentialsNonExpired: true };
}

function executor(input, transform = (result) => result) {
  const calls = [];
  const command = async (args, options) => {
    calls.push({ args, options });
    if (args.includes("sha256sum")) return { stdout: resourceSessionProjectionClassPaths
      .map((path) => `${input.runtimeBinding.classDigests[path].slice(7)}  ${path}`).join("\n") + "\n" };
    const attribute = JSON.parse(options.input).attributes[0];
    return transform({ stdout: JSON.stringify({ attributes: [{ name: attribute.name,
      decoder: "spring-jdbc-java-serialization-v1", bytesDigest: resourceSessionAttributeDigest(attribute.attributeBytes),
      value: value(attribute.name) }] }) }, attribute, calls);
  };
  return { calls, command };
}

test("given actual session rows, when authentication is captured, then raw IDs map to database primary IDs", async () => {
  // given
  const input = fixture();
  const original = structuredClone(input);
  const native = executor(input);
  // when
  const result = await captureResourceAuthentication(input, native.command);
  // then
  assert.equal(result.outcome, "passed", JSON.stringify(result.findings));
  assert.deepEqual(result.authentication.ownedSessionPrimaryIds, [primary]);
  assert.deepEqual(result.ownedSessionIds, [raw]);
  assert.deepEqual(result.loginUsernames, ["security.manager.1"]);
  assert.equal(result.journal.operations[0].sourceAddress, input.sourceAddress);
  assert.equal(result.journal.sessions[0].cookieValue, Buffer.from(raw).toString("base64"));
  assert.deepEqual(result.journal.sessions[0].operationIds, ["login-1"]);
  assert.deepEqual(result.journal.sessions[0].attributes.map((attribute) => attribute.value), names.map(value));
  assert.deepEqual(result.privateProof.runtimeBinding, input.runtimeBinding);
  assert.match(result.runtimeDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(input, original);
  assert.equal(native.calls.length, 5);
  for (const call of native.calls.filter((call) => call.options.input)) {
    assert.deepEqual(call.args, ["exec", "-i", "-w", "/app", input.decoderContainer, "java",
      "--sun-misc-unsafe-memory-access=deny",
      "-Dloader.main=org.courtside.securityassessment.SecuritySessionAttributeProjection", "-cp", ".",
      "org.springframework.boot.loader.launch.PropertiesLauncher"]);
    assert.equal(call.options.outputLimitBytes, 32768);
    assert.ok(call.options.timeoutMilliseconds <= 10000);
  }
});

test("given forged journal facts, when capturing, then only native projections and trusted login addresses survive", async () => {
  // given
  const input = fixture();
  input.journal.sessions = [{ attributes: [{ value: "forged" }] }];
  input.journal.loginTransitions = [{ attempts: 0 }];
  input.journal.loginTransitionsComplete = true;
  input.journal.operations[0].sourceAddress = "203.0.113.9";
  input.journal.operations.push({ id: "read-1", kind: "read", method: "GET", path: "/api/session",
    sessionId: raw, sourceAddress: "203.0.113.9" });
  // when
  const result = await captureResourceAuthentication(input, executor(input).command);
  // then
  assert.equal(result.outcome, "passed");
  assert.equal(result.journal.sessions[0].attributes[0].value.username, "security.manager.1");
  assert.equal(result.journal.operations[0].sourceAddress, input.sourceAddress);
  assert.equal(result.journal.operations[1].sourceAddress, undefined);
  assert.equal(result.journal.loginTransitions, undefined);
  assert.equal(result.journal.loginTransitionsComplete, undefined);
});

test("given owned baseline and changed foreign sessions, when capturing, then both phases decode without granting foreign ownership", async () => {
  // given
  const input = fixture();
  input.before.tables.spring_session = structuredClone(input.effects.tables.spring_session);
  input.before.tables.spring_session_attributes = structuredClone(input.effects.tables.spring_session_attributes);
  input.effects.tables.spring_session.rows[0].last_access_time++;
  const foreignPrimary = "10000000-0000-0000-0000-000000000002";
  input.effects.tables.spring_session.rows.push({ ...input.effects.tables.spring_session.rows[0],
    primary_id: foreignPrimary, session_id: "b".repeat(36) });
  input.effects.tables.spring_session_attributes.rows.push(...input.effects.tables.spring_session_attributes.rows
    .map((attribute) => ({ ...attribute, session_primary_id: foreignPrimary })));
  // when
  const result = await captureResourceAuthentication(input, executor(input).command);
  // then
  assert.equal(result.outcome, "passed");
  assert.deepEqual(result.authentication.ownedSessionPrimaryIds, [primary]);
  assert.equal(result.journal.sessions.length, 3);
  assert.deepEqual(result.journal.sessions[0].operationIds, []);
});

for (const [name, change] of [
  ["missing binding", (input) => { delete input.runtimeBinding; }],
  ["missing class", (input) => { delete input.runtimeBinding.classDigests[resourceSessionProjectionClassPaths[0]]; }],
  ["boolean trust", (input) => { input.runtimeBinding = true; }],
  ["unknown class", (input) => { input.runtimeBinding.classDigests["/tmp/untrusted.class"] = `sha256:${"1".repeat(64)}`; }],
  ["missing source", (input) => { delete input.sourceAddress; }],
  ["missing policy", (input) => { delete input.sessionPolicy; }],
  ["missing login policy", (input) => { delete input.loginPolicy; }],
  ["option-like container", (input) => { input.decoderContainer = "--privileged"; }],
  ["missing decoder container", (input) => { delete input.decoderContainer; }],
  ["unsupported snapshot", (input) => { input.effects.tables.unknown = input.effects.tables.spring_session; }],
  ["oversized journal", (input) => { input.journal.extra = "a".repeat(8 * 1024 * 1024); }],
  ["too many operations", (input) => { input.journal.operations = Array(10001).fill(input.journal.operations[0]); }],
  ["unknown attribute", (input) => { input.effects.tables.spring_session_attributes.rows[0].attribute_name = "unknown"; }],
  ["missing attribute", (input) => { input.effects.tables.spring_session_attributes.rows.pop(); }],
  ["oversized attribute", (input) => { input.effects.tables.spring_session_attributes.rows[0].attribute_bytes = "\\x" + "ab".repeat(65537); }],
  ["ambiguous raw session", (input) => { input.effects.tables.spring_session.rows.push({
    ...input.effects.tables.spring_session.rows[0], primary_id: "10000000-0000-0000-0000-000000000002" }); }]
]) test(`given ${name}, when capturing authentication, then evidence stays incomplete before execution`, async () => {
  // given
  const input = fixture();
  change(input);
  const calls = [];
  // when
  const result = await captureResourceAuthentication(input, async (...args) => { calls.push(args); });
  // then
  assert.equal(result.outcome, "incomplete");
  assert.equal(result.authentication, null);
  assert.equal(calls.length, 0);
});

for (const [name, transform, outcome] of [
  ["wrong byte digest", (result) => { const parsed = JSON.parse(result.stdout); parsed.attributes[0].bytesDigest = `sha256:${"0".repeat(64)}`;
    return { stdout: JSON.stringify(parsed) }; }, "failed"],
  ["wrong decoder", (result) => ({ stdout: result.stdout.replace("spring-jdbc-java-serialization-v1", "fake") }), "incomplete"],
  ["extra field", (result) => ({ stdout: result.stdout.replace('{"attributes":', '{"extra":true,"attributes":') }), "incomplete"],
  ["duplicate field", (result) => ({ stdout: result.stdout.replace('{"attributes":', '{"attributes":[],"attributes":') }), "incomplete"],
  ["trailing output", (result) => ({ stdout: result.stdout + "{}" }), "incomplete"],
  ["oversized output", () => ({ stdout: "a".repeat(32769) }), "incomplete"],
  ["native failure", () => { throw new Error("private bytes and credentials"); }, "incomplete"],
  ["unexpected projection", (result) => { const parsed = JSON.parse(result.stdout); parsed.attributes[0].value.extra = true;
    return { stdout: JSON.stringify(parsed) }; }, "incomplete"]
]) test(`given ${name}, when decoding actual bytes, then the helper rejects unsafe evidence`, async () => {
  // given
  const input = fixture();
  // when
  const result = await captureResourceAuthentication(input, executor(input, transform).command);
  // then
  assert.equal(result.outcome, outcome);
  assert.equal(result.authentication, null);
  assert.ok(!JSON.stringify(result).includes("private bytes"));
});

test("given changed mounted classes, when binding is checked, then no decoder result qualifies", async () => {
  // given
  const input = fixture();
  const native = executor(input);
  let checks = 0;
  const command = async (args, options) => {
    const result = await native.command(args, options);
    if (args.includes("sha256sum") && ++checks === 2) result.stdout = result.stdout.replace("2".repeat(64), "0".repeat(64));
    return result;
  };
  // when
  const result = await captureResourceAuthentication(input, command);
  // then
  assert.equal(result.outcome, "failed");
  assert.equal(result.authentication, null);
});

test("given another account ID in a login, when baseline identity is bound, then the journal cannot relabel that account", async () => {
  // given
  const input = fixture();
  input.journal.operations[0].accountId = primary;
  // when
  const result = await captureResourceAuthentication(input, executor(input).command);
  // then
  assert.equal(result.outcome, "failed");
});

function parsedFixture() {
  const input = fixture();
  input.sessionPolicy.passwordFactorRequired = true;
  const start = "2026-10-05T10:00:00.000Z";
  const loginEnd = "2026-10-05T10:00:01.000Z";
  const end = "2026-10-05T10:00:02.000Z";
  const frames = [{ event: "start", runId: "run-example", clock: start },
    { event: "begin", id: "0:1", vu: 0, sequence: 1, kind: "login", startedAt: start,
      method: "POST", path: "/api/session", actorUsername: null, request: { username: "security.manager.1" } },
    { event: "end", id: "0:1", status: 200, endedAt: loginEnd, responseBookingId: null,
      identityUsername: null, ownedSessionIds: [raw], sessionId: null, responseSessionId: raw },
    { event: "begin", id: "0:2", vu: 0, sequence: 2, kind: "read", startedAt: loginEnd,
      method: "GET", path: "/api/session", actorUsername: null, request: null },
    { event: "end", id: "0:2", status: 200, endedAt: end, responseBookingId: null,
      identityUsername: "security.manager.1", ownedSessionIds: [raw], sessionId: raw, responseSessionId: null },
    { event: "finish", runId: "run-example", started: 2, finished: 2, dropped: 0 }];
  input.journal = parseResourceJournal(frames.map((frame) => resourceJournalMarker + JSON.stringify(frame)).join("\n"),
    { accounts: input.before.tables.user_account.rows });
  input.journal.effectsSettled = true;
  input.before.tables.user_account.rows[0].enabled = true;
  input.before.tables.user_account.rows[0].security_epoch = 0;
  input.before.tables.user_account.rows[0].password_change_required = false;
  input.effects.tables.user_account = structuredClone(input.before.tables.user_account);
  input.effects.tables.user_account.rows[0].last_login_at = loginEnd;
  input.before.tables.user_account_role.rows.push(row("user_account_role", { user_account_id: account, role: "SPORT_DIRECTOR" }));
  input.effects.tables.user_account_role = structuredClone(input.before.tables.user_account_role);
  const session = input.effects.tables.spring_session.rows[0];
  session.creation_time = Date.parse(loginEnd);
  session.last_access_time = Date.parse(loginEnd);
  session.expiry_time = session.last_access_time + 1800000;
  return { input, contract: { schemaVersion: 1, managerAccountId: account, interval: { startedAt: start, endedAt: end },
    mailEnabled: false,
    publicationListeners: ["org.courtside.notification.internal.BookingMailer.on(org.courtside.shared.BookingConfirmed)"],
    publicationLifecycle: {
      completionMode: "DELETE", eventType: "org.courtside.shared.BookingConfirmed",
      listenerId: "org.courtside.notification.internal.BookingMailer.on(org.courtside.shared.BookingConfirmed)",
      repositoryMode: "JDBC_V2"
    } }, authenticatedAt: Date.parse(loginEnd) };
}

async function captureParsed(prepared, alter = () => {}) {
  const native = executor(prepared.input, (result, attribute) => {
    const parsed = JSON.parse(result.stdout);
    if (attribute.name === names[1]) parsed.attributes[0].value.value = prepared.authenticatedAt;
    if (attribute.name === names[0]) {
      parsed.attributes[0].value.authorities.unshift("FACTOR_PASSWORD");
      parsed.attributes[0].value.passwordFactorIssuedAt = new Date(prepared.authenticatedAt).toISOString();
    }
    alter(parsed.attributes[0]);
    return { stdout: JSON.stringify(parsed) };
  });
  const subjectHash = createHash("sha256").update("all").digest("hex");
  prepared.input.effects.tables.login_attempt_limit.rows.push(row("login_attempt_limit", {
    scope: "GLOBAL", subject_hash: subjectHash, window_started_at: "2026-10-05T10:00:01.000Z", attempt_count: 1
  }));
  return captureResourceAuthentication(prepared.input, native.command);
}

test("given actual parser session IDs, when native projections are bound, then the comparator accepts the complete authentication effects", async () => {
  // given
  const prepared = parsedFixture();
  // when
  const capture = await captureParsed(prepared);
  const result = compareResourceIntegrity({ before: prepared.input.before, after: prepared.input.effects,
    contract: { ...prepared.contract, authentication: capture.authentication }, journal: capture.journal });
  // then
  assert.equal(prepared.input.journal.complete, true);
  assert.equal(capture.outcome, "passed", JSON.stringify(capture.findings));
  assert.equal(result.outcome, "passed", JSON.stringify(result.findings));
});

test("given a native authority mutation, when projections reach the comparator, then the actual mutation is not replaced by baseline values", async () => {
  // given
  const prepared = parsedFixture();
  // when
  const capture = await captureParsed(prepared, (projection) => {
    if (projection.name === names[0]) projection.value.authorities = ["ROLE_ADMIN"];
  });
  const result = compareResourceIntegrity({ before: prepared.input.before, after: prepared.input.effects,
    contract: { ...prepared.contract, authentication: capture.authentication }, journal: capture.journal });
  // then
  assert.equal(capture.outcome, "passed");
  assert.equal(capture.journal.sessions[0].attributes[0].value.authorities[0], "ROLE_ADMIN");
  assert.equal(result.outcome, "failed");
});

test("given incomplete capture flags, when attributes decode successfully, then the helper never promotes journal coverage", async () => {
  // given
  const input = fixture();
  input.journal.complete = false;
  input.journal.captureComplete = false;
  input.journal.effectsSettled = false;
  // when
  const result = await captureResourceAuthentication(input, executor(input).command);
  // then
  assert.equal(result.journal.complete, false);
  assert.equal(result.journal.captureComplete, false);
  assert.equal(result.journal.effectsSettled, false);
});

test("given equivalent class maps and a changed source graph, when runtime digests are computed, then order is ignored and graph changes remain bound", async () => {
  // given
  const input = fixture();
  const reordered = fixture();
  reordered.runtimeBinding.classDigests = Object.fromEntries(Object.entries(reordered.runtimeBinding.classDigests).reverse());
  const changed = fixture();
  changed.runtimeBinding.sourceDigest = `sha256:${"9".repeat(64)}`;
  // when
  const first = await captureResourceAuthentication(input, executor(input).command);
  const second = await captureResourceAuthentication(reordered, executor(reordered).command);
  const third = await captureResourceAuthentication(changed, executor(changed).command);
  // then
  assert.equal(first.runtimeDigest, second.runtimeDigest);
  assert.notEqual(first.runtimeDigest, third.runtimeDigest);
});

test("given missing login identity confirmation, when capturing, then absent evidence remains incomplete", async () => {
  // given
  const input = fixture();
  input.journal.operations[0].accountId = null;
  // when
  const result = await captureResourceAuthentication(input, executor(input).command);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given the actual global threshold, when policy is bound, then its validated native value remains in the authentication contract", async () => {
  // given
  const input = fixture();
  input.loginPolicy.global.threshold = 100;
  // when
  const result = await captureResourceAuthentication(input, executor(input).command);
  // then
  assert.equal(result.outcome, "passed");
  assert.deepEqual(result.authentication.loginPolicy.global, { threshold: 100, windowMilliseconds: 60000 });
});

for (const threshold of [0, -1, 1.5, "100", Number.MAX_SAFE_INTEGER + 1, null]) {
  test(`given an invalid global threshold of ${threshold}, when binding policy, then execution stays incomplete`, async () => {
    // given
    const input = fixture();
    input.loginPolicy.global.threshold = threshold;
    const native = executor(input);
    // when
    const result = await captureResourceAuthentication(input, native.command);
    // then
    assert.equal(result.outcome, "incomplete");
    assert.equal(native.calls.length, 0);
  });
}

for (const timestamp of [null, "2026-10-05T10:00:00Z", "2026-10-05T10:00:00.123Z",
  "2026-10-05T10:00:00.123456Z", "2026-10-05T10:00:00.123456789Z",
  "2099-10-05T10:00:00.123456789Z"]) {
  test(`given a password factor timestamp of ${timestamp}, when validating native projection shape, then the actual timestamp remains unchanged`, async () => {
    // given
    const input = fixture();
    const native = executor(input, (result, attribute) => {
      const parsed = JSON.parse(result.stdout);
      if (attribute.name === names[0]) {
        parsed.attributes[0].value.passwordFactorIssuedAt = timestamp;
        if (timestamp !== null) parsed.attributes[0].value.authorities.unshift("FACTOR_PASSWORD");
      }
      return { stdout: JSON.stringify(parsed) };
    });
    // when
    const result = await captureResourceAuthentication(input, native.command);
    // then
    assert.equal(result.outcome, "passed", JSON.stringify(result.findings));
    assert.equal(result.journal.sessions[0].attributes[0].value.passwordFactorIssuedAt, timestamp);
    if (timestamp !== null) assert.equal(result.journal.sessions[0].attributes[0].value.authorities[0], "FACTOR_PASSWORD");
  });
}

test("given a future native password factor, when its unchanged projection reaches the comparator, then the original login cannot prove it", async () => {
  // given
  const prepared = parsedFixture();
  const future = "2099-10-05T10:00:00.123456789Z";
  // when
  const capture = await captureParsed(prepared, (projection) => {
    if (projection.name === names[0]) projection.value.passwordFactorIssuedAt = future;
  });
  const result = compareResourceIntegrity({ before: prepared.input.before, after: prepared.input.effects,
    contract: { ...prepared.contract, authentication: capture.authentication }, journal: capture.journal });
  // then
  assert.equal(capture.outcome, "passed");
  assert.equal(capture.journal.sessions[0].attributes[0].value.passwordFactorIssuedAt, future);
  assert.equal(result.outcome, "failed");
});

for (const timestamp of [undefined, 123, {}, "", "not-an-instant", "2026-02-30T10:00:00Z",
  "2026-10-05T24:00:00Z", "2026-10-05T10:00:00+00:00", "1969-12-31T23:59:59Z",
  "2026-10-05T10:00:00.1234567890Z", "2026-10-05T10:00:00.1Z", "2026-10-05T10:00:00.12Z",
  "2026-10-05T10:00:00.1234Z", "2026-10-05T10:00:00.12345Z", "2026-10-05T10:00:00.1234567Z",
  "2026-10-05T10:00:00.12345678Z", "2026-10-05T10:00:00Z\n"]) {
  test(`given a malformed password factor timestamp ${JSON.stringify(timestamp)}, when validating native projection, then unsafe proof stays incomplete`, async () => {
    // given
    const input = fixture();
    const native = executor(input, (result, attribute) => {
      const parsed = JSON.parse(result.stdout);
      if (attribute.name === names[0]) parsed.attributes[0].value.passwordFactorIssuedAt = timestamp;
      return { stdout: JSON.stringify(parsed) };
    });
    // when
    const result = await captureResourceAuthentication(input, native.command);
    // then
    assert.equal(result.outcome, "incomplete");
    assert.equal(result.authentication, null);
  });
}

for (const required of [true, false]) {
  test(`given native password factor policy ${required}, when binding the runtime contract, then the explicit policy remains unchanged`, async () => {
    // given
    const input = fixture();
    input.sessionPolicy.passwordFactorRequired = required;
    // when
    const result = await captureResourceAuthentication(input, executor(input).command);
    // then
    assert.equal(result.outcome, "passed");
    assert.equal(result.authentication.sessionPolicy.passwordFactorRequired, required);
  });
}

for (const required of [null, 0, "true"]) {
  test(`given nonboolean password factor policy ${JSON.stringify(required)}, when binding the contract, then incomplete policy cannot execute`, async () => {
    // given
    const input = fixture();
    input.sessionPolicy.passwordFactorRequired = required;
    const native = executor(input);
    // when
    const result = await captureResourceAuthentication(input, native.command);
    // then
    assert.equal(result.outcome, "incomplete");
    assert.equal(native.calls.length, 0);
  });
}

for (const authorities of [undefined, null, ["ROLE_Z", "ROLE_A"], ["ROLE_ADMIN", "ROLE_ADMIN"],
  [123], ["a".repeat(65)], Array.from({ length: 33 }, (_, index) => `ROLE_${String(index).padStart(2, "0")}`)]) {
  test(`given malformed principal authorities ${JSON.stringify(authorities)}, when validating native projection, then the helper rejects the shape`, async () => {
    // given
    const input = fixture();
    const native = executor(input, (result, attribute) => {
      const parsed = JSON.parse(result.stdout);
      if (attribute.name === names[0]) parsed.attributes[0].value.principalAuthorities = authorities;
      return { stdout: JSON.stringify(parsed) };
    });
    // when
    const result = await captureResourceAuthentication(input, native.command);
    // then
    assert.equal(result.outcome, "incomplete");
    assert.equal(result.authentication, null);
  });
}

for (const flag of ["truncated", "timedOut"]) {
  for (const phase of ["binding", "projection"]) {
    test(`given ${flag} during ${phase} with a valid output prefix, when native evidence is captured, then the helper fails closed`, async () => {
      // given
      const input = fixture();
      const native = executor(input);
      const command = async (args, options) => {
        const result = await native.command(args, options);
        if (args.includes("sha256sum") === (phase === "binding")) result[flag] = true;
        return result;
      };
      // when
      const result = await captureResourceAuthentication(input, command);
      // then
      assert.equal(result.outcome, "incomplete");
      assert.equal(result.authentication, null);
      assert.equal(result.runtimeBinding, null);
      assert.equal(result.privateProof, null);
      assert.equal(native.calls.length, phase === "binding" ? 1 : 2);
    });
  }
}

test("given a decoder command that throws, when authentication is captured, then the finding names the failure without its text", async () => {
  // given
  const input = fixture();
  const command = async () => { throw new Error("Owned security process failed (1): session_id=ExampleSession"); };
  // when
  const result = await captureResourceAuthentication(input, command);
  // then
  assert.equal(result.outcome, "incomplete");
  assert.deepEqual(result.findings, [{ code: "session-decoder-execution-incomplete", cause: "Error" }],
    "an incomplete capture names what stopped the decoder");
  assert.doesNotMatch(JSON.stringify(result), /ExampleSession/, "the decoder's output must not reach the finding");
});

test("given an unexpected failure inside capture, when it is reported, then the finding names its error type", async () => {
  // given
  const input = fixture();
  const native = executor(input);
  const command = async (args, options) => args.includes("sha256sum") ? native.command(args, options)
    : { get stdout() { throw new RangeError("ExampleDetail"); } };
  // when
  const result = await captureResourceAuthentication(input, command);
  // then
  assert.equal(result.outcome, "incomplete");
  assert.deepEqual(result.findings, [{ code: "authentication-evidence-incomplete", cause: "RangeError" }],
    "an error the capture did not expect is named by its type");
  assert.doesNotMatch(JSON.stringify(result), /ExampleDetail/);
});
