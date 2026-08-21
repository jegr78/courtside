import http from "k6/http";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";

const policy = JSON.parse(open("/scripts/policy.json"));
const target = "http://scanner-gateway:8090";
const password = __ENV.COURTSIDE_SECURITY_SHARED_PASSWORD;
const runId = __ENV.COURTSIDE_SECURITY_RUN_ID;
const seriesCardId = "22222222-2222-2222-2222-222222222222";
const successfulOccupancy = new Counter("successful_occupancy");
const rejectedOccupancy = new Counter("rejected_occupancy");
const partialOperations = new Counter("partial_operations");
const rateLimitedLogins = new Counter("rate_limited_logins");
let authenticated = false;
let token;
let courtId;
let bookingCardId;
let participantCardId;
let personId;
const sessionCookies = {};
const failedSessionCookies = {};
let failedToken;
let bodyLimitExercised = false;

export const options = {
  stages: policy.stages,
  gracefulStop: "2s",
  noCookiesReset: true,
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate<0.02"]
  }
};

export function setup() {
  return { attackStartsAt: Date.now() + policy.warmupSeconds * 1000 };
}

function csrf(response) {
  captureCookies(response, sessionCookies);
  const cookie = sessionCookies["XSRF-TOKEN"];
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

function authenticate() {
  if (authenticated) return true;
  const session = http.get(`${target}/api/session`);
  csrf(session);
  const response = http.post(`${target}/api/session`,
    `username=security.member.2&password=${encodeURIComponent(password)}`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-XSRF-TOKEN": token,
        Cookie: cookieHeader() }
    });
  if (response.status === 429) rateLimitedLogins.add(1);
  captureCookies(response, sessionCookies);
  authenticated = check(response, { "synthetic member authenticates": (value) => value.status === 200 });
  if (authenticated) csrf(http.get(`${target}/api/session`, { headers: { Cookie: cookieHeader() } }));
  return authenticated;
}

function loadBookingInputs() {
  if (courtId && bookingCardId && participantCardId && personId) return;
  const headers = { Cookie: cookieHeader() };
  const courts = http.get(`${target}/api/public/courts`, { headers });
  const cards = http.get(`${target}/api/public/booking-cards`, { headers });
  const participantCards = http.get(`${target}/api/public/participant-cards`, { headers });
  const members = http.get(`${target}/api/public/participant-members?query=Member2`, { headers });
  courtId = courts.json()?.[0]?.id;
  bookingCardId = cards.json()?.[0]?.id;
  participantCardId = participantCards.json()?.find((card) => card.label === "Limited assessment card")?.id;
  personId = members.json()?.[0]?.personId;
}

function scenarioFixturesReady(scenarioId, fixturesReady) {
  const authenticatedSession = authenticate();
  loadBookingInputs();
  const ready = authenticatedSession && fixturesReady();
  check(null, { [`${scenarioId}:fixtures-ready`]: () => ready });
  return ready;
}

function futureSlot(dayOffset, hour) {
  const startsAt = new Date(Date.now() + dayOffset * 86_400_000);
  startsAt.setUTCHours(hour, 0, 0, 0);
  return { startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3_600_000).toISOString() };
}

function failedLogin() {
  if (!failedToken) {
    const session = http.get(`${target}/api/session`);
    captureCookies(session, failedSessionCookies);
    failedToken = decodeURIComponent(failedSessionCookies["XSRF-TOKEN"]);
  }
  const response = http.post(`${target}/api/session`,
    `username=security.member.${(__VU % 3) + 1}&password=${encodeURIComponent(`${password}-wrong`)}`, {
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-XSRF-TOKEN": failedToken,
        Cookie: cookieHeader(failedSessionCookies) },
      responseCallback: http.expectedStatuses(401, 429)
    });
  captureCookies(response, failedSessionCookies);
  check(response, {
    "argon2-login-pressure:failed-login-rejected": (value) => [401, 429].includes(value.status),
    "login-rate-limit-boundary:failed-login-bounded": (value) => [401, 429].includes(value.status)
  });
}

function oversizedBody() {
  const response = http.post(`${target}/api/session`, "x".repeat(2_000_001), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    responseCallback: http.expectedStatuses(0, 413)
  });
  check(response, { "request-body-limit:gateway-rejects-oversized-body": (value) => [0, 413].includes(value.status) });
  const recovery = http.get(`${target}/api/public/booking-grid`);
  check(recovery, { "request-body-limit:gateway-remains-available": (value) => value.status === 200 });
}

function boundedRead(path, expected = [200]) {
  const response = http.get(`${target}${path}`, { responseCallback: http.expectedStatuses(...expected) });
  check(response, { "preview-mutation-race:availability-read-bounded": (value) => expected.includes(value.status) });
}

function competingOccupancy(additionalScenarioId) {
  if (!scenarioFixturesReady("competing-court-occupancy", () => Boolean(courtId && bookingCardId))) return;
  const response = http.post(`${target}/api/bookings`, JSON.stringify({
    courtIds: [courtId], cardId: bookingCardId, ...futureSlot(3, 16),
    note: `Security occupancy ${runId}`, participants: [{ guestName: "Security Guest" }]
  }), {
    headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token, Cookie: cookieHeader(),
      "Idempotency-Key": __VU % 2 === 0 ? `security-${runId}-duplicate`
        : `security-${runId}-${__VU}-${__ITER}` },
    responseCallback: http.expectedStatuses(201, 409, 422)
  });
  if (response.status === 201) successfulOccupancy.add(1);
  else if ([409, 422].includes(response.status)) rejectedOccupancy.add(1);
  else partialOperations.add(1);
  const isSerialized = (value) => value.status === 201
    || value.status === 409 && value.json("type") === "urn:courtside:error:court-unavailable"
    || value.status === 422 && value.json("type") === "urn:courtside:error:booking-rules-violated";
  const checks = { "competing-court-occupancy:serialized": isSerialized };
  if (additionalScenarioId) checks[`${additionalScenarioId}:mutation-bounded`] = isSerialized;
  check(response, checks);
}

function participantCapacity() {
  if (!scenarioFixturesReady("participant-capacity",
    () => Boolean(courtId && bookingCardId && participantCardId && personId))) return;
  const response = http.post(`${target}/api/bookings`, JSON.stringify({
    courtIds: [courtId], cardId: bookingCardId, ...futureSlot(4, 16),
    participants: [{ personId }, { cardId: participantCardId }, { cardId: participantCardId }]
  }), {
    headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token, Cookie: cookieHeader(),
      "Idempotency-Key": `security-capacity-${runId}-${__VU}-${__ITER}` },
    responseCallback: http.expectedStatuses(400, 409, 422)
  });
  check(response, { "participant-capacity:card-unavailable": (value) => value.status === 400
      && value.json("type") === "urn:courtside:error:participants-invalid"
      && value.json("violations")?.some(({ code }) => code === "booking.participants.cardUnavailable") === true });
}

function seriesAndRuleCost() {
  if (!scenarioFixturesReady("series-and-rule-cost", () => Boolean(courtId))) return;
  const startsOn = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const response = http.post(`${target}/api/booking-series/preview`, JSON.stringify({
    courtIds: [courtId], cardId: seriesCardId, startsOn, startTime: "18:00:00",
    durationMinutes: 60, intervalWeeks: 1,
    weekdays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"],
    occurrenceCount: 200
  }), { headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": token,
    Cookie: cookieHeader() } });
  check(response, { "series-and-rule-cost:maximum-preview-controlled": (value) => value.status === 200 });
}

export default function (run) {
  if (__ITER === 0) {
    authenticate();
    loadBookingInputs();
  }
  if (Date.now() < run.attackStartsAt) {
    boundedRead("/api/public/booking-grid");
    sleep(0.1);
    return;
  }
  switch (__ITER % policy.scenarios.length) {
    case 0:
      competingOccupancy();
      break;
    case 1:
      participantCapacity();
      break;
    case 2:
      seriesAndRuleCost();
      break;
    case 3:
      boundedRead(`/api/bookings?date=${futureSlot(3, 16).startsAt.slice(0, 10)}`);
      competingOccupancy("preview-mutation-race");
      break;
    case 4:
      if (__VU === 1 && !bodyLimitExercised) {
        bodyLimitExercised = true;
        oversizedBody();
      } else boundedRead("/api/public/booking-grid");
      break;
    case 5:
    case 6:
      failedLogin();
      break;
  }
  sleep(0.1);
}

export function handleSummary(data) {
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
      rateLimitedLogins: data.metrics.rate_limited_logins?.values.count ?? 0
    })
  };
}
