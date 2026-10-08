import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { parseResourceJournal, resourceJournalMarker, resourceJournalLimits } from "./security-resource-journal.mjs";
import { resourceBookingRequestFingerprint } from "./security-resource-integrity.mjs";
import { resourceDatePlan } from "./security-resource-dates.mjs";

const manager = "10000000-0000-0000-0000-000000000001";
const booking = "30000000-0000-0000-0000-000000000001";
const court = "40000000-0000-0000-0000-000000000001";
const card = "11111111-1111-1111-1111-111111111111";
const startedAt = "2026-10-05T23:59:59.000Z";
const endedAt = "2026-10-06T00:00:01.000Z";
const accounts = [{ id: manager, username: "security.manager.1" }];
const request = { courtIds: [court], cardId: card, startsAt: "2026-10-08T16:00:00.000Z",
  endsAt: "2026-10-08T17:00:00.000Z", note: null, participants: [
    { kind: "GUEST", personId: null, guestName: "Example Guest", cardId: null }
  ], idempotencyKey: "security-example-duplicate" };

function frames(kind = "createBooking", status = 201) {
  const begin = { event: "begin", id: "1:1", vu: 1, sequence: 1, kind, startedAt,
    method: "POST", path: "/api/bookings", actorUsername: "security.manager.1", request };
  const end = { event: "end", id: "1:1", status, endedAt, responseBookingId: status === 201 ? booking : null,
    identityUsername: null, ownedSessionIds: [] };
  return [{ event: "start", runId: "run-example", clock: startedAt }, begin, end,
    { event: "finish", runId: "run-example", started: 1, finished: 1, dropped: 0 }];
}

function log(entries) {
  return entries.map(entry => `${resourceJournalMarker}${JSON.stringify(entry)}`).join("\n") + "\n";
}

test("given a private booking journal, when parsing it, then identity and the independently computed fingerprint match integrity input", () => {
  // given
  const entries = frames();
  const original = structuredClone(entries);
  // when
  const result = parseResourceJournal(log(entries), { accounts });
  // then
  assert.equal(result.complete, true);
  assert.equal(result.effectsSettled, false);
  assert.deepEqual(result.findings, []);
  assert.equal(result.operations[0].actorAccountId, manager);
  assert.equal(result.operations[0].responseBookingId, booking);
  assert.equal(result.operations[0].request.requestFingerprint, resourceBookingRequestFingerprint(request));
  assert.deepEqual(entries, original);
});

test("given a rejected participant-capacity request, when parsing it, then every normalized participant and its failure status survive", () => {
  // given
  const entries = frames("createBooking", 400);
  entries[1].request = { ...request, participants: [
    { kind: "MEMBER", personId: manager, guestName: null, cardId: null },
    { kind: "CARD", personId: null, guestName: null, cardId: card },
    { kind: "CARD", personId: null, guestName: null, cardId: card }
  ] };
  // when
  const result = parseResourceJournal(log(entries), { accounts });
  // then
  assert.equal(result.complete, true);
  assert.equal(result.operations[0].status, 400);
  assert.deepEqual(result.operations[0].request.participants, entries[1].request.participants);
});

test("given Java preview instants without milliseconds, when the competitor booking is journalled, then the exact request hashes and survives", () => {
  // given
  const entries = frames();
  entries[1].request = { ...request, startsAt: "2026-10-08T16:00:00Z", endsAt: "2026-10-08T17:00:00Z" };
  // when
  const result = parseResourceJournal(log(entries), { accounts });
  // then
  assert.equal(result.complete, true);
  assert.equal(result.operations[0].request.startsAt, entries[1].request.startsAt);
  assert.equal(result.operations[0].request.requestFingerprint, resourceBookingRequestFingerprint(entries[1].request));
});

test("given a nested secret in a series request, when parsing it, then schema rejection cannot echo the secret", () => {
  // given
  const entries = frames("previewSeries", 200);
  entries[1].path = "/api/booking-series-preview";
  entries[1].request = { courtIds: [court], note: { token: "private-token" } };
  entries[2].responseBookingId = null;
  // when
  const result = parseResourceJournal(log(entries), { accounts });
  // then
  assert.equal(result.complete, false);
  assert.ok(!JSON.stringify(result).includes("private-token"));
});

for (const change of ["response-id", "request-body"]) {
  test(`given repeated duplicate responses, when the ${change} changes, then correlation fails even with a complete capture`, () => {
    // given
    const entries = frames();
    const begin = { ...entries[1], id: "2:1", vu: 2 };
    const end = { ...entries[2], id: "2:1" };
    if (change === "response-id") end.responseBookingId = manager;
    else begin.request = { ...request, note: "Changed body" };
    entries.splice(3, 0, begin, end);
    Object.assign(entries.at(-1), { started: 2, finished: 2 });
    // when
    const result = parseResourceJournal(log(entries), { accounts });
    // then
    assert.equal(result.complete, false);
    assert.ok(result.findings.includes("replay-mismatch"));
    assert.equal(result.operations.length, 2);
  });
}

test("given a successful login and subsequent session identity, when parsing it, then account attribution retains the actual POST interval", () => {
  // given
  const entries = frames("login", 200);
  Object.assign(entries[1], { path: "/api/session", actorUsername: null, request: { username: "security.manager.1" } });
  entries[2].responseBookingId = null;
  entries.splice(3, 0,
    { event: "begin", id: "1:2", vu: 1, sequence: 2, kind: "read", method: "GET", path: "/api/session",
      startedAt: endedAt, actorUsername: null, request: null },
    { event: "end", id: "1:2", status: 200, endedAt, responseBookingId: null,
      identityUsername: "security.manager.1", ownedSessionIds: [manager] });
  Object.assign(entries.at(-1), { started: 2, finished: 2 });
  // when
  const result = parseResourceJournal(log(entries), { accounts });
  // then
  assert.equal(result.complete, true);
  assert.equal(result.operations[0].accountId, manager);
  assert.equal(result.operations[0].endedAt, endedAt);
  assert.deepEqual(result.ownedSessionIds, [manager]);
});

test("given a successful login without an observed session identity, when parsing it, then its account cannot be assumed", () => {
  // given
  const entries = frames("login", 200);
  Object.assign(entries[1], { path: "/api/session", actorUsername: null, request: { username: "security.manager.1" } });
  entries[2].responseBookingId = null;
  // when
  const result = parseResourceJournal(log(entries), { accounts });
  // then
  assert.equal(result.complete, false);
  assert.ok(result.findings.includes("login-identity-incomplete"));
});

for (const status of [200, 201]) test(`given an exact empty TOCTOU series response with status ${status}, when parsing it, then capture includes the native no-effect mutation`, () => {
  // given
  const entries = frames("createSeries", status);
  entries[1].path = "/api/booking-series";
  entries[1].request = { courtIds: [court], cardId: card, startsOn: "2026-10-08", startTime: "18:00:00",
    durationMinutes: 60, intervalWeeks: 1, weekdays: ["THURSDAY"], occurrenceCount: 1,
    confirmedStarts: [request.startsAt] };
  entries[2].responseBookingId = null;
  entries[2].seriesResult = { seriesId: null, bookingIds: [], skipped: [request.startsAt] };
  // when
  const result = parseResourceJournal(log(entries), { accounts });
  // then
  assert.equal(result.captureComplete, true);
  assert.equal(result.complete, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.operations[0].kind, "createSeries");
  assert.deepEqual(result.operations[0].request.confirmedStarts, [request.startsAt]);
});

test("given a successful series response with a persistent ID, when journalling it, then the private result preserves that ID", () => {
  // given
  const entries = frames("createSeries", 201);
  entries[1].path = "/api/booking-series";
  entries[1].request = { courtIds: [court], cardId: card, startsOn: "2026-10-08", startTime: "18:00:00",
    durationMinutes: 60, intervalWeeks: 1, weekdays: ["THURSDAY"], occurrenceCount: 1,
    confirmedStarts: [request.startsAt] };
  entries[2].responseBookingId = null;
  entries[2].seriesResult = { seriesId: manager, bookingIds: [booking], skipped: [] };
  // when
  const result = parseResourceJournal(log(entries), { accounts });
  // then
  assert.equal(result.captureComplete, true);
  assert.equal(result.complete, false);
  assert.equal(result.operations[0].seriesResult.seriesId, manager);
});

for (const variant of ["missing", "wrong-status", "wrong-skip", "multiple-skips", "multiple-confirmed", "new-booking", "new-series", "unknown-field"]) {
  test(`given an empty series result with ${variant}, when parsing it, then unknown effects cannot qualify as complete`, () => {
    // given
    const entries = frames("createSeries", 201);
    entries[1].path = "/api/booking-series";
    entries[1].request = { courtIds: [court], cardId: card, startsOn: "2026-10-08", startTime: "18:00:00",
      durationMinutes: 60, intervalWeeks: 1, weekdays: ["THURSDAY"], occurrenceCount: 1,
      confirmedStarts: [request.startsAt] };
    entries[2].responseBookingId = null;
    entries[2].seriesResult = { seriesId: null, bookingIds: [], skipped: [request.startsAt] };
    if (variant === "missing") delete entries[2].seriesResult;
    if (variant === "wrong-status") entries[2].status = 202;
    if (variant === "wrong-skip") entries[2].seriesResult.skipped = [request.endsAt];
    if (variant === "multiple-skips") entries[2].seriesResult.skipped.push(request.endsAt);
    if (variant === "multiple-confirmed") entries[1].request.confirmedStarts.push(request.endsAt);
    if (variant === "new-booking") entries[2].seriesResult.bookingIds.push(booking);
    if (variant === "new-series") entries[2].seriesResult.seriesId = manager;
    if (variant === "unknown-field") entries[2].seriesResult.unknown = true;
    // when
    const result = parseResourceJournal(log(entries), { accounts });
    // then
    assert.equal(result.complete, false);
    assert.ok(result.findings.length > 0);
  });
}

for (const change of ["missing-start", "missing-finish", "missing-begin", "missing-end", "duplicate-end", "count", "sequence", "status", "clock", "secret", "fingerprint", "overlap", "wrong-response-kind"]) {
  test(`given a bounded journal, when ${change} makes capture ambiguous, then parsing fails closed without echoing private input`, () => {
    // given
    const entries = frames();
    if (change === "missing-start") entries.shift();
    if (change === "missing-finish") entries.pop();
    if (change === "missing-begin") entries.splice(1, 1);
    if (change === "missing-end") entries.splice(2, 1);
    if (change === "duplicate-end") entries.splice(3, 0, entries[2]);
    if (change === "count") entries[3].started = 2;
    if (change === "sequence") entries[1].sequence = 2;
    if (change === "status") entries[2].status = 0;
    if (change === "clock") entries[2].endedAt = "2026-10-05T23:59:58.000Z";
    if (change === "secret") entries[1].password = "private-password";
    if (change === "fingerprint") entries[1].request = { ...request, requestFingerprint: "f".repeat(64) };
    if (change === "overlap") {
      entries.splice(2, 0, { ...entries[1], id: "1:2", sequence: 2 });
      entries.splice(4, 0, { ...entries[3], id: "1:2" });
      Object.assign(entries.at(-1), { started: 2, finished: 2 });
    }
    if (change === "wrong-response-kind") entries[2].identityUsername = "security.manager.1";
    // when
    const result = parseResourceJournal(log(entries), { accounts });
    // then
    assert.equal(result.complete, false);
    assert.ok(result.findings.length > 0);
    assert.ok(!JSON.stringify(result).includes("private-password"));
  });
}

test("given duplicate JSON keys and truncated markers, when parsing logs, then neither can masquerade as complete evidence", () => {
  // given
  const input = log(frames());
  const duplicate = input.replace('"status":201', '"status":409,"status":201');
  const truncated = input + resourceJournalMarker + '{"event":"begin"';
  // when / then
  assert.equal(parseResourceJournal(duplicate, { accounts }).complete, false);
  assert.equal(parseResourceJournal(truncated, { accounts }).complete, false);
});

test("given two successful identical deliveries, when parsing them, then both responses correlate with the original booking", () => {
  // given
  const entries = frames();
  entries.splice(3, 0, { ...entries[1], id: "2:1", vu: 2 }, { ...entries[2], id: "2:1" });
  Object.assign(entries.at(-1), { started: 2, finished: 2 });
  // when
  const result = parseResourceJournal(log(entries), { accounts });
  // then
  assert.equal(result.complete, true);
  assert.equal(result.operations.length, 2);
  assert.deepEqual(result.operations[0].request, result.operations[1].request);
  assert.equal(result.operations[0].responseBookingId, result.operations[1].responseBookingId);
});

test("given ambiguous account identities, when mapping private journal actors, then no duplicate UUID can qualify", () => {
  // given
  const ambiguous = [...accounts, { id: manager, username: "security.member.1" }];
  // when
  const result = parseResourceJournal(log(frames()), { accounts: ambiguous });
  // then
  assert.equal(result.complete, false);
  assert.ok(result.findings.includes("account-mapping-invalid"));
});

test("given a read marker using a method the API never declares, when parsing it, then the operation cannot qualify", () => {
  // given
  const entries = frames("read", 200);
  Object.assign(entries[1], { path: "/api/public/booking-grid", request: null });
  entries[2].responseBookingId = null;
  // when
  const result = parseResourceJournal(log(entries), { accounts });
  // then
  assert.equal(result.complete, false);
  assert.ok(result.findings.includes("journal-frame-invalid"));
});

test("given k6 console text and JSON log envelopes, when parsing them, then both retain the same machine evidence", () => {
  // given
  const messages = log(frames()).trimEnd().split("\n");
  const text = messages.map(msg => `time="2026-10-06T00:00:01Z" level=info msg=${JSON.stringify(msg)} source=console`).join("\n");
  const json = messages.map(msg => JSON.stringify({ level: "info", msg, source: "console" })).join("\n");
  // when / then
  assert.equal(parseResourceJournal(text, { accounts }).complete, true);
  assert.deepEqual(parseResourceJournal(text, { accounts }), parseResourceJournal(json, { accounts }));
});

test("given excessive input or operation counts, when parsing, then bounded processing returns only closed failure codes", () => {
  // given
  const entries = frames();
  entries.at(-1).started = resourceJournalLimits.operations + 1;
  // when / then
  assert.ok(parseResourceJournal("x".repeat(resourceJournalLimits.bytes + 1), { accounts }).findings.includes("journal-size-exceeded"));
  assert.equal(parseResourceJournal(log(entries), { accounts }).complete, false);
});

function slotPlan(clock = startedAt, timeZone = "Europe/Berlin") {
  return resourceDatePlan({ tables: { club_config: { rows: [{ time_zone: timeZone }] } } }, Date.parse(clock));
}

for (const clock of ["2026-07-01T23:59:59.000Z", "2026-12-01T23:59:59.000Z"]) {
  test(`given a club-time slot plan at ${clock}, when separate VUs cross midnight, then booking and series requests retain the frozen local dates`, () => {
    // given
    const harness = scriptHarness();
    const plan = slotPlan(clock);
    harness.backend.plan = plan;
    harness.advance(Date.parse(clock));
    const run = harness.setup();
    // when
    harness.advance(Date.parse(clock) + 86400000);
    harness.fork(1).context.api.competingOccupancyRace(run);
    harness.fork(2).context.api.previewMutation(run);
    harness.fork(3).context.api.seriesPressure(run);
    // then
    const creates = harness.calls.filter(call => call.path === "/api/bookings");
    assert.equal(JSON.parse(creates[0].body).startsAt, plan.slots["3"].startsAt);
    const preview = JSON.parse(harness.calls.find(call => call.path === "/api/booking-series-preview").body);
    assert.equal(preview.startsOn, plan.slots["6"].startsOn);
    assert.equal(preview.startTime, plan.slots["6"].startTime);
    assert.deepEqual(preview.weekdays, [plan.slots["6"].weekday]);
    assert.equal(preview.startTime, clock.includes("-12-") ? "17:00:00" : "18:00:00");
    assert.equal(JSON.parse(creates[1].body).startsAt, plan.slots["6"].startsAt.replace(".000Z", "Z"));
    const cost = JSON.parse(harness.calls.filter(call => call.path === "/api/booking-series-preview").at(-1).body);
    assert.equal(cost.startsOn, plan.seriesStartsOn);
    assert.equal(run.clock, plan.clock);
    const start = JSON.parse(harness.messages[0].slice(resourceJournalMarker.length));
    assert.equal(start.clock, new Date(plan.clock).toISOString());
    assert.ok(harness.backend.checks.every(check => check.pass));
  });
}

test("given a missing or inconsistent slot plan, when setup runs, then no login or mutation is attempted", () => {
  // given
  for (const invalid of [null, { ...slotPlan(), schemaVersion: 2 },
    { ...slotPlan(), slots: { ...slotPlan().slots, "6": { ...slotPlan().slots["6"], weekday: "MONDAY" } } }]) {
    const harness = scriptHarness();
    harness.backend.plan = invalid;
    // when / then
    assert.throws(() => harness.setup(), /Invalid resource slot plan/);
    assert.equal(harness.calls.length, 0);
  }
});

test("given a native series response missing its identity field, when the producer journals it, then it cannot invent a known empty result", () => {
  // given
  const harness = scriptHarness();
  const run = harness.setup();
  harness.backend.omitSeriesId = true;
  // when
  harness.context.api.previewMutation(run);
  harness.context.api.handleSummary({ metrics: Object.fromEntries(Object.entries(harness.counters)
    .map(([name, count]) => [name, { values: { count } }])), root_group: {} });
  const result = parseResourceJournal(harness.messages.join("\n"), { accounts });
  // then
  assert.equal(result.complete, false);
});

test("given a maximum-cost preview containing blocked occurrences, when journalling the read-only request, then capture stays complete without logging violation payloads", () => {
  // given
  const harness = scriptHarness();
  const run = harness.setup();
  harness.backend.blockedCostPreview = true;
  harness.advance(run.attackStartsAt + 1);
  // when
  harness.context.api.seriesPressure(run);
  harness.context.api.handleSummary({ metrics: Object.fromEntries(Object.entries(harness.counters)
    .map(([name, count]) => [name, { values: { count } }])), root_group: {} });
  const raw = harness.messages.join("\n");
  const result = parseResourceJournal(raw, { accounts });
  // then
  assert.equal(result.complete, true);
  assert.equal(result.operations.find(operation => operation.kind === "previewSeries").request.occurrenceCount, 200);
  assert.ok(!raw.includes("private-violation"));
});

for (const retry of ["3", "tomorrow-private-secret"]) {
  test(`given a native rate-limited login with ${retry === "3" ? "numeric" : "invalid"} retry metadata, when journalling it, then only typed evidence survives`, () => {
    // given
    const harness = scriptHarness();
    const run = harness.setup();
    harness.backend.failedRetry = retry;
    harness.advance(run.attackStartsAt + 1);
    // when
    harness.context.__ITER = 5;
    harness.context.api.resourceAbuse(run);
    harness.context.api.handleSummary({ metrics: Object.fromEntries(Object.entries(harness.counters)
      .map(([name, count]) => [name, { values: { count } }])), root_group: {} });
    const raw = harness.messages.join("\n");
    const result = parseResourceJournal(raw, { accounts });
    const operation = result.operations.find(operation => operation.status === 429);
    // then
    assert.equal(operation.problemType, "urn:courtside:error:login-rate-limited");
    assert.equal(operation.retryAfterSeconds, retry === "3" ? 3 : null);
    assert.equal(operation.requestSessionId, operation.sessionId);
    assert.equal(result.complete, retry === "3");
    assert.ok(!raw.includes("private-secret"));
    assert.ok(!raw.includes("private-password"));
  });
}

function scriptHarness(shared = null, vu = 1) {
  const source = readFileSync(new URL("../security/resource-abuse.js", import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
  const policy = JSON.parse(readFileSync(new URL("../security/resource-abuse-policy.json", import.meta.url), "utf8"));
  const application = readFileSync(new URL("../src/main/resources/application.yaml", import.meta.url), "utf8");
  const backend = shared ?? { messages: [], calls: [], counters: {}, checks: [], sessions: new Map(), bookings: new Map(),
    serial: 0, now: Date.parse(startedAt), plan: slotPlan(), refuseLogin: false, wrongIdentity: false,
    maxSessions: Number(/concurrent-limit: \$\{COURTSIDE_SESSION_MAX_CONCURRENT:(\d+)\}/.exec(application)[1]) };
  const { messages, calls, counters } = backend;
  const defaultJar = { cookies: {} };
  const context = {
    __ENV: { COURTSIDE_SECURITY_SHARED_PASSWORD: "private-password", COURTSIDE_SECURITY_RUN_ID: "run-example",
      COURTSIDE_SECURITY_DATE_PLAN: backend.plan === null ? undefined : JSON.stringify(backend.plan) },
    __VU: vu, __ITER: 0, open: () => JSON.stringify(policy), sleep: () => {},
    check: (value, checks) => {
      const outcomes = Object.entries(checks).map(([name, predicate]) => ({ name, pass: predicate(value) }));
      backend.checks.push(...outcomes);
      return outcomes.every(outcome => outcome.pass);
    },
    Counter: class { constructor(name) { this.name = name; } add(value) { counters[this.name] = (counters[this.name] ?? 0) + value; } },
    console: { log: message => messages.push(message) },
    encoding: { b64decode: value => Buffer.from(value, "base64").toString() },
    Date: class extends Date { static now() { return backend.now++; } }
  };
  function send(method, url, body, parameters) {
    const path = new URL(url).pathname;
    const jar = parameters?.jar ?? defaultJar;
    const cookie = parameters?.headers?.Cookie ?? Object.entries(jar.cookies).map(([name, value]) => `${name}=${value}`).join("; ");
    const held = /(?:^|; )__Host-SESSION=([^;]+)/.exec(cookie)?.[1];
    const authorized = backend.sessions.has(held);
    const call = { vu: context.__VU, method, path, body, parameters, cookie, status: null };
    calls.push(call);
    function respond(status, result = {}, cookies = {}, headers = {}) {
      call.status = status;
      for (const [name, values] of Object.entries(cookies)) jar.cookies[name] = values.at(-1).value;
      return { status, cookies, headers,
        json: key => key ? key.split(".").reduce((value, part) => value?.[part], result) : result };
    }
    const csrfCookie = value => ({ "__Host-XSRF-TOKEN": [{ value }] });
    if (path === "/api/session") {
      if (method === "GET") return respond(200, authorized ? {
        authenticated: true, username: backend.wrongIdentity ? "security.member.1" : "security.manager.1"
      } : { authenticated: false }, csrfCookie(authorized ? "private-auth-token" : "private-token"));
      if (body.startsWith("x")) return respond(413);
      if (parameters?.headers?.["X-XSRF-TOKEN"] !== "private-token") return respond(403);
      if (body.includes("-wrong")) return backend.failedRetry ? respond(429,
        { type: "urn:courtside:error:login-rate-limited", detail: "private-secret" }, {}, { "Retry-After": backend.failedRetry }) : respond(401);
      if (backend.refuseLogin) return respond(429);
      const id = Buffer.alloc(27, ++backend.serial).toString("base64url");
      const issued = Buffer.from(id).toString("base64");
      backend.sessions.set(issued, id);
      if (backend.sessions.size > backend.maxSessions) backend.sessions.delete(backend.sessions.keys().next().value);
      return respond(200, {}, { ...csrfCookie("private-auth-token"), "__Host-SESSION": [{ value: issued }] });
    }
    if (path === "/api/public/courts") return respond(200, [{ id: court }]);
    if (path === "/api/public/booking-cards") return respond(200, [{ id: card }]);
    if (path === "/api/public/participant-cards") return respond(200, [{ id: card, label: "Limited assessment card" }]);
    if (path === "/api/public/participant-members") return respond(200, [{ personId: manager }]);
    if (!path.startsWith("/api/public/")) {
      if (!authorized) return respond(401);
      if (parameters?.headers?.["X-XSRF-TOKEN"] !== "private-auth-token") return respond(403);
    }
    if (backend.refusePaths?.includes(path)) return respond(429, { type: backend.refusalType },
      {}, backend.refusalRetry === null ? {} : { "Retry-After": backend.refusalRetry ?? "1" });
    if (path === "/api/bookings") {
      const payload = JSON.parse(body);
      if (payload.participants?.length === 3) return respond(400, { type: "urn:courtside:error:participants-invalid",
        violations: [{ code: "booking.participants.cardUnavailable" }] });
      const key = parameters.headers["Idempotency-Key"];
      const previous = backend.bookings.get(key);
      if (previous) return previous.body === body ? respond(201, { id: previous.id }) : respond(409);
      if ([...backend.bookings.values()].some(value => value.startsAt === payload.startsAt)) {
        return respond(409, { type: "urn:courtside:error:court-unavailable" });
      }
      const id = `30000000-0000-0000-0000-${String(backend.bookings.size + 1).padStart(12, "0")}`;
      backend.bookings.set(key, { id, body, startsAt: payload.startsAt });
      return respond(201, { id });
    }
    if (path === "/api/booking-series-preview" && backend.blockedCostPreview) return respond(200,
      { occurrences: [{ startsAt: request.startsAt, endsAt: request.endsAt, creatable: false,
        blockedCourtIds: [court], violations: [{ code: "private-violation" }] }] });
    if (path === "/api/booking-series-preview") return respond(200, { occurrences: [{ creatable: true,
      blockedCourtIds: [], violations: [],
      startsAt: backend.plan.slots["6"].startsAt.replace(".000Z", "Z"),
      endsAt: backend.plan.slots["6"].endsAt.replace(".000Z", "Z") }] });
    if (path === "/api/booking-series") return respond(200, { ...(backend.omitSeriesId ? {} : { seriesId: null }), bookingIds: [],
      skipped: JSON.parse(body).confirmedStarts });
    return respond(200);
  }
  context.http = { CookieJar: class { constructor() { this.cookies = {}; } },
    get: (url, parameters) => send("GET", url, null, parameters),
    post: (url, body, parameters) => send("POST", url, body, parameters), expectedStatuses: () => {} };
  vm.createContext(context);
  vm.runInContext(source + "\nthis.api = { options, setup, resourceAbuse, previewMutation, requestBodyLimit, handleSummary,"
    + " competingOccupancyRace, duplicateDeliveryRace, participantCapacityRace, seriesPressure };", context);
  return { context, messages, calls, counters, backend,
    setup: () => JSON.parse(JSON.stringify(scriptHarness(backend, 0).context.api.setup())),
    fork: id => scriptHarness(backend, id), advance: value => { backend.now = value; } };
}

test("given the actual k6 script across midnight, when replay and capacity requests run, then their journal reflects the sent bodies and frozen dates", t => {
  // given
  const harness = scriptHarness();
  const run = harness.setup();
  harness.advance(Date.parse(endedAt) + 6000);
  const duplicate = harness.fork(1);
  // when
  duplicate.context.api.duplicateDeliveryRace(run);
  harness.advance(Date.parse(endedAt) + 86_400_000);
  duplicate.context.__ITER = 1;
  duplicate.context.api.duplicateDeliveryRace(run);
  harness.fork(2).context.api.participantCapacityRace(run);
  harness.context.api.handleSummary({ metrics: Object.fromEntries(Object.entries(harness.counters)
    .map(([name, count]) => [name, { values: { count } }])), root_group: {} });
  const result = parseResourceJournal(harness.messages.join("\n"), { accounts });
  const creates = result.operations.filter(operation => operation.kind === "createBooking");
  // then
  assert.equal(result.complete, true);
  assert.equal(creates.length, 3);
  assert.deepEqual(creates[0].request, creates[1].request);
  assert.equal(creates[2].status, 400);
  assert.deepEqual(creates[2].request.participants.map(participant => participant.kind), ["MEMBER", "CARD", "CARD"]);
  const sent = harness.calls.filter(call => call.path === "/api/bookings").map(call => JSON.parse(call.body));
  assert.equal(creates[0].request.startsAt, sent[0].startsAt);
  assert.equal(creates[0].request.note, sent[0].note);
  assert.ok(!harness.messages.join("\n").includes("private-password"));
  assert.ok(!harness.messages.join("\n").includes("private-token"));
  assert.ok(!harness.messages.join("\n").includes(Buffer.from(manager).toString("base64")));
  t.diagnostic(JSON.stringify({ proof: "generated-k6-journal", requests: harness.calls.length,
    operations: result.operations.length, creates: creates.length, rejected: creates.filter(operation => operation.status === 400).length,
    complete: result.complete, frozenReplay: true, secretsAbsent: true }));
});

test("given the actual TOCTOU scenario, when series creation runs, then every POST and its exact empty result qualify", t => {
  // given
  const harness = scriptHarness();
  const run = harness.setup();
  // when
  harness.context.api.previewMutation(run);
  harness.context.api.requestBodyLimit(run);
  harness.context.api.handleSummary({ metrics: Object.fromEntries(Object.entries(harness.counters)
    .map(([name, count]) => [name, { values: { count } }])), root_group: {} });
  const result = parseResourceJournal(harness.messages.join("\n"), { accounts });
  // then
  assert.equal(result.captureComplete, true);
  assert.equal(result.complete, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.operations.length, harness.calls.length);
  assert.ok(result.operations.some(operation => operation.kind === "createSeries"));
  assert.equal(result.operations.filter(operation => operation.kind === "login").length, 5,
    "setup signs one session in for each integrity scenario and one for the series pressure");
  assert.equal(result.operations.find(operation => operation.kind === "gatewayRejectedBody")?.status, 413);
  const bodyProbe = result.operations.find(operation => operation.kind === "gatewayRejectedBody");
  const bodyCall = harness.calls.find(call => call.path === "/api/session" && call.body?.startsWith("x"));
  assert.equal(bodyCall.parameters.headers["X-Courtside-Journal-Operation"], bodyProbe.id);
  assert.ok(harness.calls.filter(call => call !== bodyCall).every(call =>
    call.parameters?.headers?.["X-Courtside-Journal-Operation"] === undefined));
  assert.ok(harness.backend.checks.every(check => check.pass));
  const series = result.operations.find(operation => operation.kind === "createSeries");
  assert.deepEqual(series.result, { seriesId: null, bookingIds: [], skipped: series.request.confirmedStarts });
  assert.equal(series.request.endsOn, null);
  assert.deepEqual(Object.keys(series.request).sort(), ["cardId", "confirmedStarts", "courtIds", "durationMinutes", "endsOn",
    "intervalWeeks", "note", "occurrenceCount", "startTime", "startsOn", "weekdays"]);
  const normalizedPreview = { ...series.request };
  delete normalizedPreview.confirmedStarts;
  assert.deepEqual(result.operations.find(operation => operation.id === series.previewOperationId).request, normalizedPreview);
  assert.equal(result.operations.find(operation => operation.id === series.previewOperationId)?.kind, "previewSeries");
  assert.equal(result.operations.find(operation => operation.id === series.winnerOperationId)?.status, 201);
  t.diagnostic(JSON.stringify({ proof: "generated-toctou-journal", requests: harness.calls.length,
    operations: result.operations.length, captureComplete: result.captureComplete,
    complete: result.complete, findings: result.findings }));
});

test("given the instrumented script, when k6 reads its options, then scenarios and enforcement thresholds retain their original limits", () => {
  // given
  const harness = scriptHarness();
  const policy = JSON.parse(readFileSync(new URL("../security/resource-abuse-policy.json", import.meta.url), "utf8"));
  // when
  const options = JSON.parse(JSON.stringify(harness.context.api.options));
  // then
  const race = (exec) => ({ executor: "per-vu-iterations", exec, vus: policy.integrity.racers,
    iterations: policy.integrity.rounds, startTime: `${policy.warmupSeconds}s`,
    maxDuration: `${policy.integrity.rounds * policy.integrity.tickSeconds + 10}s` });
  assert.deepEqual(options, { scenarios: {
    resource_abuse: { executor: "ramping-vus", exec: "resourceAbuse", startVUs: 0, stages: policy.stages },
    competing_occupancy: race("competingOccupancyRace"),
    duplicate_delivery: race("duplicateDeliveryRace"),
    participant_capacity: race("participantCapacityRace"),
    series_pressure: { executor: "constant-vus", exec: "seriesPressure", vus: policy.seriesPressure.vus,
      startTime: `${policy.seriesPressure.startSeconds}s`, duration: `${policy.seriesPressure.durationSeconds}s` },
    preview_mutation: { executor: "shared-iterations", exec: "previewMutation", vus: 1, iterations: 1,
      startTime: "1s", maxDuration: "15s" },
    request_body: { executor: "shared-iterations", exec: "requestBodyLimit", vus: 1, iterations: 1,
      startTime: "2s", maxDuration: "10s" }
  }, gracefulStop: "2s", noCookiesReset: true, thresholds: { checks: ["rate==1"], http_req_failed: ["rate<0.02"] } });
});

test("given separate failed-login cookies, when pressure precedes another booking, then the manager actor remains attributable", () => {
  // given
  const harness = scriptHarness();
  const run = harness.setup();
  harness.advance(Date.parse(endedAt) + 6000);
  const duplicate = harness.fork(2);
  // when
  duplicate.context.api.duplicateDeliveryRace(run);
  harness.context.__ITER = 5;
  harness.context.api.resourceAbuse(run);
  duplicate.context.__ITER = 1;
  duplicate.context.api.duplicateDeliveryRace(run);
  harness.context.api.handleSummary({ metrics: Object.fromEntries(Object.entries(harness.counters)
    .map(([name, count]) => [name, { values: { count } }])), root_group: {} });
  const result = parseResourceJournal(harness.messages.join("\n"), { accounts });
  // then
  assert.equal(result.complete, true);
  assert.equal(result.operations.filter(operation => operation.kind === "login" && operation.status === 401).length, 1);
  assert.ok(result.operations.filter(operation => operation.kind === "createBooking").every(operation => operation.actorAccountId === manager));
  assert.deepEqual(result.loginUsernames, ["security.manager.1", "security.member.2"]);
});

test("given journal limits under continued load, when a VU exceeds its recording budget, then transport continues and capture fails closed", () => {
  // given
  const harness = scriptHarness();
  const run = harness.setup();
  harness.advance(Date.parse(endedAt) + 6000);
  // when
  for (let index = 0; index < 710; index++) {
    harness.context.__ITER = index;
    harness.context.api.duplicateDeliveryRace(run);
  }
  harness.context.api.handleSummary({ metrics: Object.fromEntries(Object.entries(harness.counters)
    .map(([name, count]) => [name, { values: { count } }])), root_group: {} });
  const output = harness.messages.join("\n");
  const result = parseResourceJournal(output, { accounts });
  // then
  assert.equal(harness.calls.filter(call => call.path === "/api/bookings").length, 710);
  for (const vu of [0, 1]) {
    const bytes = harness.messages.filter(message => {
      const frame = JSON.parse(message.slice(resourceJournalMarker.length));
      return frame.vu === vu || frame.id?.startsWith(`${vu}:`);
    }).reduce((size, message) => size + Buffer.byteLength(message) + 1, 0);
    assert.ok(bytes <= 448 * 1024);
  }
  assert.ok(harness.counters.journal_dropped > 0);
  assert.equal(result.complete, false);
  assert.ok(result.findings.includes("journal-capture-incomplete"));
});

test("given a request interrupted before its response, when summary still runs, then the missing completion remains detectable", t => {
  // given
  const harness = scriptHarness();
  const run = harness.setup();
  harness.advance(Date.parse(endedAt) + 6000);
  const post = harness.context.http.post;
  harness.context.http.post = (url, ...arguments_) => {
    if (url.endsWith("/api/bookings")) throw new Error("Synthetic transport interruption");
    return post(url, ...arguments_);
  };
  // when
  assert.throws(() => harness.context.api.duplicateDeliveryRace(run), /Synthetic transport interruption/);
  harness.context.api.handleSummary({ metrics: Object.fromEntries(Object.entries(harness.counters)
    .map(([name, count]) => [name, { values: { count } }])), root_group: {} });
  const result = parseResourceJournal(harness.messages.join("\n"), { accounts });
  // then
  assert.equal(harness.counters.journal_started, 20, "five setup sign-ins of three requests, four fixture reads and one booking");
  assert.equal(harness.counters.journal_finished, 19);
  assert.equal(result.complete, false);
  assert.ok(result.findings.includes("journal-capture-incomplete"));
  t.diagnostic(JSON.stringify({ proof: "interrupted-k6-journal", started: harness.counters.journal_started,
    finished: harness.counters.journal_finished, complete: result.complete, findings: result.findings }));
});

test("given four racers per integrity scenario and the five-session application limit, when races and login pressure run, then each scenario keeps its own setup session", t => {
  // given
  const harness = scriptHarness();
  const run = harness.setup();
  harness.advance(run.attackStartsAt + 1);
  const racers = { competingOccupancyRace: [], duplicateDeliveryRace: [], participantCapacityRace: [] };
  let vu = 0;
  for (const scenario of Object.keys(racers)) {
    for (let racer = 0; racer < 4; racer++) racers[scenario].push(harness.fork(++vu));
  }
  const pressure = Array.from({ length: 12 }, () => harness.fork(++vu));
  // when
  for (const [scenario, forks] of Object.entries(racers)) {
    for (const fork of forks) fork.context.api[scenario](structuredClone(run));
  }
  for (const fork of pressure) {
    fork.context.__ITER = 5;
    fork.context.api.resourceAbuse(structuredClone(run));
  }
  harness.fork(++vu).context.api.previewMutation(structuredClone(run));
  harness.context.api.handleSummary({ metrics: Object.fromEntries(Object.entries(harness.counters)
    .map(([name, count]) => [name, { values: { count } }])), root_group: {} });
  const logins = harness.calls.filter(call => call.path === "/api/session" && call.method === "POST");
  const successful = logins.filter(call => call.status === 200);
  const sessionOf = call => /__Host-SESSION=([^;]+)/.exec(call.cookie)?.[1];
  const writesBy = forks => harness.calls.filter(call => call.path === "/api/bookings"
    && forks.some(fork => fork.context.__VU === call.vu));
  const result = parseResourceJournal(harness.messages.join("\n"), { accounts });
  // then
  assert.equal(harness.backend.maxSessions, 5);
  assert.equal(successful.length, 5, "every session is signed in by setup before any pressure");
  assert.ok(successful.every(call => call.vu === 0));
  assert.equal(harness.backend.sessions.size, 5, "no sign-in evicts a session the application limit would drop");
  assert.deepEqual(result.ownedSessionIds, [...harness.backend.sessions.values()].sort());
  const scenarioSessions = Object.values(racers).map(forks => new Set(writesBy(forks).map(sessionOf)));
  assert.ok(scenarioSessions.every(sessions => sessions.size === 1), "the racers of one scenario share its session");
  assert.equal(new Set(scenarioSessions.flatMap(sessions => [...sessions])).size, 3,
    "no two integrity scenarios share a session");
  assert.equal(logins.filter(call => call.status === 401).length, 12);
  assert.ok(logins.filter(call => call.status === 401).every(call => call.parameters.jar && !call.cookie.includes("__Host-SESSION=")));
  assert.equal(harness.counters.successful_occupancy, 1);
  assert.equal(harness.counters.rejected_occupancy, 3);
  assert.equal(harness.counters.duplicate_responses, 4);
  assert.equal(result.captureComplete, true);
  assert.ok(result.operations.filter(operation => operation.kind === "login" && operation.status === 200)
    .every(operation => operation.accountId === manager && operation.username === "security.manager.1"));
  for (const fork of pressure) {
    const login = result.operations.find(operation => operation.kind === "login" && operation.status === 401
      && operation.vu === fork.context.__VU);
    assert.equal(login.username, `security.member.${(fork.context.__VU % 3) + 1}`);
    assert.equal(login.requestSessionId, login.sessionId);
  }
  assert.deepEqual(result.loginUsernames, ["security.manager.1", "security.member.1", "security.member.2", "security.member.3"]);
  assert.ok(result.operations.filter(operation => operation.kind === "createBooking").every(operation => operation.actorAccountId === manager));
  const raw = harness.messages.join("\n");
  assert.ok(!raw.includes("private-password") && !raw.includes("private-token") && !raw.includes("private-auth-token"));
  assert.ok([...harness.backend.sessions.keys()].every(cookie => !raw.includes(cookie)));
  t.diagnostic(JSON.stringify({ proof: "separate-setup-sessions", racers: vu, successfulLogins: successful.length,
    survivingSessions: harness.backend.sessions.size, contentionWinners: harness.counters.successful_occupancy,
    contentionLosers: harness.counters.rejected_occupancy, duplicateResponses: harness.counters.duplicate_responses,
    failedLogins: 12, captureComplete: result.captureComplete }));
});

test("given admission refusals during the integrity races, when the script meets them, then it records them without judging the race", () => {
  // given
  const harness = scriptHarness();
  const run = harness.setup();
  harness.advance(run.attackStartsAt + 1);
  harness.backend.refusePaths = ["/api/bookings", "/api/booking-series-preview"];
  harness.backend.refusalType = "urn:courtside:error:request-rate-limited";
  // when
  harness.fork(1).context.api.competingOccupancyRace(run);
  harness.fork(2).context.api.duplicateDeliveryRace(run);
  harness.fork(3).context.api.participantCapacityRace(run);
  harness.fork(4).context.api.previewMutation(run);
  harness.context.api.handleSummary({ metrics: Object.fromEntries(Object.entries(harness.counters)
    .map(([name, count]) => [name, { values: { count } }])), root_group: {} });
  const result = parseResourceJournal(harness.messages.join("\n"), { accounts });
  // then
  assert.equal(harness.counters.integrity_admission_refusals, 4);
  assert.deepEqual(harness.backend.checks.filter(check => /^(competing-court-occupancy|duplicate-delivery|participant-capacity|preview-mutation-race):(?!fixtures-ready)/
    .test(check.name)), [], "a refused request is neither a passed nor a failed integrity check");
  assert.ok(result.operations.filter(operation => operation.status === 429).every(operation =>
    operation.problemType === "urn:courtside:error:request-rate-limited" && operation.retryAfterSeconds === 1));
  assert.equal(result.complete, true);
});

for (const [name, type, retry, passes] of [
  ["a typed refusal with Retry-After", "urn:courtside:error:operation-capacity-exhausted", "1", true],
  ["a typed refusal without Retry-After", "urn:courtside:error:request-rate-limited", null, false],
  ["a 429 of another kind", "urn:courtside:error:login-rate-limited", "1", false]
]) {
  test(`given ${name}, when the series pressure meets it, then only the typed admission answer passes`, () => {
    // given
    const harness = scriptHarness();
    const run = harness.setup();
    harness.backend.refusePaths = ["/api/booking-series-preview"];
    harness.backend.refusalType = type;
    harness.backend.refusalRetry = retry;
    // when
    harness.context.api.seriesPressure(run);
    // then
    const check = harness.backend.checks.find(entry => entry.name === "series-and-rule-cost:maximum-preview-controlled");
    assert.equal(check.pass, passes, `${name} ${passes ? "is" : "is not"} the refusal the pressure is meant to provoke`);
    assert.equal(harness.counters.pressure_admission_refusals ?? 0, passes ? 1 : 0);
  });
}

for (const failure of ["refused-login", "wrong-identity"]) {
  test(`given ${failure} during shared authentication, when setup prepares booking traffic, then it fails before any domain mutation`, () => {
    // given
    const harness = scriptHarness();
    if (failure === "refused-login") harness.backend.refuseLogin = true;
    else harness.backend.wrongIdentity = true;
    // when / then
    assert.throws(() => harness.setup(), /Resource booking setup incomplete/);
    assert.ok(!harness.calls.some(call => ["/api/bookings", "/api/booking-series"].includes(call.path)));
    assert.ok(!harness.messages.join("\n").includes("private-password"));
  });
}

test("given VU zero creates a booking instead of preparing authentication, when parsing setup evidence, then the mutation is rejected", () => {
  // given
  const entries = frames();
  Object.assign(entries[1], { vu: 0, id: "0:1" });
  entries[2].id = "0:1";
  // when
  const result = parseResourceJournal(log(entries), { accounts });
  // then
  assert.equal(result.complete, false);
  assert.ok(result.findings.includes("journal-frame-invalid"));
});
