import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync, mkdirSync, symlinkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runOwnedProcess } from "./security-passive-deployment.mjs";
import test from "node:test";
import { resourceIntegritySchema, resourceIntegritySnapshotFingerprint } from "./security-resource-integrity.mjs";
import { parseResourceJournal, resourceJournalMarker } from "./security-resource-journal.mjs";
import { planResourceCleanup } from "./security-resource-cleanup.mjs";
import { runResourceAbuseAssessment, resourceAbusePolicy, resourceAbuseScriptDigest,
  resourceAbuseGatewayDigest, resourceAbusePolicyFileDigest, resourceAbuseIntegrityDigest,
  resourceAbuseReceiptParserDigest } from "./security-resource-abuse.mjs";
import { securityMailObservationSource, captureSecurityMailBaseline } from "./security-mail-observation.mjs";
import { observeResourceEffects, cleanupAndRecoverResourceRuntime, createResourceEvidence,
  writeNativeEvidence, retainResourceEvidenceFailure, resourceEvidenceSummary } from "./security-resource-runtime.mjs";

const runId = "runtime-example-0001";
const project = `courtside-security-${runId}`;
const composeArgs = ["compose", "-p", project, "-f", "/owned/compose.security.yaml"];
const manager = "10000000-0000-0000-0000-000000000001";
const person = "20000000-0000-0000-0000-000000000001";
const bookingId = "30000000-0000-0000-0000-000000000001";
const oldBooking = "30000000-0000-0000-0000-000000000002";
const card = "11111111-1111-1111-1111-111111111111";
const court = "40000000-0000-0000-0000-000000000001";
const startedAt = "2026-10-05T10:00:00.000Z";
const time = "2026-10-05T10:00:10.000Z";
const endedAt = "2026-10-05T10:01:00.000Z";
const mailId = "0123456789ABCDEFGHIJKL";
const raw = `Message-ID: <runtime@example.org>\r\nTo: Jane Doe <jane@example.org>\r\nMIME-Version: 1.0\r\nContent-Type: text/calendar; charset=utf-8\r\n\r\nBEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:booking-${bookingId}@courtside\r\nDTSTART:20261008T160000Z\r\nDTEND:20261008T170000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
const parser = fileURLToPath(new URL("./security-mail-receipt.py", import.meta.url));
const digest = value => createHash("sha256").update(value).digest("hex");
const mailIdentity = { seedFingerprint: `sha256:${"b".repeat(64)}`, instanceFingerprint: `sha256:${"c".repeat(64)}` };
const sinkId = "3".repeat(64);
const appId = "4".repeat(64);
const networkId = "5".repeat(64);
const mailImageId = `sha256:${"6".repeat(64)}`;
const sinkIp = "172.30.0.3";
const labels = service => ({ "org.courtside.environment": "SECURITY", "org.courtside.security.run-id": runId,
  "org.courtside.security.seed-fingerprint": mailIdentity.seedFingerprint,
  "org.courtside.security.instance-fingerprint": mailIdentity.instanceFingerprint,
  "com.docker.compose.project": project, ...(service ? { "com.docker.compose.service": service } : {}) });
const row = (table, values) => Object.fromEntries(resourceIntegritySchema[table].columns.map(name =>
  [name, Object.hasOwn(values, name) ? values[name] : null]));

function fixture() {
  const before = { schemaVersion: 1, tables: Object.fromEntries(Object.entries(resourceIntegritySchema)
    .map(([table, schema]) => [table, { ...structuredClone(schema), rows: [] }])) };
  before.tables.person.rows.push(row("person", { id: person, first_name: "Jane", last_name: "Doe", email: "jane@example.org" }));
  before.tables.user_account.rows.push(row("user_account", { id: manager, person_id: person,
    username: "security.manager.1", enabled: true, password_hash: "private-hash", security_epoch: 0,
    password_change_required: false }));
  before.tables.court.rows.push(row("court", { id: court, active: true }));
  before.tables.booking_card.rows.push(row("booking_card", { id: card, active: true, allowed_player_counts: [] }));
  before.tables.booking.rows.push(row("booking", { id: oldBooking, card_id: card, status: "CONFIRMED", note: "Example shared note" }));
  const request = { courtIds: [court], cardId: card, startsAt: "2026-10-08T16:00:00.000Z",
    endsAt: "2026-10-08T17:00:00.000Z", note: "Example shared note", participants: [], idempotencyKey: "runtime-example-key" };
  const frames = [{ event: "start", runId, clock: startedAt },
    { event: "begin", id: "1:1", vu: 1, sequence: 1, kind: "createBooking", startedAt, method: "POST",
      path: "/api/bookings", actorUsername: "security.manager.1", request },
    { event: "end", id: "1:1", status: 201, endedAt: time, responseBookingId: bookingId,
      identityUsername: null, ownedSessionIds: [] },
    { event: "finish", runId, started: 1, finished: 1, dropped: 0 }];
  const journal = parseResourceJournal(frames.map(frame => resourceJournalMarker + JSON.stringify(frame)).join("\n"),
    { accounts: [{ id: manager, username: "security.manager.1" }] });
  assert.equal(journal.complete, true);
  const effects = structuredClone(before);
  effects.tables.booking.rows.push(row("booking", { id: bookingId, card_id: card, booked_by: manager,
    status: "CONFIRMED", created_at: time, note: request.note, idempotency_key: request.idempotencyKey,
    request_fingerprint: journal.operations[0].request.requestFingerprint }));
  effects.tables.court_allocation.rows.push(row("court_allocation", { id: "50000000-0000-0000-0000-000000000001",
    booking_id: bookingId, court_id: court, status: "CONFIRMED", starts_at: request.startsAt, ends_at: request.endsAt }));
  effects.tables.domain_event.rows.push(row("domain_event", { id: "70000000-0000-0000-0000-000000000001",
    event_type: "booking.booking.confirmed", subject_id: bookingId, actor_account_id: manager,
    occurred_at: time, payload: { bookingId } }));
  effects.tables.message_record.rows.push(row("message_record", { id: "80000000-0000-0000-0000-000000000001",
    account_id: manager, kind: "BOOKING_CONFIRMED", state: "HANDED_OVER", message_id: "<runtime@example.org>",
    queued_at: time, queued_seq: 1, settled_at: time }));
  const sourceAddress = "172.30.0.5";
  const contract = { schemaVersion: 1, managerAccountId: manager, interval: { startedAt, endedAt },
    mailEnabled: true, publicationListeners: [], publicationLifecycle: { completionMode: "DELETE", repositoryMode: "JDBC_V2",
      listenerId: "org.courtside.notification.internal.BookingMailer.on(org.courtside.shared.BookingConfirmed)",
      eventType: "org.courtside.shared.BookingConfirmed" }, authentication: { ownedSessionPrimaryIds: [],
      loginSubjects: [{ scope: "ADDRESS", subjectHash: digest(`login:${sourceAddress}`) },
        { scope: "GLOBAL", subjectHash: digest("all") }],
      sessionPolicy: { inactivitySeconds: 900, absoluteLifetimeMilliseconds: 3600000, concurrentLimit: 5,
        cookieName: "__Host-SESSION", browserFamily: "OTHER" },
      loginPolicy: { proofMode: "http-bounded-v1", sourceAddress,
        address: { maxFailures: 3, windowMilliseconds: 60000, blockMilliseconds: 300000 },
        global: { windowMilliseconds: 60000 } } } };
  const complete = { ...structuredClone(journal), effectsSettled: true,
    mailReceipts: [{ messageId: "<runtime@example.org>", calendarUid: `booking-${bookingId}@courtside`,
      recipient: "jane@example.org", accountId: manager, startsAt: request.startsAt, endsAt: request.endsAt, acceptedAt: time }] };
  const cleanup = planResourceCleanup({ before, effects, contract, journal: complete });
  assert.equal(cleanup.outcome, "passed");
  return { before, effects, journal, contract, cleanup: cleanup.expected };
}

async function harness(input = fixture(), { snapshots = [input.effects, input.effects, input.cleanup, input.cleanup],
  mailMissing = false, cleanupFailure = false, restartFailure = false, recoveryApps } = {}) {
  const calls = [];
  let state = 0;
  let capturingBaseline = true;
  let restarted = false;
  let recoveryPoll = 0;
  const command = async (args, options = {}) => {
    calls.push({ args, options });
    if (args[0] === "image") {
      assert.deepEqual(args, ["image", "inspect", `axllent/mailpit:v1.31@${securityMailObservationSource.imageDigest}`]);
      return { stdout: JSON.stringify([{ Id: mailImageId }]) };
    }
    if (args[0] === "network") {
      assert.deepEqual(args, ["network", "inspect", networkId]);
      return { stdout: JSON.stringify([{ Id: networkId, Name: `${project}_backend`, Internal: true,
        Labels: { ...labels(), "com.docker.compose.network": "backend" }, Containers: {
          [sinkId]: { Name: `${project}-mail-1`, IPv4Address: `${sinkIp}/24` },
          [appId]: { Name: `${project}-app-1`, IPv4Address: "172.30.0.4/24" }
        } }]) };
    }
    if (args[0] === "inspect") {
      if (args[1].endsWith("-mail-1")) return { stdout: JSON.stringify([{ Id: sinkId, Image: mailImageId,
        Name: `/${project}-mail-1`, State: { Running: true }, Config: {
        Image: `axllent/mailpit:v1.31@${securityMailObservationSource.imageDigest}`,
        Env: ["MP_MAX_MESSAGES=100"], Entrypoint: ["/mailpit"], Cmd: null, Labels: labels("mail") },
        NetworkSettings: { Networks: { [`${project}_backend`]: { NetworkID: networkId, IPAddress: sinkIp,
          Aliases: ["mail", `${project}-mail-1`] } } } }]) };
      const app = { Id: appId, Name: `/${project}-app-1`, Image: `sha256:${"a".repeat(64)}`,
        Config: { Labels: labels("app") }, State: { Running: true, Status: "running", OOMKilled: false, Health: { Status: "healthy" } },
        NetworkSettings: { Networks: { [`${project}_backend`]: { NetworkID: networkId, IPAddress: "172.30.0.4" },
          [`${project}_frontend`]: { NetworkID: "7".repeat(64), IPAddress: "172.31.0.4" } } } };
      return { stdout: JSON.stringify([restarted && recoveryApps ? await recoveryApps(app, recoveryPoll++, options) : app]) };
    }
    if (args.includes("curl")) {
      if (args.at(-1).endsWith("/raw")) return { stdout: raw };
      const messages = mailMissing || capturingBaseline ? [] : [{ ID: mailId, MessageID: "runtime@example.org", Created: time, Size: Buffer.byteLength(raw) }];
      return { stdout: JSON.stringify({ total: messages.length, messages_count: messages.length, start: 0, messages }) };
    }
    if (args.includes("python3")) {
      const parsed = spawnSync("python3", [parser], { input: options.input, encoding: "utf8" });
      assert.equal(parsed.status, 0);
      return { stdout: parsed.stdout };
    }
    assert.deepEqual(args.slice(0, composeArgs.length), composeArgs);
    if (args.includes("psql")) {
      if (options.input) {
        if (cleanupFailure) throw new Error("private-hash password=example-secret");
        return { stdout: "" };
      }
      if (args.at(-1).startsWith("SELECT COALESCE(jsonb_agg")) {
        return { stdout: JSON.stringify(Object.keys(input.before.tables).sort().map(table => ({ schema: "public", table }))) };
      }
      const snapshot = snapshots[state++] ?? snapshots.at(-1);
      return { stdout: JSON.stringify(snapshot) };
    }
    if (args.includes("restart") && restartFailure) throw new Error("private recovery failure");
    if (args.includes("restart")) restarted = true;
    return { stdout: "" };
  };
  const directory = join(mkdtempSync(join(tmpdir(), "courtside-runtime-")), "attempt-1");
  const mailBaseline = await captureSecurityMailBaseline({ runId, command,
    identity: mailIdentity });
  assert.equal(mailBaseline.status, "complete");
  capturingBaseline = false;
  calls.length = 0;
  const projections = [];
  const options = { runId, attempt: 1, command, composeArgs, before: input.before, contract: input.contract,
    outerDeadlineMilliseconds: Date.now() + 900000,
    journal: input.journal, mailBaseline,
    evidenceDirectory: directory, evidenceLimitBytes: 200 * 1024 * 1024,
    now: () => endedAt,
    projectSessions: async ({ phase }) => { projections.push(phase); return { complete: true, observations: [] }; },
    settlement: { samples: 2, intervalMilliseconds: 0 }, wait: async () => {} };
  return { options, calls, directory, projections };
}

test("given actual parsed operation frames and settled native mail, when observing effects, then capture full private evidence before any cleanup", async () => {
  // given
  const input = fixture(); const h = await harness(input); const original = structuredClone(input);
  // when
  const effects = await observeResourceEffects(h.options);
  // then
  assert.equal(effects.outcome, "passed");
  assert.deepEqual(h.projections, ["after"]);
  assert.deepEqual(input, original);
  assert.ok(!h.calls.some(({ options }) => options.input?.startsWith("BEGIN;")));
  assert.deepEqual(JSON.parse(readFileSync(join(h.directory, "effects-001.json"), "utf8")), input.effects);
  assert.deepEqual(JSON.parse(readFileSync(join(h.directory, "mail-baseline.json"), "utf8")), h.options.mailBaseline);
  assert.equal(h.options.mailBaseline.runtimeBinding.appId, appId);
  const apiReads = h.calls.filter(({ args }) => args.includes("curl"));
  assert.ok(apiReads.every(({ args }) => args[1] === appId && args.includes(`mail:8025:${sinkIp}`)));
  const observed = JSON.parse(readFileSync(join(h.directory, "journal-001.json"), "utf8"));
  assert.equal(observed.effectsSettled, true);
  assert.equal(observed.mailReceipts[0].acceptedAt, time);
  assert.equal(observed.mailReceipts[0].accountId, manager);
  assert.equal(statSync(h.directory).mode & 0o777, 0o700);
  for (const name of readdirSync(h.directory)) assert.equal(statSync(join(h.directory, name)).mode & 0o777, 0o600);
  assert.equal(effects.evidence.bytes, readdirSync(h.directory).reduce((total, name) => total + statSync(join(h.directory, name)).size, 0));
  assert.doesNotMatch(JSON.stringify(effects), /private-hash|jane@example.org|Example shared note/);
});

test("given mail settlement after pressure stopped, when observing the actual effects capture, then close the interval with the host capture clock", async () => {
  // given
  const input = fixture(); input.contract.interval.endedAt = "2026-10-05T10:00:09.000Z";
  const h = await harness(input); const original = structuredClone(input.contract);
  // when
  const result = await observeResourceEffects(h.options);
  // then
  assert.equal(result.outcome, "passed");
  const observed = JSON.parse(readFileSync(join(h.directory, "contract-001.json")));
  assert.equal(observed.interval.endedAt, endedAt);
  assert.deepEqual(input.contract, original);
});

test("given whole native authentication capture, when observing an effects snapshot, then merge its attributed journal and contract with one decoder callback", async () => {
  // given
  const input = fixture(); const h = await harness(input); let calls = 0;
  const observedAuthentication = structuredClone(input.contract.authentication);
  observedAuthentication.sessionPolicy.passwordFactorRequired = true;
  observedAuthentication.loginPolicy.global.threshold = 20;
  const initialAuthentication = { ...structuredClone(observedAuthentication), ownedSessionPrimaryIds: [], loginSubjects: [] };
  delete initialAuthentication.loginPolicy.sourceAddress;
  input.contract.authentication = initialAuthentication;
  h.options.projectSessions = async ({ phase, before, snapshot, journal, contract }) => {
    calls++;
    assert.equal(phase, "after");
    assert.deepEqual(before, input.before);
    assert.deepEqual(snapshot, input.effects);
    assert.deepEqual(contract.authentication, initialAuthentication);
    assert.equal(contract.authentication.sessionPolicy.passwordFactorRequired, true);
    assert.equal(contract.authentication.loginPolicy.proofMode, "http-bounded-v1");
    assert.ok(!Object.hasOwn(contract.authentication.loginPolicy, "sourceAddress"));
    assert.deepEqual(before.tables.spring_session.rows, []);
    assert.deepEqual(snapshot.tables.spring_session.rows, []);
    return { outcome: "passed", authentication: observedAuthentication,
      journal: { ...journal, sessions: [], operations: journal.operations.map(operation => ({ ...operation, sourceAddress: "172.30.0.5" })) },
      privateProof: { decoder: "native-test-observation" }, runtimeDigest: `sha256:${"a".repeat(64)}` };
  };
  // when
  const effects = await observeResourceEffects(h.options);
  // then
  assert.equal(effects.outcome, "passed");
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(h.directory, "contract-001.json"))).authentication, observedAuthentication);
  const journal = JSON.parse(readFileSync(join(h.directory, "journal-001.json")));
  assert.equal(journal.operations[0].sourceAddress, "172.30.0.5");
  assert.ok(JSON.parse(readFileSync(join(h.directory, "sessions-001.json"))).privateProof);
});

test("given native journal and decoder binding evidence, when capturing effects, then charge and retain every input in the same private budget", async () => {
  // given
  const h = await harness();
  h.options.nativeEvidence = [{ name: "journal-native.log", value: "private original journal", bound: 1024 },
    { name: "decoder-binding-native.json", value: { candidate: "private binding" }, bound: 1024 }];
  // when
  const result = await observeResourceEffects(h.options);
  // then
  assert.equal(result.outcome, "passed");
  assert.equal(readFileSync(join(h.directory, "journal-native.log"), "utf8"), "private original journal");
  assert.equal(result.evidence.bytes, readdirSync(h.directory).reduce((sum, name) => sum + statSync(join(h.directory, name)).size, 0));
  assert.equal(result.stateBefore, result.integrity.beforeFingerprint);
  assert.equal(result.stateAfter, result.integrity.afterFingerprint);
  assert.match(result.integrityEvidenceDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.integrityEvidenceDigest, `sha256:${digest(readFileSync(join(h.directory, "effects-proof.json")))}`);
  assert.equal(result.journalDigest, `sha256:${digest(readFileSync(join(h.directory, "journal-001.json")))}`);
  const proof = JSON.parse(readFileSync(join(h.directory, "effects-proof.json")));
  assert.ok(proof.evidence.files.some(file => file.name === "journal-native.log"));
  assert.ok(proof.evidence.files.some(file => file.name === "decoder-binding-native.json"));
  assert.doesNotMatch(JSON.stringify(result), /private original journal|private binding/);
});

test("given proven effects, when cleaning and recovering, then execute only validated SQL through stdin and verify actual snapshots without seeding", async () => {
  // given
  const input = fixture(); const h = await harness(input);
  const effects = await observeResourceEffects(h.options);
  // when
  const result = await cleanupAndRecoverResourceRuntime({ effects });
  // then
  assert.equal(result.outcome, "passed");
  assert.equal(result.cleanup.outcome, "passed");
  assert.equal(result.recovery.outcome, "passed");
  assert.equal(result.integrityEvidenceDigest, `sha256:${digest(readFileSync(join(h.directory, "runtime-proof.json")))}`);
  const proof = JSON.parse(readFileSync(join(h.directory, "runtime-proof.json")));
  assert.ok(proof.evidence.files.some(file => file.name === "effects-proof.json"));
  assert.ok(proof.evidence.files.some(file => file.name === "cleanup.json"));
  assert.ok(proof.evidence.files.some(file => file.name === "recovery.json"));
  const deletion = h.calls.find(({ options }) => options.input?.startsWith("BEGIN;"));
  assert.ok(deletion);
  assert.ok(deletion.args.includes("ON_ERROR_STOP=1"));
  assert.ok(!deletion.args.includes("-c"));
  assert.match(deletion.options.input, new RegExp(`'${bookingId}'::uuid`));
  assert.doesNotMatch(deletion.options.input, new RegExp(`'${oldBooking}'::uuid`));
  assert.ok(!h.calls.some(({ args }) => args.includes("seeder")));
  assert.ok(h.calls.every(({ options }) => Number.isSafeInteger(options.timeoutMilliseconds) && options.timeoutMilliseconds <= 10000));
  const restart = h.calls.find(({ args }) => args.includes("restart"));
  assert.deepEqual(restart.args.slice(composeArgs.length), ["restart", "--no-deps", "app"]);
  assert.deepEqual(JSON.parse(readFileSync(join(h.directory, "cleanup.json"), "utf8")), input.cleanup);
  assert.deepEqual(JSON.parse(readFileSync(join(h.directory, "recovery.json"), "utf8")), input.cleanup);
});

test("given missing native mail or session projection, when observing effects, then keep proof incomplete and execute no deletion", async () => {
  // given
  for (const mode of ["mail", "sessions", "policy", "journal"]) {
    const h = await harness(fixture(), { mailMissing: mode === "mail" });
    if (mode === "sessions") delete h.options.projectSessions;
    if (mode === "policy") delete h.options.contract.authentication.sessionPolicy;
    if (mode === "journal") h.options.journal.complete = false;
    // when
    const effects = await observeResourceEffects(h.options);
    const cleanup = await cleanupAndRecoverResourceRuntime({ effects });
    // then
    assert.equal(effects.outcome, "incomplete");
    assert.equal(cleanup.outcome, "incomplete");
    assert.ok(!h.calls.some(({ options }) => options.input?.startsWith("BEGIN;")));
  }
});

test("given a synthetic mail baseline without producer identity, when observing effects, then remain incomplete and never clean the booking", async () => {
  // given
  const h = await harness();
  h.options.mailBaseline = { status: "complete", runId, messageIds: [], findings: [] };
  // when
  const effects = await observeResourceEffects(h.options);
  const cleanup = await cleanupAndRecoverResourceRuntime({ effects });
  // then
  assert.equal(effects.outcome, "incomplete");
  assert.equal(cleanup.outcome, "incomplete");
  assert.ok(!h.calls.some(({ options }) => options.input?.startsWith("BEGIN;")));
});

test("given pending mail, when a later actual snapshot settles, then retain both observations and use only the settled capture", async () => {
  // given
  const input = fixture(); const pending = structuredClone(input.effects);
  pending.tables.message_record.rows[0].state = "QUEUED";
  pending.tables.message_record.rows[0].settled_at = null;
  const h = await harness(input, { snapshots: [pending, input.effects] });
  // when
  const effects = await observeResourceEffects(h.options);
  // then
  assert.equal(effects.outcome, "passed");
  assert.equal(JSON.parse(readFileSync(join(h.directory, "effects-001.json"))).tables.message_record.rows[0].state, "QUEUED");
  assert.equal(JSON.parse(readFileSync(join(h.directory, "effects-002.json"))).tables.message_record.rows[0].state, "HANDED_OVER");
});

for (const status of ["PUBLISHED", "PROCESSING"]) {
test(`given actual JDBC V2 ${status} and queued mail despite an input settled flag, when DELETE absence precedes mail handover, then settle only after both actual effects complete`, async () => {
  // given
  const input = fixture();
  const listenerId = "org.courtside.notification.internal.BookingMailer.on(org.courtside.shared.BookingConfirmed)";
  input.contract.publicationLifecycle = { completionMode: "DELETE", repositoryMode: "JDBC_V2", listenerId,
    eventType: "org.courtside.shared.BookingConfirmed" };
  input.journal.effectsSettled = true;
  const pending = structuredClone(input.effects);
  pending.tables.message_record.rows[0].state = "QUEUED";
  pending.tables.message_record.rows[0].settled_at = null;
  pending.tables.event_publication.rows.push(row("event_publication", {
    id: "90000000-0000-0000-0000-000000000001", listener_id: listenerId,
    event_type: input.contract.publicationLifecycle.eventType, serialized_event: JSON.stringify({ bookingId }),
    publication_date: time, status, completion_attempts: 1, last_resubmission_date: time }));
  const deleted = structuredClone(pending);
  deleted.tables.event_publication.rows = [];
  const h = await harness(input, { snapshots: [pending, deleted, input.effects] });
  h.options.settlement.samples = 3;
  // when
  const result = await observeResourceEffects(h.options);
  // then
  assert.equal(result.outcome, "passed");
  for (const suffix of ["001", "002"]) {
    assert.equal(JSON.parse(readFileSync(join(h.directory, `effects-proof-${suffix}.json`))).outcome, "incomplete");
    const journal = JSON.parse(readFileSync(join(h.directory, `journal-${suffix}.json`)));
    assert.equal(journal.effectsSettled, false);
    assert.equal(journal.mailReceipts.length, 0);
    assert.equal(JSON.parse(readFileSync(join(h.directory, `mail-${suffix}.json`))).receipts.length, 1);
  }
  const settled = JSON.parse(readFileSync(join(h.directory, "journal-003.json")));
  assert.equal(settled.effectsSettled, true);
  assert.equal(settled.mailReceipts.length, 1);
  assert.equal(JSON.parse(readFileSync(join(h.directory, "effects-003.json"))).tables.event_publication.rows.length, 0);
});
}

for (const binding of ["missing", "legacy", "foreign", "extra-field"]) {
  test(`given ${binding} native publication binding and no remaining publications, when mail hands over, then missing producer proof never settles or authorizes cleanup`, async () => {
    // given
    const input = fixture();
    if (binding === "missing") delete input.contract.publicationLifecycle;
    if (binding === "legacy") input.contract.publicationLifecycle.repositoryMode = "JDBC_V1";
    if (binding === "foreign") input.contract.publicationLifecycle.eventType = "foreign.Event";
    if (binding === "extra-field") input.contract.publicationLifecycle.extra = true;
    input.journal.effectsSettled = true;
    const h = await harness(input);
    // when
    const effects = await observeResourceEffects(h.options);
    const recovery = await cleanupAndRecoverResourceRuntime({ effects });
    // then
    assert.equal(effects.outcome, "incomplete");
    assert.equal(recovery.outcome, "incomplete");
    assert.equal(JSON.parse(readFileSync(join(h.directory, "journal-001.json"))).effectsSettled, false);
    assert.ok(!h.calls.some(({ options }) => options.input?.startsWith("BEGIN;")));
  });
}

test("given native DELETE binding and handed-over mail, when a completed publication still persists, then the input settled flag cannot replace observed absence", async () => {
  // given
  const input = fixture();
  input.journal.effectsSettled = true;
  input.effects.tables.event_publication.rows.push(row("event_publication", {
    id: "90000000-0000-0000-0000-000000000001", listener_id: input.contract.publicationLifecycle.listenerId,
    event_type: input.contract.publicationLifecycle.eventType, serialized_event: JSON.stringify({ bookingId }),
    publication_date: time, status: "COMPLETED", completion_attempts: 1, last_resubmission_date: time,
    completion_date: time }));
  const h = await harness(input);
  // when
  const effects = await observeResourceEffects(h.options);
  // then
  assert.equal(effects.outcome, "failed");
  assert.equal(JSON.parse(readFileSync(join(h.directory, "journal-001.json"))).effectsSettled, false);
  assert.ok(!h.calls.some(({ options }) => options.input?.startsWith("BEGIN;")));
});

test("given a native delete-mode publication still in flight, when the next actual snapshot contains its deletion, then retain both captures and wait for settlement", async () => {
  // given
  const input = fixture(); const pending = structuredClone(input.effects);
  const listenerId = "org.courtside.notification.internal.BookingMailer.on(org.courtside.shared.BookingConfirmed)";
  input.contract.publicationLifecycle = { completionMode: "DELETE", repositoryMode: "JDBC_V2", listenerId,
    eventType: "org.courtside.shared.BookingConfirmed" };
  pending.tables.event_publication.rows.push(row("event_publication", {
    id: "90000000-0000-0000-0000-000000000001", listener_id: listenerId,
    event_type: input.contract.publicationLifecycle.eventType, serialized_event: JSON.stringify({ bookingId }),
    publication_date: time, status: "PROCESSING", completion_attempts: 1, last_resubmission_date: time }));
  const h = await harness(input, { snapshots: [pending, input.effects] });
  // when
  const result = await observeResourceEffects(h.options);
  // then
  assert.equal(result.outcome, "passed");
  assert.equal(JSON.parse(readFileSync(join(h.directory, "effects-proof-001.json"))).outcome, "incomplete");
  assert.equal(JSON.parse(readFileSync(join(h.directory, "journal-001.json"))).effectsSettled, false);
  assert.equal(JSON.parse(readFileSync(join(h.directory, "effects-001.json"))).tables.event_publication.rows.length, 1);
  assert.equal(JSON.parse(readFileSync(join(h.directory, "effects-002.json"))).tables.event_publication.rows.length, 0);
});

test("given protected credential corruption alongside a transient publication, when observing effects, then fail immediately without polling it away", async () => {
  // given
  const input = fixture(); const pending = structuredClone(input.effects);
  const listenerId = "org.courtside.notification.internal.BookingMailer.on(org.courtside.shared.BookingConfirmed)";
  input.contract.publicationLifecycle = { completionMode: "DELETE", repositoryMode: "JDBC_V2", listenerId,
    eventType: "org.courtside.shared.BookingConfirmed" };
  pending.tables.event_publication.rows.push(row("event_publication", {
    id: "90000000-0000-0000-0000-000000000001", listener_id: listenerId,
    event_type: input.contract.publicationLifecycle.eventType, serialized_event: JSON.stringify({ bookingId }),
    publication_date: time, status: "PROCESSING", completion_attempts: 1, last_resubmission_date: time }));
  pending.tables.user_account.rows[0].password_hash = "changed-private-hash";
  const h = await harness(input, { snapshots: [pending, input.effects] });
  // when
  const result = await observeResourceEffects(h.options);
  // then
  assert.equal(result.outcome, "failed");
  assert.ok(result.integrity.findings.some(finding => finding.code === "protected-field-changed"
    && finding.tableHash === `sha256:${digest(JSON.stringify("user_account"))}`));
  assert.ok(!readdirSync(h.directory).includes("effects-002.json"));
  assert.ok(!h.calls.some(({ options }) => options.input?.startsWith("BEGIN;")));
});

test("given protected corruption with incomplete observation, when comparing effects, then preserve failure and retain the attempt", async () => {
  // given
  const input = fixture(); input.effects.tables.user_account.rows[0].password_hash = "changed-private-hash";
  const h = await harness(input, { mailMissing: true });
  // when
  const effects = await observeResourceEffects(h.options);
  // then
  assert.equal(effects.outcome, "failed");
  assert.ok(readdirSync(h.directory).includes("effects-001.json"));
  assert.ok(!h.calls.some(({ options }) => options.input?.startsWith("BEGIN;")));
});

test("given a changed precleanup row, when cleanup starts, then abort before deletion instead of hiding the mutation", async () => {
  // given
  const input = fixture(); const drift = structuredClone(input.effects);
  drift.tables.person.rows[0].last_name = "Major";
  const h = await harness(input, { snapshots: [input.effects, drift] });
  const effects = await observeResourceEffects(h.options);
  // when
  const result = await cleanupAndRecoverResourceRuntime({ effects });
  // then
  assert.equal(result.outcome, "failed");
  assert.equal(result.cleanup.outcome, "failed");
  assert.ok(!h.calls.some(({ options }) => options.input?.startsWith("BEGIN;")));
  assert.ok(!h.calls.some(({ args }) => args.includes("restart")));
});

test("given actual protected drift before cleanup or during effects, when exporting assessment phases, then failure outranks missing runtime coverage without executing SQL", async () => {
  // given
  for (const phase of ["effects", "precleanup"]) {
    const input = fixture(); const drift = structuredClone(input.effects);
    drift.tables.person.rows[0].last_name = "Major";
    const h = await harness(input, { snapshots: phase === "effects" ? [drift] : [input.effects, drift] });
    const effects = await observeResourceEffects(h.options);
    const phases = await cleanupAndRecoverResourceRuntime({ effects });
    const fingerprint = effects.stateBefore;
    const execution = {
      runtimeHardened: true, requestCount: 0, generatedDataMegabytes: 0, samples: [],
      scenarios: resourceAbusePolicy.scenarios.map(({ id }) => ({ id, outcome: "incomplete" })),
      circuitBreaker: { tripped: false, reason: null, sampleSequence: null },
      safetyLimitViolation: { violated: false, reason: null, sampleSequence: null },
      stateBefore: fingerprint, stateAfter: effects.stateAfter,
      stateAfterCleanup: phases.cleanup?.actualFingerprint ?? null,
      stateAfterRecovery: phases.recovery?.actualFingerprint ?? null,
      integrity: { effects: effects.outcome, cleanup: phases.cleanup?.outcome ?? "incomplete",
        recovery: phases.recovery?.outcome ?? "incomplete" },
      recovery: { health: "incomplete", restart: "incomplete", database: "incomplete", domainIntegrity: "incomplete" },
      competingWrites: { successful: 0, rejected: 0, partialOperations: 0, duplicateBookings: 0,
        duplicateResponses: 0, duplicateFailures: 0, toctouCreated: 0, toctouSkipped: 0 },
      scannerImage: resourceAbusePolicy.image, scriptDigest: resourceAbuseScriptDigest(),
      mountedPolicyDigest: resourceAbusePolicyFileDigest(), gatewayDigest: resourceAbuseGatewayDigest(),
      integrityModuleDigest: resourceAbuseIntegrityDigest(), receiptParserDigest: resourceAbuseReceiptParserDigest(),
      journalDigest: effects.journalDigest, integrityEvidenceDigest: phases.integrityEvidenceDigest
    };
    const evidenceDirectory = mkdtempSync(join(tmpdir(), "courtside-runtime-verdict-"));
    // when
    const result = await runResourceAbuseAssessment({ profile: "destructive", environment: "SECURITY",
      selectedTests: ["CSA-RES-001"], targetFingerprint: fingerprint,
      budgets: { requests: 1, generatedDataMegabytes: 1 } }, {
      evidenceDirectory, maxRequests: 1, attempt: 1, deadline: new Date(Date.now() + 10000),
      runAbuse: async () => execution
    });
    // then
    assert.equal(result.outcome, "failed", phase);
    assert.equal(JSON.parse(readFileSync(join(evidenceDirectory, "resource-abuse.json"))).outcome, "failed");
    assert.ok(!h.calls.some(({ options }) => options.input?.startsWith("BEGIN;")));
    assert.ok(!h.calls.some(({ args }) => args.includes("restart")));
  }
});

test("given cleanup or recovery leaves changed state, when capturing the actual phase, then fail rather than substituting an expected snapshot", async () => {
  // given
  for (const phase of ["cleanup", "recovery"]) {
    const input = fixture(); const drift = structuredClone(input.cleanup);
    drift.tables.user_account.rows[0].security_epoch = 1;
    const h = await harness(input, { snapshots: [input.effects, input.effects,
      phase === "cleanup" ? drift : input.cleanup, phase === "recovery" ? drift : input.cleanup] });
    const effects = await observeResourceEffects(h.options);
    // when
    const result = await cleanupAndRecoverResourceRuntime({ effects });
    // then
    assert.equal(result.outcome, "failed");
    assert.equal(result[phase].outcome, "failed");
    assert.equal(JSON.parse(readFileSync(join(h.directory, `${phase}.json`))).tables.user_account.rows[0].security_epoch, 1);
  }
});

test("given a private evidence budget smaller than the observations, when capturing effects, then stop incomplete without cleanup and retain a bounded failure record", async () => {
  // given
  const h = await harness(); h.options.evidenceLimitBytes = 16384;
  // when
  const effects = await observeResourceEffects(h.options);
  // then
  assert.equal(effects.outcome, "incomplete");
  assert.ok(!h.calls.some(({ options }) => options.input?.startsWith("BEGIN;")));
  const bytes = readdirSync(h.directory).reduce((total, name) => total + statSync(join(h.directory, name)).size, 0);
  assert.ok(bytes <= h.options.evidenceLimitBytes);
  assert.ok(readdirSync(h.directory).includes("failure.json"));
});

for (const mode of [0o755, 0o700]) {
test(`given an existing or symbolic evidence destination with mode ${mode.toString(8)}, when starting another attempt, then retain the previous attempt without changing its permissions`, async () => {
  // given
  for (const symbolic of [false, true]) {
    const h = await harness(); const target = join(h.directory, "..", "existing");
    mkdirSync(target, { mode });
    chmodSync(target, mode);
    if (symbolic) symlinkSync(target, h.directory);
    else {
      mkdirSync(h.directory, { mode });
      chmodSync(h.directory, mode);
    }
    const destination = symbolic ? target : h.directory;
    const initialMode = statSync(destination).mode & 0o777;
    assert.equal(initialMode, mode);
    assert.equal(statSync(target).mode & 0o777, mode);
    // when
    const result = await observeResourceEffects(h.options);
    // then
    assert.equal(result.outcome, "incomplete");
    assert.equal(h.calls.length, 0);
    assert.equal(statSync(destination).mode & 0o777, initialMode);
    assert.equal(statSync(target).mode & 0o777, mode);
    assert.deepEqual(readdirSync(target), []);
    assert.deepEqual(readdirSync(h.directory), []);
  }
});
}

test("given a fabricated passing result or a reused cleanup handle, when requesting cleanup, then perform no destructive command", async () => {
  // given
  const fake = await cleanupAndRecoverResourceRuntime({ effects: { outcome: "passed" } });
  const h = await harness(); const effects = await observeResourceEffects(h.options);
  await cleanupAndRecoverResourceRuntime({ effects }); const count = h.calls.length;
  // when
  const repeated = await cleanupAndRecoverResourceRuntime({ effects });
  // then
  assert.equal(fake.outcome, "incomplete");
  assert.equal(repeated.outcome, "incomplete");
  assert.equal(h.calls.length, count);
});

test("given delayed native healthy recovery, when starting states precede healthy, then poll the same application without up and capture only after health", async () => {
  // given
  const h = await harness(fixture(), { recoveryApps: (app, poll) => {
    app.State.Health.Status = poll < 2 ? "starting" : "healthy";
    return app;
  } });
  let elapsed = 0;
  h.options.monotonicNow = () => elapsed;
  h.options.wait = async milliseconds => { elapsed += milliseconds; };
  // when
  const effects = await observeResourceEffects(h.options);
  const result = await cleanupAndRecoverResourceRuntime({ effects });
  // then
  assert.equal(result.recovery.outcome, "passed");
  assert.ok(!h.calls.some(({ args }) => args.includes("up")));
  assert.equal(elapsed, 6000);
  assert.ok(h.calls.every(({ options }) => options.timeoutMilliseconds <= 10000));
  const proof = JSON.parse(readFileSync(join(h.directory, "recovery-status.json")));
  assert.equal(proof.status, "healthy");
  assert.equal(proof.polls, 3);
});

for (const mutation of ["exited", "dead", "unhealthy", "oom", "missing-health", "missing-oom", "missing-running", "missing-status", "missing-label", "unknown-health", "not-running", "cid", "image", "foreign-label", "final-health", "final-cid", "never-healthy"]) {
  test(`given native recovery with ${mutation}, when validating health and identity, then refuse an unproven recovered phase`, async () => {
    // given
    const h = await harness(fixture(), { recoveryApps: (app, poll) => {
      if (["exited", "dead"].includes(mutation)) { app.State.Status = mutation; app.State.Running = false; }
      if (mutation === "unhealthy") app.State.Health.Status = "unhealthy";
      if (mutation === "oom") app.State.OOMKilled = true;
      if (mutation === "missing-health") delete app.State.Health;
      if (mutation === "missing-oom") delete app.State.OOMKilled;
      if (mutation === "missing-running") delete app.State.Running;
      if (mutation === "missing-status") delete app.State.Status;
      if (mutation === "missing-label") delete app.Config.Labels["org.courtside.security.run-id"];
      if (mutation === "unknown-health") app.State.Health.Status = "unknown";
      if (mutation === "not-running") app.State.Running = false;
      if (mutation === "cid") app.Id = "9".repeat(64);
      if (mutation === "image") app.Image = `sha256:${"9".repeat(64)}`;
      if (mutation === "foreign-label") app.Config.Labels["org.courtside.security.run-id"] = "foreign-run";
      if (mutation === "final-health" && poll > 0) app.State.Health.Status = "starting";
      if (mutation === "final-cid" && poll > 0) app.Id = "9".repeat(64);
      if (mutation === "never-healthy") app.State.Health.Status = "starting";
      return app;
    } });
    let elapsed = 0;
    h.options.monotonicNow = () => elapsed;
    h.options.wait = async milliseconds => { elapsed += milliseconds; };
    h.options.outerDeadlineMilliseconds = Date.now() + 7000;
    // when
    const effects = await observeResourceEffects(h.options);
    const result = await cleanupAndRecoverResourceRuntime({ effects });
    // then
    assert.equal(result.outcome, ["missing-health", "missing-oom", "missing-running", "missing-status", "missing-label", "unknown-health", "not-running", "final-health", "never-healthy"].includes(mutation) ? "incomplete" : "failed");
    assert.equal(result.cleanup.outcome, "passed");
    assert.ok(!h.calls.some(({ args }) => args.includes("up")));
    if (!["final-health", "final-cid"].includes(mutation)) assert.ok(!readdirSync(h.directory).includes("recovery.json"));
    if (mutation === "final-health") assert.equal(JSON.parse(readFileSync(join(h.directory, "recovery-status.json"))).status, "starting");
    assert.ok(elapsed <= 7000);
    assert.doesNotMatch(JSON.stringify(result), /jane@example.org|private-hash/);
  });
}

for (const label of Object.keys(labels("app"))) {
  test(`given native recovery with changed ${label}, when polling the application, then fail before capturing recovered state`, async () => {
    // given
    const h = await harness(fixture(), { recoveryApps: app => {
      app.Config.Labels[label] = "foreign-value";
      return app;
    } });
    // when
    const effects = await observeResourceEffects(h.options);
    const result = await cleanupAndRecoverResourceRuntime({ effects });
    // then
    assert.equal(result.outcome, "failed");
    assert.equal(result.recovery.code, "application-identity-changed");
    assert.ok(!readdirSync(h.directory).includes("recovery.json"));
  });
}

test("given a long outer deadline and an application that stays starting, when the configured health ceiling expires, then stop at 360 seconds without a recovered snapshot", async () => {
  // given
  const h = await harness(fixture(), { recoveryApps: app => { app.State.Health.Status = "starting"; return app; } });
  let elapsed = 0;
  h.options.monotonicNow = () => elapsed;
  h.options.wait = async milliseconds => { elapsed += milliseconds; };
  // when
  const effects = await observeResourceEffects(h.options);
  const result = await cleanupAndRecoverResourceRuntime({ effects });
  // then
  assert.equal(result.outcome, "incomplete");
  assert.equal(result.recovery.code, "health-deadline");
  assert.equal(elapsed, 360000);
  assert.ok(!readdirSync(h.directory).includes("recovery.json"));
  assert.ok(h.calls.every(({ options }) => options.timeoutMilliseconds <= 10000));
});

for (const mode of ["delayed", "never", "timeout"]) {
  test(`given a real bounded native child producing ${mode} health observations, when recovering, then retain the actual native outcome without extending deadlines`, async () => {
    // given
    const h = await harness(fixture(), { recoveryApps: async (app, poll, options) => {
      app.State.Health.Status = mode === "delayed" && poll >= 1 ? "healthy" : "starting";
      const script = mode === "timeout" ? "process.stderr.write('ExampleSecret');setInterval(()=>{},1000)"
        : `setTimeout(()=>process.stdout.write(${JSON.stringify(JSON.stringify([app]))}),5)`;
      const native = await runOwnedProcess(process.execPath, ["-e", script], {
        timeoutMilliseconds: Math.min(mode === "timeout" ? 30 : 1000, options.timeoutMilliseconds),
        stopFile: join(h.directory, "absent-stop"), outputLimitBytes: 8192
      });
      return JSON.parse(native.stdout)[0];
    } });
    h.options.wait = async milliseconds => new Promise(resolve => setTimeout(resolve, Math.min(milliseconds, 25)));
    h.options.outerDeadlineMilliseconds = Date.now() + 1000;
    // when
    const effects = await observeResourceEffects(h.options);
    const result = await cleanupAndRecoverResourceRuntime({ effects });
    // then
    assert.equal(result.outcome, mode === "delayed" ? "passed" : "incomplete");
    assert.ok(h.calls.every(({ options }) => options.timeoutMilliseconds <= 10000));
    assert.doesNotMatch(JSON.stringify(result), /ExampleSecret|Config|Labels|stdout|stderr/);
    if (mode !== "delayed") {
      const retained = readFileSync(join(h.directory, "failure.json"), "utf8");
      assert.doesNotMatch(retained, /ExampleSecret|Config|Labels|stdout|stderr/);
      assert.equal(JSON.parse(retained).recovery.step, "health");
      assert.ok(!readdirSync(h.directory).includes("recovery.json"));
    }
  });
}

test("given a missing outer deadline, when capturing effects, then refuse before native commands", async () => {
  // given
  const h = await harness(); delete h.options.outerDeadlineMilliseconds;
  // when
  const result = await observeResourceEffects(h.options);
  // then
  assert.equal(result.outcome, "incomplete");
  assert.equal(h.calls.length, 0);
});

test("given a protected recovery mutation and missing final native health, when the final identity check fails, then preserve the proven database failure", async () => {
  // given
  const input = fixture(); const changed = structuredClone(input.cleanup);
  changed.tables.user_account.rows[0].security_epoch = 1;
  const h = await harness(input, { snapshots: [input.effects, input.effects, input.cleanup, changed],
    recoveryApps: (app, poll) => { if (poll > 0) delete app.State.Health; return app; } });
  // when
  const effects = await observeResourceEffects(h.options);
  const result = await cleanupAndRecoverResourceRuntime({ effects });
  // then
  assert.equal(result.outcome, "failed");
  assert.equal(result.recovery.outcome, "failed");
  assert.equal(result.recovery.code, "cleanup-state-mismatch");
  assert.equal(result.recovery.expectedFingerprint, resourceIntegritySnapshotFingerprint(input.cleanup));
  assert.equal(result.recovery.actualFingerprint, resourceIntegritySnapshotFingerprint(changed));
  assert.ok(readdirSync(h.directory).includes("recovery-proof.json"));
  assert.deepEqual(JSON.parse(readFileSync(join(h.directory, "recovery-proof.json"))), result.recovery);
  const failure = JSON.parse(readFileSync(join(h.directory, "failure.json")));
  assert.equal(failure.recovery.step, "final-identity");
  assert.equal(failure.recovery.status, "application-state-missing");
  assert.equal(JSON.parse(readFileSync(join(h.directory, "recovery.json"))).tables.user_account.rows[0].security_epoch, 1);
});

for (const step of ["health", "snapshot"]) {
  test(`given a late native ${step} result after the outer deadline, when the command returns successfully, then refuse its result and retain incomplete recovery`, async () => {
    // given
    const h = await harness(); const original = h.options.command;
    let elapsed = 0; let restarted = false;
    h.options.outerDeadlineMilliseconds = Date.now() + 7000;
    h.options.monotonicNow = () => elapsed;
    h.options.command = async (args, options) => {
      const result = await original(args, options);
      if (args.includes("restart")) restarted = true;
      else if (restarted && (step === "health" && args[0] === "inspect"
        || step === "snapshot" && args.includes("psql") && !args.at(-1).startsWith("SELECT COALESCE"))) elapsed = 8000;
      return result;
    };
    // when
    const effects = await observeResourceEffects(h.options);
    const result = await cleanupAndRecoverResourceRuntime({ effects });
    // then
    assert.equal(result.outcome, "incomplete");
    assert.equal(result.recovery.outcome, "incomplete");
    assert.ok(!readdirSync(h.directory).includes("recovery.json"));
  });
}

test("given native command errors containing secrets, when cleanup or restart fails, then retain a sanitized incomplete proof", async () => {
  // given
  for (const mode of ["cleanup", "restart"]) {
    const h = await harness(fixture(), { cleanupFailure: mode === "cleanup", restartFailure: mode === "restart" });
    const effects = await observeResourceEffects(h.options);
    // when
    const result = await cleanupAndRecoverResourceRuntime({ effects });
    // then
    assert.equal(result.outcome, "incomplete");
    assert.doesNotMatch(JSON.stringify(result), /private-hash|example-secret|private recovery/);
    assert.doesNotMatch(readFileSync(join(h.directory, "failure.json"), "utf8"), /private-hash|example-secret|private recovery/);
  }
});

test("given a rejected whole native decoder result, when observing effects, then keep its failure dominant without exposing private diagnostics", async () => {
  // given
  const h = await harness();
  h.options.projectAuthentication = async () => ({ outcome: "failed", journal: null,
    privateProof: null, findings: ["private native decoder error"] });
  // when
  const effects = await observeResourceEffects(h.options);
  // then
  assert.equal(effects.outcome, "failed");
  assert.doesNotMatch(JSON.stringify(effects), /private native decoder error/);
  assert.ok(!h.calls.some(({ options }) => options.input?.startsWith("BEGIN;")));
});

test("given whole authentication without native binding proof, when observing effects, then refuse a passing decoder label", async () => {
  // given
  const input = fixture(); const h = await harness(input);
  h.options.projectAuthentication = async () => ({ outcome: "passed", authentication: input.contract.authentication,
    journal: { ...input.journal, sessions: [] }, privateProof: null, runtimeDigest: null });
  // when
  const effects = await observeResourceEffects(h.options);
  // then
  assert.equal(effects.outcome, "incomplete");
  assert.ok(!h.calls.some(({ options }) => options.input?.startsWith("BEGIN;")));
});

test("given an altered retained evidence file, when cleanup is requested, then refuse destructive commands and report incomplete retention", async () => {
  // given
  const h = await harness(); const effects = await observeResourceEffects(h.options);
  const { chmodSync } = await import("node:fs");
  chmodSync(join(h.directory, "effects-001.json"), 0o644);
  const count = h.calls.length;
  // when
  const result = await cleanupAndRecoverResourceRuntime({ effects });
  // then
  assert.equal(result.outcome, "incomplete");
  assert.equal(h.calls.length, count);
  assert.ok(result.findings.includes("private-evidence-retention-incomplete"));
});

test("given a native baseline before pressure, when a later command fails, then retain the baseline and raw journal immediately with a sanitized early proof", async () => {
  // given
  const h = await harness();
  const handle = createResourceEvidence({ directory: h.directory, maximumBytes: h.options.evidenceLimitBytes });
  // when
  writeNativeEvidence(handle, { name: "before-native.json", value: h.options.before, bound: 32768 });
  assert.deepEqual(JSON.parse(readFileSync(join(h.directory, "before-native.json"))), h.options.before);
  writeNativeEvidence(handle, { name: "journal-native.log", value: "private raw scanner output", bound: 1024 });
  const result = retainResourceEvidenceFailure(handle, { runId, attempt: 1, phase: "pressure", error: "private exception" });
  // then
  assert.equal(result.outcome, "incomplete");
  assert.equal(readFileSync(join(h.directory, "journal-native.log"), "utf8"), "private raw scanner output");
  assert.doesNotMatch(readFileSync(join(h.directory, "failure.json"), "utf8"), /private exception|private raw scanner output/);
  assert.equal(statSync(h.directory).mode & 0o777, 0o700);
  for (const name of readdirSync(h.directory)) assert.equal(statSync(join(h.directory, name)).mode & 0o777, 0o600);
  assert.throws(() => writeNativeEvidence(handle, { name: "k6-stderr.log", value: "late", bound: 100 }));
});

test("given a persisted native evidence handle, when observing and recovering, then adopt its single budget and include the early inputs in the phase chain", async () => {
  // given
  const h = await harness();
  const handle = createResourceEvidence({ directory: h.directory, maximumBytes: h.options.evidenceLimitBytes });
  writeNativeEvidence(handle, { name: "journal-native.log", value: "private early journal", bound: 100 });
  h.options.evidenceHandle = handle;
  // when
  const effects = await observeResourceEffects(h.options);
  const result = await cleanupAndRecoverResourceRuntime({ effects });
  // then
  assert.equal(result.outcome, "passed");
  const proof = JSON.parse(readFileSync(join(h.directory, "runtime-proof.json")));
  assert.ok(proof.evidence.files.some(file => file.name === "journal-native.log"));
  const evidence = resourceEvidenceSummary(handle);
  assert.equal(evidence.bytes, readdirSync(h.directory).reduce((total, name) => total + statSync(join(h.directory, name)).size, 0));
  assert.deepEqual(evidence, result.evidence);
  const count = h.calls.length;
  assert.equal((await observeResourceEffects(h.options)).outcome, "incomplete");
  assert.equal(h.calls.length, count);
});

test("given a shared evidence budget nearly exhausted before pressure, when storing another native input, then reject it and retain the reserved failure without resetting the budget", async () => {
  // given
  const h = await harness(); const maximumBytes = 16384;
  const handle = createResourceEvidence({ directory: h.directory, maximumBytes });
  writeNativeEvidence(handle, { name: "journal-native.log", value: "x".repeat(8000), bound: 8000 });
  // when
  assert.throws(() => writeNativeEvidence(handle, { name: "k6-stderr.log", value: "y".repeat(1000), bound: 1000 }));
  const result = retainResourceEvidenceFailure(handle, { runId, attempt: 1, phase: "pressure" });
  // then
  assert.equal(result.outcome, "incomplete");
  assert.ok(resourceEvidenceSummary(handle).bytes <= maximumBytes);
  assert.equal(readFileSync(join(h.directory, "journal-native.log"), "utf8").length, 8000);
  assert.ok(readdirSync(h.directory).includes("failure.json"));
});

test("given invalid runtime context with an owned early evidence handle, when effects cannot start, then retain an incomplete context proof without native commands", async () => {
  // given
  const h = await harness();
  h.options.evidenceHandle = createResourceEvidence({ directory: h.directory, maximumBytes: h.options.evidenceLimitBytes });
  writeNativeEvidence(h.options.evidenceHandle, { name: "before-native.json", value: h.options.before, bound: 32768 });
  h.options.composeArgs = ["untrusted"];
  // when
  const result = await observeResourceEffects(h.options);
  // then
  assert.equal(result.outcome, "incomplete");
  assert.equal(h.calls.length, 0);
  assert.ok(readdirSync(h.directory).includes("failure.json"));
  assert.ok(readdirSync(h.directory).includes("before-native.json"));
});

test("given forged handles or arbitrary native destinations, when retaining evidence, then reject them without writing an attacker selected path", async () => {
  // given
  const h = await harness();
  const handle = createResourceEvidence({ directory: h.directory, maximumBytes: h.options.evidenceLimitBytes });
  // when / then
  assert.throws(() => writeNativeEvidence({}, { name: "journal-native.log", value: "foreign", bound: 100 }));
  assert.throws(() => writeNativeEvidence(handle, { name: "../outside.log", value: "foreign", bound: 100 }));
  assert.throws(() => writeNativeEvidence(handle, { name: "cleanup.sql", value: "foreign", bound: 100 }));
  assert.equal(retainResourceEvidenceFailure({}, { runId, attempt: 1 }).outcome, "incomplete");
  assert.deepEqual(readdirSync(h.directory), []);
});

test("given an owned shared writer and a different phase budget, when attempting adoption, then fail closed without resetting or losing early evidence", async () => {
  // given
  const h = await harness();
  h.options.evidenceHandle = createResourceEvidence({ directory: h.directory, maximumBytes: h.options.evidenceLimitBytes });
  writeNativeEvidence(h.options.evidenceHandle, { name: "journal-native.log", value: "early journal", bound: 100 });
  h.options.evidenceLimitBytes--;
  // when
  const result = await observeResourceEffects(h.options);
  const repeated = retainResourceEvidenceFailure(h.options.evidenceHandle, { runId, attempt: 1, phase: "environment" });
  // then
  assert.equal(result.outcome, "incomplete");
  assert.equal(repeated.outcome, "incomplete");
  assert.equal(h.calls.length, 0);
  assert.equal(resourceEvidenceSummary(h.options.evidenceHandle).maximumBytes, 200 * 1024 * 1024);
  assert.equal(readFileSync(join(h.directory, "journal-native.log"), "utf8"), "early journal");
  assert.equal(readdirSync(h.directory).filter(name => name === "failure.json").length, 1);
});
