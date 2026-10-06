import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { resourceIntegritySchema, resourceBookingRequestFingerprint } from "./security-resource-integrity.mjs";
import { planResourceCleanup, verifyResourceCleanup, verifyResourceCleanupPrecondition } from "./security-resource-cleanup.mjs";

const manager = "10000000-0000-0000-0000-000000000001";
const person = "20000000-0000-0000-0000-000000000001";
const bookingId = "30000000-0000-0000-0000-000000000001";
const oldBookingId = "30000000-0000-0000-0000-000000000002";
const court = "40000000-0000-0000-0000-000000000001";
const card = "11111111-1111-1111-1111-111111111111";
const startedAt = "2026-10-05T10:00:00.000Z";
const endedAt = "2026-10-05T10:01:00.000Z";
const time = "2026-10-05T10:00:10.000Z";
const note = "Security occupancy ' \\ $courtside_cleanup$; DELETE FROM person; --";

function row(table, values) {
  return Object.fromEntries(resourceIntegritySchema[table].columns.map(column =>
    [column, Object.hasOwn(values, column) ? values[column] : null]));
}

function fixture() {
  const before = { schemaVersion: 1, tables: Object.fromEntries(Object.entries(resourceIntegritySchema)
    .map(([table, definition]) => [table, { ...structuredClone(definition), rows: [] }])) };
  before.tables.person.rows.push(row("person", { id: person, first_name: "Jane", last_name: "Doe", email: "jane@example.org" }));
  before.tables.user_account.rows.push(row("user_account", { id: manager, person_id: person,
    username: "security.manager.1", enabled: true, password_hash: "private-hash", last_login_at: null }));
  before.tables.court.rows.push(row("court", { id: court, active: true }));
  before.tables.booking_card.rows.push(row("booking_card", { id: card, active: true, allowed_player_counts: [2] }));
  before.tables.booking.rows.push(row("booking", { id: oldBookingId, card_id: card, note, status: "CONFIRMED" }));
  before.tables.court_allocation.rows.push(row("court_allocation", { id: "50000000-0000-0000-0000-000000000002",
    booking_id: oldBookingId, court_id: court, starts_at: "2026-10-09T16:00:00.000Z",
    ends_at: "2026-10-09T17:00:00.000Z", status: "CONFIRMED" }));
  before.tables.booking_participant.rows.push(row("booking_participant", { id: "60000000-0000-0000-0000-000000000003",
    booking_id: oldBookingId, position: 0, kind: "MEMBER", person_id: person }));
  const effects = structuredClone(before);
  const request = { cardId: card, courtIds: [court], startsAt: "2026-10-08T16:00:00.000Z",
    endsAt: "2026-10-08T17:00:00.000Z", note,
    participants: [{ kind: "GUEST", personId: null, guestName: "Example Guest", cardId: null }],
    idempotencyKey: "cleanup-example", requestFingerprint: null };
  request.requestFingerprint = resourceBookingRequestFingerprint(request);
  effects.tables.booking.rows.push(row("booking", { id: bookingId, card_id: card, booked_by: manager,
    status: "CONFIRMED", created_at: time, note, idempotency_key: request.idempotencyKey,
    request_fingerprint: request.requestFingerprint }));
  effects.tables.court_allocation.rows.push(row("court_allocation", { id: "50000000-0000-0000-0000-000000000001",
    booking_id: bookingId, court_id: court, starts_at: request.startsAt, ends_at: request.endsAt, status: "CONFIRMED" }));
  effects.tables.booking_participant.rows.push(
    row("booking_participant", { id: "60000000-0000-0000-0000-000000000001", booking_id: bookingId,
      position: 1, kind: "MEMBER", person_id: person }),
    row("booking_participant", { id: "60000000-0000-0000-0000-000000000002", booking_id: bookingId,
      position: 2, kind: "GUEST", guest_name: "Example Guest" }));
  effects.tables.domain_event.rows.push(row("domain_event", { id: "70000000-0000-0000-0000-000000000001",
    event_type: "booking.booking.confirmed", subject_id: bookingId, actor_account_id: manager,
    occurred_at: time, payload: { bookingId } }));
  effects.tables.message_record.rows.push(row("message_record", { id: "80000000-0000-0000-0000-000000000001",
    account_id: manager, kind: "BOOKING_CONFIRMED", state: "HANDED_OVER", message_id: "<cleanup@example.org>",
    queued_at: time, queued_seq: 1, settled_at: time }));
  effects.tables.user_account.rows[0].last_login_at = time;
  return { before, effects, contract: { schemaVersion: 1, managerAccountId: manager,
    interval: { startedAt, endedAt }, mailEnabled: true,
    publicationListeners: ["org.courtside.notification.internal.BookingMailer.on(org.courtside.shared.BookingConfirmed)"],
    publicationLifecycle: {
      completionMode: "DELETE", eventType: "org.courtside.shared.BookingConfirmed",
      listenerId: "org.courtside.notification.internal.BookingMailer.on(org.courtside.shared.BookingConfirmed)",
      repositoryMode: "JDBC_V2"
    },
    authentication: { ownedSessionPrimaryIds: [], loginSubjects: [] } },
  journal: { schemaVersion: 1, complete: true, effectsSettled: true, publications: [], operations: [
    { id: "login-1", kind: "login", status: 200, accountId: manager, startedAt, endedAt: time },
    { id: "create-1", kind: "createBooking", status: 201, actorAccountId: manager,
      responseBookingId: bookingId, request, startedAt, endedAt: time }
  ], mailReceipts: [{ messageId: "<cleanup@example.org>", accountId: manager, recipient: "jane@example.org",
    calendarUid: `booking-${bookingId}@courtside`, startsAt: request.startsAt, endsAt: request.endsAt, acceptedAt: time }] } };
}

test("given settled effects without publication rows, when cleanup is planned, then the fixture carries the actual closed native V2 binding", () => {
  // given
  const input = fixture();
  // when
  const plan = planResourceCleanup(input);
  // then
  assert.deepEqual(input.contract.publicationLifecycle, {
    completionMode: "DELETE",
    eventType: "org.courtside.shared.BookingConfirmed",
    listenerId: "org.courtside.notification.internal.BookingMailer.on(org.courtside.shared.BookingConfirmed)",
    repositoryMode: "JDBC_V2"
  });
  assert.equal(plan.outcome, "passed");
});

for (const damage of ["missing", "repository", "listener", "completion", "extra"]) {
  test(`given ${damage} native publication binding without publication rows, when cleanup is planned, then no deletion is authorized`, () => {
    // given
    const input = fixture();
    input.contract.publicationLifecycle = {
      completionMode: "DELETE",
      eventType: "org.courtside.shared.BookingConfirmed",
      listenerId: "org.courtside.notification.internal.BookingMailer.on(org.courtside.shared.BookingConfirmed)",
      repositoryMode: "JDBC_V2"
    };
    if (damage === "missing") delete input.contract.publicationLifecycle;
    if (damage === "repository") input.contract.publicationLifecycle.repositoryMode = "JDBC_V1";
    if (damage === "listener") input.contract.publicationLifecycle.listenerId = "";
    if (damage === "completion") input.contract.publicationLifecycle.completionMode = "UPDATE";
    if (damage === "extra") input.contract.publicationLifecycle.extra = true;
    // when
    const plan = planResourceCleanup(input);
    // then
    assert.equal(plan.outcome, "incomplete");
    assert.equal(plan.sql, null);
  });
}

test("given a newly created native booking, when cleanup captures its actual deletion bodies, then participant positions start at one", () => {
  // given
  const input = fixture();
  // when
  const plan = planResourceCleanup(input);
  // then
  assert.equal(plan.outcome, "passed");
  const captured = [...plan.sql.matchAll(/decode\('([a-f0-9]+)', 'hex'\)/g)]
    .map(([, encoded]) => JSON.parse(Buffer.from(encoded, "hex").toString("utf8"))).at(-1);
  assert.deepEqual(captured.booking_participant.map(participant => ({ position: participant.position, kind: participant.kind })),
    [{ position: 1, kind: "MEMBER" }, { position: 2, kind: "GUEST" }]);
  assert.deepEqual(captured.booking_participant, plan.capturedTargets.booking_participant);
  assert.deepEqual(plan.expected.tables.booking_participant.rows, input.before.tables.booking_participant.rows);
});

for (const position of [0, 7, 19]) {
  test(`given a protected participant at position ${position}, when new booking cleanup is planned, then its original row is preserved exactly`, () => {
    // given
    const input = fixture();
    input.before.tables.booking_participant.rows[0].position = position;
    input.effects.tables.booking_participant.rows[0].position = position;
    const protectedRows = structuredClone(input.before.tables.booking_participant.rows);
    // when
    const plan = planResourceCleanup(input);
    // then
    assert.equal(plan.outcome, "passed");
    assert.deepEqual(plan.expected.tables.booking_participant.rows, protectedRows);
    assert.equal(verifyResourceCleanup({ ...input, actual: plan.expected }).outcome, "passed");
  });
}

test("given proven effects and an old booking with the same note, when planning cleanup, then remove only the new booking and its cascading children", () => {
  // given
  const input = fixture();
  const original = structuredClone(input);
  // when
  const plan = planResourceCleanup(input);
  // then
  assert.equal(plan.outcome, "passed");
  assert.deepEqual(plan.bookingIds, [bookingId]);
  for (const table of ["booking", "court_allocation", "booking_participant"]) {
    assert.deepEqual(plan.expected.tables[table].rows, input.before.tables[table].rows);
  }
  for (const table of Object.keys(input.effects.tables).filter(table => !["booking", "court_allocation", "booking_participant"].includes(table))) {
    assert.deepEqual(plan.expected.tables[table], input.effects.tables[table]);
  }
  assert.deepEqual(input, original);
  assert.equal(plan.nativeProofRequired, true);
});

test("given exact cleanup with reordered metadata and rows, when verifying it, then accept the full expected fingerprint", () => {
  // given
  const input = fixture();
  const actual = planResourceCleanup(input).expected;
  actual.tables = Object.fromEntries(Object.entries(actual.tables).reverse());
  for (const table of Object.values(actual.tables)) { table.columns.reverse(); table.rows.reverse(); }
  // when
  const proof = verifyResourceCleanup({ ...input, actual });
  // then
  assert.equal(proof.outcome, "passed");
  assert.equal(proof.actualFingerprint, proof.expectedFingerprint);
  assert.doesNotMatch(JSON.stringify(proof), /private-hash|Example Guest|cleanup@example|Security occupancy/);
});

test("given a changed audit row and unknown schema metadata, when verifying cleanup, then proven corruption remains failed", () => {
  // given
  const input = fixture();
  const actual = structuredClone(planResourceCleanup(input).expected);
  actual.tables.domain_event.rows[0].payload = { bookingId: oldBookingId };
  actual.tables.unknown_table = { columns: ["id"], primaryKey: ["id"], rows: [] };
  // when
  const proof = verifyResourceCleanup({ ...input, actual });
  // then
  assert.equal(proof.outcome, "failed");
});

test("given captured private target bodies, when generating SQL, then encoded JSON binds every exact row without SQL interpolation", () => {
  // given
  const input = fixture();
  // when
  const plan = planResourceCleanup(input);
  const values = [...plan.sql.matchAll(/decode\('([a-f0-9]+)', 'hex'\)/g)]
    .map(([, encoded]) => JSON.parse(Buffer.from(encoded, "hex").toString("utf8")));
  // then
  assert.equal(values.length, 4);
  assert.deepEqual(values[3], plan.capturedTargets);
  assert.equal(values[3].booking[0].note, note);
  assert.equal(values[3].booking_participant.length, 2);
  assert.equal(values[3].court_allocation.length, 1);
});

for (const table of ["booking", "court_allocation", "booking_participant", "domain_event", "message_record", "user_account"]) {
  test(`given proven effects, when cleanup leaves or changes ${table}, then verification fails`, () => {
    // given
    const input = fixture();
    const actual = structuredClone(planResourceCleanup(input).expected);
    if (["booking", "court_allocation", "booking_participant"].includes(table)) actual.tables[table] = input.effects.tables[table];
    else actual.tables[table].rows = [];
    // when
    const proof = verifyResourceCleanup({ ...input, actual });
    // then
    assert.equal(proof.outcome, "failed");
    assert.notEqual(proof.actualFingerprint, proof.expectedFingerprint);
  });
}

for (const damage of ["unknown", "missing", "column", "primaryKey", "extraMetadata", "partialRow"]) {
  test(`given ${damage} snapshot metadata, when verifying cleanup, then coverage is incomplete`, () => {
    // given
    const input = fixture();
    const actual = structuredClone(planResourceCleanup(input).expected);
    if (damage === "unknown") actual.tables.foreign_table = { columns: ["id"], primaryKey: ["id"], rows: [] };
    if (damage === "missing") delete actual.tables.person;
    if (damage === "column") actual.tables.person.columns.push("unknown_column");
    if (damage === "primaryKey") actual.tables.person.primaryKey = ["email"];
    if (damage === "extraMetadata") actual.schema = "foreign";
    if (damage === "partialRow") delete actual.tables.person.rows[0].email;
    // when
    const proof = verifyResourceCleanup({ ...input, actual });
    // then
    assert.equal(proof.outcome, "incomplete");
  });
}

for (const damage of ["unknownBooking", "rejected", "preexisting", "audit", "incompleteJournal", "unknownSchema"]) {
  test(`given ${damage} effects, when planning cleanup, then no executable deletion is produced`, () => {
    // given
    const input = fixture();
    if (damage === "unknownBooking") input.effects.tables.booking.rows.push(row("booking", { id: "90000000-0000-0000-0000-000000000001", note }));
    if (damage === "rejected") input.journal.operations[1].status = 409;
    if (damage === "preexisting") input.journal.operations[1].responseBookingId = oldBookingId;
    if (damage === "audit") input.effects.tables.domain_event.rows[0].payload = {};
    if (damage === "incompleteJournal") input.journal.complete = false;
    if (damage === "unknownSchema") input.effects.tables.extra = { columns: ["id"], primaryKey: ["id"], rows: [] };
    // when
    const plan = planResourceCleanup(input);
    // then
    assert.notEqual(plan.outcome, "passed");
    assert.equal(plan.sql, null);
    assert.deepEqual(plan.bookingIds, []);
  });
}

for (const table of ["booking", "court_allocation", "booking_participant"]) {
  test(`given captured ${table} rows, when a target body drifts before deletion, then the precondition fails`, () => {
    // given
    const input = fixture();
    const current = structuredClone(input.effects);
    const target = current.tables[table].rows.find(row => table === "booking" ? row.id === bookingId : row.booking_id === bookingId);
    target[table === "booking" ? "note" : table === "court_allocation" ? "status" : "guest_name"] = "changed";
    // when
    const proof = verifyResourceCleanupPrecondition({ ...input, current });
    // then
    assert.equal(proof.outcome, "failed");
  });
}

test("given a changed target child set, when checking deletion preconditions, then missing and added rows abort", () => {
  // given
  const input = fixture();
  // when / then
  for (const added of [false, true]) {
    const current = structuredClone(input.effects);
    if (added) current.tables.booking_participant.rows.push(row("booking_participant", {
      id: "90000000-0000-0000-0000-000000000001", booking_id: bookingId, kind: "GUEST", guest_name: "New Guest" }));
    else current.tables.court_allocation.rows.pop();
    assert.equal(verifyResourceCleanupPrecondition({ ...input, current }).outcome, "failed");
  }
});

test("given captured effects, when rendering the transaction, then lock and compare exact JSON before deleting UUID targets", () => {
  // given
  const input = fixture();
  // when
  const { sql } = planResourceCleanup(input);
  // then
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /current_database\(\) <> 'courtside_security'/);
  assert.match(sql, /LOCK TABLE public\.booking, public\.court_allocation, public\.booking_participant IN SHARE ROW EXCLUSIVE MODE/);
  assert.ok(sql.indexOf("RAISE EXCEPTION 'cleanup-target-drift'") < sql.indexOf("DELETE FROM public.booking"));
  for (const table of ["booking", "court_allocation", "booking_participant"]) assert.match(sql, new RegExp(`to_jsonb\\(r\\).*public\\.${table}`, "s"));
  assert.match(sql, /DELETE FROM public\.booking WHERE id = ANY/);
  assert.equal((sql.match(/DELETE FROM/g) ?? []).length, 1);
  assert.match(sql, /GET DIAGNOSTICS removed = ROW_COUNT/);
  assert.match(sql, /cleanup-schema-drift/);
  assert.match(sql, /cleanup-cascade-drift/);
  assert.match(sql, /COMMIT;$/);
  assert.match(sql, /END;\n\$courtside_cleanup\$;/);
  assert.doesNotMatch(sql, /Security occupancy|DELETE FROM person|private-hash/);
  assert.match(sql, new RegExp(`'${bookingId}'::uuid`));
  assert.doesNotMatch(sql, new RegExp(`'${oldBookingId}'::uuid`));
});

test("given the native migrations, when checking booking foreign keys, then only allocations and participants cascade from booking", () => {
  // given
  const migrations = ["V3__booking.sql", "V6__participants.sql"].map(name =>
    readFileSync(new URL(`../src/main/resources/db/migration/${name}`, import.meta.url), "utf8"));
  // when / then
  assert.match(migrations[0], /CREATE TABLE court_allocation[\s\S]*booking_id uuid\s+NOT NULL REFERENCES booking ON DELETE CASCADE/);
  assert.match(migrations[1], /CREATE TABLE booking_participant[\s\S]*booking_id uuid\s+NOT NULL REFERENCES booking ON DELETE CASCADE/);
  const directory = new URL("../src/main/resources/db/migration/", import.meta.url);
  const all = readdirSync(directory).filter(name => name.endsWith(".sql"))
    .map(name => readFileSync(new URL(name, directory), "utf8")).join("\n");
  assert.equal((all.match(/\bREFERENCES\s+(?:public\.)?booking\b/g) ?? []).length, 2);
});

test("given an unchanged domain without successful creates, when planning cleanup, then no deletion is needed", () => {
  // given
  const input = fixture();
  input.effects = structuredClone(input.before);
  input.journal.operations = [];
  input.journal.mailReceipts = [];
  // when
  const plan = planResourceCleanup(input);
  // then
  assert.equal(plan.outcome, "passed");
  assert.deepEqual(plan.bookingIds, []);
  assert.equal(plan.sql, null);
  assert.equal(verifyResourceCleanup({ ...input, actual: input.effects }).outcome, "passed");
});

test("given cyclic or oversized inputs, when planning cleanup, then fail closed within the input budget", () => {
  // given
  const cyclic = fixture();
  cyclic.journal.extra = cyclic;
  const oversized = fixture();
  oversized.journal.operations = Array(10001).fill(oversized.journal.operations[1]);
  // when / then
  for (const input of [cyclic, oversized, null]) {
    const plan = planResourceCleanup(input);
    assert.equal(plan.outcome, "incomplete");
    assert.equal(plan.sql, null);
  }
});

test("given a complete cleanup, when an old booking or child disappears, then verification fails even with the shared note", () => {
  // given
  const input = fixture();
  // when / then
  for (const table of ["booking", "court_allocation", "booking_participant"]) {
    const actual = structuredClone(planResourceCleanup(input).expected);
    actual.tables[table].rows = [];
    assert.equal(verifyResourceCleanup({ ...input, actual }).outcome, "failed");
  }
});

test("given a missing target booking, when checking deletion preconditions, then abort instead of deleting a partial target set", () => {
  // given
  const input = fixture();
  const current = structuredClone(input.effects);
  current.tables.booking.rows = current.tables.booking.rows.filter(row => row.id !== bookingId);
  // when
  const proof = verifyResourceCleanupPrecondition({ ...input, current });
  // then
  assert.equal(proof.outcome, "failed");
});

test("given a byte or depth budget overflow, when planning cleanup, then refuse all deletion", () => {
  // given
  const large = fixture();
  large.journal.extra = "x".repeat(32 * 1024 * 1024 + 1);
  const deep = fixture();
  deep.journal.extra = Array.from({ length: 40 }).reduce(value => ({ value }), null);
  // when / then
  for (const input of [large, deep]) {
    assert.equal(planResourceCleanup(input).outcome, "incomplete");
    assert.equal(planResourceCleanup(input).sql, null);
  }
});

function manyBookings(count) {
  const input = fixture();
  const template = structuredClone(input);
  input.effects = structuredClone(input.before);
  input.effects.tables.user_account.rows[0].last_login_at = time;
  input.journal.operations = [template.journal.operations[0]];
  input.journal.mailReceipts = [];
  const id = (prefix, index) => `${prefix}0000000-0000-0000-0000-${String(index).padStart(12, "0")}`;
  for (let index = 1; index <= count; index++) {
    const newId = id("a", index);
    const operation = structuredClone(template.journal.operations[1]);
    operation.id = `create-${index}`;
    operation.responseBookingId = newId;
    operation.request.idempotencyKey = `cleanup-${index}`;
    operation.request.startsAt = new Date(Date.parse(operation.request.startsAt) + (index + 10) * 86400000).toISOString();
    operation.request.endsAt = new Date(Date.parse(operation.request.endsAt) + (index + 10) * 86400000).toISOString();
    operation.request.requestFingerprint = resourceBookingRequestFingerprint(operation.request);
    input.journal.operations.push(operation);
    for (const table of ["booking", "court_allocation", "booking_participant", "domain_event", "message_record"]) {
      const additions = template.effects.tables[table].rows.filter(row =>
        !template.before.tables[table].rows.some(old => old.id === row.id));
      for (const [position, source] of additions.entries()) {
        const added = structuredClone(source);
        added.id = table === "booking" ? newId : id({ court_allocation: "b", booking_participant: "c",
          domain_event: "d", message_record: "e" }[table], index * 2 + position);
        if (table === "booking") Object.assign(added, { idempotency_key: operation.request.idempotencyKey,
          request_fingerprint: operation.request.requestFingerprint });
        if (["court_allocation", "booking_participant"].includes(table)) added.booking_id = newId;
        if (table === "court_allocation") Object.assign(added, { starts_at: operation.request.startsAt, ends_at: operation.request.endsAt });
        if (table === "domain_event") Object.assign(added, { subject_id: newId, payload: { bookingId: newId } });
        if (table === "message_record") Object.assign(added, { message_id: `<cleanup-${index}@example.org>`, queued_seq: index });
        input.effects.tables[table].rows.push(added);
      }
    }
    input.journal.mailReceipts.push({ ...structuredClone(template.journal.mailReceipts[0]),
      messageId: `<cleanup-${index}@example.org>`, calendarUid: `booking-${newId}@courtside`,
      startsAt: operation.request.startsAt, endsAt: operation.request.endsAt });
  }
  return input;
}

test("given exactly 256 proven bookings, when planning cleanup, then permit every target within the fixed bound", () => {
  // given
  const input = manyBookings(256);
  // when
  const plan = planResourceCleanup(input);
  // then
  assert.equal(plan.outcome, "passed");
  assert.equal(plan.bookingIds.length, 256);
  assert.match(plan.sql, /IF removed <> 256 THEN/);
  assert.equal(plan.expected.tables.booking.rows.length, 1);
  assert.equal(plan.expected.tables.domain_event.rows.length, 256);
  assert.equal(plan.expected.tables.message_record.rows.length, 256);
  assert.equal(verifyResourceCleanup({ ...input, actual: plan.expected }).outcome, "passed");
});

test("given 257 otherwise valid bookings, when planning cleanup, then reject the entire deletion rather than truncate targets", () => {
  // given
  const input = manyBookings(257);
  // when
  const plan = planResourceCleanup(input);
  // then
  assert.equal(plan.outcome, "incomplete");
  assert.deepEqual(plan.bookingIds, []);
  assert.equal(plan.sql, null);
});

test("given a SQL-bearing response identifier, when planning cleanup, then no identifier reaches a deletion literal", () => {
  // given
  const input = fixture();
  input.journal.operations[1].responseBookingId = `${bookingId}'; DELETE FROM person; --`;
  // when
  const plan = planResourceCleanup(input);
  // then
  assert.notEqual(plan.outcome, "passed");
  assert.equal(plan.sql, null);
  assert.deepEqual(plan.bookingIds, []);
});
