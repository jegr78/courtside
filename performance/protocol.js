import http from "k6/http";
import { check, group, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const contract = JSON.parse(open("/scripts/contract.json"));
const credentials = JSON.parse(open("/run/courtside/perf.json"));
const profileName = __ENV.PERF_PROFILE;
const runId = __ENV.PERF_RUN_ID;
const profile = contract.profiles[profileName];
const workload = contract.workloads[profile.workload];
const target = __ENV.PERF_TARGET;
const bookingConflicts = new Counter("booking_conflicts");
const bookingConflictRate = new Rate("booking_conflict_rate");
const unexpectedServerErrors = new Counter("unexpected_server_errors");
const technicalErrors = new Rate("technical_errors");
const readLatency = new Trend("read_only_api_duration", true);
const loginLatency = new Trend("login_duration", true);
const bookingLatency = new Trend("booking_duration", true);
const contentionLatency = new Trend("booking_contention_duration", true);
const cancellationLatency = new Trend("cancellation_duration", true);

export const options = {
  noCookiesReset: true,
  ...(profile.stages ? { stages: profile.stages } : { vus: profile.virtualUsers, duration: profile.duration }),
  thresholds: {
    technical_errors: [contract.thresholds.technicalErrorRate],
    unexpected_server_errors: [contract.thresholds.unexpectedServerErrors],
    ...(profileName === "smoke" ? {} : {
      read_only_api_duration: [
        `p(95)<${contract.thresholds.readOnlyApi.p95Milliseconds}`,
        `p(99)<${contract.thresholds.readOnlyApi.p99Milliseconds}`
      ],
      login_duration: [`p(95)<${contract.thresholds.login.p95Milliseconds}`],
      booking_duration: [
        `p(95)<${contract.thresholds.booking.p95Milliseconds}`,
        `p(99)<${contract.thresholds.booking.p99Milliseconds}`
      ]
    })
  }
};

let authenticated = false;
let csrf;
let bookingCardId;
let courtIds;
const reportedFailures = {};

function username() {
  return `member${String(__VU).padStart(4, "0")}`;
}

function csrfToken(response) {
  const token = response?.cookies?.["XSRF-TOKEN"]?.findLast(cookie => cookie.value)?.value;
  if (token) csrf = decodeURIComponent(token);
  const cookie = http.cookieJar().cookiesForURL(target)["XSRF-TOKEN"]?.[0];
  return cookie ? decodeURIComponent(cookie) : csrf;
}

function record(response, expectedStatuses, metric) {
  metric?.add(response.timings.duration);
  const expected = expectedStatuses.includes(response.status);
  const serverError = response.status >= 500;
  unexpectedServerErrors.add(serverError ? 1 : 0);
  technicalErrors.add(!expected || serverError);
  const requestPath = response.request.url.replace(target, "").split("?")[0];
  const requestKey = `${response.request.method} ${requestPath}`;
  check(response, { [`${requestKey} status ${expectedStatuses.join(" or ")}`]: () => expected });
  if (!expected && !reportedFailures[requestKey]) {
    reportedFailures[requestKey] = true;
    console.error(`${requestKey} returned unexpected status ${response.status}`);
  }
  return expected;
}

function authenticate() {
  if (authenticated) return;
  group("login", () => {
    const initial = http.get(`${target}/api/session`, { tags: { journey: "login-setup" } });
    record(initial, [200]);
    const token = csrfToken(initial);
    const body = `username=${encodeURIComponent(username())}&password=${encodeURIComponent(credentials.password)}`;
    const response = http.post(`${target}/api/session`, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-XSRF-TOKEN": token },
      tags: { journey: "login" }
    });
    record(response, [200], loginLatency);
    authenticated = response.status === 200;
    if (authenticated) {
      const refreshed = http.get(`${target}/api/session`, { tags: { journey: "login-setup" } });
      record(refreshed, [200]);
      csrfToken(refreshed);
    }
  });
}

function readJourneys() {
  group("read", () => {
    record(http.get(`${target}/api/public/config`, { tags: { journey: "read" } }), [200], readLatency);
    record(http.get(`${target}/api/public/booking-grid`, { tags: { journey: "read" } }), [200], readLatency);
    const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    record(http.get(`${target}/api/bookings?date=${date}`, { tags: { journey: "read" } }), [200], readLatency);
  });
}

function loadBookingInputs() {
  if (bookingCardId && courtIds) return true;
  const cards = http.get(`${target}/api/public/booking-cards`, { tags: { journey: "booking-setup" } });
  const courts = http.get(`${target}/api/public/courts`, { tags: { journey: "booking-setup" } });
  if (!record(cards, [200]) || !record(courts, [200])) return false;
  bookingCardId = cards.json()[0]?.id;
  courtIds = courts.json().map(court => court.id);
  return Boolean(bookingCardId && courtIds.length);
}

function slot(dayOffset, hour) {
  const start = new Date(Date.now() + dayOffset * 86_400_000);
  start.setUTCHours(hour, 0, 0, 0);
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString() };
}

function normalBookingSlot() {
  const hours = [10, 11, 12, 13, 14, 15, 18, 19];
  const index = __VU - 1;
  return slot(2 + Math.floor(index / (hours.length * 8)), hours[Math.floor(index / 8) % hours.length]);
}

function isContentionIteration() {
  return __ITER === 0 && __VU <= workload.contentionVirtualUsers;
}

function writeJourney() {
  if (!loadBookingInputs()) return;
  group("booking", () => {
    const contention = isContentionIteration();
    const bookingSlot = contention ? slot(1, 14) : normalBookingSlot();
    const response = http.post(`${target}/api/bookings`, JSON.stringify({
      courtIds: [contention ? courtIds[0] : courtIds[(__VU - 1) % courtIds.length]],
      cardId: bookingCardId,
      ...bookingSlot,
      participants: [{ guestName: "Load Test Guest" }]
    }), {
      headers: {
        "Content-Type": "application/json",
        "X-XSRF-TOKEN": csrfToken(),
        "Idempotency-Key": `k6-${runId}-${__VU}-${__ITER}`
      },
      tags: { journey: "booking" }
    });
    if (response.status === 409 && response.json("type") === "urn:courtside:error:court-unavailable") {
      contentionLatency.add(response.timings.duration);
      bookingConflicts.add(1);
      bookingConflictRate.add(true);
      record(response, [409]);
      return;
    }
    bookingConflictRate.add(false);
    (contention ? contentionLatency : bookingLatency).add(response.timings.duration);
    if (!record(response, [201])) return;
    const bookingId = response.json().id;
    const cancellation = http.del(`${target}/api/bookings/${bookingId}`, null, {
      headers: { "X-XSRF-TOKEN": csrfToken() }, tags: { journey: "cancellation" }
    });
    record(cancellation, [204], cancellationLatency);
  });
}

export default function () {
  authenticate();
  if (!authenticated) {
    sleep(1);
    return;
  }
  if (isContentionIteration() || (__ITER % 10) / 10 < workload.writeShare) writeJourney();
  else readJourneys();
  sleep(1);
}

export function handleSummary(data) {
  return { "/results/raw-summary.json": JSON.stringify(data, null, 2) };
}
