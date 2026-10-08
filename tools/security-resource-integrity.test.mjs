import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { parseResourceJournal } from "./security-resource-journal.mjs";
import { resourceDatePlan } from "./security-resource-dates.mjs";
import {
  resourceIntegritySchema, compareResourceIntegrity, resourceIntegritySnapshotFingerprint,
  validatedResourceBookingIds, resourceBookingRequestFingerprint, resourceIntegrityLimits,
  resourceSessionAttributeDigest
} from "./security-resource-integrity.mjs";

const start = "2026-10-05T10:00:00.000Z";
const end = "2026-10-05T10:01:00.000Z";
const time = "2026-10-05T10:00:10.000Z";
const manager = "10000000-0000-0000-0000-000000000001";
const person = "20000000-0000-0000-0000-000000000001";
const bookingId = "30000000-0000-0000-0000-000000000001";
const courtId = "40000000-0000-0000-0000-000000000001";
const cardId = "11111111-1111-1111-1111-111111111111";

function row(table, values) {
  return Object.fromEntries(resourceIntegritySchema[table].columns.map((column) =>
    [column, Object.hasOwn(values, column) ? values[column] : null]));
}

function fixture(withBooking = false) {
  const before = { schemaVersion: 1, tables: Object.fromEntries(
    Object.entries(resourceIntegritySchema).map(([table, definition]) =>
      [table, { ...structuredClone(definition), rows: [] }])) };
  before.tables.person.rows.push(row("person", {
    id: person, first_name: "Jane", last_name: "Doe", email: "jane@example.org"
  }));
  before.tables.user_account.rows.push(row("user_account", {
    id: manager, person_id: person, username: "security.manager.1", password_hash: "private-hash",
    enabled: true, password_change_required: false, locale: "en", security_epoch: 0, version: 0,
    created_at: "2026-10-01T10:00:00.000Z"
  }));
  before.tables.user_account_role.rows.push(row("user_account_role", {
    user_account_id: manager, role: "SPORT_DIRECTOR"
  }));
  before.tables.court.rows.push(row("court", { id: courtId, number: 1, active: true }));
  before.tables.booking_card.rows.push(row("booking_card", {
    id: cardId, allowed_player_counts: [2, 4], active: true, guest_allowed: true
  }));
  const after = structuredClone(before);
  const contract = { schemaVersion: 1, managerAccountId: manager,
    interval: { startedAt: start, endedAt: end }, mailEnabled: true,
    publicationListeners: [], publicationLifecycle: { completionMode: "DELETE", repositoryMode: "JDBC_V2",
      listenerId: "org.courtside.notification.internal.BookingMailer.on(org.courtside.shared.BookingConfirmed)",
      eventType: "org.courtside.shared.BookingConfirmed" },
    authentication: { ownedSessionPrimaryIds: [], loginSubjects: [] } };
  const journal = { schemaVersion: 1, complete: true, effectsSettled: true,
    operations: [], mailReceipts: [], publications: [] };
  if (withBooking) {
    const request = { cardId, courtIds: [courtId], startsAt: "2026-10-08T16:00:00.000Z",
      endsAt: "2026-10-08T17:00:00.000Z", note: "Security occupancy run-example",
      participants: [{ kind: "GUEST", personId: null, guestName: "Example Guest", cardId: null }],
      idempotencyKey: "security-run-example-1", requestFingerprint: null };
    request.requestFingerprint = resourceBookingRequestFingerprint(request);
    journal.operations.push({ id: "request-1", kind: "createBooking", status: 201,
      startedAt: start, endedAt: time, actorAccountId: manager, responseBookingId: bookingId, request });
    after.tables.booking.rows.push(row("booking", { id: bookingId, card_id: cardId,
      booked_by: manager, status: "CONFIRMED", created_at: time, note: request.note,
      idempotency_key: request.idempotencyKey, request_fingerprint: request.requestFingerprint }));
    after.tables.court_allocation.rows.push(row("court_allocation", {
      id: "50000000-0000-0000-0000-000000000001", booking_id: bookingId, court_id: courtId,
      starts_at: request.startsAt, ends_at: request.endsAt, status: "CONFIRMED"
    }));
    after.tables.booking_participant.rows.push(
      row("booking_participant", { id: "60000000-0000-0000-0000-000000000001",
        booking_id: bookingId, position: 1, kind: "MEMBER", person_id: person }),
      row("booking_participant", { id: "60000000-0000-0000-0000-000000000002",
        booking_id: bookingId, position: 2, kind: "GUEST", guest_name: "Example Guest" }));
    after.tables.domain_event.rows.push(row("domain_event", {
      id: "70000000-0000-0000-0000-000000000001", event_type: "booking.booking.confirmed",
      subject_id: bookingId, actor_account_id: manager, occurred_at: time, payload: { bookingId }
    }));
    after.tables.message_record.rows.push(row("message_record", {
      id: "80000000-0000-0000-0000-000000000001", account_id: manager, kind: "BOOKING_CONFIRMED",
      state: "HANDED_OVER", message_id: "<example-1@example.org>", queued_at: time,
      queued_seq: 1, settled_at: time
    }));
    journal.mailReceipts.push({ messageId: "<example-1@example.org>", accountId: manager,
      recipient: "jane@example.org", calendarUid: `booking-${bookingId}@courtside`,
      startsAt: request.startsAt, endsAt: request.endsAt, acceptedAt: time });
  }
  return { before, after, contract, journal };
}

function secondBooking(input, overlapping = false) {
  const secondId = "30000000-0000-0000-0000-000000000002";
  const other = JSON.parse(JSON.stringify(fixture(true)).replaceAll(bookingId, secondId));
  other.journal.operations[0].id = "request-2";
  other.journal.operations[0].request.idempotencyKey = "security-run-example-2";
  if (!overlapping) {
    other.journal.operations[0].request.startsAt = "2026-10-09T16:00:00.000Z";
    other.journal.operations[0].request.endsAt = "2026-10-09T17:00:00.000Z";
  }
  other.journal.operations[0].request.requestFingerprint = resourceBookingRequestFingerprint(other.journal.operations[0].request);
  Object.assign(other.after.tables.booking.rows[0], {
    idempotency_key: other.journal.operations[0].request.idempotencyKey,
    request_fingerprint: other.journal.operations[0].request.requestFingerprint
  });
  for (const table of ["booking", "court_allocation", "booking_participant", "domain_event", "message_record"]) {
    for (const added of other.after.tables[table].rows) {
      if (table !== "booking") added.id = `9${added.id.slice(1)}`;
      if (table === "court_allocation") Object.assign(added, {
        starts_at: other.journal.operations[0].request.startsAt, ends_at: other.journal.operations[0].request.endsAt
      });
      if (table === "message_record") Object.assign(added, { message_id: "<example-2@example.org>", queued_seq: 2 });
      input.after.tables[table].rows.push(added);
    }
  }
  Object.assign(other.journal.mailReceipts[0], { messageId: "<example-2@example.org>",
    startsAt: other.journal.operations[0].request.startsAt, endsAt: other.journal.operations[0].request.endsAt });
  input.journal.operations.push(other.journal.operations[0]);
  input.journal.mailReceipts.push(other.journal.mailReceipts[0]);
}

function ownSession(input, baseline = false) {
  const primaryId = "a0000000-0000-0000-0000-000000000001";
  const sessionId = "A".repeat(36);
  const milliseconds = Date.parse(time);
  input.contract.authentication.ownedSessionPrimaryIds.push(primaryId);
  input.contract.authentication.sessionPolicy = { inactivitySeconds: 1800,
    absoluteLifetimeMilliseconds: 86400000, concurrentLimit: 5,
    cookieName: "__Host-SESSION", browserFamily: "OTHER" };
  const login = { id: "own-login", kind: "login", status: 200, accountId: manager,
    startedAt: start, endedAt: time, responseSessionId: sessionId };
  input.journal.operations.push(login);
  const session = row("spring_session", { primary_id: primaryId, session_id: sessionId,
    creation_time: milliseconds, last_access_time: milliseconds, max_inactive_interval: 1800,
    expiry_time: milliseconds + 1800000, principal_name: "security.manager.1" });
  input.after.tables.spring_session.rows.push(session);
  const context = { contextClass: "org.springframework.security.core.context.SecurityContextImpl",
    authenticationClass: "org.springframework.security.authentication.UsernamePasswordAuthenticationToken",
    principalClass: "org.courtside.identity.internal.CourtsideUserDetails", authenticated: true,
    accountId: manager, username: "security.manager.1", securityEpoch: 0,
    authorities: ["ROLE_SPORT_DIRECTOR"], principalAuthorities: ["ROLE_SPORT_DIRECTOR"], passwordFactorIssuedAt: null,
    credentials: null, details: null, principalPassword: null,
    enabled: true, accountNonExpired: true, accountNonLocked: true, credentialsNonExpired: true };
  const values = [
    ["SPRING_SECURITY_CONTEXT", context, "\\xaced000501"],
    ["courtside.authenticated-at", { className: "java.lang.Long", value: milliseconds }, "\\xaced000502"],
    ["courtside.browser-family", { className: "java.lang.String", value: "OTHER" }, "\\xaced000503"]
  ];
  const observation = { phase: "after", primaryId, sessionId,
    cookieName: "__Host-SESSION", cookieValue: Buffer.from(sessionId).toString("base64"),
    operationIds: [login.id], attributes: values.map(([name, value, bytes]) => ({
      name, decoder: "spring-jdbc-java-serialization-v1", bytesDigest: resourceSessionAttributeDigest(bytes), value
    })) };
  for (const [name, , bytes] of values) input.after.tables.spring_session_attributes.rows.push(
    row("spring_session_attributes", { session_primary_id: primaryId, attribute_name: name, attribute_bytes: bytes }));
  input.journal.sessions = [observation];
  if (baseline) {
    input.before.tables.spring_session.rows.push(structuredClone(session));
    input.before.tables.spring_session_attributes.rows = structuredClone(input.after.tables.spring_session_attributes.rows);
    input.journal.sessions.push({ ...structuredClone(observation), phase: "before", operationIds: [] });
    login.kind = "read";
    login.sessionId = sessionId;
  }
  return { primaryId, sessionId, observation, session };
}

function sharedSessionAfterBooking() {
  const input = fixture(true);
  const own = ownSession(input);
  const booking = input.journal.operations.find(({ kind }) => kind === "createBooking");
  Object.assign(booking, { startedAt: "2026-10-05T10:00:30.000Z", endedAt: "2026-10-05T10:00:40.000Z",
    sessionId: own.sessionId });
  input.after.tables.booking.rows[0].created_at = booking.endedAt;
  input.after.tables.domain_event.rows[0].occurred_at = booking.endedAt;
  Object.assign(input.after.tables.message_record.rows[0], { queued_at: booking.endedAt, settled_at: booking.endedAt });
  input.journal.mailReceipts[0].acceptedAt = booking.endedAt;
  const login = input.journal.operations.find(({ kind }) => kind === "login");
  Object.assign(login, { sourceAddress: "172.20.0.2", requestSessionId: null });
  own.observation.attributes[0].value.details = {
    className: "org.springframework.security.web.authentication.WebAuthenticationDetails",
    remoteAddress: login.sourceAddress, sessionId: login.requestSessionId
  };
  const read = { id: "shared-read", kind: "read", status: 200, sessionId: own.sessionId,
    sourceAddress: "172.20.0.99", startedAt: "2026-10-05T10:00:20.000Z", endedAt: "2026-10-05T10:00:21.000Z" };
  input.journal.operations.push(read);
  own.observation.operationIds.push(read.id, booking.id);
  own.session.last_access_time = Date.parse("2026-10-05T10:00:35.000Z");
  own.session.expiry_time = own.session.last_access_time + 1800000;
  return { input, ...own, login, read, booking };
}

function gatewayBlockedBody(input = fixture()) {
  input.journal.operations.push({ id: "1:99", kind: "gatewayRejectedBody", status: 413,
    method: "POST", path: "/api/session", request: { bodyBytes: 2000001, contentType: "application/x-www-form-urlencoded" },
    startedAt: start, endedAt: time });
  input.journal.gatewayBodyRejectionsComplete = true;
  input.journal.gatewayBodyRejections = [{ operationId: "1:99", method: "POST", path: "/api/session", status: 413,
    bodyBytes: 2000001, contentType: "application/x-www-form-urlencoded", maximumBodyBytes: 2000000,
    forwarded: false, observedAt: time }];
  return input;
}

function actualScriptHarness(clock) {
  const location = new URL("./security-resource-journal.test.mjs", import.meta.url);
  const tests = readFileSync(location, "utf8");
  const start = tests.indexOf("function scriptHarness(");
  const end = tests.indexOf("\ntest(", start);
  assert.ok(start >= 0 && end > start);
  const source = tests.slice(start, end).replaceAll("import.meta.url", JSON.stringify(location.href));
  return vm.runInNewContext(`(${source})(null, 1)`, { readFileSync, URL, vm, Buffer, Date,
    startedAt: clock, court: courtId, card: cardId, manager,
    slotPlan: () => resourceDatePlan({ tables: { club_config: { rows: [{ time_zone: "Europe/Berlin" }] } } }, Date.parse(clock))
  }, { timeout: 1000 });
}

function scriptFixtureStates(journal, clock) {
  const input = fixture(true);
  const own = ownSession(input);
  const receipt = input.journal.mailReceipts[0];
  const winner = journal.operations.find((operation) => operation.kind === "createBooking" && operation.status === 201);
  const login = journal.operations.find((operation) => operation.kind === "login" && operation.status === 200);
  const gateway = journal.operations.find((operation) => operation.kind === "gatewayRejectedBody");
  assert.ok(winner && login && gateway);
  input.journal = structuredClone(journal);
  input.journal.effectsSettled = true;
  const sourceAddress = "172.20.0.2";
  for (const operation of input.journal.operations.filter((operation) => operation.kind === "login")) operation.sourceAddress = sourceAddress;
  input.contract.interval = { startedAt: clock, endedAt: new Date(Date.parse(input.journal.operations.at(-1).endedAt) + 1000).toISOString() };
  for (const snapshot of [input.before, input.after]) {
    snapshot.tables.club_config.rows.push(row("club_config", { id: manager, time_zone: "Europe/Berlin" }));
    snapshot.tables.booking_card.rows.push(row("booking_card", { id: winner.request.cardId, allowed_player_counts: [], active: true }));
  }
  Object.assign(input.after.tables.booking.rows[0], { id: winner.responseBookingId, card_id: winner.request.cardId,
    note: winner.request.note, created_at: winner.endedAt, idempotency_key: winner.request.idempotencyKey,
    request_fingerprint: winner.request.requestFingerprint });
  Object.assign(input.after.tables.court_allocation.rows[0], { booking_id: winner.responseBookingId,
    court_id: winner.request.courtIds[0], starts_at: winner.request.startsAt, ends_at: winner.request.endsAt });
  input.after.tables.booking_participant.rows = [];
  Object.assign(input.after.tables.domain_event.rows[0], { subject_id: winner.responseBookingId,
    payload: { bookingId: winner.responseBookingId }, occurred_at: winner.endedAt });
  Object.assign(input.after.tables.message_record.rows[0], { queued_at: winner.endedAt, settled_at: winner.endedAt });
  Object.assign(receipt, { calendarUid: `booking-${winner.responseBookingId}@courtside`, startsAt: winner.request.startsAt,
    endsAt: winner.request.endsAt, acceptedAt: winner.endedAt });
  input.journal.mailReceipts = [receipt];
  const sessionId = login.responseSessionId;
  const operations = input.journal.operations.filter((operation) => operation.sessionId === sessionId || operation.responseSessionId === sessionId);
  const authenticatedAt = Date.parse(login.endedAt);
  const lastAccess = Math.max(...operations.map((operation) => Date.parse(operation.endedAt)));
  Object.assign(own.session, { session_id: sessionId, creation_time: authenticatedAt, last_access_time: lastAccess,
    expiry_time: lastAccess + 1800000 });
  Object.assign(own.observation, { sessionId, cookieValue: Buffer.from(sessionId).toString("base64"),
    operationIds: operations.map((operation) => operation.id) });
  const context = own.observation.attributes[0].value;
  Object.assign(context, { authorities: ["FACTOR_PASSWORD", "ROLE_SPORT_DIRECTOR"], passwordFactorIssuedAt: login.startedAt,
    details: { className: "org.springframework.security.web.authentication.WebAuthenticationDetails",
      remoteAddress: sourceAddress, sessionId: login.requestSessionId } });
  own.observation.attributes.find(({ name }) => name === "courtside.authenticated-at").value.value = authenticatedAt;
  input.contract.authentication.sessionPolicy.passwordFactorRequired = true;
  input.journal.sessions = [own.observation];
  const addressHash = createHash("sha256").update(`login:${sourceAddress}`).digest("hex");
  const globalHash = createHash("sha256").update("all").digest("hex");
  input.contract.authentication.loginSubjects = [{ scope: "ADDRESS", subjectHash: addressHash }, { scope: "GLOBAL", subjectHash: globalHash }];
  input.contract.authentication.loginPolicy = { proofMode: "http-bounded-v1", sourceAddress,
    address: { maxFailures: 5, windowMilliseconds: 60000, blockMilliseconds: 60000 }, global: { windowMilliseconds: 60000 } };
  input.after.tables.login_attempt_limit.rows.push(row("login_attempt_limit", { scope: "GLOBAL", subject_hash: globalHash,
    attempt_count: journal.operations.filter((operation) => operation.kind === "login").length,
    window_started_at: login.startedAt }));
  input.journal.gatewayBodyRejectionsComplete = true;
  input.journal.gatewayBodyRejections = [{ operationId: gateway.id, method: gateway.method, path: gateway.path,
    status: 413, bodyBytes: gateway.request.bodyBytes, contentType: gateway.request.contentType,
    maximumBodyBytes: 2000000, forwarded: false, observedAt: gateway.endedAt }];
  return input;
}

function loginBuckets(input) {
  const sourceAddress = "172.20.0.2";
  const addressHash = createHash("sha256").update(`login:${sourceAddress}`).digest("hex");
  const globalHash = createHash("sha256").update("all").digest("hex");
  input.contract.authentication.loginSubjects = [
    { scope: "ADDRESS", subjectHash: addressHash }, { scope: "GLOBAL", subjectHash: globalHash }
  ];
  input.contract.authentication.loginPolicy = { sourceAddress,
    address: { maxFailures: 5, windowMilliseconds: 60000, blockMilliseconds: 60000 },
    global: { windowMilliseconds: 60000 } };
  input.journal.loginTransitionsComplete = true;
  input.journal.loginTransitions = [];
  for (let index = 1; index <= 5; index++) {
    const at = `2026-10-05T10:00:0${index}.000Z`;
    input.journal.operations.push({ id: `failed-${index}`, kind: "login", status: 401,
      startedAt: start, endedAt: time, sourceAddress });
    input.journal.loginTransitions.push({ sequence: index, operationId: `failed-${index}`, kind: "register",
      retryAt: at, addressAt: at, globalAt: at, decision: "counted" });
  }
  input.after.tables.login_attempt_limit.rows.push(
    row("login_attempt_limit", { scope: "ADDRESS", subject_hash: addressHash, attempt_count: 5,
      window_started_at: "2026-10-05T10:00:01.000Z", blocked_until: "2026-10-05T10:01:05.000Z" }),
    row("login_attempt_limit", { scope: "GLOBAL", subject_hash: globalHash, attempt_count: 5,
      window_started_at: "2026-10-05T10:00:01.000Z" }));
  return { sourceAddress, addressHash, globalHash };
}

function httpBuckets(input) {
  loginBuckets(input);
  input.contract.authentication.loginPolicy.proofMode = "http-bounded-v1";
  input.contract.authentication.loginPolicy.address.blockMilliseconds = 600000;
  delete input.journal.loginTransitions;
  delete input.journal.loginTransitionsComplete;
  input.after.tables.login_attempt_limit.rows[0].blocked_until = "2026-10-05T10:10:05.000Z";
  return input;
}

function emptySeries(input) {
  for (const snapshot of [input.before, input.after]) {
    snapshot.tables.booking_card.rows[0].allowed_player_counts = [];
    snapshot.tables.club_config.rows.push(row("club_config", { id: manager, time_zone: "Europe/Berlin" }));
  }
  const winner = input.journal.operations[0];
  winner.request.participants = [];
  winner.request.requestFingerprint = resourceBookingRequestFingerprint(winner.request);
  input.after.tables.booking.rows[0].request_fingerprint = winner.request.requestFingerprint;
  input.after.tables.booking_participant.rows = [];
  winner.startedAt = "2026-10-05T10:00:05.000Z";
  const request = { courtIds: [courtId], cardId, startsOn: "2026-10-08", startTime: "18:00:00",
    durationMinutes: 60, intervalWeeks: 1, weekdays: ["THURSDAY"], endsOn: null,
    occurrenceCount: 1, note: "Security TOCTOU run-example" };
  input.journal.operations.push({ id: "preview-1", kind: "previewSeries", status: 200,
    actorAccountId: manager, startedAt: start, endedAt: "2026-10-05T10:00:04.000Z", request,
    result: { occurrences: [{ startsAt: winner.request.startsAt, endsAt: winner.request.endsAt,
      creatable: true, blockedCourtIds: [], violations: [] }] } });
  const mutation = { id: "series-1", kind: "createSeries", status: 200, actorAccountId: manager,
    startedAt: "2026-10-05T10:00:11.000Z", endedAt: "2026-10-05T10:00:12.000Z",
    previewOperationId: "preview-1", winnerOperationId: winner.id,
    request: { ...structuredClone(request), confirmedStarts: [winner.request.startsAt] },
    result: { seriesId: null, bookingIds: [], skipped: [winner.request.startsAt] } };
  input.journal.operations.push(mutation);
  return mutation;
}

test("given ordered snapshots, when rows and object keys reorder, then fingerprints and decisions stay deterministic", () => {
  // given
  const input = fixture(true);
  const reordered = structuredClone(input.before);
  reordered.tables = Object.fromEntries(Object.entries(reordered.tables).reverse());
  for (const table of Object.values(reordered.tables)) {
    table.rows.reverse();
    table.columns.reverse();
  }
  // when
  const first = resourceIntegritySnapshotFingerprint(input.before);
  const second = resourceIntegritySnapshotFingerprint(reordered);
  // then
  assert.equal(first, second);
  assert.equal(compareResourceIntegrity(input).outcome, "passed");
  assert.deepEqual(validatedResourceBookingIds(input), [bookingId]);
});

test("given native one-based booking participant positions, when captured rows arrive in either order, then match the booker first and request participant second", () => {
  // given
  const input = fixture(true);
  const rows = input.after.tables.booking_participant.rows;
  assert.deepEqual(rows.map(({ position }) => position), [1, 2]);
  // when
  const original = compareResourceIntegrity(input);
  rows.reverse();
  const reordered = compareResourceIntegrity(input);
  // then
  assert.equal(original.outcome, "passed");
  assert.deepEqual(reordered, original);
  assert.deepEqual(validatedResourceBookingIds(input), [bookingId]);
});

for (const mutation of ["zero", "negative", "duplicate", "gap", "wrong-order", "fractional", "string"]) {
  test(`given native one-based booking participants, when ${mutation} changes their positions, then reject the effect without cleanup eligibility`, () => {
    // given
    const input = fixture(true);
    const rows = input.after.tables.booking_participant.rows;
    if (mutation === "zero") rows[0].position = 0;
    if (mutation === "negative") rows[0].position = -1;
    if (mutation === "duplicate") rows[1].position = 1;
    if (mutation === "gap") rows[1].position = 3;
    if (mutation === "wrong-order") [rows[0].position, rows[1].position] = [2, 1];
    if (mutation === "fractional") rows[0].position = 1.5;
    if (mutation === "string") rows[0].position = "1";
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "failed");
    assert.ok(result.findings.some(({ code }) => code === "participant-mismatch"));
    assert.deepEqual(validatedResourceBookingIds(input), []);
  });
}

for (const field of ["password_hash", "enabled", "username", "person_id", "locale",
  "password_change_required", "credentials_expire_at", "security_epoch", "version", "created_at"]) {
  test(`given a protected account, when ${field} changes, then integrity fails without exposing its value`, () => {
    // given
    const input = fixture();
    input.after.tables.user_account.rows[0][field] = "private-corruption";
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "failed");
    assert.ok(result.findings.some(({ code }) => code === "protected-field-changed"));
    assert.doesNotMatch(JSON.stringify(result), /private-corruption|private-hash|security.manager|password_hash/);
  });
}

test("given a manager login response, when its timestamp changes within the request interval, then only that field is allowed", () => {
  // given
  const input = fixture();
  input.journal.operations.push({ id: "login-1", kind: "login", accountId: manager, status: 200,
    startedAt: start, endedAt: time });
  input.after.tables.user_account.rows[0].last_login_at = time;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

for (const change of ["no-login", "failed-login", "foreign-account", "outside-window"]) {
  test(`given account bookkeeping, when ${change} supplies attribution, then integrity fails`, () => {
    // given
    const input = fixture();
    if (change !== "no-login") input.journal.operations.push({ id: "login-1", kind: "login",
      accountId: change === "foreign-account" ? person : manager,
      status: change === "failed-login" ? 401 : 200, startedAt: start, endedAt: time });
    input.after.tables.user_account.rows[0].last_login_at =
      change === "outside-window" ? "2026-10-05T10:00:59.000Z" : time;
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "failed");
  });
}

for (const [table, field, value] of [
  ["booking", "booked_by", person], ["booking", "note", "Another note"],
  ["booking", "request_fingerprint", "b".repeat(64)], ["booking", "id", person],
  ["court_allocation", "court_id", person], ["court_allocation", "ends_at", end],
  ["booking_participant", "person_id", manager], ["booking_participant", "position", 9],
  ["domain_event", "actor_account_id", person], ["domain_event", "subject_id", person],
  ["domain_event", "payload", { bookingId: person }], ["message_record", "account_id", person],
  ["message_record", "kind", "CREDENTIALS_PASSWORD_RESET"],
  ["message_record", "message_id", "<different@example.org>"]
]) {
  test(`given a journalled booking, when ${table} ${field} is mislinked, then its effects fail`, () => {
    // given
    const input = fixture(true);
    input.after.tables[table].rows[0][field] = value;
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "failed");
    assert.deepEqual(validatedResourceBookingIds(input), []);
  });
}

for (const table of ["domain_event", "message_record", "court_allocation", "booking_participant"]) {
  for (const mode of ["missing", "duplicate"]) {
    test(`given a committed booking, when ${table} is ${mode}, then integrity fails`, () => {
      // given
      const input = fixture(true);
      if (mode === "missing") input.after.tables[table].rows.pop();
      else input.after.tables[table].rows.push({ ...input.after.tables[table].rows[0], id: person });
      // when
      const result = compareResourceIntegrity(input);
      // then
      assert.equal(result.outcome, "failed");
    });
  }
}

for (const mode of ["missing", "duplicate", "wrong-calendar", "wrong-recipient", "wrong-times"]) {
  test(`given a confirmation record, when SMTP evidence is ${mode}, then correlation cannot pass`, () => {
    // given
    const input = fixture(true);
    if (mode === "missing") input.journal.mailReceipts = [];
    if (mode === "duplicate") input.journal.mailReceipts.push({ ...input.journal.mailReceipts[0] });
    if (mode === "wrong-calendar") input.journal.mailReceipts[0].calendarUid = `booking-${person}@courtside`;
    if (mode === "wrong-recipient") input.journal.mailReceipts[0].recipient = "john@example.org";
    if (mode === "wrong-times") input.journal.mailReceipts[0].startsAt = start;
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, mode === "missing" ? "incomplete" : "failed");
    assert.deepEqual(validatedResourceBookingIds(input), []);
  });
}

test("given a complete native-grounded booking and mail handover, when only sink acceptance occurs after the stored settlement within the attempt, then fail the precise handover ordering", () => {
  // given
  const native = fixture(true);
  assert.equal(compareResourceIntegrity(native).outcome, "passed");
  assert.equal(native.journal.mailReceipts[0].acceptedAt, native.after.tables.message_record.rows[0].settled_at);
  const input = structuredClone(native);
  input.journal.mailReceipts[0].acceptedAt = "2026-10-05T10:00:11.000Z";
  assert.ok(Date.parse(input.journal.mailReceipts[0].acceptedAt) < Date.parse(input.contract.interval.endedAt));
  assert.deepEqual({ ...input, journal: { ...input.journal, mailReceipts: native.journal.mailReceipts } }, native);
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.findings.map(({ code }) => code), ["confirmation-message-mismatch"]);
  assert.deepEqual(validatedResourceBookingIds(input), []);
});

test("given an opted out manager, when a booking commits without mail, then its preferences are respected", () => {
  // given
  const input = fixture(true);
  const preference = row("message_optout", { user_account_id: manager, kind: "BOOKING_CONFIRMED", created_at: start });
  input.before.tables.message_optout.rows.push(preference);
  input.after.tables.message_optout.rows.push({ ...preference });
  input.after.tables.message_record.rows = [];
  input.journal.mailReceipts = [];
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given a replay, when its response identifies another booking, then integrity fails even during interruption", () => {
  // given
  const input = fixture(true);
  input.journal.complete = false;
  input.journal.operations.push({ ...input.journal.operations[0], id: "replay-1", responseBookingId: person });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given a replay, when its body changes under the same key, then integrity fails", () => {
  // given
  const input = fixture(true);
  input.journal.operations.push({ ...input.journal.operations[0], id: "replay-1",
    request: { ...input.journal.operations[0].request, note: "Changed request" } });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given a baseline booking with the same note, when cleanup eligibility is calculated, then only the new ID is returned", () => {
  // given
  const input = fixture(true);
  const existing = { ...input.after.tables.booking.rows[0], id: person, idempotency_key: "baseline-key" };
  input.before.tables.booking.rows.push(existing);
  input.after.tables.booking.rows.push({ ...existing });
  // when
  const ids = validatedResourceBookingIds(input);
  // then
  assert.deepEqual(ids, [bookingId]);
  input.after.tables.booking.rows.pop();
  assert.equal(compareResourceIntegrity(input).outcome, "failed");
});

for (const table of ["user_account_role", "import_preview", "spring_session", "login_attempt_limit"]) {
  test(`given protected ${table} state, when a foreign row is added, then integrity fails`, () => {
    // given
    const input = fixture();
    const keys = resourceIntegritySchema[table].primaryKey;
    input.after.tables[table].rows.push(row(table, Object.fromEntries(keys.map((key) => [key, "foreign"]))));
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "failed");
  });
}

test("given an owned session, when unsupported session volatility changes, then coverage stays incomplete", () => {
  // given
  const input = fixture();
  input.contract.authentication.ownedSessionPrimaryIds.push("owned-session");
  input.after.tables.spring_session.rows.push(row("spring_session", { primary_id: "owned-session" }));
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

for (const mode of ["unknown-table", "unknown-column", "missing-table", "duplicate-key", "missing-field"]) {
  test(`given captured state, when ${mode} prevents full coverage, then the comparator fails closed`, () => {
    // given
    const input = fixture();
    if (mode === "unknown-table") input.after.tables.unknown = { columns: ["id"], primaryKey: ["id"], rows: [] };
    if (mode === "unknown-column") input.after.tables.user_account.columns.push("unknown");
    if (mode === "missing-table") delete input.after.tables.person;
    if (mode === "duplicate-key") input.after.tables.person.rows.push({ ...input.after.tables.person.rows[0] });
    if (mode === "missing-field") delete input.after.tables.user_account.rows[0].password_hash;
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "incomplete");
  });
}

test("given incomplete attribution, when a protected field is also corrupted, then failure takes precedence", () => {
  // given
  const input = fixture();
  input.journal.complete = false;
  input.after.tables.user_account.rows[0].password_hash = "corrupt";
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given an early stop without mutation, when the journal is incomplete, then integrity never claims success", () => {
  // given
  const input = fixture();
  input.journal.complete = false;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given an unknown operation, when its effects cannot be attributed, then coverage remains incomplete", () => {
  // given
  const input = fixture();
  input.journal.operations.push({ id: "unknown-1", kind: "unknown", status: 200, startedAt: start, endedAt: time });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a normalized request, when computing its fingerprint, then Java record ordering and instant bytes are preserved", () => {
  // given
  const request = { courtIds: [courtId, "80000000-0000-0000-0000-000000000001"], cardId,
    startsAt: "2026-10-08T18:00:00.000+02:00", endsAt: "2026-10-08T17:00:00.123400Z", note: "Example note",
    participants: [{ kind: "GUEST", personId: null, guestName: "Example Guest", cardId: null }] };
  const bytes = '{"courtIds":["80000000-0000-0000-0000-000000000001","40000000-0000-0000-0000-000000000001"],"cardId":"11111111-1111-1111-1111-111111111111","startsAt":"2026-10-08T16:00:00Z","endsAt":"2026-10-08T17:00:00.123400Z","note":"Example note","participants":[{"kind":"GUEST","personId":null,"guestName":"Example Guest","cardId":null}]}';
  // when
  const result = resourceBookingRequestFingerprint(request);
  // then
  assert.equal(result, createHash("sha256").update(bytes).digest("hex"));
});

test("given a forged request fingerprint copied into both inputs, when comparing effects, then the request bytes still expose corruption", () => {
  // given
  const input = fixture(true);
  input.journal.operations[0].request.requestFingerprint = "b".repeat(64);
  input.after.tables.booking.rows[0].request_fingerprint = "b".repeat(64);
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given a failed confirmation without capture, when account and kind match, then mail integrity remains incomplete", () => {
  // given
  const input = fixture(true);
  input.journal.mailReceipts = [];
  Object.assign(input.after.tables.message_record.rows[0], { state: "FAILED", reason: "MailHandoverFailedException" });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a malformed journal, when snapshots are otherwise intact, then attribution is incomplete", () => {
  // given
  const input = fixture();
  input.journal.operations = null;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given an excessive journal, when comparison starts, then bounded processing fails closed", () => {
  // given
  const input = fixture();
  input.journal.operations = Array.from({ length: resourceIntegrityLimits.operations + 1 }, () => ({}));
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
  assert.ok(result.findings.some(({ code }) => code === "journal-entry-limit-exceeded"));
});

test("given native DELETE completion, when a completed publication persists despite its matching observation, then the retained effect fails", () => {
  // given
  const input = fixture(true);
  const listenerId = "example-confirmation-listener";
  input.contract.publicationListeners.push(listenerId);
  input.journal.publications.push({ id: person, bookingId, listenerId });
  input.after.tables.event_publication.rows.push(row("event_publication", {
    id: person, listener_id: listenerId, event_type: "org.courtside.shared.BookingConfirmed",
    serialized_event: JSON.stringify({ bookingId }), publication_date: time,
    completion_date: time, status: "COMPLETED", completion_attempts: 1
  }));
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
  input.after.tables.event_publication.rows[0].serialized_event = JSON.stringify({ bookingId: person });
  assert.equal(compareResourceIntegrity(input).outcome, "failed");
});

test("given schema drift alongside credential corruption, when both are captured, then the known integrity violation takes precedence", () => {
  // given
  const input = fixture();
  input.after.tables.user_account.columns.push("new_field");
  input.after.tables.user_account.rows[0].new_field = null;
  input.after.tables.user_account.rows[0].password_hash = "corruption";
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given malformed mail attribution alongside credential corruption, when both are compared, then corruption remains failed", () => {
  // given
  const input = fixture(true);
  input.journal.mailReceipts.push(null);
  input.after.tables.user_account.rows[0].password_hash = "corruption";
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given an owned session, when its principal changes to another account, then attribution cannot excuse corruption", () => {
  // given
  const input = fixture();
  input.contract.authentication.ownedSessionPrimaryIds.push("own-session");
  const session = row("spring_session", { primary_id: "own-session", principal_name: "security.manager.1" });
  input.before.tables.spring_session.rows.push(session);
  input.after.tables.spring_session.rows.push({ ...session, principal_name: "security.member.1" });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given an explicitly identified login bucket, when unsupported counters change, then the result remains incomplete", () => {
  // given
  const input = fixture();
  const subjectHash = createHash("sha256").update("login:172.20.0.2").digest("hex");
  input.contract.authentication.loginSubjects.push({ scope: "ADDRESS", subjectHash });
  input.after.tables.login_attempt_limit.rows.push(row("login_attempt_limit", {
    scope: "ADDRESS", subject_hash: subjectHash, attempt_count: 2, window_started_at: start
  }));
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a baseline confirmation, when its existing audit and mail rows change, then they remain protected", () => {
  // given
  const input = fixture(true);
  input.before = structuredClone(input.after);
  input.journal.operations = [];
  input.journal.mailReceipts = [];
  input.after.tables.domain_event.rows[0].actor_account_id = person;
  input.after.tables.message_record.rows[0].state = "FAILED";
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
  assert.deepEqual(validatedResourceBookingIds(input), []);
});

test("given a failed booking request, when a new booking persists, then rejected operations cannot authorize its row", () => {
  // given
  const input = fixture(true);
  input.journal.operations[0].status = 409;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

function admissionRefusedBooking(input, key) {
  const original = fixture(true).journal.operations[0];
  const request = { ...original.request, idempotencyKey: key };
  request.requestFingerprint = resourceBookingRequestFingerprint(request);
  input.journal.operations.push({ ...original, id: `refused-${key}`, status: 429, responseBookingId: null,
    problemType: "urn:courtside:error:request-rate-limited", retryAfterSeconds: 1, request });
}

test("given a booking key refused by admission, when no booking carries it, then the refusal left no effect", () => {
  // given
  const input = fixture(false);
  admissionRefusedBooking(input, "security-run-example-refused");
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed", JSON.stringify(result.findings));
});

test("given a booking key only ever refused by admission, when a booking carries it, then integrity fails by name", () => {
  // given
  const input = fixture(true);
  input.journal.operations[0].status = 429;
  Object.assign(input.journal.operations[0], { responseBookingId: null,
    problemType: "urn:courtside:error:operation-capacity-exhausted", retryAfterSeconds: 1 });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
  assert.ok(result.findings.some(({ code }) => code === "refused-request-created-booking"),
    "a request the admission control refused must not have created the booking its key names");
});

test("given a replay refused by admission after its original succeeded, when the booking exists, then the original explains it", () => {
  // given
  const input = fixture(true);
  admissionRefusedBooking(input, input.journal.operations[0].request.idempotencyKey);
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed", JSON.stringify(result.findings));
});

test("given a successful replay, when it returns the same ID and request, then only one set of effects is required", () => {
  // given
  const input = fixture(true);
  input.journal.operations.push({ ...input.journal.operations[0], id: "replay-1" });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given an early clean stop after one booking and replay, when coverage is incomplete, then existing effects do not imply a completed race", () => {
  // given
  const input = fixture(true);
  input.journal.complete = false;
  input.journal.operations.push({ ...input.journal.operations[0], id: "replay-1" });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given submillisecond login timing, when last login lies beyond the response interval, then the precise bound rejects it", () => {
  // given
  const input = fixture();
  input.journal.operations.push({ id: "login-1", kind: "login", accountId: manager, status: 200,
    startedAt: start, endedAt: "2026-10-05T10:00:10.000100Z" });
  input.after.tables.user_account.rows[0].last_login_at = "2026-10-05T10:00:10.000200Z";
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given an unjournalled row in an interrupted attempt, when its creation cannot be observed, then attribution remains incomplete", () => {
  // given
  const input = fixture(true);
  input.journal.complete = false;
  input.journal.operations = [];
  input.journal.mailReceipts = [];
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given two independently observed bookings, when every effect has a distinct correlation, then both IDs qualify", () => {
  // given
  const input = fixture(true);
  secondBooking(input);
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
  assert.equal(validatedResourceBookingIds(input).length, 2);
});

test("given two observed winners, when their court allocations overlap, then interruption cannot excuse the violation", () => {
  // given
  const input = fixture(true);
  secondBooking(input, true);
  input.journal.complete = false;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given two booking confirmations, when the SMTP Message-ID is reused, then one receipt cannot cover both bookings", () => {
  // given
  const input = fixture(true);
  secondBooking(input);
  input.journal.mailReceipts[1].messageId = input.journal.mailReceipts[0].messageId;
  input.after.tables.message_record.rows.pop();
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given two message records, when their queue sequences collide, then bookkeeping integrity fails", () => {
  // given
  const input = fixture(true);
  secondBooking(input);
  input.after.tables.message_record.rows[1].queued_seq = input.after.tables.message_record.rows[0].queued_seq;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given unsupported receipt data, when no corruption is otherwise observed, then coverage stays incomplete", () => {
  // given
  const input = fixture();
  input.journal.mailReceipts.push(null);
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a booking request with unknown fields, when its schema cannot be interpreted, then effects cannot qualify", () => {
  // given
  const input = fixture(true);
  input.journal.operations[0].request.unknown = true;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given an incomplete login journal, when the manager timestamp changes within the attempt, then missing attribution is incomplete", () => {
  // given
  const input = fixture();
  input.journal.complete = false;
  input.after.tables.user_account.rows[0].last_login_at = time;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given equivalent UTC timestamp encodings, when database and mail serialization differ, then instant correlation remains exact", () => {
  // given
  const input = fixture(true);
  input.after.tables.court_allocation.rows[0].starts_at = "2026-10-08T16:00:00+00:00";
  input.journal.mailReceipts[0].endsAt = "2026-10-08T19:00:00+02:00";
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given submillisecond request timing, when its interval is reversed, then the journal is incomplete", () => {
  // given
  const input = fixture();
  input.journal.operations.push({ id: "read-1", kind: "read", status: 200,
    startedAt: "2026-10-05T10:00:10.000200Z", endedAt: "2026-10-05T10:00:10.000100Z" });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given an invalid HTTP status, when an operation claims completion, then coverage remains incomplete", () => {
  // given
  const input = fixture();
  input.journal.operations.push({ id: "read-1", kind: "read", status: 900, startedAt: start, endedAt: time });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

function pendingPublication(input, bound = true) {
  const listenerId = "org.courtside.notification.internal.BookingMailer.on(org.courtside.shared.BookingConfirmed)";
  if (bound) input.contract.publicationLifecycle = {
    completionMode: "DELETE", listenerId, eventType: "org.courtside.shared.BookingConfirmed", repositoryMode: "JDBC_V2"
  };
  else delete input.contract.publicationLifecycle;
  input.journal.effectsSettled = false;
  const publication = row("event_publication", { id: person, listener_id: listenerId,
    event_type: "org.courtside.shared.BookingConfirmed",
    serialized_event: JSON.stringify({ bookingId }), publication_date: time,
    status: "PROCESSING", completion_attempts: 1, last_resubmission_date: time });
  input.after.tables.event_publication.rows.push(publication);
  return publication;
}

test("given the actual A9 JDBC V2 PROCESSING publication shape, when its booking is causal but DELETE settlement is pending, then preserve incomplete coverage without a lifecycle failure", () => {
  // given
  const input = fixture(true);
  const publication = pendingPublication(input);
  assert.equal(publication.status, "PROCESSING");
  assert.equal(publication.completion_attempts, 1);
  assert.equal(publication.last_resubmission_date, publication.publication_date);
  assert.equal(publication.completion_date, null);
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
  assert.ok(result.findings.some(({ code }) => code === "publication-settlement-pending"));
  assert.ok(result.findings.every(({ outcome }) => outcome !== "failed"));
  assert.deepEqual(validatedResourceBookingIds(input), []);
});

test("given the actual native JDBC V2 initial PUBLISHED insert, when its causal publication awaits DELETE settlement, then retain incomplete coverage without a lifecycle failure", () => {
  // given
  const input = fixture(true);
  const publication = pendingPublication(input);
  publication.status = "PUBLISHED";
  assert.equal(publication.completion_attempts, 1);
  assert.equal(publication.last_resubmission_date, publication.publication_date);
  assert.equal(publication.completion_date, null);
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
  assert.ok(result.findings.some(({ code }) => code === "publication-settlement-pending"));
  assert.ok(result.findings.every(({ outcome }) => outcome !== "failed"));
  assert.deepEqual(validatedResourceBookingIds(input), []);
});

for (const { status, mutation } of ["PUBLISHED", "PROCESSING"].flatMap((status) =>
  ["zero-attempts", "second-attempt", "null-status", "completed-status", "failed-status", "resubmitted-status", "unknown-status", "null-resubmission", "earlier-resubmission", "later-resubmission"]
    .map((mutation) => ({ status, mutation })))) {
  test(`given the native JDBC V2 ${status} publication lifecycle, when ${mutation} contradicts its first in-flight delivery, then fail without cleanup eligibility`, () => {
    // given
    const input = fixture(true);
    const publication = pendingPublication(input);
    publication.status = status;
    if (mutation === "zero-attempts") publication.completion_attempts = 0;
    if (mutation === "second-attempt") publication.completion_attempts = 2;
    if (mutation === "null-status") publication.status = null;
    if (mutation === "completed-status") publication.status = "COMPLETED";
    if (mutation === "failed-status") publication.status = "FAILED";
    if (mutation === "resubmitted-status") publication.status = "RESUBMITTED";
    if (mutation === "unknown-status") publication.status = "CREATED";
    if (mutation === "null-resubmission") publication.last_resubmission_date = null;
    if (mutation === "earlier-resubmission") publication.last_resubmission_date = start;
    if (mutation === "later-resubmission") publication.last_resubmission_date = end;
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "failed");
    assert.ok(result.findings.some(({ code }) => code === "publication-native-lifecycle-mismatch"));
    assert.deepEqual(validatedResourceBookingIds(input), []);
  });
}

for (const bound of [false, true]) {
  test(`given a native pending JDBC publication with binding ${bound}, when settlement is pending, then coverage remains incomplete`, () => {
    // given
    const input = fixture(true);
    pendingPublication(input, bound);
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "incomplete");
    assert.deepEqual(validatedResourceBookingIds(input), []);
  });
}

test("given native DELETE completion, when the pending publication disappears on settlement, then correlated effects qualify", () => {
  // given
  const input = fixture(true);
  pendingPublication(input);
  input.after.tables.event_publication.rows = [];
  input.journal.effectsSettled = true;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

for (const binding of [undefined, null, {},
  { completionMode: "DELETE", listenerId: "", eventType: "org.courtside.shared.BookingConfirmed", repositoryMode: "JDBC_V2" },
  { completionMode: "DELETE", listenerId: "native-listener", eventType: "org.courtside.shared.BookingConfirmed" },
  { completionMode: "DELETE", listenerId: "native-listener", eventType: "org.courtside.shared.BookingConfirmed", repositoryMode: "JDBC_V1" },
  { completionMode: "DELETE", listenerId: "native-listener", eventType: "org.courtside.shared.BookingConfirmed", repositoryMode: "foreign" },
  { completionMode: "UPDATE", listenerId: "native-listener", eventType: "org.courtside.shared.BookingConfirmed", repositoryMode: "JDBC_V2" },
  { completionMode: "DELETE", listenerId: "native-listener", eventType: "foreign.Event", repositoryMode: "JDBC_V2" },
  { completionMode: "DELETE", listenerId: "native-listener", eventType: "org.courtside.shared.BookingConfirmed", repositoryMode: "JDBC_V2", extra: true }]) {
  test(`given unsupported native binding ${JSON.stringify(binding)}, when no publications remain, then missing producer proof cannot qualify`, () => {
    // given
    const input = fixture(true);
    if (binding === undefined) delete input.contract.publicationLifecycle;
    else input.contract.publicationLifecycle = binding;
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "incomplete");
  });
}

for (const mutation of ["settled", "listener", "event", "booking", "payload", "time", "beforeCreation", "status", "attempts", "completion", "resubmission", "duplicate", "password", "baselineDeletion"]) {
  test(`given a pending native publication, when ${mutation} violates its bounded contract, then integrity fails immediately`, () => {
    // given
    const input = fixture(true);
    const publication = pendingPublication(input);
    if (mutation === "settled") input.journal.effectsSettled = true;
    if (mutation === "listener") publication.listener_id = "foreign-listener";
    if (mutation === "event") publication.event_type = "foreign.Event";
    if (mutation === "booking") publication.serialized_event = JSON.stringify({ bookingId: manager });
    if (mutation === "payload") publication.serialized_event = JSON.stringify({ bookingId, extra: true });
    if (mutation === "time") publication.publication_date = "2026-10-05T10:02:00Z";
    if (mutation === "beforeCreation") publication.publication_date = start;
    if (mutation === "status") publication.status = "FAILED";
    if (mutation === "attempts") publication.completion_attempts = 2;
    if (mutation === "completion") publication.completion_date = time;
    if (mutation === "resubmission") publication.last_resubmission_date = end;
    if (mutation === "duplicate") input.after.tables.event_publication.rows.push({ ...publication, id: manager });
    if (mutation === "password") input.after.tables.user_account.rows[0].password_hash = "changed";
    if (mutation === "baselineDeletion") input.before.tables.event_publication.rows.push({ ...publication, id: manager });
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "failed");
  });
}

test("given an unobserved publication listener, when publication rows appear, then no listener is implicitly allowed", () => {
  // given
  const input = fixture(true);
  input.after.tables.event_publication.rows.push(row("event_publication", { id: person,
    listener_id: "unknown-listener", event_type: "org.courtside.shared.BookingConfirmed",
    serialized_event: JSON.stringify({ bookingId }) }));
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given an unsettled native V2 publication with an observation, when DELETE completion is still pending, then integrity cannot yet qualify", () => {
  // given
  const input = fixture(true);
  const publication = pendingPublication(input);
  const listenerId = publication.listener_id;
  input.journal.publications.push({ id: person, bookingId, listenerId });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given duplicate publication effects, when a listener receives the same booking twice, then integrity fails", () => {
  // given
  const input = fixture(true);
  const listenerId = "example-confirmation-listener";
  input.contract.publicationListeners.push(listenerId);
  for (const id of [person, manager]) {
    input.journal.publications.push({ id, bookingId, listenerId });
    input.after.tables.event_publication.rows.push(row("event_publication", {
      id, listener_id: listenerId, event_type: "org.courtside.shared.BookingConfirmed",
      serialized_event: JSON.stringify({ bookingId }), publication_date: time,
      completion_date: time, status: "COMPLETED", completion_attempts: 1
    }));
  }
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given a cancelled allocation next to a confirmed booking, when occupancy is evaluated, then cancelled history does not overlap", () => {
  // given
  const input = fixture(true);
  const allocation = { ...input.after.tables.court_allocation.rows[0], id: person, status: "CANCELLED" };
  input.before.tables.court_allocation.rows.push(allocation);
  input.after.tables.court_allocation.rows.push({ ...allocation });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given unsupported session attributes, when even an owned session changes bytes, then those bytes never receive blanket permission", () => {
  // given
  const input = fixture();
  input.contract.authentication.ownedSessionPrimaryIds.push("owned-session");
  input.after.tables.spring_session_attributes.rows.push(row("spring_session_attributes", {
    session_primary_id: "owned-session", attribute_name: "UNKNOWN_AUTHORITY", attribute_bytes: "private-bytes"
  }));
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
  assert.doesNotMatch(JSON.stringify(result), /private-bytes|UNKNOWN_AUTHORITY|owned-session/);
});

test("given a reordered damaged snapshot, when comparing protected rows, then public findings remain deterministic", () => {
  // given
  const input = fixture(true);
  input.after.tables.user_account.rows[0].password_hash = "changed";
  input.after.tables.domain_event.rows[0].actor_account_id = person;
  const reversed = structuredClone(input);
  reversed.after.tables = Object.fromEntries(Object.entries(reversed.after.tables).reverse());
  for (const table of Object.values(reversed.after.tables)) {
    table.rows.reverse();
    table.columns.reverse();
    table.rows = table.rows.map((row) => Object.fromEntries(Object.entries(row).reverse()));
  }
  // when
  const first = compareResourceIntegrity(input);
  const second = compareResourceIntegrity(reversed);
  // then
  assert.deepEqual(first, second);
});

test("given oversized private text, when bounded comparison starts, then no raw text escapes the limit finding", () => {
  // given
  const input = fixture();
  input.after.tables.person.rows[0].first_name = "x".repeat(resourceIntegrityLimits.bytes + 1);
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
  assert.ok(result.findings.some(({ code }) => code === "input-size-exceeded"));
  assert.ok(JSON.stringify(result).length < 2000);
});

test("given malformed normalized participants, when computing a request fingerprint, then missing discriminated fields are rejected", () => {
  // given
  const request = { ...fixture(true).journal.operations[0].request,
    participants: [{ kind: "GUEST", guestName: "Example Guest" }] };
  // when / then
  assert.throws(() => resourceBookingRequestFingerprint(request), /booking-request-shape-invalid/);
});

test("given an interrupted journal with a missing booking response, when its actual mail receipt survives, then attribution remains incomplete", () => {
  // given
  const input = fixture(true);
  input.journal.complete = false;
  input.journal.operations = [];
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a replay response journalled before the original, when the original request brackets creation and audit, then response ordering does not invent corruption", () => {
  // given
  const input = fixture(true);
  const original = input.journal.operations[0];
  const replay = { ...structuredClone(original), id: "replay-1",
    startedAt: "2026-10-05T10:00:20.000Z", endedAt: "2026-10-05T10:00:30.000Z" };
  input.journal.operations = [replay, original];
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
  input.journal.operations.reverse();
  assert.deepEqual(compareResourceIntegrity(input), result);
});

test("given two disjoint replay windows, when creation and audit fit different requests only, then no single request proves the committed effect", () => {
  // given
  const input = fixture(true);
  const original = input.journal.operations[0];
  input.journal.operations.push({ ...structuredClone(original), id: "replay-1",
    startedAt: "2026-10-05T10:00:20.000Z", endedAt: "2026-10-05T10:00:30.000Z" });
  input.after.tables.domain_event.rows[0].occurred_at = "2026-10-05T10:00:25.000Z";
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given decoder-bound authenticated session evidence, when every authority and JDBC field matches, then narrow session creation passes", () => {
  // given
  const input = fixture();
  ownSession(input);
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

for (const mutation of ["authorities", "epoch", "account", "bytes", "cookie", "expiry", "timeout", "unknown-attribute"]) {
  test(`given an owned authenticated session, when ${mutation} violates its bound evidence, then integrity fails`, () => {
    // given
    const input = fixture();
    const { observation, session, primaryId } = ownSession(input);
    if (mutation === "authorities") observation.attributes[0].value.authorities.push("ROLE_ADMIN");
    if (mutation === "epoch") observation.attributes[0].value.securityEpoch = 99;
    if (mutation === "account") observation.attributes[0].value.accountId = person;
    if (mutation === "bytes") input.after.tables.spring_session_attributes.rows[0].attribute_bytes = "\\xaced000599";
    if (mutation === "cookie") observation.cookieValue = Buffer.from("B".repeat(36)).toString("base64");
    if (mutation === "expiry") session.expiry_time++;
    if (mutation === "timeout") session.max_inactive_interval++;
    if (mutation === "unknown-attribute") input.after.tables.spring_session_attributes.rows.push(
      row("spring_session_attributes", { session_primary_id: primaryId, attribute_name: "UNKNOWN", attribute_bytes: "\\x00" }));
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "failed");
  });
}

test("given session metadata without a decoder projection, when opaque Java bytes change, then integrity remains incomplete", () => {
  // given
  const input = fixture();
  const { observation } = ownSession(input);
  observation.attributes = [];
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a decoded baseline session, when a real request advances only JDBC access and expiry, then other fields stay protected", () => {
  // given
  const input = fixture();
  const { session, sessionId } = ownSession(input, true);
  const at = "2026-10-05T10:00:20.000Z";
  input.journal.operations.push({ id: "own-read", kind: "read", status: 200,
    startedAt: at, endedAt: "2026-10-05T10:00:21.000Z", sessionId });
  input.journal.sessions[0].operationIds.push("own-read");
  session.last_access_time = Date.parse(at);
  session.expiry_time = session.last_access_time + 1800000;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
  session.creation_time++;
  assert.equal(compareResourceIntegrity(input).outcome, "failed");
});

test("given observed limiter transactions, when five failures reach the source-defined block, then exact bucket effects pass", () => {
  // given
  const input = fixture();
  loginBuckets(input);
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

for (const mutation of ["count", "block", "window", "global-block", "source", "hash"]) {
  test(`given native limiter transitions, when ${mutation} differs from their source recipe, then integrity fails`, () => {
    // given
    const input = fixture();
    loginBuckets(input);
    if (mutation === "count") input.after.tables.login_attempt_limit.rows[0].attempt_count++;
    if (mutation === "block") input.after.tables.login_attempt_limit.rows[0].blocked_until = end;
    if (mutation === "window") input.after.tables.login_attempt_limit.rows[0].window_started_at = time;
    if (mutation === "global-block") input.after.tables.login_attempt_limit.rows[1].blocked_until = end;
    if (mutation === "source") input.journal.operations[0].sourceAddress = "172.20.0.99";
    if (mutation === "hash") input.contract.authentication.loginSubjects[0].subjectHash = "b".repeat(64);
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "failed");
  });
}

test("given a rate-limited HTTP response without native register evidence, when bucket changes are observed, then guessing the 429 path cannot pass", () => {
  // given
  const input = fixture();
  loginBuckets(input);
  input.journal.loginTransitions = [];
  input.journal.operations[0].status = 429;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a native address block, when a later request is refused before counting, then both bucket counts remain unchanged", () => {
  // given
  const input = fixture();
  const { sourceAddress } = loginBuckets(input);
  input.journal.operations.push({ id: "blocked", kind: "login", status: 429, sourceAddress,
    startedAt: start, endedAt: time });
  input.journal.loginTransitions.push({ sequence: 6, operationId: "blocked", kind: "register",
    retryAt: "2026-10-05T10:00:06.000Z", addressAt: "2026-10-05T10:00:06.000Z", globalAt: null, decision: "blocked" });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given capacity exhaustion after register, when HTTP returns 429 with counted native evidence, then the request still increments both buckets", () => {
  // given
  const input = fixture();
  loginBuckets(input);
  input.journal.operations[0].status = 429;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given a successful native login, when clear deletes the address bucket only, then the global bucket remains protected", () => {
  // given
  const input = fixture();
  loginBuckets(input);
  input.journal.operations.at(-1).status = 200;
  input.journal.operations.at(-1).accountId = manager;
  input.journal.loginTransitions.push({ sequence: 6, operationId: "failed-5", kind: "clear", at: time });
  input.before.tables.login_attempt_limit.rows.push(row("login_attempt_limit", {
    scope: "ADDRESS", subject_hash: input.after.tables.login_attempt_limit.rows[0].subject_hash,
    attempt_count: 1, window_started_at: "2026-10-05T09:58:00.000Z" }));
  input.after.tables.login_attempt_limit.rows.shift();
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
  input.after.tables.login_attempt_limit.rows = [];
  assert.equal(compareResourceIntegrity(input).outcome, "failed");
});

test("given source timestamps with microseconds, when the block deadline is persisted, then submillisecond precision is preserved", () => {
  // given
  const input = fixture();
  loginBuckets(input);
  input.journal.loginTransitions.at(-1).addressAt = "2026-10-05T10:00:05.000123Z";
  input.journal.loginTransitions.at(-1).globalAt = "2026-10-05T10:00:05.000123Z";
  input.after.tables.login_attempt_limit.rows[0].blocked_until = "2026-10-05T10:01:05.000123Z";
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given extra session decoder projections, when capture contains unsupported attributes, then the extra evidence cannot be ignored", () => {
  // given
  const input = fixture();
  const { observation } = ownSession(input);
  observation.attributes.push({ name: "UNKNOWN", decoder: "other", bytesDigest: "unknown", value: {} });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a complete native journal, when clear precedes its register timestamp, then the invalid causal order cannot qualify", () => {
  // given
  const input = fixture();
  loginBuckets(input);
  input.journal.operations.at(-1).status = 200;
  input.journal.operations.at(-1).accountId = manager;
  input.journal.loginTransitions.push({ sequence: 6, operationId: "failed-5", kind: "clear", at: start });
  input.after.tables.login_attempt_limit.rows.shift();
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given decoded native web authentication details, when their producer contract is unsupported, then session integrity remains incomplete", () => {
  // given
  const input = fixture();
  const { observation } = ownSession(input);
  observation.attributes[0].value.details = { className: "org.springframework.security.web.authentication.WebAuthenticationDetails",
    remoteAddress: "172.20.0.2", sessionId: null };
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given decoder-bound web authentication details, when address and request session match the actual login, then its authenticated session qualifies", () => {
  // given
  const input = fixture();
  const { observation } = ownSession(input);
  const login = input.journal.operations[0];
  login.sourceAddress = "172.20.0.2";
  login.requestSessionId = null;
  observation.attributes[0].value.details = {
    className: "org.springframework.security.web.authentication.WebAuthenticationDetails",
    remoteAddress: login.sourceAddress, sessionId: null
  };
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
  observation.attributes[0].value.details.remoteAddress = "172.20.0.99";
  assert.equal(compareResourceIntegrity(input).outcome, "failed");
});

test("given a decoded baseline web context, when a later read preserves its details, then request attribution still protects authentication", () => {
  // given
  const input = fixture();
  const { sessionId } = ownSession(input, true);
  const details = { className: "org.springframework.security.web.authentication.WebAuthenticationDetails",
    remoteAddress: "172.20.0.2", sessionId: null };
  input.contract.authentication.sessionPolicy.sourceAddress = details.remoteAddress;
  for (const observation of input.journal.sessions) observation.attributes[0].value.details = structuredClone(details);
  input.journal.operations[0].sessionId = sessionId;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given an unexpected native session observation, when its phase has no supported contract, then it cannot be silently ignored", () => {
  // given
  const input = fixture();
  ownSession(input);
  input.journal.sessions.push({ phase: "invented", primaryId: manager });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a configured session concurrency bound, when captured authenticated sessions exceed it, then the bound fails", () => {
  // given
  const input = fixture();
  const { session } = ownSession(input);
  input.contract.authentication.sessionPolicy.concurrentLimit = 1;
  input.after.tables.spring_session.rows.push({ ...session, primary_id: person, session_id: "B".repeat(36) });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given reordered decoded baseline attributes, when capture changes only row order, then authentication decisions remain canonical", () => {
  // given
  const input = fixture();
  ownSession(input, true);
  input.after.tables.spring_session_attributes.rows.reverse();
  input.journal.sessions[0].attributes.reverse();
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given malformed native limiter baseline and protected credentials, when both are inspected, then unsupported authentication cannot hide corruption", () => {
  // given
  const input = fixture();
  loginBuckets(input);
  input.before.tables.login_attempt_limit.rows.push({ ...input.after.tables.login_attempt_limit.rows[0], window_started_at: "unsupported" });
  input.after.tables.user_account.rows[0].password_hash = "corrupted";
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given native evidence without its policy, when no snapshot effect exposes it, then unsupported evidence still cannot qualify", () => {
  // given
  const input = fixture();
  input.journal.sessions = [{ phase: "unsupported" }];
  input.journal.loginTransitions = [{ kind: "unsupported" }];
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a blocked native retry check before expiration, when a later count timestamp crosses expiration, then the transaction cannot invent a counted path", () => {
  // given
  const input = fixture();
  loginBuckets(input);
  input.before.tables.login_attempt_limit.rows.push(row("login_attempt_limit", {
    scope: "ADDRESS", subject_hash: input.after.tables.login_attempt_limit.rows[0].subject_hash,
    attempt_count: 1, window_started_at: "2026-10-05T09:58:00.000Z", blocked_until: "2026-10-05T10:00:00.500Z"
  }));
  input.journal.loginTransitions[0].retryAt = start;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given complete concurrent successful HTTP logins, when each counted request clears its own address, then exact global count and address absence qualify without native transitions", () => {
  // given
  const input = httpBuckets(fixture());
  for (const operation of input.journal.operations) Object.assign(operation, { status: 200, accountId: manager });
  input.after.tables.login_attempt_limit.rows.shift();
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given complete concurrent HTTP failures, when five counted requests create one source-bound block, then a legal bounded ordering qualifies", () => {
  // given
  const input = httpBuckets(fixture());
  input.journal.operations.push({ id: "blocked-http", kind: "login", status: 429,
    sourceAddress: "172.20.0.2", startedAt: "2026-10-05T10:00:06.000Z", endedAt: time,
    retryAfterSeconds: 599, problemType: "urn:courtside:error:login-rate-limited" });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given HTTP capacity advice, when a long block cannot explain Retry-After one, then capacity 429 is counted exactly", () => {
  // given
  const input = httpBuckets(fixture());
  Object.assign(input.journal.operations[0], { status: 429, retryAfterSeconds: 1,
    problemType: "urn:courtside:error:login-rate-limited" });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

for (const mutation of ["global-count", "address-count", "deadline", "first-window", "retry-advice", "source"]) {
  test(`given bounded HTTP login evidence, when ${mutation} breaks its semantic constraints, then integrity fails`, () => {
    // given
    const input = httpBuckets(fixture());
    input.journal.operations.push({ id: "blocked-http", kind: "login", status: 429,
      sourceAddress: "172.20.0.2", startedAt: "2026-10-05T10:00:06.000Z", endedAt: time,
      retryAfterSeconds: 599, problemType: "urn:courtside:error:login-rate-limited" });
    if (mutation === "global-count") input.after.tables.login_attempt_limit.rows[1].attempt_count++;
    if (mutation === "address-count") input.after.tables.login_attempt_limit.rows[0].attempt_count++;
    if (mutation === "deadline") input.after.tables.login_attempt_limit.rows[0].blocked_until = "2026-10-05T10:11:05.000Z";
    if (mutation === "first-window") input.after.tables.login_attempt_limit.rows[1].window_started_at = end;
    if (mutation === "retry-advice") input.journal.operations.at(-1).retryAfterSeconds = 100;
    if (mutation === "source") input.journal.operations[0].sourceAddress = "172.20.0.99";
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "failed");
  });
}

for (const ambiguity of ["missing-header", "short-block", "mixed-clears", "incomplete-journal"]) {
  test(`given ${ambiguity} in HTTP login evidence, when native effects cannot be uniquely bounded, then qualification remains incomplete`, () => {
    // given
    const input = httpBuckets(fixture());
    if (ambiguity === "missing-header") input.journal.operations[0].status = 429;
    if (ambiguity === "short-block") {
      input.contract.authentication.loginPolicy.address.blockMilliseconds = 1000;
      input.after.tables.login_attempt_limit.rows[0].blocked_until = "2026-10-05T10:00:06.000Z";
    }
    if (ambiguity === "mixed-clears") Object.assign(input.journal.operations[0], { status: 200, accountId: manager });
    if (ambiguity === "incomplete-journal") input.journal.complete = false;
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "incomplete");
  });
}

test("given a completed success phase before HTTP failures, when the final address window begins after the last clear, then both phase effects qualify", () => {
  // given
  const input = httpBuckets(fixture());
  input.journal.operations.push({ id: "preauth", kind: "login", status: 200, accountId: manager,
    sourceAddress: "172.20.0.2", startedAt: start, endedAt: "2026-10-05T10:00:00.500Z" });
  for (const operation of input.journal.operations.slice(0, 5)) operation.startedAt = "2026-10-05T10:00:01.000Z";
  input.after.tables.login_attempt_limit.rows[1].attempt_count = 6;
  input.after.tables.login_attempt_limit.rows[1].window_started_at = "2026-10-05T10:00:00.100Z";
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given a preserved global window and actual successes, when the bucket ages only after the last login, then snapshot delay does not invent a reset", () => {
  // given
  const input = httpBuckets(fixture());
  input.before.tables.login_attempt_limit.rows.push({ ...input.after.tables.login_attempt_limit.rows[1],
    attempt_count: 2, window_started_at: "2026-10-05T09:59:40.000Z" });
  input.after.tables.login_attempt_limit.rows[1].attempt_count = 7;
  input.after.tables.login_attempt_limit.rows[1].window_started_at = "2026-10-05T09:59:40.000Z";
  for (const operation of input.journal.operations) Object.assign(operation, { status: 200, accountId: manager });
  input.after.tables.login_attempt_limit.rows.shift();
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given a global window boundary inside counted login intervals, when a reset cannot be uniquely attributed, then HTTP inference remains incomplete", () => {
  // given
  const input = httpBuckets(fixture());
  input.before.tables.login_attempt_limit.rows.push({ ...input.after.tables.login_attempt_limit.rows[1],
    attempt_count: 2, window_started_at: "2026-10-05T09:59:05.000Z" });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given an active baseline address block, when typed HTTP advice matches its unchanged deadline, then neither bucket is counted", () => {
  // given
  const input = httpBuckets(fixture());
  input.before.tables.login_attempt_limit.rows = structuredClone(input.after.tables.login_attempt_limit.rows);
  input.journal.operations = [{ id: "blocked-http", kind: "login", status: 429,
    sourceAddress: "172.20.0.2", startedAt: "2026-10-05T10:00:06.000Z", endedAt: time,
    retryAfterSeconds: 599, problemType: "urn:courtside:error:login-rate-limited" }];
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given protected foreign login buckets, when HTTP inference permits own effects, then foreign mutations still fail", () => {
  // given
  const input = httpBuckets(fixture());
  const foreign = row("login_attempt_limit", { scope: "ADDRESS", subject_hash: "c".repeat(64),
    attempt_count: 1, window_started_at: start });
  input.before.tables.login_attempt_limit.rows.push(foreign);
  input.after.tables.login_attempt_limit.rows.push({ ...foreign, attempt_count: 2 });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given ambiguous concurrent clears but exact global counting, when the global count is corrupted, then ambiguity cannot hide that violation", () => {
  // given
  const input = httpBuckets(fixture());
  Object.assign(input.journal.operations[0], { status: 200, accountId: manager });
  input.after.tables.login_attempt_limit.rows[1].attempt_count++;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

test("given an actual preview followed by a confirmed competitor, when series creation skips exactly that occurrence with HTTP 200, then the no-effect response qualifies", () => {
  // given
  const input = fixture(true);
  emptySeries(input);
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

for (const mutation of ["actor", "skipped", "bookingIds", "timezone", "winner", "persisted-series"]) {
  test(`given a journalled no-effect series request, when ${mutation} contradicts its closed contract, then integrity fails`, () => {
    // given
    const input = fixture(true);
    const operation = emptySeries(input);
    if (mutation === "actor") operation.actorAccountId = person;
    if (mutation === "skipped") operation.result.skipped = ["2026-10-09T16:00:00.000Z"];
    if (mutation === "bookingIds") operation.result.bookingIds = [bookingId];
    if (mutation === "timezone") operation.request.startTime = "17:00:00";
    if (mutation === "winner") operation.winnerOperationId = "preview-1";
    if (mutation === "persisted-series") input.after.tables.booking_series.rows.push(row("booking_series", { id: person }));
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "failed");
  });
}

test("given HTTP 201 for an allegedly empty series, when actual controller semantics require 200, then unsupported evidence cannot qualify", () => {
  // given
  const input = fixture(true);
  emptySeries(input).status = 201;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a missing preview response projection, when an empty series response alone cannot prove the race, then integrity remains incomplete", () => {
  // given
  const input = fixture(true);
  emptySeries(input);
  delete input.journal.operations.find(({ id }) => id === "preview-1").result;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a subsecond confirmed start outside the series request, when local formatting truncates its fraction, then the occurrence still fails exact correlation", () => {
  // given
  const input = fixture(true);
  const operation = emptySeries(input);
  const fractional = "2026-10-08T16:00:00.123Z";
  operation.request.confirmedStarts = [fractional];
  operation.result.skipped = [fractional];
  const winner = input.journal.operations[0];
  winner.request.startsAt = fractional;
  winner.request.endsAt = "2026-10-08T17:00:00.123Z";
  const occurrence = input.journal.operations.find(({ id }) => id === "preview-1").result.occurrences[0];
  Object.assign(occurrence, { startsAt: winner.request.startsAt, endsAt: winner.request.endsAt });
  winner.request.requestFingerprint = resourceBookingRequestFingerprint(winner.request);
  input.after.tables.booking.rows[0].request_fingerprint = winner.request.requestFingerprint;
  Object.assign(input.after.tables.court_allocation.rows[0], {
    starts_at: winner.request.startsAt, ends_at: winner.request.endsAt
  });
  Object.assign(input.journal.mailReceipts[0], { startsAt: winner.request.startsAt, endsAt: winner.request.endsAt });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

function minuteHttpPressure() {
  const input = httpBuckets(fixture());
  input.contract.interval.endedAt = "2026-10-05T10:01:30.000Z";
  input.contract.authentication.loginPolicy.address.blockMilliseconds = 60000;
  for (const operation of input.journal.operations) operation.startedAt = "2026-10-05T10:00:05.000Z";
  for (const bucket of input.after.tables.login_attempt_limit.rows) bucket.window_started_at = "2026-10-05T10:00:05.100Z";
  input.after.tables.login_attempt_limit.rows[0].blocked_until = "2026-10-05T10:01:10.000Z";
  input.journal.operations.push({ id: "last-blocked", kind: "login", status: 429,
    sourceAddress: "172.20.0.2", startedAt: "2026-10-05T10:01:04.000Z", endedAt: "2026-10-05T10:01:05.000Z",
    retryAfterSeconds: 6, problemType: "urn:courtside:error:login-rate-limited" });
  return input;
}

test("given a ninety-second capture interval and native one-minute block, when actual login pressure fits one block and counting window, then later settling does not prevent qualification", () => {
  // given
  const input = minuteHttpPressure();
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given a ninety-second run and successful login warmup, when failed pressure ends before the actual block deadline, then the whole-run duration is irrelevant", () => {
  // given
  const input = minuteHttpPressure();
  input.journal.operations.push({ id: "warmup-success", kind: "login", status: 200, accountId: manager,
    sourceAddress: "172.20.0.2", startedAt: start, endedAt: "2026-10-05T10:00:04.000Z" });
  input.after.tables.login_attempt_limit.rows[1].attempt_count++;
  input.after.tables.login_attempt_limit.rows[1].window_started_at = "2026-10-05T10:00:01.000Z";
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given a native one-minute block, when a login interval crosses its actual deadline, then expired-block ambiguity stays incomplete", () => {
  // given
  const input = minuteHttpPressure();
  Object.assign(input.journal.operations.at(-1), { startedAt: "2026-10-05T10:01:08.000Z",
    endedAt: "2026-10-05T10:01:11.000Z", retryAfterSeconds: 2 });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a one-minute counting window, when successful login observations span a possible second window, then bounded inference cannot claim the reset count is corruption or qualification", () => {
  // given
  const input = minuteHttpPressure();
  input.journal.operations.pop();
  for (const operation of input.journal.operations) Object.assign(operation, { status: 200, accountId: manager });
  input.journal.operations.push({ id: "late-success", kind: "login", status: 200, accountId: manager,
    sourceAddress: "172.20.0.2", startedAt: "2026-10-05T10:01:10.000Z", endedAt: "2026-10-05T10:01:11.000Z" });
  input.after.tables.login_attempt_limit.rows.shift();
  Object.assign(input.after.tables.login_attempt_limit.rows[0], { attempt_count: 1,
    window_started_at: "2026-10-05T10:01:10.500Z" });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given Retry-After one near an actual block deadline, when capacity and address refusal cannot be distinguished, then the ambiguous request is never counted by assumption", () => {
  // given
  const input = minuteHttpPressure();
  Object.assign(input.journal.operations.at(-1), { startedAt: "2026-10-05T10:01:09.100Z",
    endedAt: "2026-10-05T10:01:09.500Z", retryAfterSeconds: 1 });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

test("given a baseline one-minute block and later capture, when the last actual refused login precedes expiry, then snapshot-time expiry alone does not invalidate unchanged buckets", () => {
  // given
  const input = minuteHttpPressure();
  input.before.tables.login_attempt_limit.rows = structuredClone(input.after.tables.login_attempt_limit.rows);
  input.journal.operations = [input.journal.operations.at(-1)];
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given a one-minute block and typed capacity refusal well before expiry, when complete counted evidence fits its actual deadline, then Retry-After one is narrowly counted", () => {
  // given
  const input = minuteHttpPressure();
  Object.assign(input.journal.operations[0], { status: 429, retryAfterSeconds: 1,
    problemType: "urn:courtside:error:login-rate-limited" });
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

test("given expired-block ambiguity and protected account corruption, when bounded HTTP proof cannot finish, then the known integrity violation still fails", () => {
  // given
  const input = minuteHttpPressure();
  Object.assign(input.journal.operations.at(-1), { startedAt: "2026-10-05T10:01:08.000Z",
    endedAt: "2026-10-05T10:01:11.000Z", retryAfterSeconds: 2 });
  input.after.tables.user_account.rows[0].password_hash = "corrupted";
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

for (const access of ["read", "booking"]) {
  test(`given an authenticated shared setup session, when later ${access} access advances JDBC bookkeeping, then original login and latest access qualify independently`, () => {
    // given
    const { input, session, read } = sharedSessionAfterBooking();
    if (access === "read") {
      session.last_access_time = Date.parse(read.startedAt);
      session.expiry_time = session.last_access_time + 1800000;
    }
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "passed");
  });
}

test("given a new manager session followed by actual reads and bookings, when latest access falls outside every observed request, then login proof cannot authorize the invented timestamp", () => {
  // given
  const { input, session } = sharedSessionAfterBooking();
  session.last_access_time = Date.parse("2026-10-05T10:00:45.000Z");
  session.expiry_time = session.last_access_time + 1800000;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

for (const mutation of ["roles", "epoch", "password", "details", "creation-and-authentication", "missing-login-link"]) {
  test(`given independently attributed shared session access, when ${mutation} violates the original authentication proof, then later requests cannot waive it`, () => {
    // given
    const { input, session, observation, login, read } = sharedSessionAfterBooking();
    const context = observation.attributes[0].value;
    if (mutation === "roles") context.authorities.push("ROLE_ADMIN");
    if (mutation === "epoch") context.securityEpoch++;
    if (mutation === "password") input.after.tables.user_account.rows[0].password_hash = "corrupted";
    if (mutation === "details") context.details.remoteAddress = read.sourceAddress;
    if (mutation === "creation-and-authentication") {
      session.creation_time = session.last_access_time;
      observation.attributes.find(({ name }) => name === "courtside.authenticated-at").value.value = session.last_access_time;
    }
    if (mutation === "missing-login-link") observation.operationIds = observation.operationIds.filter((id) => id !== login.id);
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, ["creation-and-authentication", "missing-login-link"].includes(mutation) ? "incomplete" : "failed");
  });
}

for (const status of [413, 0]) {
  test(`given the exact source-bound gateway body probe, when the oversized HTTP request ends with ${status}, then only an observed 413 rejection qualifies`, () => {
    // given
    const input = gatewayBlockedBody();
    input.journal.operations[0].status = status;
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, status === 413 ? "passed" : "incomplete");
  });
}

for (const missing of ["request", "body-size", "content-type", "method", "timestamp"]) {
  test(`given an oversized-body classification without ${missing}, when HTTP 413 alone cannot prove the closed source-bound request, then integrity remains incomplete`, () => {
    // given
    const input = gatewayBlockedBody();
    if (missing === "request") delete input.journal.operations[0].request;
    if (missing === "body-size") delete input.journal.operations[0].request.bodyBytes;
    if (missing === "content-type") delete input.journal.operations[0].request.contentType;
    if (missing === "method") delete input.journal.operations[0].method;
    if (missing === "timestamp") delete input.journal.operations[0].endedAt;
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "incomplete");
  });
}

for (const mutation of ["request-size", "content-type", "request-extra-field", "status", "path", "method", "kind", "window"]) {
  test(`given an asserted gateway body-limit rejection, when ${mutation} contradicts its exact contract, then the unsupported request cannot qualify`, () => {
    // given
    const input = gatewayBlockedBody();
    if (mutation === "request-size") input.journal.operations[0].request.bodyBytes = 100;
    if (mutation === "content-type") input.journal.operations[0].request.contentType = "application/json";
    if (mutation === "request-extra-field") input.journal.operations[0].request.username = "security.manager.1";
    if (mutation === "status") input.journal.operations[0].status = 429;
    if (mutation === "path") input.journal.operations[0].path = "/api/bookings";
    if (mutation === "method") input.journal.operations[0].method = "PUT";
    if (mutation === "kind") input.journal.operations[0].kind = "login";
    if (mutation === "window") input.journal.operations[0].endedAt = "2026-10-05T10:02:00.000Z";
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "incomplete");
  });
}

test("given complete bounded app logins plus the exact source-bound gateway body rejection, when counters exclude only that pre-upstream request, then global login counting remains exact", () => {
  // given
  const input = gatewayBlockedBody(minuteHttpPressure());
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
  input.after.tables.login_attempt_limit.rows[1].attempt_count++;
  assert.equal(compareResourceIntegrity(input).outcome, "failed");
});

test("given the exact source-bound gateway rejection, when protected account or foreign bucket data changes anyway, then rejection evidence gives no database permission", () => {
  // given
  const input = gatewayBlockedBody();
  input.after.tables.user_account.rows[0].password_hash = "corrupted";
  input.after.tables.login_attempt_limit.rows.push(row("login_attempt_limit", {
    scope: "ADDRESS", subject_hash: "c".repeat(64), attempt_count: 1, window_started_at: time
  }));
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "failed");
});

function nativeAuthenticatedSessionFixture() {
  const fixture = sharedSessionAfterBooking();
  fixture.input.contract.authentication.sessionPolicy.passwordFactorRequired = true;
  const context = fixture.observation.attributes[0].value;
  context.authorities = ["FACTOR_PASSWORD", "ROLE_SPORT_DIRECTOR"];
  context.passwordFactorIssuedAt = "2026-10-05T10:00:09.999123456Z";
  return { ...fixture, context };
}

test("given native Spring password-factor evidence, when its issuance fits the original login before session fixation, then later booking access does not invalidate authentication", () => {
  // given
  const { input } = nativeAuthenticatedSessionFixture();
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "passed");
});

for (const mutation of ["missing-factor", "duplicate-factor", "principal-factor", "principal-roles", "missing-issued-at", "future-issued-at", "later-read-issued-at"]) {
  test(`given current native Spring authentication, when ${mutation} violates its closed authority and original-login contract, then integrity fails`, () => {
    // given
    const { input, context, read } = nativeAuthenticatedSessionFixture();
    if (mutation === "missing-factor") context.authorities = ["ROLE_SPORT_DIRECTOR"];
    if (mutation === "duplicate-factor") context.authorities.unshift("FACTOR_PASSWORD");
    if (mutation === "principal-factor") context.principalAuthorities.unshift("FACTOR_PASSWORD");
    if (mutation === "principal-roles") context.principalAuthorities = ["ROLE_ADMIN"];
    if (mutation === "missing-issued-at") context.passwordFactorIssuedAt = null;
    if (mutation === "future-issued-at") context.passwordFactorIssuedAt = "2026-10-05T11:00:00.000Z";
    if (mutation === "later-read-issued-at") context.passwordFactorIssuedAt = read.startedAt;
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "failed");
  });
}

test("given a current native session contract, when its decoder omits the password-factor field, then missing producer evidence cannot qualify", () => {
  // given
  const { input, context } = nativeAuthenticatedSessionFixture();
  delete context.passwordFactorIssuedAt;
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

for (const missing of ["receipts", "coverage", "operation-id", "native-time"]) {
  test(`given the exact oversized script request without ${missing}, when native gateway correlation is incomplete, then request classification alone cannot qualify`, () => {
    // given
    const input = gatewayBlockedBody();
    if (missing === "receipts") delete input.journal.gatewayBodyRejections;
    if (missing === "coverage") delete input.journal.gatewayBodyRejectionsComplete;
    if (missing === "operation-id") input.journal.gatewayBodyRejections[0].operationId = null;
    if (missing === "native-time") delete input.journal.gatewayBodyRejections[0].observedAt;
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "incomplete");
  });
}

for (const mutation of ["duplicate", "forwarded", "bytes", "body-limit", "content-type", "method", "status"]) {
  test(`given native gateway rejection evidence, when ${mutation} contradicts the exact pre-upstream source contract, then integrity fails`, () => {
    // given
    const input = gatewayBlockedBody();
    const receipt = input.journal.gatewayBodyRejections[0];
    if (mutation === "duplicate") input.journal.gatewayBodyRejections.push(structuredClone(receipt));
    if (mutation === "forwarded") receipt.forwarded = true;
    if (mutation === "bytes") receipt.bodyBytes++;
    if (mutation === "body-limit") receipt.maximumBodyBytes++;
    if (mutation === "content-type") receipt.contentType = "application/json";
    if (mutation === "method") receipt.method = "GET";
    if (mutation === "status") receipt.status = 429;
    // when
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(result.outcome, "failed");
  });
}

test("given a native rejection outside the actual HTTP interval, when its timestamp cannot correlate with that request, then the gateway proof stays incomplete", () => {
  // given
  const input = gatewayBlockedBody();
  input.journal.gatewayBodyRejections[0].observedAt = "2026-10-05T10:00:11.000Z";
  // when
  const result = compareResourceIntegrity(input);
  // then
  assert.equal(result.outcome, "incomplete");
});

for (const clock of [start, "2026-12-01T10:00:00.000Z"]) {
  test(`given the actual k6 source and journal parser at ${clock}, when the TOCTOU session and the oversized probe are compared against fixture states, then all normalized operation contracts qualify together`, (t) => {
    // given
    const harness = actualScriptHarness(clock);
    const run = harness.setup();
    // when
    harness.context.api.previewMutation(run);
    harness.context.api.requestBodyLimit(run);
    harness.context.api.handleSummary({ metrics: Object.fromEntries(Object.entries(harness.counters)
      .map(([name, count]) => [name, { values: { count } }])), root_group: {} });
    const journal = parseResourceJournal(harness.messages.join("\n"), { accounts: [{ id: manager, username: "security.manager.1" }] });
    const input = scriptFixtureStates(journal, clock);
    const result = compareResourceIntegrity(input);
    // then
    assert.equal(journal.complete, true);
    assert.equal(journal.operations.length, harness.calls.length);
    assert.ok(harness.backend.checks.every(({ pass }) => pass));
    assert.equal(result.outcome, "passed", JSON.stringify(result.findings));
    const series = journal.operations.find(({ kind }) => kind === "createSeries");
    assert.equal(series.request.endsOn, null);
    assert.equal(series.result.seriesId, null);
    const sent = JSON.parse(harness.calls.find(({ path }) => path === "/api/booking-series").body);
    assert.equal(Object.hasOwn(sent, "endsOn"), false);
    t.diagnostic(JSON.stringify({ proof: "actual-script-parser-comparator-unit", nativeRuntime: false,
      operations: journal.operations.length, outcome: result.outcome }));
  });
}
