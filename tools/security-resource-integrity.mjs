import { createHash } from "node:crypto";

const definitions = {
  booking: "id card_id status booked_by note created_at cancelled_at cancelled_by idempotency_key request_fingerprint moved_at moved_by series_id reminded_at",
  booking_card: "id label color allowed_player_counts show_generic_occupancy counts_against_limits guest_allowed active",
  booking_card_allowed_role: "booking_card_id role",
  booking_card_managing_role: "booking_card_id role",
  booking_participant: "id booking_id kind person_id guest_name card_id position",
  booking_series: "id card_id starts_on start_time duration_minutes interval_weeks weekdays ends_on occurrence_count note created_by created_at",
  booking_series_court: "booking_series_id court_id position",
  club_config: "id club_name primary_color accent_color logo_url imprint_url default_locale slot_minutes time_zone new_account_credential_hours password_reset_credential_hours no_membership_type_rule_set_id booking_reminder_hours privacy_url logo_content logo_media_type logo_digest password_reset_token_minutes documentation_url short_name",
  court: "id number name active",
  court_allocation: "id booking_id court_id starts_at ends_at status",
  credential_issue_limit: "account_id issued_count window_started_at",
  domain_event: "id event_type subject_id actor_account_id occurred_at payload",
  event_publication: "id listener_id event_type serialized_event publication_date completion_date status completion_attempts last_resubmission_date",
  flyway_schema_history: "installed_rank version description type script checksum installed_by installed_on execution_time success",
  import_column_mapping: "source_id column_header canonical_field",
  import_external_reference: "id source_id external_id person_id linked_at",
  import_owned_field: "source_id canonical_field",
  import_preview: "id source_id mode file_name file_hash row_count change_set fingerprints removal_count removal_percent removal_warning_pct created_at created_by_account_id expires_at superseded_at",
  import_run: "id source_id preview_id mode file_hash created_count corrected_count ended_count accounts_disabled_count roles_removed_count row_error_count removals_confirmed executed_at executed_by_account_id accounts_created_count",
  import_source: "id source_key display_name separator encoding default_membership_type_id removal_warning_percent created_at",
  import_type_mapping: "source_id source_value membership_type_id",
  login_attempt_limit: "scope subject_hash attempt_count window_started_at blocked_until",
  member: "id person_id membership_type_id started_on ended_on",
  membership_type: "id name rule_set_id active grants_account",
  message_optout: "user_account_id kind created_at",
  message_record: "id account_id kind state message_id reason status_code queued_at queued_seq settled_at attempts retries next_attempt_at parameters",
  opening_hours: "id day_of_week opens_at closes_at version_id",
  opening_hours_version: "id effective_from",
  participant_card: "id label active capacity",
  password_reset_mail_limit: "account_id mailed_count window_started_at",
  password_reset_token: "account_id code_hash address_hash security_epoch created_at expires_at",
  person: "id first_name last_name email",
  rule_definition: "id rule_set_id rule_type params",
  rule_set: "id name active",
  spring_session: "primary_id session_id creation_time last_access_time max_inactive_interval expiry_time principal_name",
  spring_session_attributes: "session_primary_id attribute_name attribute_bytes",
  user_account: "id person_id username password_hash locale enabled created_at last_login_at password_change_required security_epoch version credentials_expire_at",
  user_account_role: "user_account_id role"
};

const primaryKeys = {
  booking_card_allowed_role: ["booking_card_id", "role"],
  booking_card_managing_role: ["booking_card_id", "role"],
  booking_series_court: ["booking_series_id", "court_id"],
  credential_issue_limit: ["account_id"],
  flyway_schema_history: ["installed_rank"],
  import_column_mapping: ["source_id", "column_header"],
  import_owned_field: ["source_id", "canonical_field"],
  import_type_mapping: ["source_id", "source_value"],
  login_attempt_limit: ["scope", "subject_hash"],
  message_optout: ["user_account_id", "kind"],
  password_reset_mail_limit: ["account_id"],
  password_reset_token: ["account_id"],
  spring_session: ["primary_id"],
  spring_session_attributes: ["session_primary_id", "attribute_name"],
  user_account_role: ["user_account_id", "role"]
};

export const resourceIntegritySchema = Object.freeze(Object.fromEntries(
  Object.entries(definitions).map(([table, columns]) => [table, Object.freeze({
    columns: Object.freeze(columns.split(" ").sort()),
    primaryKey: Object.freeze(primaryKeys[table] ?? ["id"])
  })])));

export const resourceIntegrityLimits = Object.freeze({
  bytes: 32 * 1024 * 1024, rows: 100000, operations: 10000, findings: 1000, depth: 32,
  nodes: 1000000, bookings: 256, ownedSessions: 512, loginSubjects: 8
});

const admissionProblemTypes = ["urn:courtside:error:request-rate-limited",
  "urn:courtside:error:operation-capacity-exhausted"];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const confirmedType = "booking.booking.confirmed";
const publicationType = "org.courtside.shared.BookingConfirmed";

function canonical(value, budget = { bytes: 0 }, depth = 0) {
  if (depth > resourceIntegrityLimits.depth) throw new Error("input-depth-exceeded");
  budget.nodes = (budget.nodes ?? 0) + 1;
  if (budget.nodes > resourceIntegrityLimits.nodes) throw new Error("input-size-exceeded");
  let result;
  if (value === null || typeof value === "boolean") result = JSON.stringify(value);
  else if (typeof value === "number" && Number.isFinite(value)) result = JSON.stringify(value);
  else if (typeof value === "string") result = JSON.stringify(value);
  else if (Array.isArray(value)) result = `[${value.map((item) => canonical(item, budget, depth + 1)).join(",")}]`;
  else if (value && Object.getPrototypeOf(value) === Object.prototype) {
    result = `{${Object.keys(value).sort().map((key) =>
      `${canonical(key, budget, depth + 1)}:${canonical(value[key], budget, depth + 1)}`).join(",")}}`;
  } else throw new Error("input-shape-invalid");
  if (value === null || typeof value !== "object") budget.bytes += Buffer.byteLength(result);
  if (budget.bytes > resourceIntegrityLimits.bytes) throw new Error("input-size-exceeded");
  if (depth === 0 && Buffer.byteLength(result) > resourceIntegrityLimits.bytes) throw new Error("input-size-exceeded");
  return result;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function equal(left, right) {
  return canonical(left) === canonical(right);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function within(value, interval) {
  const at = instantNanoseconds(value);
  const start = instantNanoseconds(interval.startedAt);
  const end = instantNanoseconds(interval.endedAt);
  return at !== null && start !== null && end !== null && at >= start && at <= end;
}

function orderedInstants(start, end) {
  const a = instantNanoseconds(start);
  const b = instantNanoseconds(end);
  return a !== null && b !== null && a <= b;
}

function sameInstant(left, right) {
  const a = instantNanoseconds(left);
  return a !== null && a === instantNanoseconds(right);
}

function plusMilliseconds(value, milliseconds) {
  const nanos = instantNanoseconds(value) + BigInt(milliseconds) * 1000000n;
  const seconds = nanos / 1000000000n;
  const fraction = (nanos % 1000000000n).toString().padStart(9, "0");
  return `${new Date(Number(seconds * 1000n)).toISOString().slice(0, 19)}.${fraction}Z`;
}

function instantParts(value) {
  const parts = typeof value === "string"
    ? /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value) : null;
  if (!parts) throw new Error("instant-unsupported");
  const milliseconds = Date.parse(`${parts[1]}${parts[3]}`);
  if (!Number.isFinite(milliseconds)) throw new Error("instant-unsupported");
  return { milliseconds, nanos: (parts[2] ?? "").padEnd(9, "0") };
}

function instantNanoseconds(value) {
  try {
    const { milliseconds, nanos } = instantParts(value);
    return BigInt(milliseconds) * 1000000n + BigInt(nanos);
  } catch {
    return null;
  }
}

function javaInstant(value) {
  const { milliseconds, nanos } = instantParts(value);
  const base = new Date(milliseconds).toISOString().replace(/\.000Z$/, "");
  const fraction = nanos === "000000000" ? ""
    : `.${nanos.endsWith("000000") ? nanos.slice(0, 3) : nanos.endsWith("000") ? nanos.slice(0, 6) : nanos}`;
  return `${base}${fraction}Z`;
}

function compareJavaUuids(left, right) {
  const leftHex = left.replaceAll("-", "");
  const rightHex = right.replaceAll("-", "");
  for (const offset of [0, 16]) {
    const a = BigInt.asIntN(64, BigInt(`0x${leftHex.slice(offset, offset + 16)}`));
    const b = BigInt.asIntN(64, BigInt(`0x${rightHex.slice(offset, offset + 16)}`));
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

function normalizedParticipant(participant) {
  if (!record(participant) || !equal(Object.keys(participant).sort(), ["cardId", "guestName", "kind", "personId"])) return false;
  if (participant.kind === "GUEST") return participant.personId === null && participant.cardId === null
    && typeof participant.guestName === "string" && participant.guestName.trim().length > 0;
  if (participant.kind === "MEMBER") return uuid.test(participant.personId)
    && participant.guestName === null && participant.cardId === null;
  return participant.kind === "CARD" && uuid.test(participant.cardId)
    && participant.personId === null && participant.guestName === null;
}

export function resourceBookingRequestFingerprint(request) {
  canonical(request);
  if (!record(request) || !Array.isArray(request.courtIds) || !request.courtIds.length
      || request.courtIds.some((id) => !uuid.test(id)) || !uuid.test(request.cardId)
      || !(request.note === null || typeof request.note === "string")
      || !Array.isArray(request.participants) || !request.participants.every(normalizedParticipant)) {
    throw new Error("booking-request-shape-invalid");
  }
  const payload = {
    courtIds: [...request.courtIds].sort(compareJavaUuids), cardId: request.cardId,
    startsAt: javaInstant(request.startsAt), endsAt: javaInstant(request.endsAt), note: request.note,
    participants: request.participants.map(({ kind, personId, guestName, cardId }) =>
      ({ kind, personId, guestName, cardId }))
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function resourceSessionAttributeDigest(bytes) {
  if (typeof bytes !== "string" || !/^\\x(?:[a-f0-9]{2}){1,65536}$/.test(bytes)) {
    throw new Error("session-attribute-encoding-unsupported");
  }
  return `sha256:${createHash("sha256").update(Buffer.from(bytes.slice(2), "hex")).digest("hex")}`;
}

function keyOf(table, row) {
  return canonical(resourceIntegritySchema[table].primaryKey.map((column) => row[column]));
}

function httpLoginPermissions({ policy, validPolicy, contract, journal, operations, subjects,
  oldRows, currentRows, finding, permit, deletions }) {
  const incomplete = () => finding("http-login-proof-incomplete", "incomplete");
  const failed = (row) => finding("http-login-bucket-mismatch", "failed", "login_attempt_limit", row);
  if (!validPolicy || !journal.complete || !journal.effectsSettled) { incomplete(); return; }
  const logins = operations.filter((operation) => operation.kind === "login");
  if (logins.length > resourceIntegrityLimits.operations || journal.loginTransitions !== undefined || journal.loginTransitionsComplete !== undefined) {
    incomplete(); return;
  }
  const begin = instantNanoseconds(contract.interval.startedAt);
  const end = instantNanoseconds(contract.interval.endedAt);
  const duration = (milliseconds) => BigInt(milliseconds) * 1000000n;
  const before = new Map(subjects.map((subject) => [subject.scope, oldRows("login_attempt_limit")
    .find((row) => row.scope === subject.scope && row.subject_hash === subject.subjectHash)]));
  const after = new Map(subjects.map((subject) => [subject.scope, currentRows("login_attempt_limit")
    .find((row) => row.scope === subject.scope && row.subject_hash === subject.subjectHash)]));
  if (!Number.isSafeInteger(policy.verificationConcurrency) || policy.verificationConcurrency < 1) { incomplete(); return; }
  const counted = [];
  const blocked = [];
  const refused = [];
  for (const operation of logins) {
    if (operation.sourceAddress !== policy.sourceAddress) { finding("login-source-mismatch", "failed"); return; }
    if (operation.status === 200 || operation.status === 401) counted.push(operation);
    else if (operation.status === 429) {
      if (operation.problemType !== "urn:courtside:error:login-rate-limited"
          || !Number.isSafeInteger(operation.retryAfterSeconds) || operation.retryAfterSeconds < 1) {
        incomplete(); return;
      }
      // Retry-After one may also be a full verification capacity, which records no attempt.
      (operation.retryAfterSeconds > 1 ? blocked : refused).push(operation);
    } else { incomplete(); return; }
  }
  const successes = counted.filter((operation) => operation.status === 200);
  const failures = counted.filter((operation) => operation.status !== 200);
  if (failures.length > 128 || successes.length > resourceIntegrityLimits.ownedSessions) { incomplete(); return; }
  const nonSuccesses = [...failures, ...blocked];
  const starts = (operation) => instantNanoseconds(operation.startedAt);
  const ends = (operation) => instantNanoseconds(operation.endedAt);
  const max = (values) => values.reduce((a, b) => a > b ? a : b);
  const min = (values) => values.reduce((a, b) => a < b ? a : b);
  const loginBegin = logins.length ? min(logins.map(starts)) : null;
  const loginEnd = logins.length ? max(logins.map(ends)) : null;
  const priorAddress = before.get("ADDRESS");
  const priorBlock = priorAddress?.blocked_until == null ? null : instantNanoseconds(priorAddress.blocked_until);
  if (priorAddress?.blocked_until != null && priorBlock === null) { incomplete(); return; }
  if (priorBlock !== null && loginBegin !== null && priorBlock > loginBegin) {
    if (priorBlock <= loginEnd) {
      incomplete(); return;
    }
    if (counted.length) { failed(after.get("ADDRESS") ?? priorAddress); return; }
  }
  const actualAddress = after.get("ADDRESS");
  const deadline = actualAddress?.blocked_until == null ? null : instantNanoseconds(actualAddress.blocked_until);
  if (actualAddress?.blocked_until != null && deadline === null) { failed(actualAddress); return; }
  if (deadline !== null && nonSuccesses.length) {
    const pressureEnd = max(nonSuccesses.map(ends));
    if (pressureEnd >= deadline) {
      incomplete(); return;
    }
  }
  const origin = (scope, count, cleared = false) => {
    const prior = cleared ? undefined : before.get(scope);
    const actual = after.get(scope);
    if (!count) {
      if (!equal(prior ?? null, actual ?? null)) failed(actual ?? prior);
      return { unchanged: true };
    }
    const window = scope === "ADDRESS" ? policy.address.windowMilliseconds : policy.global.windowMilliseconds;
    const scopeOperations = scope === "ADDRESS" ? failures : counted;
    const windowBegin = min(scopeOperations.map(starts));
    const windowEnd = max(scopeOperations.map(ends));
    if (windowEnd - windowBegin >= duration(window)) { incomplete(); return null; }
    let reset = !prior;
    if (prior) {
      const priorAt = instantNanoseconds(prior.window_started_at);
      if (priorAt === null || !Number.isSafeInteger(prior.attempt_count) || prior.attempt_count < 1) { incomplete(); return null; }
      const expires = priorAt + duration(window);
      if (expires <= windowBegin) reset = true;
      else if (expires <= windowEnd) { incomplete(); return null; }
    }
    const expectedCount = count + (reset ? 0 : prior.attempt_count);
    if (!actual || actual.attempt_count !== expectedCount || !Number.isSafeInteger(actual.attempt_count)
        || scope === "GLOBAL" && actual.blocked_until !== null) { failed(actual ?? prior); return null; }
    const at = instantNanoseconds(actual.window_started_at);
    if (at === null || !reset && !sameInstant(actual.window_started_at, prior.window_started_at)
        || reset && (at < begin || at > end)) { failed(actual); return null; }
    if (at + duration(window) <= windowEnd) { incomplete(); return null; }
    return { reset, at, expectedCount };
  };
  const global = origin("GLOBAL", counted.length);
  if (!global) return;
  if (successes.length && nonSuccesses.length && max(successes.map(ends)) > min(nonSuccesses.map(starts))) {
    incomplete(); return;
  }
  if (global.reset && (global.at > min(counted.map(ends))
      || !counted.some((operation) => within(after.get("GLOBAL").window_started_at, operation)))) {
    failed(after.get("GLOBAL")); return;
  }
  if (successes.length && global.reset && !successes.some((operation) => within(after.get("GLOBAL").window_started_at, operation))) {
    failed(after.get("GLOBAL")); return;
  }
  let address;
  if (successes.length && !failures.length) {
    if (after.get("ADDRESS")) { failed(after.get("ADDRESS")); return; }
    address = { cleared: true };
  } else {
    address = origin("ADDRESS", failures.length, successes.length > 0);
    if (!address) return;
  }
  let trigger = null;
  if (failures.length) {
    if (address.expectedCount > policy.address.maxFailures) { failed(actualAddress); return; }
    const reachesLimit = address.expectedCount === policy.address.maxFailures;
    if (reachesLimit !== (deadline !== null)) { failed(actualAddress); return; }
    if (deadline !== null) trigger = deadline - duration(policy.address.blockMilliseconds);
    const sorted = [...failures].sort((a, b) => ends(a) < ends(b) ? -1 : ends(a) > ends(b) ? 1 : a.id.localeCompare(b.id));
    let witness = false;
    for (const first of sorted) {
      const firstAt = address.reset ? address.at : !successes.length && global.reset ? global.at : starts(first);
      const firstGlobal = !successes.length && global.reset ? global.at : firstAt;
      if (firstAt < starts(first) || firstAt > ends(first) || firstGlobal < firstAt || firstGlobal > ends(first)) continue;
      const candidates = trigger === null ? [null] : sorted.filter((operation) => trigger >= starts(operation) && trigger <= ends(operation));
      for (const last of candidates) {
        if (sorted.length > 1 && last === first || sorted.length === 1 && last && (last !== first || trigger !== firstAt)) continue;
        let at = firstGlobal;
        let legal = true;
        for (const operation of sorted.filter((entry) => entry !== first && entry !== last)) {
          at = at > starts(operation) ? at : starts(operation);
          if (at > ends(operation) || trigger !== null && at > trigger) { legal = false; break; }
        }
        if (legal && (trigger === null || at <= trigger || sorted.length === 1)) { witness = true; break; }
      }
      if (witness) break;
    }
    if (!witness) { failed(actualAddress); return; }
  }
  for (const operation of refused) {
    const blockTail = deadline !== null && ends(operation) >= deadline - 1000000000n && starts(operation) < deadline;
    const verifying = counted.filter((other) => starts(other) <= ends(operation) && ends(other) >= starts(operation));
    if (!blockTail && verifying.length < policy.verificationConcurrency) { failed(actualAddress); return; }
  }
  for (const operation of blocked) {
    if (deadline === null) { failed(actualAddress); return; }
    const lower = deadline - BigInt(operation.retryAfterSeconds) * 1000000000n;
    const upper = deadline - BigInt(operation.retryAfterSeconds - 1) * 1000000000n;
    let earliest = starts(operation) > lower ? starts(operation) : lower;
    if (trigger !== null && earliest < trigger) earliest = trigger;
    if (global.reset && earliest < global.at) earliest = global.at;
    if (earliest > ends(operation) || earliest >= upper || earliest >= deadline) { failed(actualAddress); return; }
  }
  for (const subject of subjects) {
    const actual = after.get(subject.scope);
    const prior = before.get(subject.scope);
    if (actual) permit("login_attempt_limit", actual, ["attempt_count", "window_started_at", "blocked_until"]);
    else if (prior && subject.scope === "ADDRESS" && successes.length) {
      deletions.add(canonical(["login_attempt_limit", keyOf("login_attempt_limit", prior)]));
    }
  }
}

function validateEmptySeries(operation, { operations, creations, manager, oldRows, finding }) {
  const incomplete = () => finding("empty-series-proof-incomplete", "incomplete");
  const failed = () => finding("empty-series-proof-mismatch", "failed");
  if (operation.actorAccountId !== manager.id) { failed(); return; }
  if (operation.status !== 200) { incomplete(); return; }
  const request = operation.request;
  const result = operation.result;
  const keys = ["cardId", "confirmedStarts", "courtIds", "durationMinutes", "endsOn", "intervalWeeks",
    "note", "occurrenceCount", "startTime", "startsOn", "weekdays"];
  if (!record(request) || !equal(Object.keys(request).sort(), keys)
      || !uuid.test(request.cardId) || !Array.isArray(request.courtIds) || request.courtIds.length !== 1
      || !uuid.test(request.courtIds[0]) || request.durationMinutes !== 60 || request.intervalWeeks !== 1
      || request.occurrenceCount !== 1 || request.endsOn !== null || typeof request.note !== "string"
      || !Array.isArray(request.weekdays) || request.weekdays.length !== 1
      || !Array.isArray(request.confirmedStarts) || request.confirmedStarts.length !== 1
      || instantNanoseconds(request.confirmedStarts[0]) === null
      || !record(result) || !equal(Object.keys(result).sort(), ["bookingIds", "seriesId", "skipped"])) {
    incomplete(); return;
  }
  const start = request.confirmedStarts[0];
  if (result.seriesId !== null || !equal(result.bookingIds, []) || !Array.isArray(result.skipped)
      || result.skipped.length !== 1 || !sameInstant(result.skipped[0], start)) { failed(); return; }
  const preview = operations.find((entry) => entry.id === operation.previewOperationId);
  const winner = operations.find((entry) => entry.id === operation.winnerOperationId);
  if (!preview || !winner) { incomplete(); return; }
  const previewRequest = { ...request };
  delete previewRequest.confirmedStarts;
  const occurrences = preview.result?.occurrences;
  const occurrence = occurrences?.[0];
  if (!record(preview.request) || !record(preview.result) || !Array.isArray(occurrences)
      || !record(occurrence) || !["startsAt", "endsAt", "creatable", "blockedCourtIds", "violations"]
        .every((field) => Object.hasOwn(occurrence, field))) { incomplete(); return; }
  const booking = winner.request;
  if (preview.kind !== "previewSeries" || preview.status !== 200 || preview.actorAccountId !== manager.id
      || !record(preview.request) || !equal(preview.request, previewRequest)
      || !Array.isArray(occurrences) || occurrences.length !== 1 || occurrence?.creatable !== true
      || !sameInstant(occurrence.startsAt, start) || !equal(occurrence.blockedCourtIds, [])
      || !equal(occurrence.violations, []) || winner.kind !== "createBooking" || winner.status !== 201
      || winner.actorAccountId !== manager.id || creations.get(winner.responseBookingId)?.responseBookingId !== winner.responseBookingId
      || !record(booking) || booking.cardId !== request.cardId || !equal(booking.courtIds, request.courtIds)
      || !sameInstant(booking.startsAt, start) || !sameInstant(booking.endsAt, occurrence.endsAt)
      || instantNanoseconds(booking.endsAt) - instantNanoseconds(start) !== 3600000000000n
      || !orderedInstants(preview.endedAt, winner.startedAt) || !orderedInstants(winner.endedAt, operation.startedAt)) {
    failed(); return;
  }
  const card = oldRows("booking_card").find((row) => row.id === request.cardId);
  if (!card || !equal(card.allowed_player_counts, [])) { failed(); return; }
  const config = oldRows("club_config");
  if (config.length !== 1 || typeof config[0].time_zone !== "string") { incomplete(); return; }
  let parts;
  try {
    parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: config[0].time_zone,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
      weekday: "long", hourCycle: "h23" }).formatToParts(new Date(start)).map(({ type, value }) => [type, value]));
  } catch { incomplete(); return; }
  if (instantNanoseconds(start) % 1000000000n !== 0n
      || request.startsOn !== `${parts.year}-${parts.month}-${parts.day}`
      || request.startTime !== `${parts.hour}:${parts.minute}:${parts.second}`
      || request.weekdays[0] !== parts.weekday.toUpperCase()) failed();
}

function validateGatewayBodyRejections(journal, operations, report) {
  const requests = operations.filter((operation) => operation.kind === "gatewayRejectedBody");
  if (!requests.length && journal.gatewayBodyRejections === undefined && journal.gatewayBodyRejectionsComplete === undefined) return;
  if (!Array.isArray(journal.gatewayBodyRejections) || journal.gatewayBodyRejectionsComplete !== true) {
    report("gateway-native-coverage-incomplete", "incomplete");
    return;
  }
  if (journal.gatewayBodyRejections.length > 16) { report("gateway-native-coverage-incomplete", "incomplete"); return; }
  const receipts = new Set();
  for (const receipt of journal.gatewayBodyRejections) {
    if (!record(receipt) || !equal(Object.keys(receipt).sort(), ["bodyBytes", "contentType", "forwarded", "maximumBodyBytes",
      "method", "observedAt", "operationId", "path", "status"])
        || typeof receipt.operationId !== "string" || !receipt.operationId
        || instantNanoseconds(receipt.observedAt) === null) {
      report("gateway-native-receipt-incomplete", "incomplete");
      continue;
    }
    if (receipts.has(receipt.operationId)) report("gateway-native-receipt-duplicate", "failed");
    receipts.add(receipt.operationId);
    const operation = requests.find((entry) => entry.id === receipt.operationId);
    if (!operation) { report("gateway-native-attribution-incomplete", "incomplete"); continue; }
    if (receipt.method !== "POST" || receipt.path !== "/api/session" || receipt.status !== 413
        || receipt.bodyBytes !== 2000001 || receipt.contentType !== "application/x-www-form-urlencoded"
        || receipt.maximumBodyBytes !== 2000000 || receipt.forwarded !== false) {
      report("gateway-native-receipt-mismatch", "failed");
    }
    if (!within(receipt.observedAt, operation)) report("gateway-native-time-incomplete", "incomplete");
  }
  for (const operation of requests) {
    if (!receipts.has(operation.id)) report("gateway-native-attribution-incomplete", "incomplete");
  }
}

function authenticationPermissions({ contract, journal, manager, operations, oldRows, currentRows, finding, allow }) {
  const changes = new Map();
  const deletions = new Set();
  const permit = (table, row, fields) => {
    allow(table, row);
    changes.set(canonical([table, keyOf(table, row)]), new Set(fields));
  };
  const auth = contract.authentication;
  const policy = auth.sessionPolicy;
  if (!policy && journal.sessions !== undefined) finding("session-policy-incomplete", "incomplete");
  if (!auth.loginPolicy && (journal.loginTransitions !== undefined || journal.loginTransitionsComplete !== undefined)) {
    finding("login-policy-incomplete", "incomplete");
  }
  if (policy) {
    const validPolicy = Number.isSafeInteger(policy.inactivitySeconds) && policy.inactivitySeconds >= 60
      && Number.isSafeInteger(policy.absoluteLifetimeMilliseconds) && policy.absoluteLifetimeMilliseconds >= 60000
      && policy.absoluteLifetimeMilliseconds <= 2592000000 && Number.isInteger(policy.concurrentLimit)
      && policy.concurrentLimit >= 1 && policy.concurrentLimit <= 50
      && ["SESSION", "__Host-SESSION"].includes(policy.cookieName) && typeof policy.browserFamily === "string"
      && (policy.passwordFactorRequired === undefined || typeof policy.passwordFactorRequired === "boolean");
    if (!validPolicy) finding("session-policy-incomplete", "incomplete");
    else {
      const observations = Array.isArray(journal.sessions) ? journal.sessions : [];
      if (observations.length > resourceIntegrityLimits.ownedSessions * 2) throw new Error("journal-entry-limit-exceeded");
      for (const observation of observations) {
        if (!record(observation) || !["before", "after"].includes(observation.phase)
            || !auth.ownedSessionPrimaryIds.includes(observation.primaryId)
            || !(observation.phase === "before" ? oldRows : currentRows)("spring_session")
              .some((row) => row.primary_id === observation.primaryId)) {
          finding("session-observation-unsupported", "incomplete");
        }
      }
      const activeSessions = currentRows("spring_session").filter((row) => row.principal_name === manager.username
        && Number.isSafeInteger(row.expiry_time) && row.expiry_time > Date.parse(contract.interval.endedAt));
      if (activeSessions.length > policy.concurrentLimit) finding("session-concurrency-exceeded", "failed");
      const roles = oldRows("user_account_role").filter((row) => row.user_account_id === manager.id)
        .map((row) => `ROLE_${row.role}`).sort();
      if (manager.password_change_required) roles.push("PASSWORD_CHANGE_REQUIRED");
      roles.sort();
      const expectedContext = {
        contextClass: "org.springframework.security.core.context.SecurityContextImpl",
        authenticationClass: "org.springframework.security.authentication.UsernamePasswordAuthenticationToken",
        principalClass: "org.courtside.identity.internal.CourtsideUserDetails", authenticated: true,
        accountId: manager.id, username: manager.username, securityEpoch: manager.security_epoch,
        authorities: roles, principalAuthorities: roles, passwordFactorIssuedAt: null,
        credentials: null, details: null, principalPassword: null, enabled: true,
        accountNonExpired: true, accountNonLocked: true, credentialsNonExpired: true
      };
      const names = ["SPRING_SECURITY_CONTEXT", "courtside.authenticated-at", "courtside.browser-family"].sort();
      const decode = (phase, session, rows) => {
        const matches = observations.filter((entry) => entry?.phase === phase && entry.primaryId === session.primary_id);
        if (matches.length !== 1 || !Array.isArray(matches[0]?.attributes)) {
          finding("session-observation-incomplete", "incomplete", "spring_session", session);
          return null;
        }
        const observation = matches[0];
        if (!equal(observation.attributes.map((entry) => entry?.name).sort(), names)) {
          finding("session-projection-schema-incomplete", "incomplete", "spring_session", session);
          return null;
        }
        const attributes = rows.filter((row) => row.session_primary_id === session.primary_id);
        if (!equal(attributes.map((row) => row.attribute_name).sort(), names)) {
          finding("session-attribute-schema-mismatch", "failed", "spring_session", session);
          return null;
        }
        if (observation.sessionId !== session.session_id || observation.cookieName !== policy.cookieName
            || observation.cookieValue !== Buffer.from(session.session_id).toString("base64")) {
          finding("session-cookie-mismatch", "failed", "spring_session", session);
          return null;
        }
        const values = new Map();
        for (const attribute of attributes) {
          const projections = observation.attributes.filter((entry) => entry?.name === attribute.attribute_name);
          if (projections.length !== 1 || projections[0].decoder !== "spring-jdbc-java-serialization-v1"
              || !record(projections[0].value)) {
            finding("session-decoder-incomplete", "incomplete", "spring_session_attributes", attribute);
            return null;
          }
          const projection = projections[0];
          let digest;
          try { digest = resourceSessionAttributeDigest(attribute.attribute_bytes); }
          catch { finding("session-byte-encoding-incomplete", "incomplete", "spring_session_attributes", attribute); return null; }
          if (digest !== projection.bytesDigest) {
            finding("session-byte-binding-mismatch", "failed", "spring_session_attributes", attribute);
            return null;
          }
          values.set(attribute.attribute_name, projection.value);
        }
        const authenticatedAt = values.get("courtside.authenticated-at");
        const context = values.get("SPRING_SECURITY_CONTEXT");
        if (!Object.hasOwn(context, "principalAuthorities") || !Object.hasOwn(context, "passwordFactorIssuedAt")) {
          finding("session-factor-projection-incomplete", "incomplete", "spring_session", session);
          return null;
        }
        const factor = context.passwordFactorIssuedAt;
        const factorAt = factor === null ? null : instantNanoseconds(factor);
        const factorAuthorities = factor === null ? roles : [...roles, "FACTOR_PASSWORD"].sort();
        if (!equal({ ...context, details: null, passwordFactorIssuedAt: null }, { ...expectedContext, authorities: factorAuthorities })
            || !equal(values.get("courtside.browser-family"), { className: "java.lang.String", value: policy.browserFamily })
            || !equal(Object.keys(authenticatedAt).sort(), ["className", "value"])
            || authenticatedAt.className !== "java.lang.Long" || !Number.isSafeInteger(authenticatedAt.value)
            || authenticatedAt.value < session.creation_time || authenticatedAt.value > session.last_access_time) {
          finding("session-authentication-mismatch", "failed", "spring_session", session);
          return null;
        }
        if (policy.passwordFactorRequired && factor === null || factor !== null && (factorAt === null
            || typeof factor !== "string" || !factor.endsWith("Z")
            || factorAt > BigInt(authenticatedAt.value) * 1000000n + 999999n)) {
          finding("session-password-factor-mismatch", "failed", "spring_session", session);
          return null;
        }
        if (context.details !== null && (!record(context.details)
            || !equal(Object.keys(context.details).sort(), ["className", "remoteAddress", "sessionId"])
            || context.details.className !== "org.springframework.security.web.authentication.WebAuthenticationDetails"
            || typeof context.details.remoteAddress !== "string"
            || !(context.details.sessionId === null || typeof context.details.sessionId === "string"
              && /^[A-Za-z0-9_-]{36}$/.test(context.details.sessionId)))) {
          finding("session-web-details-unsupported", "incomplete", "spring_session", session);
          return null;
        }
        return { observation, values, attributes };
      };
      for (const session of currentRows("spring_session")) {
        if (!auth.ownedSessionPrimaryIds.includes(session.primary_id)) continue;
        const baseline = oldRows("spring_session").find((row) => row.primary_id === session.primary_id);
        const numeric = [session.creation_time, session.last_access_time, session.expiry_time, session.max_inactive_interval];
        if (!uuid.test(session.primary_id) || !/^[A-Za-z0-9_-]{36}$/.test(session.session_id)
            || session.principal_name !== manager.username || !numeric.every(Number.isSafeInteger)
            || session.max_inactive_interval !== policy.inactivitySeconds
            || session.expiry_time !== session.last_access_time + policy.inactivitySeconds * 1000
            || session.last_access_time < session.creation_time
            || session.last_access_time >= session.creation_time + policy.absoluteLifetimeMilliseconds) {
          finding("session-metadata-mismatch", "failed", "spring_session", session);
          continue;
        }
        if (baseline && ["primary_id", "session_id", "creation_time", "max_inactive_interval", "principal_name"]
          .some((field) => !equal(baseline[field], session[field]))) {
          finding("session-protected-field-changed", "failed", "spring_session", session);
          continue;
        }
        const decoded = decode("after", session, currentRows("spring_session_attributes"));
        if (!decoded) continue;
        if (!Array.isArray(decoded.observation.operationIds)) {
          finding("session-request-incomplete", "incomplete", "spring_session", session); continue;
        }
        const observedOperations = operations.filter((operation) => decoded.observation.operationIds.includes(operation.id));
        const accessOperations = observedOperations.filter((operation) => within(new Date(session.last_access_time).toISOString(), operation)
          && (operation.sessionId === session.session_id || operation.kind === "login" && operation.status === 200
            && operation.accountId === manager.id && operation.responseSessionId === session.session_id));
        const originalLogins = observedOperations.filter((operation) => operation.kind === "login" && operation.status === 200
          && operation.accountId === manager.id && operation.responseSessionId === session.session_id
          && within(new Date(session.creation_time).toISOString(), operation)
          && within(new Date(decoded.values.get("courtside.authenticated-at").value).toISOString(), operation)
          && (decoded.values.get("SPRING_SECURITY_CONTEXT").passwordFactorIssuedAt === null
            || within(decoded.values.get("SPRING_SECURITY_CONTEXT").passwordFactorIssuedAt, operation)));
        if (!accessOperations.length) {
          finding("session-request-incomplete", "incomplete", "spring_session", session); continue;
        }
        if (baseline) {
          const prior = decode("before", baseline, oldRows("spring_session_attributes"));
          if (!prior) continue;
          if (!equal([...prior.values], [...decoded.values]) || session.last_access_time < baseline.last_access_time) {
            finding("session-protected-attribute-changed", "failed", "spring_session", session); continue;
          }
        } else if (!originalLogins.length) {
          finding("session-login-incomplete", "incomplete", "spring_session", session); continue;
        }
        if (!baseline && decoded.values.get("SPRING_SECURITY_CONTEXT").details !== null) {
          const details = decoded.values.get("SPRING_SECURITY_CONTEXT").details;
          const completeLogins = originalLogins.filter((operation) => typeof operation.sourceAddress === "string"
            && Object.hasOwn(operation, "requestSessionId"));
          if (!completeLogins.length) {
            finding("session-web-details-attribution-incomplete", "incomplete", "spring_session", session); continue;
          }
          if (!completeLogins.some((login) => details.remoteAddress === login.sourceAddress && details.sessionId === login.requestSessionId)) {
            finding("session-web-details-mismatch", "failed", "spring_session", session); continue;
          }
        }
        permit("spring_session", session, ["last_access_time", "expiry_time"]);
        for (const attribute of decoded.attributes) permit("spring_session_attributes", attribute, []);
      }
    }
  }
  const loginPolicy = auth.loginPolicy;
  if (loginPolicy) {
    const addressHash = createHash("sha256").update(`login:${loginPolicy.sourceAddress}`).digest("hex");
    const globalHash = createHash("sha256").update("all").digest("hex");
    const subjects = [{ scope: "ADDRESS", subjectHash: addressHash }, { scope: "GLOBAL", subjectHash: globalHash }];
    if (!equal([...auth.loginSubjects].sort((a, b) => a.scope.localeCompare(b.scope)), subjects)) {
      finding("login-subject-binding-mismatch", "failed");
    } else {
      const validPolicy = typeof loginPolicy.sourceAddress === "string" && loginPolicy.sourceAddress.length > 0
        && Number.isSafeInteger(loginPolicy.address?.maxFailures) && loginPolicy.address.maxFailures >= 1
        && [loginPolicy.address?.windowMilliseconds, loginPolicy.address?.blockMilliseconds,
          loginPolicy.global?.windowMilliseconds].every((value) => Number.isSafeInteger(value) && value >= 1000);
      if (loginPolicy.proofMode === "http-bounded-v1") {
        httpLoginPermissions({ policy: loginPolicy, validPolicy, contract, journal, operations, subjects,
          oldRows, currentRows, finding, permit, deletions });
        return { changes, deletions };
      }
      if (loginPolicy.proofMode !== undefined && loginPolicy.proofMode !== "native-v1") {
        finding("login-proof-mode-unsupported", "incomplete");
        return { changes, deletions };
      }
      const transitions = Array.isArray(journal.loginTransitions) ? journal.loginTransitions : [];
      if (transitions.length > resourceIntegrityLimits.operations) throw new Error("journal-entry-limit-exceeded");
      let complete = validPolicy && journal.loginTransitionsComplete === true;
      const state = new Map(subjects.map((subject) => [subject.scope, structuredClone(oldRows("login_attempt_limit")
        .find((row) => row.scope === subject.scope && row.subject_hash === subject.subjectHash) ?? null)]));
      const registers = new Map();
      const clears = new Set();
      const sequences = new Set();
      const loginOperations = operations.filter((operation) => operation.kind === "login");
      for (const operation of loginOperations) {
        if (operation.sourceAddress !== loginPolicy.sourceAddress) {
          finding("login-source-mismatch", "failed"); complete = false;
        }
      }
      const count = (scope, at) => {
        const prior = state.get(scope);
        const now = instantNanoseconds(at);
        const duration = scope === "ADDRESS" ? loginPolicy.address.windowMilliseconds : loginPolicy.global.windowMilliseconds;
        const reset = prior === null || instantNanoseconds(prior.window_started_at) + BigInt(duration) * 1000000n <= now;
        const attempts = reset ? 1 : prior.attempt_count + 1;
        state.set(scope, { scope, subject_hash: scope === "ADDRESS" ? addressHash : globalHash,
          attempt_count: attempts, window_started_at: reset ? at : prior.window_started_at,
          blocked_until: scope === "ADDRESS" && attempts >= loginPolicy.address.maxFailures
            ? plusMilliseconds(at, loginPolicy.address.blockMilliseconds) : null });
      };
      for (const transition of [...transitions].sort((a, b) => (a?.sequence ?? 0) - (b?.sequence ?? 0))) {
        const operation = loginOperations.find((entry) => entry.id === transition?.operationId);
        if (!validPolicy || !record(transition) || !Number.isSafeInteger(transition.sequence) || transition.sequence < 1
            || sequences.has(transition.sequence) || !operation || ![200, 401, 429].includes(operation.status)) {
          complete = false; continue;
        }
        sequences.add(transition.sequence);
        if (transition.kind === "register") {
          if (registers.has(operation.id) || !within(transition.addressAt, operation)
              || !within(transition.retryAt, operation) || !orderedInstants(transition.retryAt, transition.addressAt)) {
            complete = false; continue;
          }
          const address = state.get("ADDRESS");
          const blocked = address?.blocked_until !== null && address?.blocked_until !== undefined
            && instantNanoseconds(address.blocked_until) > instantNanoseconds(transition.retryAt);
          if (transition.decision === "blocked") {
            if (!blocked || operation.status !== 429 || transition.globalAt !== null) {
              finding("login-transition-mismatch", "failed"); complete = false; continue;
            }
          } else if (transition.decision === "counted") {
            if (blocked || !within(transition.globalAt, operation)
                || !orderedInstants(transition.addressAt, transition.globalAt)) {
              finding("login-transition-mismatch", "failed"); complete = false; continue;
            }
            count("ADDRESS", transition.addressAt);
            count("GLOBAL", transition.globalAt);
          } else { complete = false; continue; }
          registers.set(operation.id, transition);
        } else if (transition.kind === "clear") {
          if (operation.status !== 200 || registers.get(operation.id)?.decision !== "counted" || clears.has(operation.id)
              || !within(transition.at, operation)
              || !orderedInstants(registers.get(operation.id).globalAt, transition.at)) { complete = false; continue; }
          state.set("ADDRESS", null);
          clears.add(operation.id);
        } else complete = false;
      }
      if (loginOperations.some((operation) => !registers.has(operation.id)
          || operation.status === 200 && !clears.has(operation.id))) complete = false;
      if (!complete) finding("login-transition-coverage-incomplete", "incomplete");
      else for (const subject of subjects) {
        const actual = currentRows("login_attempt_limit").find((row) => row.scope === subject.scope
          && row.subject_hash === subject.subjectHash);
        const expected = state.get(subject.scope);
        const prior = oldRows("login_attempt_limit").find((row) => row.scope === subject.scope
          && row.subject_hash === subject.subjectHash);
        const matches = expected === null ? actual === undefined : actual && actual.attempt_count === expected.attempt_count
          && sameInstant(actual.window_started_at, expected.window_started_at)
          && (expected.blocked_until === null ? actual.blocked_until === null : sameInstant(actual.blocked_until, expected.blocked_until));
        if (!matches) finding("login-bucket-mismatch", "failed", "login_attempt_limit", actual ?? prior);
        else if (actual) permit("login_attempt_limit", actual, ["attempt_count", "window_started_at", "blocked_until"]);
        else if (prior) deletions.add(canonical(["login_attempt_limit", keyOf("login_attempt_limit", prior)]));
      }
    }
  }
  return { changes, deletions };
}

function snapshotIndex(snapshot, emit) {
  const result = new Map();
  result.invalidKeys = new Map();
  result.captureComplete = true;
  const report = (...args) => {
    result.captureComplete = false;
    emit(...args);
  };
  if (!record(snapshot) || snapshot.schemaVersion !== 1 || !record(snapshot.tables)) {
    report("snapshot-invalid", "incomplete");
    return result;
  }
  for (const table of Object.keys(snapshot.tables).sort()) {
    if (!Object.hasOwn(resourceIntegritySchema, table)) report("unknown-table", "incomplete", table);
  }
  let count = 0;
  for (const [table, expected] of Object.entries(resourceIntegritySchema)) {
    const captured = snapshot.tables[table];
    if (!record(captured) || !Array.isArray(captured.columns) || !Array.isArray(captured.primaryKey)
        || !Array.isArray(captured.rows)) {
      report("table-capture-incomplete", "incomplete", table);
      continue;
    }
    if (!equal([...captured.columns].sort(), expected.columns) || !equal(captured.primaryKey, expected.primaryKey)) {
      report("schema-mismatch", "incomplete", table);
    }
    count += captured.rows.length;
    if (count > resourceIntegrityLimits.rows) throw new Error("snapshot-row-limit-exceeded");
    const rows = new Map();
    const invalidKeys = new Set();
    for (const row of captured.rows) {
      if (!record(row) || !equal(Object.keys(row).sort(), expected.columns)
          || expected.primaryKey.some((column) => row[column] === null)) {
        report("row-capture-incomplete", "incomplete", table);
        if (record(row) && expected.primaryKey.every((column) => Object.hasOwn(row, column) && row[column] !== null)) {
          invalidKeys.add(keyOf(table, row));
          if (!rows.has(keyOf(table, row))) rows.set(keyOf(table, row), Object.fromEntries(
            expected.columns.filter((column) => Object.hasOwn(row, column)).map((column) => [column, row[column]])));
        }
        continue;
      }
      const key = keyOf(table, row);
      if (rows.has(key)) report("duplicate-snapshot-key", "incomplete", table, key);
      else rows.set(key, row);
    }
    result.set(table, new Map([...rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
    result.invalidKeys.set(table, invalidKeys);
  }
  return result;
}

function indexFingerprint(index) {
  return hash(Object.fromEntries([...index].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([table, rows]) => [table, { ...resourceIntegritySchema[table],
      rows: [...rows].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, row]) => row) }])));
}

export function resourceIntegritySnapshotFingerprint(snapshot) {
  canonical(snapshot);
  const errors = [];
  const index = snapshotIndex(snapshot, (code) => errors.push(code));
  if (errors.length) throw new Error("snapshot-capture-incomplete");
  return indexFingerprint(index);
}

export function resourcePublicationLifecycleIsNativeDelete(lifecycle) {
  return record(lifecycle)
    && equal(Object.keys(lifecycle).sort(), ["completionMode", "eventType", "listenerId", "repositoryMode"])
    && lifecycle.completionMode === "DELETE" && lifecycle.repositoryMode === "JDBC_V2"
    && lifecycle.eventType === publicationType && typeof lifecycle.listenerId === "string"
    && lifecycle.listenerId.trim().length > 0 && lifecycle.listenerId.length <= 512
    && !/[^\x20-\x7e]/.test(lifecycle.listenerId);
}

function compare(input) {
  const findings = [];
  let failed = false;
  let incomplete = false;
  const report = (code, outcome, table = null, key = null, field = null, before = null, after = null) => {
    failed ||= outcome === "failed";
    incomplete ||= outcome === "incomplete";
    if (findings.length < resourceIntegrityLimits.findings) findings.push({ code, outcome,
      tableHash: hash(table), keyHash: hash(key), fieldHash: hash(field),
      beforeHash: hash(before), afterHash: hash(after) });
  };
  const finish = (beforeFingerprint = null, afterFingerprint = null, ids = []) => ({
    result: { schemaVersion: 1, outcome: failed ? "failed" : incomplete ? "incomplete" : "passed",
      beforeFingerprint, afterFingerprint, validatedBookingIdHashes: failed || incomplete ? [] : ids.map(hash).sort(),
      findings: findings.sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0) }, ids
  });
  try {
    canonical(input);
    if (!record(input)) throw new Error("input-shape-invalid");
    const { before, after, contract, journal } = input;
    const beforeIndex = snapshotIndex(before, report);
    const afterIndex = snapshotIndex(after, report);
    const rows = (index, table) => [...(index.get(table)?.values() ?? [])];
    const oldRows = (table) => rows(beforeIndex, table);
    const currentRows = (table) => rows(afterIndex, table);
    const added = (table) => currentRows(table).filter((row) => !beforeIndex.get(table)?.has(keyOf(table, row)));
    const allowed = new Set();
    const allow = (table, row) => allowed.add(canonical([table, keyOf(table, row)]));
    const finding = (code, outcome, table, row, field = null) =>
      report(code, outcome, table, row ? keyOf(table, row) : null, field);
    const manager = oldRows("user_account").find((row) => row.id === contract?.managerAccountId);
    const interval = contract?.interval;
    const contractValid = record(contract) && contract.schemaVersion === 1 && uuid.test(contract.managerAccountId)
      && manager?.username === "security.manager.1" && manager.enabled === true
      && record(interval) && orderedInstants(interval.startedAt, interval.endedAt)
      && typeof contract.mailEnabled === "boolean" && Array.isArray(contract.publicationListeners)
      && record(contract.authentication) && Array.isArray(contract.authentication.ownedSessionPrimaryIds)
      && contract.authentication.ownedSessionPrimaryIds.length <= resourceIntegrityLimits.ownedSessions
      && contract.authentication.ownedSessionPrimaryIds.every((id) => typeof id === "string" && id.length > 0)
      && Array.isArray(contract.authentication.loginSubjects)
      && contract.authentication.loginSubjects.length <= resourceIntegrityLimits.loginSubjects
      && contract.authentication.loginSubjects.every((subject) => record(subject)
        && ["ADDRESS", "GLOBAL"].includes(subject.scope) && /^[a-f0-9]{64}$/.test(subject.subjectHash));
    if (!contractValid) report("contract-incomplete", "incomplete");
    const lifecycle = contract?.publicationLifecycle;
    const nativeDelete = contractValid && resourcePublicationLifecycleIsNativeDelete(lifecycle);
    if (!nativeDelete) report("publication-native-binding-incomplete", "incomplete");
    const journalValid = record(journal) && journal.schemaVersion === 1
      && typeof journal.complete === "boolean" && typeof journal.effectsSettled === "boolean"
      && Array.isArray(journal.operations) && Array.isArray(journal.mailReceipts)
      && Array.isArray(journal.publications);
    if (!journalValid) report("journal-incomplete", "incomplete");
    const operations = journalValid ? journal.operations : [];
    const rawReceipts = journalValid ? journal.mailReceipts : [];
    if (operations.length + rawReceipts.length + (journalValid ? journal.publications.length : 0)
        > resourceIntegrityLimits.operations) throw new Error("journal-entry-limit-exceeded");
    if (!journalValid || !journal.complete || !journal.effectsSettled) report("journal-coverage-incomplete", "incomplete");
    let attributionComplete = journalValid && journal.complete;
    const receipts = rawReceipts.filter((receipt) => {
      const valid = record(receipt) && typeof receipt.messageId === "string" && receipt.messageId.length > 0
        && typeof receipt.calendarUid === "string" && typeof receipt.recipient === "string"
        && uuid.test(receipt.accountId) && instantNanoseconds(receipt.acceptedAt) !== null
        && instantNanoseconds(receipt.startsAt) !== null && instantNanoseconds(receipt.endsAt) !== null;
      if (!valid) report("mail-receipt-incomplete", "incomplete");
      return valid;
    });
    const receiptMessageIds = new Set();
    for (const receipt of receipts) {
      if (receiptMessageIds.has(receipt.messageId)) report("duplicate-receipt-message-id", "failed");
      receiptMessageIds.add(receipt.messageId);
    }
    const requests = new Map();
    const creations = new Map();
    const creationWindows = new Map();
    const logins = [];
    const emptySeries = [];
    const refusedBookings = [];
    const operationIds = new Set();
    for (const operation of operations) {
      if (!record(operation) || typeof operation.id !== "string" || !operation.id
          || operationIds.has(operation.id) || !Number.isInteger(operation.status)
          || operation.status < 100 || operation.status > 599
          || !contractValid || !within(operation.startedAt, interval) || !within(operation.endedAt, interval)
          || !orderedInstants(operation.startedAt, operation.endedAt)) {
        report("operation-incomplete", "incomplete");
        attributionComplete = false;
        continue;
      }
      operationIds.add(operation.id);
      if (operation.kind === "login") {
        if (![200, 401, 429].includes(operation.status)) {
          report("login-status-unsupported", "incomplete");
          attributionComplete = false;
        }
        if (operation.status === 200 && operation.accountId === manager.id) logins.push(operation);
        else if (operation.status === 200) report("foreign-successful-login", "failed");
      } else if (operation.kind === "gatewayRejectedBody") {
        if (operation.method !== "POST" || operation.path !== "/api/session" || operation.status !== 413
            || !record(operation.request) || !equal(Object.keys(operation.request).sort(), ["bodyBytes", "contentType"])
            || operation.request.bodyBytes !== 2000001 || operation.request.contentType !== "application/x-www-form-urlencoded") {
          report("gateway-body-rejection-incomplete", "incomplete");
          attributionComplete = false;
        }
      } else if (operation.kind === "createBooking") {
        if (operation.status !== 201) {
          if (operation.status === 429 && admissionProblemTypes.includes(operation.problemType)
              && typeof operation.request?.idempotencyKey === "string") refusedBookings.push(operation);
          continue;
        }
        const request = operation.request;
        if (!record(request) || !uuid.test(operation.responseBookingId)
            || !uuid.test(operation.actorAccountId) || !uuid.test(request.cardId)
            || !Array.isArray(request.courtIds) || !request.courtIds.length
            || request.courtIds.some((id) => !uuid.test(id))
            || new Set(request.courtIds).size !== request.courtIds.length
            || !orderedInstants(request.startsAt, request.endsAt) || sameInstant(request.startsAt, request.endsAt)
            || !(request.note === null || typeof request.note === "string")
            || !Array.isArray(request.participants) || !request.participants.every(normalizedParticipant)
            || !(request.idempotencyKey === null || typeof request.idempotencyKey === "string"
              && request.idempotencyKey.length >= 1 && request.idempotencyKey.length <= 128)
            || !(request.idempotencyKey === null ? request.requestFingerprint === null
              : typeof request.requestFingerprint === "string" && /^[a-f0-9]{64}$/.test(request.requestFingerprint))) {
          report("booking-operation-incomplete", "incomplete");
          attributionComplete = false;
          continue;
        }
        if (operation.actorAccountId !== manager.id) report("foreign-booking-actor", "failed");
        if (!equal(Object.keys(request).sort(), ["cardId", "courtIds", "endsAt", "idempotencyKey", "note",
          "participants", "requestFingerprint", "startsAt"])) {
          report("booking-request-schema-unsupported", "incomplete");
          attributionComplete = false;
        }
        if (request.idempotencyKey !== null && request.requestFingerprint !== resourceBookingRequestFingerprint(request)) {
          report("request-fingerprint-mismatch", "failed");
        }
        const requestKey = request.idempotencyKey === null ? operation.id
          : canonical([operation.actorAccountId, request.idempotencyKey]);
        const previous = requests.get(requestKey);
        if (previous && (previous.responseBookingId !== operation.responseBookingId || !equal(previous.request, request))) {
          report("replay-mismatch", "failed");
        }
        requests.set(requestKey, operation);
        const prior = creations.get(operation.responseBookingId);
        if (prior && (!equal(prior.request, request) || prior.actorAccountId !== operation.actorAccountId)) {
          report("booking-id-body-mismatch", "failed");
        }
        if (!prior) creations.set(operation.responseBookingId, operation);
        const windows = creationWindows.get(operation.responseBookingId) ?? [];
        windows.push(operation);
        creationWindows.set(operation.responseBookingId, windows);
      } else if (operation.kind === "createSeries") {
        emptySeries.push(operation);
      } else if (!["read", "previewSeries"].includes(operation.kind)) {
        report("operation-kind-unsupported", "incomplete");
        attributionComplete = false;
      }
    }
    for (const operation of refusedBookings) {
      if (requests.has(canonical([operation.actorAccountId, operation.request.idempotencyKey]))) continue;
      const created = currentRows("booking").find((booking) => booking.booked_by === operation.actorAccountId
        && booking.idempotency_key === operation.request.idempotencyKey);
      if (created) finding("refused-request-created-booking", "failed", "booking", created);
    }
    if (journalValid) validateGatewayBodyRejections(journal, operations.filter((entry) => operationIds.has(entry.id)), report);
    for (const operation of emptySeries) validateEmptySeries(operation, { operations: operations.filter((entry) => operationIds.has(entry.id)),
      creations, manager, oldRows, finding });
    if (creations.size > resourceIntegrityLimits.bookings) throw new Error("journal-entry-limit-exceeded");
    const authenticationEffect = (table, row) => {
      if (!contractValid) return false;
      if (["spring_session", "spring_session_attributes"].includes(table)) {
        const id = table === "spring_session" ? row.primary_id : row.session_primary_id;
        return contract.authentication.ownedSessionPrimaryIds.includes(id);
      }
      return table === "login_attempt_limit" && contract.authentication.loginSubjects.some((subject) =>
        record(subject) && subject.scope === row.scope && subject.subjectHash === row.subject_hash);
    };
    const authentication = contractValid && journalValid
      ? authenticationPermissions({ contract, journal, manager, operations: operations.filter((operation) => operationIds.has(operation.id)),
        oldRows, currentRows, finding, allow }) : { changes: new Map(), deletions: new Set() };
    for (const [table, previous] of beforeIndex) {
      const current = afterIndex.get(table);
      if (!current) continue;
      if (table === "spring_session" && contractValid) {
        for (const row of current.values()) {
          if (authenticationEffect(table, row) && row.principal_name !== null
              && row.principal_name !== manager.username) finding("owned-session-foreign-principal", "failed", table, row);
        }
      }
      for (const [key, old] of previous) {
        const next = current.get(key);
        if (!next) {
          if (afterIndex.invalidKeys.get(table)?.has(key)) continue;
          if (authentication.deletions.has(canonical([table, key]))) continue;
          report(authenticationEffect(table, old) ? "authentication-effect-unsupported" : "protected-row-deleted",
            authenticationEffect(table, old) ? "incomplete" : "failed", table, key, null, old, null);
          continue;
        }
        for (const field of resourceIntegritySchema[table].columns) {
          if (!Object.hasOwn(old, field) || !Object.hasOwn(next, field)) continue;
          if (equal(old[field], next[field])) continue;
          if (authentication.changes.get(canonical([table, key]))?.has(field)) continue;
          if (table === "user_account" && field === "last_login_at" && contractValid && old.id === manager.id
              && logins.some((login) => within(next[field], login))
              && (old[field] === null || instantNanoseconds(old[field]) !== null
                && instantNanoseconds(next[field]) >= instantNanoseconds(old[field]))) continue;
          if (table === "user_account" && field === "last_login_at" && contractValid && old.id === manager.id
              && !attributionComplete && within(next[field], interval)
              && (old[field] === null || instantNanoseconds(old[field]) !== null
                && instantNanoseconds(next[field]) >= instantNanoseconds(old[field]))) {
            report("login-attribution-incomplete", "incomplete", table, key, field, old[field], next[field]);
            continue;
          }
          const owned = authenticationEffect(table, old);
          report(owned ? "authentication-effect-unsupported" : "protected-field-changed",
            owned ? "incomplete" : "failed", table, key, field, old[field], next[field]);
        }
      }
    }
    const validatedIds = [];
    const correlatedMessages = new Set();
    const correlatedReceipts = new Set();
    const queueSequences = new Set();
    const messageIds = new Set();
    for (const message of currentRows("message_record")) {
      const sequence = canonical(message.queued_seq);
      if (queueSequences.has(sequence)) finding("duplicate-message-sequence", "failed", "message_record", message);
      if (messageIds.has(message.message_id)) finding("duplicate-message-id", "failed", "message_record", message);
      queueSequences.add(sequence);
      messageIds.add(message.message_id);
    }
    const allocationsByCourt = new Map();
    for (const allocation of currentRows("court_allocation")) {
      if (allocation.status === "CANCELLED") continue;
      const start = instantNanoseconds(allocation.starts_at);
      const end = instantNanoseconds(allocation.ends_at);
      if (start === null || end === null || end <= start) {
        finding("allocation-range-invalid", "failed", "court_allocation", allocation);
        continue;
      }
      const group = allocationsByCourt.get(allocation.court_id) ?? [];
      group.push({ start, end, allocation });
      allocationsByCourt.set(allocation.court_id, group);
    }
    for (const group of allocationsByCourt.values()) {
      group.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
      let previousEnd = null;
      for (const { start, end, allocation } of group) {
        if (previousEnd !== null && start < previousEnd) finding("court-occupancy-overlap", "failed", "court_allocation", allocation);
        if (previousEnd === null || end > previousEnd) previousEnd = end;
      }
    }
    for (const [id, operation] of creations) {
      const request = operation.request;
      const booking = added("booking").find((row) => row.id === id);
      if (!booking) {
        report("successful-booking-missing-or-preexisting", "failed", "booking", canonical([id]));
        continue;
      }
      const card = oldRows("booking_card").find((row) => row.id === request.cardId);
      const expected = { id, card_id: request.cardId, status: "CONFIRMED", booked_by: operation.actorAccountId,
        note: request.note, cancelled_at: null, cancelled_by: null, moved_at: null, moved_by: null,
        series_id: null, reminded_at: null, idempotency_key: request.idempotencyKey,
        request_fingerprint: request.requestFingerprint };
      let valid = true;
      for (const [field, value] of Object.entries(expected)) {
        if (!equal(booking[field], value)) {
          report("booking-field-mismatch", "failed", "booking", keyOf("booking", booking), field, value, booking[field]);
          valid = false;
        }
      }
      const windows = creationWindows.get(id);
      if (!windows.some((window) => within(booking.created_at, window)) || !card || card.active !== true
          || request.courtIds.some((court) => !oldRows("court").some((row) => row.id === court && row.active === true))) {
        finding("booking-context-mismatch", "failed", "booking", booking);
        valid = false;
      }
      allow("booking", booking);
      const allocations = added("court_allocation").filter((row) => row.booking_id === id);
      if (allocations.length !== request.courtIds.length) {
        finding("allocation-count-mismatch", "failed", "booking", booking);
        valid = false;
      }
      const allocated = new Set();
      for (const allocation of allocations) {
        if (!uuid.test(allocation.id) || allocated.has(allocation.court_id)
            || !request.courtIds.includes(allocation.court_id) || allocation.status !== "CONFIRMED"
            || !sameInstant(allocation.starts_at, request.startsAt) || !sameInstant(allocation.ends_at, request.endsAt)) {
          finding("allocation-mismatch", "failed", "court_allocation", allocation);
          valid = false;
        }
        allocated.add(allocation.court_id);
        allow("court_allocation", allocation);
      }
      const tracksPlayers = Array.isArray(card?.allowed_player_counts) && card.allowed_player_counts.length > 0;
      const participants = tracksPlayers ? [{ kind: "MEMBER", personId: manager.person_id, guestName: null, cardId: null },
        ...request.participants] : [];
      const storedParticipants = added("booking_participant").filter((row) => row.booking_id === id);
      if ((!tracksPlayers && request.participants.length) || storedParticipants.length !== participants.length
          || tracksPlayers && !card.allowed_player_counts.includes(participants.length)) {
        finding("participant-count-mismatch", "failed", "booking", booking);
        valid = false;
      }
      const positions = new Set();
      for (const participant of storedParticipants) {
        const spec = participants[participant.position - 1];
        if (!uuid.test(participant.id) || !Number.isInteger(participant.position) || participant.position < 1
            || positions.has(participant.position)
            || !spec || !equal({ kind: participant.kind, personId: participant.person_id,
              guestName: participant.guest_name, cardId: participant.card_id }, spec)) {
          finding("participant-mismatch", "failed", "booking_participant", participant);
          valid = false;
        }
        positions.add(participant.position);
        allow("booking_participant", participant);
      }
      if (request.participants.some(({ kind }) => kind !== "GUEST")) {
        finding("participant-effects-unsupported", "incomplete", "booking", booking);
      }
      const audits = added("domain_event").filter((row) => row.subject_id === id && row.event_type === confirmedType);
      if (audits.length !== 1) {
        finding("confirmation-audit-count-mismatch", "failed", "booking", booking);
        valid = false;
      }
      for (const event of audits) {
        if (!uuid.test(event.id) || event.actor_account_id !== operation.actorAccountId
            || !windows.some((window) => within(booking.created_at, window) && within(event.occurred_at, window))
            || !orderedInstants(booking.created_at, event.occurred_at) || !equal(event.payload, { bookingId: id })) {
          finding("confirmation-audit-mismatch", "failed", "domain_event", event);
          valid = false;
        }
        allow("domain_event", event);
      }
      const wantsMail = contract.mailEnabled && !oldRows("message_optout").some((row) =>
        row.user_account_id === manager.id && row.kind === "BOOKING_CONFIRMED");
      const person = oldRows("person").find((row) => row.id === manager.person_id);
      const matchingReceipts = receipts.filter((receipt) => record(receipt)
        && receipt.calendarUid === `booking-${id}@courtside`);
      if (matchingReceipts.length > (wantsMail ? 1 : 0)) finding("confirmation-receipt-count-mismatch", "failed", "booking", booking);
      if (wantsMail && matchingReceipts.length === 0) finding("confirmation-mail-correlation-incomplete", "incomplete", "booking", booking);
      for (const receipt of matchingReceipts) {
        correlatedReceipts.add(receipt);
        const messages = added("message_record").filter((row) => row.message_id === receipt.messageId);
        if (messages.length !== 1) finding("confirmation-message-count-mismatch", "failed", "booking", booking);
        if (receipt.accountId !== manager.id || receipt.recipient !== person?.email
            || !sameInstant(receipt.startsAt, request.startsAt) || !sameInstant(receipt.endsAt, request.endsAt)
            || !within(receipt.acceptedAt, interval)) finding("confirmation-receipt-mismatch", "failed", "booking", booking);
        for (const message of messages) {
          correlatedMessages.add(message);
          allow("message_record", message);
          if (!uuid.test(message.id) || message.account_id !== manager.id || message.kind !== "BOOKING_CONFIRMED"
              || message.state !== "HANDED_OVER" || message.reason !== null || message.status_code !== null
              || !within(message.queued_at, interval) || !within(message.settled_at, interval)
              || !orderedInstants(message.queued_at, message.settled_at)
              || !orderedInstants(receipt.acceptedAt, message.settled_at)
              || !Number.isSafeInteger(Number(message.queued_seq)) || Number(message.queued_seq) < 1) {
            finding("confirmation-message-mismatch", "failed", "message_record", message);
          }
        }
      }
      if (valid) validatedIds.push(id);
    }
    for (const receipt of receipts) {
      if (!correlatedReceipts.has(receipt)) report("unattributed-mail-receipt", attributionComplete ? "failed" : "incomplete");
    }
    const wantedCount = contractValid && contract.mailEnabled
      && !oldRows("message_optout").some((row) => row.user_account_id === manager.id && row.kind === "BOOKING_CONFIRMED")
      ? creations.size : 0;
    if (attributionComplete && added("message_record").length > wantedCount) report("extra-message-record", "failed");
    for (const message of added("message_record")) {
      if (!correlatedMessages.has(message)) {
        const foreign = !contractValid || message.account_id !== manager.id || message.kind !== "BOOKING_CONFIRMED";
        finding(foreign ? "foreign-message-record" : "confirmation-mail-correlation-incomplete",
          foreign ? "failed" : "incomplete", "message_record", message);
        allow("message_record", message);
      }
    }
    const publications = journalValid ? journal.publications.filter((entry) => {
      const valid = record(entry) && uuid.test(entry.id) && uuid.test(entry.bookingId)
        && typeof entry.listenerId === "string";
      if (!valid) report("publication-observation-incomplete", "incomplete");
      return valid;
    }) : [];
    const publicationEffects = new Set();
    for (const publication of added("event_publication")) {
      const observation = publications.find((entry) => entry.id === publication.id);
      let serialized;
      try { serialized = JSON.parse(publication.serialized_event); } catch { serialized = null; }
      const booking = added("booking").find((entry) => entry.id === serialized?.bookingId);
      const causal = booking && creations.has(booking.id);
      const payloadValid = record(serialized) && uuid.test(serialized.bookingId)
        && equal(serialized, { bookingId: serialized.bookingId });
      if (!uuid.test(publication.id) || typeof publication.listener_id !== "string" || !publication.listener_id.length
          || publication.event_type !== publicationType || !payloadValid || !booking
          || !within(publication.publication_date, interval)
          || !orderedInstants(booking?.created_at, publication.publication_date)
          || (observation && (observation.bookingId !== serialized?.bookingId
            || observation.listenerId !== publication.listener_id))) {
        finding("publication-mismatch", "failed", "event_publication", publication);
      }
      const effect = canonical([publication.listener_id, serialized?.bookingId]);
      if (publicationEffects.has(effect)) finding("duplicate-publication-effect", "failed", "event_publication", publication);
      publicationEffects.add(effect);
      const pending = ["PUBLISHED", "PROCESSING"].includes(publication.status) && publication.completion_attempts === 1
        && publication.completion_date === null
        && sameInstant(publication.last_resubmission_date, publication.publication_date);
      if (nativeDelete && (publication.listener_id !== lifecycle.listenerId || !pending || journal?.effectsSettled)) {
        finding("publication-native-lifecycle-mismatch", "failed", "event_publication", publication);
      } else {
        finding(nativeDelete && causal ? "publication-settlement-pending" : "publication-native-binding-incomplete",
          "incomplete", "event_publication", publication);
      }
      if (!causal) finding("publication-unattributed", attributionComplete ? "failed" : "incomplete", "event_publication", publication);
      allow("event_publication", publication);
    }
    if (publications.some((entry) => !added("event_publication").some((row) => row.id === entry.id))) {
      report("publication-observation-missing", "incomplete");
    }
    for (const [table, previous] of beforeIndex) {
      const current = afterIndex.get(table);
      if (!current) continue;
      for (const [key, next] of current) {
        if (previous.has(key) || allowed.has(canonical([table, key]))) continue;
        const owned = authenticationEffect(table, next);
        const unattributed = ["booking", "court_allocation", "booking_participant", "domain_event"].includes(table)
          && !attributionComplete;
        report(owned ? "authentication-effect-unsupported" : "unexpected-row-added",
          owned || unattributed ? "incomplete" : "failed", table, key, null, null, next);
      }
    }
    return finish(beforeIndex.captureComplete ? indexFingerprint(beforeIndex) : null,
      afterIndex.captureComplete ? indexFingerprint(afterIndex) : null, validatedIds.sort());
  } catch (failure) {
    report(["input-depth-exceeded", "input-size-exceeded", "snapshot-row-limit-exceeded", "journal-entry-limit-exceeded"]
      .includes(failure.message) ? failure.message : "input-shape-invalid", "incomplete");
    return finish();
  }
}

export function compareResourceIntegrity(input) {
  return compare(input).result;
}

export function validatedResourceBookingIds(input) {
  const { result, ids } = compare(input);
  return result.outcome === "passed" ? ids : [];
}
