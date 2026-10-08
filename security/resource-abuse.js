import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import encoding from "k6/encoding";
import exec from "k6/execution";

const policy = JSON.parse(open("/scripts/policy.json"));
const target = "http://scanner-gateway:8090";
const password = __ENV.COURTSIDE_SECURITY_SHARED_PASSWORD;
const runId = __ENV.COURTSIDE_SECURITY_RUN_ID;
const memberCardId = "11111111-1111-1111-1111-111111111111";
const seriesCardId = "22222222-2222-2222-2222-222222222222";
const successfulOccupancy = new Counter("successful_occupancy");
const rejectedOccupancy = new Counter("rejected_occupancy");
const partialOperations = new Counter("partial_operations");
const rateLimitedLogins = new Counter("rate_limited_logins");
const duplicateResponses = new Counter("duplicate_responses");
const duplicateFailures = new Counter("duplicate_failures");
const toctouCreated = new Counter("toctou_created");
const toctouSkipped = new Counter("toctou_skipped");
const integrityAdmissionRefusals = new Counter("integrity_admission_refusals");
const pressureAdmissionRefusals = new Counter("pressure_admission_refusals");
const addressAdmissionRefusals = new Counter("address_admission_refusals");
const admissionProblemTypes = ["urn:courtside:error:request-rate-limited",
  "urn:courtside:error:operation-capacity-exhausted"];
const sessionNames = ["occupancy", "duplicate", "capacity", "toctou", "pressure"];
let boundScenario = null;
let token;
let courtId;
let bookingCardId;
let participantCardId;
let personId;
const sessionCookies = {};
const failedSessionCookies = {};
let failedToken;
let failedCookieJar;
let runSlots;
let actorUsername = null;
let journalSequence = 0;
let lastJournalOperationId;
let seriesOperationRefs;
let journalBytes = 0;
const journalStarted = new Counter("journal_started");
const journalFinished = new Counter("journal_finished");
const journalDropped = new Counter("journal_dropped");
const journalMarker = "COURTSIDE_RESOURCE_JOURNAL_V1 ";
const journalVuLimits = { operations: 700, bytes: 448 * 1024, frameBytes: 16384 };
const sessionIdPattern = /^[A-Za-z0-9_-]{36}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const responseInstant = value => typeof value === "string"
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  && Number.isFinite(Date.parse(value));

export const options = {
  scenarios: {
    resource_abuse: { executor: "ramping-vus", exec: "resourceAbuse", startVUs: 0, stages: policy.stages },
    competing_occupancy: raceScenario("competingOccupancyRace"),
    duplicate_delivery: raceScenario("duplicateDeliveryRace"),
    participant_capacity: raceScenario("participantCapacityRace"),
    address_pressure: { executor: "constant-arrival-rate", exec: "addressPressure", rate: policy.addressPressure.rate,
      timeUnit: "1s", duration: `${policy.addressPressure.durationSeconds}s`,
      startTime: `${policy.addressPressure.startSeconds}s`, preAllocatedVUs: policy.addressPressure.preAllocatedVUs,
      maxVUs: policy.addressPressure.maxVUs },
    series_pressure: { executor: "constant-vus", exec: "seriesPressure", vus: policy.seriesPressure.vus,
      startTime: `${policy.seriesPressure.startSeconds}s`, duration: `${policy.seriesPressure.durationSeconds}s` },
    preview_mutation: { executor: "shared-iterations", exec: "previewMutation", vus: 1, iterations: 1,
      startTime: "1s", maxDuration: "15s" },
    request_body: { executor: "shared-iterations", exec: "requestBodyLimit", vus: 1, iterations: 1,
      startTime: "2s", maxDuration: "10s" }
  },
  gracefulStop: "2s",
  noCookiesReset: true,
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate<0.02"]
  }
};

function raceScenario(exec) {
  const { racers, rounds, tickSeconds } = policy.integrity;
  return { executor: "per-vu-iterations", exec, vus: racers, iterations: rounds,
    startTime: `${policy.warmupSeconds}s`, maxDuration: `${rounds * tickSeconds + 10}s` };
}

export function setup() {
  const slotPlan = resourceSlotPlan(__ENV.COURTSIDE_SECURITY_DATE_PLAN);
  const clock = slotPlan.clock;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(runId)) throw new Error("Invalid resource journal run identity");
  emitJournal({ event: "start", runId, clock: new Date(clock).toISOString() });
  const sessions = {};
  for (const name of sessionNames) {
    sessions[name] = signIn();
    if (!sessions[name]) throw new Error("Resource booking setup incomplete");
  }
  Object.assign(sessionCookies, sessions.occupancy.cookies);
  token = sessions.occupancy.token;
  loadBookingInputs();
  if (![courtId, bookingCardId, participantCardId, personId].every(Boolean)) {
    throw new Error("Resource booking setup incomplete");
  }
  return { clock, slotPlan, attackStartsAt: Date.now() + policy.warmupSeconds * 1000, sessions,
    fixtures: { courtId, bookingCardId, participantCardId, personId } };
}

function useSetupSession(run, sessionName) {
  runSlots = run.slotPlan;
  if (!sessionName || boundScenario === exec.scenario.name) return;
  const session = run.sessions?.[sessionName];
  const fixtures = run.fixtures;
  if (session?.username !== "security.manager.1" || typeof session.token !== "string" || !session.token
      || !decodedSessionId(session.cookies?.["__Host-SESSION"])
      || !fixtures || ![fixtures.courtId, fixtures.bookingCardId, fixtures.participantCardId, fixtures.personId].every(Boolean)) {
    throw new Error("Resource booking setup incomplete");
  }
  for (const name of Object.keys(sessionCookies)) delete sessionCookies[name];
  Object.assign(sessionCookies, session.cookies);
  token = session.token;
  actorUsername = session.username;
  ({ courtId, bookingCardId, participantCardId, personId } = fixtures);
  boundScenario = exec.scenario.name;
}

function emitJournal(frame) {
  const message = journalMarker + JSON.stringify(frame);
  const bytes = encodeURIComponent(message).replace(/%[A-F\d]{2}/g, "x").length + 1;
  if (bytes > journalVuLimits.frameBytes || journalBytes + bytes > journalVuLimits.bytes) {
    journalDropped.add(1);
    return;
  }
  journalBytes += bytes;
  console.log(message);
}

function responseJson(response) {
  try { return response.json(); } catch { return null; }
}

function decodedSessionId(value) {
  if (typeof value !== "string") return null;
  try {
    const id = encoding.b64decode(value, "std", "s");
    return sessionIdPattern.test(id) ? id : null;
  } catch { return null; }
}

function normalizedBooking(body, parameters) {
  const request = JSON.parse(body);
  return { courtIds: request.courtIds, cardId: request.cardId,
    startsAt: request.startsAt, endsAt: request.endsAt, note: request.note ?? null,
    participants: (request.participants ?? []).map(participant => ({
      kind: participant.personId != null ? "MEMBER" : participant.cardId != null ? "CARD" : "GUEST",
      personId: participant.personId ?? null, guestName: participant.guestName ?? null, cardId: participant.cardId ?? null
    })), idempotencyKey: parameters?.headers?.["Idempotency-Key"] ?? null };
}

function journalRequest(method, url, body, parameters) {
  const path = url.slice(target.length);
  const gatewayBodyProbe = method === "POST" && path === "/api/session" && typeof body === "string"
    && body.length === 2_000_001 && /^x+$/.test(body)
    && parameters?.headers?.["Content-Type"] === "application/x-www-form-urlencoded";
  const kind = gatewayBodyProbe ? "gatewayRejectedBody" : method === "POST" && path === "/api/session" ? "login"
    : path === "/api/bookings" ? "createBooking"
    : path === "/api/booking-series-preview" ? "previewSeries"
    : path === "/api/booking-series" ? "createSeries" : "read";
  const username = kind === "login" ? /^username=(security\.(?:manager|member)\.[1-3])&/.exec(body)?.[1] ?? null : null;
  const request = gatewayBodyProbe ? { bodyBytes: body.length, contentType: parameters.headers["Content-Type"] }
    : kind === "createBooking" ? normalizedBooking(body, parameters)
    : kind === "login" ? { username }
    : ["previewSeries", "createSeries"].includes(kind) ? JSON.parse(body) : null;
  const sequence = ++journalSequence;
  const id = `${__VU}:${sequence}`;
  journalStarted.add(1);
  if (sequence <= journalVuLimits.operations) emitJournal({ event: "begin", id, vu: __VU, sequence, kind,
    startedAt: new Date(Date.now()).toISOString(), method, path,
    actorUsername: kind === "login" ? null : actorUsername, request,
    ...(kind === "createSeries" && seriesOperationRefs ? seriesOperationRefs : {}) });
  else journalDropped.add(1);
  const sendingParameters = gatewayBodyProbe ? { ...parameters,
    headers: { ...parameters.headers, "X-Courtside-Journal-Operation": id } } : parameters;
  const response = method === "GET" ? http.get(url, sendingParameters) : http.post(url, body, sendingParameters);
  const endedAt = new Date(Date.now()).toISOString();
  const result = response.status === 429 || ["createBooking", "createSeries", "previewSeries"].includes(kind) || method === "GET" && path === "/api/session"
    ? responseJson(response) : null;
  const identityUsername = method === "GET" && path === "/api/session" && response.status === 200
    && result?.authenticated === true && /^security\.(?:manager|member)\.[1-3]$/.test(result.username)
    ? result.username : null;
  if (identityUsername) actorUsername = identityUsername;
  if (kind === "login" && username === "security.manager.1") actorUsername = null;
  const sessionId = decodedSessionId(/(?:^|; )__Host-SESSION=([^;]+)/.exec(parameters?.headers?.Cookie ?? "")?.[1]);
  const responseSessionId = decodedSessionId(response.cookies?.["__Host-SESSION"]?.at(-1)?.value);
  const frame = { event: "end", id, status: response.status, endedAt,
    responseBookingId: kind === "createBooking" && response.status === 201 && uuidPattern.test(result?.id) ? result.id : null,
    identityUsername, sessionId, responseSessionId,
    ownedSessionIds: [...new Set([sessionId, responseSessionId].filter(Boolean))] };
  if (response.status === 429) {
    const retry = response.headers?.["Retry-After"];
    frame.problemType = typeof result?.type === "string" && /^urn:courtside:error:[a-z0-9-]{1,80}$/.test(result.type) ? result.type : null;
    frame.retryAfterSeconds = typeof retry === "string" && /^\d{1,9}$/.test(retry) && Number.isSafeInteger(Number(retry)) ? Number(retry) : null;
  }
  if (kind === "previewSeries" && response.status === 200 && request.occurrenceCount === 1) {
    const occurrences = result?.occurrences;
    frame.previewResult = Array.isArray(occurrences) && occurrences.length <= 200
      && occurrences.every(value => responseInstant(value?.startsAt) && responseInstant(value?.endsAt)
        && typeof value.creatable === "boolean" && Array.isArray(value.blockedCourtIds)
        && value.blockedCourtIds.length <= 32 && value.blockedCourtIds.every(id => uuidPattern.test(id))
        && Array.isArray(value.violations) && value.violations.length === 0)
      ? { occurrences: occurrences.map(({ startsAt, endsAt, creatable, blockedCourtIds, violations }) =>
        ({ startsAt, endsAt, creatable, blockedCourtIds, violations })) } : null;
  }
  if (kind === "createSeries" && response.status >= 200 && response.status < 300 && result) {
    frame.seriesResult = Object.keys(result).length === 3 && ["seriesId", "bookingIds", "skipped"].every(key => Object.hasOwn(result, key))
      && (result.seriesId === null || uuidPattern.test(result.seriesId))
      && Array.isArray(result.bookingIds) && result.bookingIds.length <= 200 && result.bookingIds.every(id => uuidPattern.test(id))
      && Array.isArray(result.skipped) && result.skipped.length <= 200 && result.skipped.every(responseInstant)
      ? { seriesId: result.seriesId, bookingIds: result.bookingIds, skipped: result.skipped } : null;
  }
  journalFinished.add(1);
  if (sequence <= journalVuLimits.operations) emitJournal(frame);
  else journalDropped.add(1);
  lastJournalOperationId = id;
  return response;
}

function journalGet(url, parameters) {
  return journalRequest("GET", url, null, parameters);
}

function journalPost(url, body, parameters) {
  return journalRequest("POST", url, body, parameters);
}

function csrf(response) {
  captureCookies(response, sessionCookies);
  const cookie = sessionCookies["__Host-XSRF-TOKEN"];
  if (cookie) token = decodeURIComponent(cookie);
  return token;
}

function captureCookies(response, targetCookies) {
  for (const [name, values] of Object.entries(response.cookies ?? {})) {
    const value = values.at(-1)?.value;
    if (value) targetCookies[name] = value;
  }
}

function cookieHeader(cookies = sessionCookies) {
  return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ");
}

function signIn() {
  const jar = new http.CookieJar();
  for (const name of Object.keys(sessionCookies)) delete sessionCookies[name];
  token = undefined;
  csrf(journalGet(`${target}/api/session`, { jar }));
  const response = journalPost(`${target}/api/session`,
    `username=security.manager.1&password=${encodeURIComponent(password)}`, {
      jar, headers: { "Content-Type": "application/x-www-form-urlencoded", "X-XSRF-TOKEN": token,
        Cookie: cookieHeader() }
    });
  if (response.status === 429) rateLimitedLogins.add(1);
  captureCookies(response, sessionCookies);
  if (!check(response, { "synthetic member authenticates": (value) => value.status === 200 })) return null;
  csrf(journalGet(`${target}/api/session`, { jar, headers: { Cookie: cookieHeader() } }));
  if (actorUsername !== "security.manager.1" || !token || !decodedSessionId(sessionCookies["__Host-SESSION"])) return null;
  return { cookies: { ...sessionCookies }, token, username: actorUsername };
}

function typedAdmissionRefusal(response) {
  const retryAfter = Number(response.headers?.["Retry-After"]);
  return response.status === 429 && admissionProblemTypes.includes(responseJson(response)?.type)
    && Number.isSafeInteger(retryAfter) && retryAfter >= 1;
}

function refusedIntegrityRequest(response) {
  if (!typedAdmissionRefusal(response)) return false;
  integrityAdmissionRefusals.add(1);
  return true;
}

function awaitTick() {
  const tick = policy.integrity.tickSeconds * 1000;
  sleep((tick - (Date.now() % tick)) / 1000);
}

function loadBookingInputs() {
  if (courtId && bookingCardId && participantCardId && personId) return;
  const headers = { Cookie: cookieHeader() };
  const courts = journalGet(`${target}/api/public/courts`, { headers });
  const cards = journalGet(`${target}/api/public/booking-cards`, { headers });
  const participantCards = journalGet(`${target}/api/public/participant-cards`, { headers });
  const members = journalPost(`${target}/api/public/participant-members`,
    JSON.stringify({ query: "Member2" }),
    { headers: { ...headers, "Content-Type": "application/json", "X-XSRF-TOKEN": token } });
  courtId = courts.json()?.[0]?.id;
  bookingCardId = cards.json()?.find((card) => card.id === memberCardId)?.id;
  participantCardId = participantCards.json()?.find((card) => card.label === "Limited assessment card")?.id;
  personId = members.json()?.[0]?.personId;
}

function scenarioFixturesReady(scenarioId, fixturesReady) {
  const ready = boundScenario !== null && fixturesReady();
  check(null, { [`${scenarioId}:fixtures-ready`]: () => ready });
  return ready;
}

function resourceSlotPlan(raw) {
  const fail = () => { throw new Error("Invalid resource slot plan"); };
  if (typeof raw !== "string" || raw.length > 8192) fail();
  let plan;
  try { plan = JSON.parse(raw); } catch { fail(); }
  const exact = (value, fields) => value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
  const iso = value => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  const localDate = value => typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  if (!exact(plan, ["clock", "timeZone", "slots", "seriesStartsOn"])
      || !Number.isSafeInteger(plan.clock) || plan.clock <= 0 || !Number.isFinite(new Date(plan.clock).getTime())
      || typeof plan.timeZone !== "string" || !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(plan.timeZone)
      || plan.timeZone.length > 128 || !exact(plan.slots, ["3", "4", "5", "6"])
      || !localDate(plan.seriesStartsOn)) fail();
  const names = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  for (const slot of Object.values(plan.slots)) {
    if (!exact(slot, ["startsAt", "endsAt", "startsOn", "startTime", "weekday"])
        || !iso(slot.startsAt) || !iso(slot.endsAt) || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(slot.startTime)
        || !localDate(slot.startsOn)) fail();
    const start = Date.parse(slot.startsAt);
    const local = new Date(`${slot.startsOn}T${slot.startTime}.000Z`);
    if (Date.parse(slot.endsAt) - start !== 3600000 || start <= plan.clock
        || start - plan.clock > 8 * 86400000
        || Math.abs(local.getTime() - start) > 14 * 3600000
        || names[local.getUTCDay()] !== slot.weekday) fail();
  }
  if (new Set(Object.values(plan.slots).map(slot => slot.startsAt)).size !== 4) fail();
  return plan;
}

function futureSlot(dayOffset) {
  const { startsAt, endsAt } = runSlots.slots[String(dayOffset)];
  return { startsAt, endsAt };
}

function failedLogin() {
  if (!failedToken) {
    failedCookieJar = new http.CookieJar();
    const session = journalGet(`${target}/api/session`, { jar: failedCookieJar });
    captureCookies(session, failedSessionCookies);
    failedToken = decodeURIComponent(failedSessionCookies["__Host-XSRF-TOKEN"]);
  }
  const response = journalPost(`${target}/api/session`,
    `username=security.member.${(__VU % 3) + 1}&password=${encodeURIComponent(`${password}-wrong`)}`, {
      jar: failedCookieJar,
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-XSRF-TOKEN": failedToken,
        Cookie: cookieHeader(failedSessionCookies) },
      responseCallback: http.expectedStatuses(401, 429)
    });
  captureCookies(response, failedSessionCookies);
  if (response.status === 429) rateLimitedLogins.add(1);
  const retryAfter = Number(response.headers?.["Retry-After"]);
  const typedFailure = (value) => value.status === 401
      && responseJson(value)?.type === "urn:courtside:error:unauthenticated"
    || value.status === 429 && responseJson(value)?.type === "urn:courtside:error:login-rate-limited"
      && Number.isSafeInteger(retryAfter) && retryAfter >= 1;
  check(response, {
    "argon2-login-pressure:failed-login-rejected": typedFailure,
    "login-rate-limit-boundary:failed-login-bounded": typedFailure
  });
}

function oversizedBody() {
  const response = journalPost(`${target}/api/session`, "x".repeat(2_000_001), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    responseCallback: http.expectedStatuses(0, 413)
  });
  check(response, { "request-body-limit:gateway-rejects-oversized-body": (value) => [0, 413].includes(value.status) });
  const recovery = journalGet(`${target}/api/public/booking-grid`, { responseCallback: http.expectedStatuses(200, 429) });
  check(recovery, { "request-body-limit:gateway-remains-available": (value) => value.status === 200
      || typedAdmissionRefusal(value) });
}

export function addressPressure() {
  const response = http.get(`${target}/api/public/booking-grid`, { jar: new http.CookieJar(),
    responseCallback: http.expectedStatuses(200, 429) });
  if (typedAdmissionRefusal(response) && responseJson(response)?.type === "urn:courtside:error:request-rate-limited") {
    addressAdmissionRefusals.add(1);
  }
  check(response, { "admission-pressure:answered-or-typed-refusal": (value) => value.status === 200
      || typedAdmissionRefusal(value) });
}

function competingOccupancy() {
  if (!scenarioFixturesReady("competing-court-occupancy", () => Boolean(courtId && bookingCardId && personId))) return;
  const response = journalPost(`${target}/api/bookings`, JSON.stringify({
    courtIds: [courtId], cardId: bookingCardId, ...futureSlot(3, 16),
    note: `Security occupancy ${runId}`, participants: [{ guestName: "Security Guest" }]
  }), {
    headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token, Cookie: cookieHeader(),
      "Idempotency-Key": `security-${runId}-${__VU}-${__ITER}` },
    responseCallback: http.expectedStatuses(201, 409, 422, 429)
  });
  if (refusedIntegrityRequest(response)) return;
  if (response.status === 201) successfulOccupancy.add(1);
  else if ([409, 422].includes(response.status)) rejectedOccupancy.add(1);
  else partialOperations.add(1);
  const isSerialized = (value) => value.status === 201
    || value.status === 409 && value.json("type") === "urn:courtside:error:court-unavailable"
    || value.status === 422 && value.json("type") === "urn:courtside:error:booking-rules-violated";
  check(response, { "competing-court-occupancy:serialized": isSerialized });
}

function duplicateDelivery() {
  if (!scenarioFixturesReady("duplicate-delivery", () => Boolean(courtId && bookingCardId && personId))) return;
  const response = journalPost(`${target}/api/bookings`, JSON.stringify({
    courtIds: [courtId], cardId: bookingCardId, ...futureSlot(5, 16),
    note: `Security duplicate ${runId}`, participants: [{ guestName: "Security Guest" }]
  }), {
    headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token, Cookie: cookieHeader(),
      "Idempotency-Key": `security-${runId}-duplicate` },
    responseCallback: http.expectedStatuses(201, 429)
  });
  if (refusedIntegrityRequest(response)) return;
  if (response.status === 201 && response.json("id")) duplicateResponses.add(1);
  else duplicateFailures.add(1);
  check(response, { "duplicate-delivery:replay-returns-original": (value) => value.status === 201
      && Boolean(value.json("id")) });
}

function participantCapacity() {
  if (!scenarioFixturesReady("participant-capacity",
    () => Boolean(courtId && bookingCardId && participantCardId && personId))) return;
  const response = journalPost(`${target}/api/bookings`, JSON.stringify({
    courtIds: [courtId], cardId: bookingCardId, ...futureSlot(4, 16),
    participants: [{ personId }, { cardId: participantCardId }, { cardId: participantCardId }]
  }), {
    headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token, Cookie: cookieHeader(),
      "Idempotency-Key": `security-capacity-${runId}-${__VU}-${__ITER}` },
    responseCallback: http.expectedStatuses(400, 409, 422, 429)
  });
  if (refusedIntegrityRequest(response)) return;
  check(response, { "participant-capacity:card-unavailable": (value) => value.status === 400
      && value.json("type") === "urn:courtside:error:participants-invalid"
      && value.json("violations")?.some(({ code }) => code === "booking.participants.cardUnavailable") === true });
}

function seriesAndRuleCost() {
  if (!scenarioFixturesReady("series-and-rule-cost", () => Boolean(courtId))) return;
  const startsOn = runSlots.seriesStartsOn;
  const response = journalPost(`${target}/api/booking-series-preview`, JSON.stringify({
    courtIds: [courtId], cardId: seriesCardId, startsOn, startTime: "18:00:00",
    durationMinutes: 60, intervalWeeks: 1,
    weekdays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
    occurrenceCount: 200
  }), { headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token,
    Cookie: cookieHeader() }, responseCallback: http.expectedStatuses(200, 429) });
  if (typedAdmissionRefusal(response)) pressureAdmissionRefusals.add(1);
  check(response, { "series-and-rule-cost:maximum-preview-controlled": (value) => value.status === 200
      || typedAdmissionRefusal(value) });
}

function previewMutationRace() {
  if (!scenarioFixturesReady("preview-mutation-race", () => Boolean(courtId))) return;
  const slot = runSlots.slots["6"];
  const weekday = slot.weekday;
  const series = {
    courtIds: [courtId], cardId: seriesCardId, startsOn: slot.startsOn,
    startTime: slot.startTime, durationMinutes: 60, intervalWeeks: 1, weekdays: [weekday],
    occurrenceCount: 1, note: `Security TOCTOU ${runId}`
  };
  const preview = journalPost(`${target}/api/booking-series-preview`, JSON.stringify(series), {
    headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token, Cookie: cookieHeader() },
    responseCallback: http.expectedStatuses(200, 429)
  });
  if (refusedIntegrityRequest(preview)) return;
  const previewOperationId = lastJournalOperationId;
  const confirmedStart = preview.json("occurrences.0.startsAt");
  check(preview, { "preview-mutation-race:preview-is-creatable": (value) => value.status === 200
      && value.json("occurrences.0.creatable") === true && Boolean(confirmedStart) });
  if (!confirmedStart) return;
  const competitor = journalPost(`${target}/api/bookings`, JSON.stringify({
    courtIds: [courtId], cardId: seriesCardId, startsAt: confirmedStart,
    endsAt: preview.json("occurrences.0.endsAt"), note: `Security TOCTOU occupancy ${runId}`,
  }), {
    headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token, Cookie: cookieHeader(),
      "Idempotency-Key": `security-${runId}-toctou` },
    responseCallback: http.expectedStatuses(201, 409, 422, 429)
  });
  if (refusedIntegrityRequest(competitor)) return;
  const winnerOperationId = lastJournalOperationId;
  seriesOperationRefs = { previewOperationId, winnerOperationId };
  const mutation = competitor.status === 201
    ? journalPost(`${target}/api/booking-series`, JSON.stringify({ ...series, confirmedStarts: [confirmedStart] }), {
      headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token, Cookie: cookieHeader() },
      responseCallback: http.expectedStatuses(200, 201, 409, 422, 429)
    }) : null;
  seriesOperationRefs = null;
  if (mutation && refusedIntegrityRequest(mutation)) return;
  const created = mutation?.json("bookingIds")?.length ?? 0;
  const skipped = mutation?.json("skipped")?.length ?? 0;
  if (created) toctouCreated.add(created);
  if (skipped) toctouSkipped.add(skipped);
  check(mutation, { "preview-mutation-race:stale-preview-fails-closed": (value) => competitor.status === 201
      && value?.status === 200 && value.json("seriesId") === null && created === 0 && skipped === 1
      && Date.parse(value.json("skipped.0")) === Date.parse(confirmedStart) });
}

export function resourceAbuse(run) {
  useSetupSession(run, null);
  failedLogin();
  sleep(Date.now() < run.attackStartsAt ? 1 : 0.2);
}

export function competingOccupancyRace(run) {
  useSetupSession(run, "occupancy");
  awaitTick();
  competingOccupancy();
}

export function duplicateDeliveryRace(run) {
  useSetupSession(run, "duplicate");
  awaitTick();
  duplicateDelivery();
}

export function participantCapacityRace(run) {
  useSetupSession(run, "capacity");
  awaitTick();
  participantCapacity();
}

export function seriesPressure(run) {
  useSetupSession(run, "pressure");
  seriesAndRuleCost();
  sleep(0.2);
}

export function previewMutation(run) {
  useSetupSession(run, "toctou");
  previewMutationRace();
}

export function requestBodyLimit() {
  oversizedBody();
}

export function handleSummary(data) {
  emitJournal({ event: "finish", runId,
    started: data.metrics.journal_started?.values.count ?? 0,
    finished: data.metrics.journal_finished?.values.count ?? 0,
    dropped: data.metrics.journal_dropped?.values.count ?? 0 });
  const collectChecks = (group) => [
    ...(group.checks ?? []).map(({ name, passes, fails }) => ({ name, passes, fails })),
    ...(group.groups ?? []).flatMap(collectChecks)
  ];
  return {
    "/results/summary.json": JSON.stringify({
      metrics: data.metrics,
      checks: collectChecks(data.root_group),
      successfulOccupancy: data.metrics.successful_occupancy?.values.count ?? 0,
      rejectedOccupancy: data.metrics.rejected_occupancy?.values.count ?? 0,
      partialOperations: data.metrics.partial_operations?.values.count ?? 0,
      rateLimitedLogins: data.metrics.rate_limited_logins?.values.count ?? 0,
      integrityAdmissionRefusals: data.metrics.integrity_admission_refusals?.values.count ?? 0,
      pressureAdmissionRefusals: data.metrics.pressure_admission_refusals?.values.count ?? 0,
      addressAdmissionRefusals: data.metrics.address_admission_refusals?.values.count ?? 0,
      duplicateResponses: data.metrics.duplicate_responses?.values.count ?? 0,
      duplicateFailures: data.metrics.duplicate_failures?.values.count ?? 0,
      toctouCreated: data.metrics.toctou_created?.values.count ?? 0,
      toctouSkipped: data.metrics.toctou_skipped?.values.count ?? 0
    })
  };
}
