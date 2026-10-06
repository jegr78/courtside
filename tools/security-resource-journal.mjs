import { resourceBookingRequestFingerprint } from "./security-resource-integrity.mjs";

export const resourceJournalMarker = "COURTSIDE_RESOURCE_JOURNAL_V1 ";
export const resourceJournalLimits = Object.freeze({ bytes: 8 * 1024 * 1024, frameBytes: 16384, operations: 10000 });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sessionId = /^[A-Za-z0-9_-]{36}$/;
const subject = /^security\.(?:manager|member)\.[1-3]$/;
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const instant = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const keys = (value, required, optional = []) => record(value)
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));

function requestInstant(value) {
  const parts = typeof value === "string"
    ? /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value) : null;
  if (!parts) return null;
  const local = Date.parse(`${parts[1]}Z`);
  const epoch = Date.parse(`${parts[1]}${parts[3]}`);
  if (!Number.isFinite(local) || !Number.isFinite(epoch)
      || !new Date(local).toISOString().startsWith(parts[1])) return null;
  return BigInt(epoch) * 1000000n + BigInt((parts[2] ?? "").padEnd(9, "0"));
}

function uniqueJson(text) {
  const value = JSON.parse(text);
  let cursor = 0;
  let nodes = 0;
  const whitespace = () => { while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor++; };
  const string = () => {
    const start = cursor++;
    while (cursor < text.length) {
      if (text[cursor++] === "\\") cursor++;
      else if (text[cursor - 1] === '"') return JSON.parse(text.slice(start, cursor));
    }
    throw new Error("journal-frame-invalid");
  };
  function scan(depth = 0) {
    if (depth > 16 || ++nodes > 4096) throw new Error("journal-frame-invalid");
    whitespace();
    if (text[cursor] === '"') { string(); return; }
    if (text[cursor] === "{" || text[cursor] === "[") {
      const object = text[cursor++] === "{";
      const close = object ? "}" : "]";
      const seen = new Set();
      whitespace();
      while (text[cursor] !== close) {
        if (object) {
          const key = string();
          if (seen.has(key)) throw new Error("journal-frame-invalid");
          seen.add(key);
          whitespace();
          cursor++;
        }
        scan(depth + 1);
        whitespace();
        if (text[cursor] !== ",") break;
        cursor++;
        whitespace();
      }
      cursor++;
    } else {
      while (cursor < text.length && !/[\s,\]}]/.test(text[cursor])) cursor++;
    }
  }
  scan();
  return value;
}

function messageOf(line) {
  if (line.startsWith(resourceJournalMarker)) return line;
  if (line.startsWith("{")) {
    const envelope = uniqueJson(line);
    if (envelope.source !== "console" || envelope.level !== "info" || typeof envelope.msg !== "string") {
      throw new Error("journal-frame-invalid");
    }
    return envelope.msg;
  }
  const match = /^time="[^"]+" level=info msg=("(?:\\.|[^"\\])*") source=console\s*$/.exec(line);
  if (!match) throw new Error("journal-frame-invalid");
  return JSON.parse(match[1]);
}

function bookingRequest(request) {
  if (!keys(request, ["courtIds", "cardId", "startsAt", "endsAt", "note", "participants", "idempotencyKey"])
      || requestInstant(request.startsAt) === null || requestInstant(request.endsAt) === null
      || requestInstant(request.startsAt) >= requestInstant(request.endsAt)
      || !Array.isArray(request.courtIds) || new Set(request.courtIds).size !== request.courtIds.length
      || request.courtIds.length > 32 || !Array.isArray(request.participants) || request.participants.length > 32
      || !(request.idempotencyKey === null || typeof request.idempotencyKey === "string"
        && request.idempotencyKey.length > 0 && request.idempotencyKey.length <= 128)
      || !(request.note === null || typeof request.note === "string" && request.note.length <= 4096)) {
    throw new Error("booking-request-invalid");
  }
  const fingerprint = resourceBookingRequestFingerprint(request);
  return { courtIds: request.courtIds, cardId: request.cardId, startsAt: request.startsAt, endsAt: request.endsAt,
    note: request.note, participants: request.participants.map(({ kind, personId, guestName, cardId }) =>
      ({ kind, personId, guestName, cardId })), idempotencyKey: request.idempotencyKey,
    requestFingerprint: request.idempotencyKey === null ? null : fingerprint };
}

function seriesRequest(request) {
  if (!keys(request, ["courtIds", "cardId", "startsOn", "startTime", "durationMinutes", "intervalWeeks",
    "weekdays", "occurrenceCount"], ["endsOn", "note", "confirmedStarts"])
      || !Array.isArray(request.courtIds) || !request.courtIds.length || request.courtIds.length > 32
      || !request.courtIds.every(id => uuid.test(id))
      || !uuid.test(request.cardId) || !/^\d{4}-\d\d-\d\d$/.test(request.startsOn)
      || !/^\d\d:\d\d:\d\d$/.test(request.startTime)
      || ![request.durationMinutes, request.intervalWeeks, request.occurrenceCount].every(value => Number.isInteger(value) && value > 0)
      || request.occurrenceCount > 200
      || !(request.note === undefined || request.note === null || typeof request.note === "string" && request.note.length <= 4096)
      || !(request.endsOn === undefined || request.endsOn === null || /^\d{4}-\d\d-\d\d$/.test(request.endsOn))
      || !Array.isArray(request.weekdays) || !request.weekdays.length || request.weekdays.length > 7
      || !request.weekdays.every(value => ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].includes(value))
      || request.confirmedStarts !== undefined && (!Array.isArray(request.confirmedStarts) || request.confirmedStarts.length > 200
        || !request.confirmedStarts.every(value => requestInstant(value) !== null))) {
    throw new Error("series-request-invalid");
  }
  return { ...request, endsOn: request.endsOn ?? null, note: request.note ?? null };
}

export function parseResourceJournal(output, { accounts = [] } = {}) {
  const result = { schemaVersion: 1, complete: false, captureComplete: false, effectsSettled: false,
    operations: [], mailReceipts: [], publications: [], ownedSessionIds: [], loginUsernames: [], findings: [], runId: null };
  const findings = new Set();
  const report = code => findings.add(code);
  const done = () => { result.findings = [...findings].sort(); return result; };
  if (typeof output !== "string" || Buffer.byteLength(output) > resourceJournalLimits.bytes) {
    report("journal-size-exceeded");
    return done();
  }
  const accountIds = new Map();
  const mappedIds = new Set();
  if (!Array.isArray(accounts) || accounts.length > 512) report("account-mapping-invalid");
  else for (const account of accounts) {
    if (!record(account) || !uuid.test(account.id) || typeof account.username !== "string"
        || accountIds.has(account.username) || mappedIds.has(account.id)) report("account-mapping-invalid");
    else { accountIds.set(account.username, account.id); mappedIds.add(account.id); }
  }
  let start;
  let finish;
  const begins = new Map();
  const ends = new Map();
  const sequences = new Map();
  let count = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes("COURTSIDE_RESOURCE_JOURNAL")) continue;
    try {
      if (Buffer.byteLength(line) > resourceJournalLimits.frameBytes * 2) throw new Error("journal-frame-invalid");
      const message = messageOf(line);
      if (!message.startsWith(resourceJournalMarker)
          || Buffer.byteLength(message) > resourceJournalLimits.frameBytes) throw new Error("journal-frame-invalid");
      if (++count > resourceJournalLimits.operations * 2 + 3) { report("journal-entry-limit-exceeded"); break; }
      const frame = uniqueJson(message.slice(resourceJournalMarker.length));
      if (frame.event === "start") {
        if (start || count !== 1 || !keys(frame, ["event", "runId", "clock"])
            || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(frame.runId) || !instant(frame.clock)) throw new Error("journal-frame-invalid");
        start = frame;
        result.runId = frame.runId;
      } else if (frame.event === "finish") {
        if (finish || !keys(frame, ["event", "runId", "started", "finished", "dropped"])
            || ![frame.started, frame.finished, frame.dropped].every(value => Number.isInteger(value) && value >= 0
              && value <= resourceJournalLimits.operations)) throw new Error("journal-frame-invalid");
        finish = frame;
      } else if (frame.event === "begin") {
        if (finish || !keys(frame, ["event", "id", "vu", "sequence", "kind", "startedAt", "method", "path", "actorUsername", "request"], ["previewOperationId", "winnerOperationId"])
            || [frame.previewOperationId, frame.winnerOperationId].some(id => id !== undefined
              && (frame.kind !== "createSeries" || typeof id !== "string" || !/^\d+:\d+$/.test(id)))
            || !Number.isInteger(frame.vu) || frame.vu < 0 || frame.vu > 50
            || frame.vu === 0 && !["login", "read"].includes(frame.kind)
            || !Number.isInteger(frame.sequence) || frame.sequence !== (sequences.get(frame.vu) ?? 0) + 1
            || frame.sequence > 1 && !ends.has(`${frame.vu}:${frame.sequence - 1}`)
            || frame.id !== `${frame.vu}:${frame.sequence}` || begins.has(frame.id)
            || !instant(frame.startedAt) || !["GET", "POST"].includes(frame.method)
            || !(frame.actorUsername === null || subject.test(frame.actorUsername))
            || !["login", "read", "createBooking", "previewSeries", "createSeries", "gatewayRejectedBody"].includes(frame.kind)) {
          throw new Error("journal-frame-invalid");
        }
        const paths = { login: ["/api/session"], gatewayRejectedBody: ["/api/session"], createBooking: ["/api/bookings"],
          previewSeries: ["/api/booking-series-preview"], createSeries: ["/api/booking-series"],
          read: ["/api/session", "/api/public/courts", "/api/public/booking-cards", "/api/public/participant-cards",
            "/api/public/participant-members", "/api/public/booking-grid"] };
        const method = frame.kind === "read" && frame.path !== "/api/public/participant-members" ? "GET" : "POST";
        if (!paths[frame.kind].includes(frame.path) || frame.method !== method) {
          throw new Error("journal-frame-invalid");
        }
        if (frame.kind === "createBooking") frame.request = bookingRequest(frame.request);
        else if (["previewSeries", "createSeries"].includes(frame.kind)) frame.request = seriesRequest(frame.request);
        else if (frame.kind === "gatewayRejectedBody") {
          if (!keys(frame.request, ["bodyBytes", "contentType"]) || frame.request.bodyBytes !== 2_000_001
              || frame.request.contentType !== "application/x-www-form-urlencoded") throw new Error("journal-frame-invalid");
        }
        else if (frame.kind === "login" ? !keys(frame.request, ["username"])
            || !(frame.request.username === null || subject.test(frame.request.username)) : frame.request !== null) {
          throw new Error("journal-frame-invalid");
        }
        if (begins.size >= resourceJournalLimits.operations) throw new Error("journal-entry-limit-exceeded");
        sequences.set(frame.vu, frame.sequence);
        begins.set(frame.id, frame);
      } else if (frame.event === "end") {
        if (finish || !keys(frame, ["event", "id", "status", "endedAt", "responseBookingId", "identityUsername", "ownedSessionIds"], ["seriesResult", "previewResult", "problemType", "retryAfterSeconds", "sessionId", "responseSessionId"])
            || frame.problemType !== undefined && !(frame.problemType === null
              || typeof frame.problemType === "string" && /^urn:courtside:error:[a-z0-9-]{1,80}$/.test(frame.problemType))
            || frame.retryAfterSeconds !== undefined && !(frame.retryAfterSeconds === null
              || Number.isSafeInteger(frame.retryAfterSeconds) && frame.retryAfterSeconds >= 0 && frame.retryAfterSeconds <= 999999999)
            || ends.has(frame.id) || !begins.has(frame.id) || !Number.isInteger(frame.status)
            || frame.status < 0 || frame.status > 599 || frame.status > 0 && frame.status < 100
            || !instant(frame.endedAt) || frame.endedAt < begins.get(frame.id).startedAt
            || !(frame.responseBookingId === null || uuid.test(frame.responseBookingId))
            || !(frame.identityUsername === null || subject.test(frame.identityUsername))
            || !Array.isArray(frame.ownedSessionIds) || frame.ownedSessionIds.length > 4
            || !frame.ownedSessionIds.every(id => sessionId.test(id))
            || [frame.sessionId, frame.responseSessionId].some(id => id !== undefined && id !== null && !sessionId.test(id))) {
          throw new Error("journal-frame-invalid");
        }
        const begin = begins.get(frame.id);
        if (frame.status === 429 && (!frame.problemType || !Number.isSafeInteger(frame.retryAfterSeconds)
            || frame.retryAfterSeconds < 1)) report("rate-limit-response-incomplete");
        if (frame.previewResult !== undefined && (begin.kind !== "previewSeries" || frame.status !== 200
            || !keys(frame.previewResult, ["occurrences"]) || !Array.isArray(frame.previewResult.occurrences)
            || frame.previewResult.occurrences.length > 200 || !frame.previewResult.occurrences.every(value =>
              keys(value, ["startsAt", "endsAt", "creatable", "blockedCourtIds", "violations"])
              && requestInstant(value.startsAt) !== null && requestInstant(value.endsAt) !== null
              && typeof value.creatable === "boolean" && Array.isArray(value.blockedCourtIds)
              && value.blockedCourtIds.length <= 32 && value.blockedCourtIds.every(id => uuid.test(id))
              && Array.isArray(value.violations) && value.violations.length === 0))) throw new Error("journal-frame-invalid");
        if (frame.responseBookingId !== null && (begin.kind !== "createBooking" || frame.status !== 201)
            || frame.identityUsername !== null && (begin.kind !== "read" || begin.method !== "GET"
              || begin.path !== "/api/session" || frame.status !== 200)
            || frame.seriesResult !== undefined && begin.kind !== "createSeries") throw new Error("journal-frame-invalid");
        if (frame.seriesResult !== undefined && (!keys(frame.seriesResult, ["seriesId", "bookingIds", "skipped"])
            || !(frame.seriesResult.seriesId === null || uuid.test(frame.seriesResult.seriesId))
            || !Array.isArray(frame.seriesResult.bookingIds) || frame.seriesResult.bookingIds.length > 200
            || !frame.seriesResult.bookingIds.every(id => uuid.test(id))
            || !Array.isArray(frame.seriesResult.skipped) || frame.seriesResult.skipped.length > 200
            || !frame.seriesResult.skipped.every(value => requestInstant(value) !== null))) throw new Error("journal-frame-invalid");
        ends.set(frame.id, frame);
        if (frame.status === 0) report("operation-response-incomplete");
      } else throw new Error("journal-frame-invalid");
    } catch (error) {
      report(["booking-request-invalid", "series-request-invalid", "journal-entry-limit-exceeded"].includes(error.message)
        ? error.message : "journal-frame-invalid");
    }
  }
  if (!start || !finish || start.runId !== finish.runId || !begins.size
      || finish.started !== begins.size || finish.finished !== ends.size || finish.dropped !== 0
      || begins.size !== ends.size) report("journal-capture-incomplete");
  result.captureComplete = findings.size === 0;
  const replays = new Map();
  const bookings = new Map();
  const sessions = new Set();
  const usernames = new Set();
  const pendingLogins = new Map();
  const confirmedLogins = new Map();
  for (const begin of begins.values()) {
    const end = ends.get(begin.id);
    if (begin.kind === "login") pendingLogins.set(begin.vu, begin);
    else if (begin.path === "/api/session" && begin.method === "GET" && end?.status === 200) {
      const login = pendingLogins.get(begin.vu);
      const response = login && ends.get(login.id);
      if (response?.status === 200 && begin.startedAt >= response.endedAt
          && end.identityUsername === login.request.username && accountIds.has(end.identityUsername)) {
        confirmedLogins.set(login.id, accountIds.get(end.identityUsername));
      }
    }
  }
  for (const begin of begins.values()) {
    const end = ends.get(begin.id);
    if (!end) continue;
    const operation = { id: begin.id, kind: begin.kind, vu: begin.vu, sequence: begin.sequence,
      method: begin.method, path: begin.path, startedAt: begin.startedAt, endedAt: end.endedAt, status: end.status,
      sessionId: end.sessionId ?? null, responseSessionId: end.responseSessionId ?? null };
    if (end.status === 429) Object.assign(operation, { problemType: end.problemType ?? null,
      retryAfterSeconds: end.retryAfterSeconds ?? null });
    if (begin.kind === "gatewayRejectedBody") {
      operation.request = begin.request;
      if (end.status !== 413) report("gateway-body-rejection-incomplete");
    }
    end.ownedSessionIds.forEach(id => sessions.add(id));
    if (start && begin.startedAt < start.clock) report("operation-clock-invalid");
    if (begin.kind === "login") {
      operation.requestSessionId = end.sessionId ?? null;
      operation.username = begin.request.username;
      if (begin.request.username) usernames.add(begin.request.username);
      operation.accountId = null;
      if (end.status === 200) {
        const accountId = confirmedLogins.get(begin.id);
        if (!accountId) report("login-identity-incomplete");
        else operation.accountId = accountId;
      }
    } else if (begin.kind === "createBooking") {
      operation.actorAccountId = accountIds.get(begin.actorUsername) ?? null;
      operation.request = begin.request;
      operation.responseBookingId = end.responseBookingId;
      if (!operation.actorAccountId) report("booking-actor-incomplete");
      if (end.status === 201) {
        if (!operation.responseBookingId) report("booking-response-incomplete");
        const key = begin.request.idempotencyKey === null ? begin.id : JSON.stringify([operation.actorAccountId, begin.request.idempotencyKey]);
        const body = JSON.stringify(begin.request);
        const previous = replays.get(key);
        if (previous && (previous.id !== end.responseBookingId || previous.body !== body)) report("replay-mismatch");
        replays.set(key, { id: end.responseBookingId, body });
        const prior = bookings.get(end.responseBookingId);
        if (prior && (prior.body !== body || prior.actor !== operation.actorAccountId)) report("booking-id-body-mismatch");
        bookings.set(end.responseBookingId, { body, actor: operation.actorAccountId });
      }
    } else if (["previewSeries", "createSeries"].includes(begin.kind)) {
      operation.request = begin.request;
      operation.actorAccountId = accountIds.get(begin.actorUsername) ?? null;
      if (begin.kind === "previewSeries") operation.result = end.previewResult ?? null;
      if (begin.kind === "createSeries") {
        operation.previewOperationId = begin.previewOperationId ?? null;
        operation.winnerOperationId = begin.winnerOperationId ?? null;
        operation.seriesResult = end.seriesResult ?? null;
        operation.result = operation.seriesResult;
        const response = operation.seriesResult;
        const confirmed = begin.request.confirmedStarts;
        if (![200, 201].includes(end.status) || !operation.actorAccountId
            || begin.request.occurrenceCount !== 1 || !Array.isArray(confirmed) || confirmed.length !== 1
            || !response || response.seriesId !== null || response.bookingIds.length !== 0
            || response.skipped.length !== 1
            || requestInstant(response.skipped[0]) !== requestInstant(confirmed[0])) report("operation-kind-unsupported");
      }
    }
    result.operations.push(operation);
  }
  result.ownedSessionIds = [...sessions].sort();
  result.loginUsernames = [...usernames].sort();
  result.complete = result.captureComplete && findings.size === 0;
  return done();
}
