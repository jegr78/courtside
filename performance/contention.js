import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const contract = JSON.parse(open("/scripts/contract.json"));
const credentials = JSON.parse(open("/run/courtside/perf.json"));
const profile = contract.profiles.contention;
const target = __ENV.PERF_TARGET;
const bookingStatuses = http.expectedStatuses(201, 409);
const attempts = new Counter("contention_attempts");
const creations = new Counter("booking_creations");
const conflicts = new Counter("booking_conflicts");
const cancellations = new Counter("booking_cancellations");
const conflictRate = new Rate("booking_conflict_rate");
const technicalErrors = new Rate("technical_errors");
const serverErrors = new Counter("unexpected_server_errors");
const latency = new Trend("booking_contention_duration", true);

export const options = {
  setupTimeout: profile.setupTimeout,
  systemTags: ["proto", "status", "method", "name", "group", "check", "error_code", "tls_version", "scenario", "expected_response"],
  scenarios: {
    contention: {
      executor: "per-vu-iterations", vus: profile.virtualUsers, iterations: 1,
      maxDuration: profile.scenarioDuration, gracefulStop: "0s"
    }
  },
  thresholds: {
    technical_errors: [contract.thresholds.technicalErrorRate],
    unexpected_server_errors: [contract.thresholds.unexpectedServerErrors],
    contention_attempts: [`count==${profile.virtualUsers}`],
    booking_creations: ["count==1"],
    booking_conflicts: [`count==${profile.virtualUsers - 1}`],
    booking_cancellations: ["count==1"],
    booking_contention_duration: [
      `p(95)<${contract.thresholds.booking.p95Milliseconds}`,
      `p(99)<${contract.thresholds.booking.p99Milliseconds}`
    ]
  }
};

function parameters(name, account) {
  return {
    timeout: "10s", tags: { name, journey: "contention" },
    ...(account ? { cookies: account.cookies, headers: { "X-XSRF-TOKEN": account.csrf } } : {})
  };
}

function record(response, name, expected) {
  technicalErrors.add(!expected);
  serverErrors.add(response.status >= 500 ? 1 : 0);
  check(response, { [`${name} expected outcome`]: () => expected });
  return expected;
}

function requireSuccess(response, name) {
  if (!record(response, name, response.status === 200)) throw new Error(`${name} failed with status ${response.status}`);
  return response;
}

export function setup() {
  const identity = requireSuccess(http.get(`${target}/api/source`, parameters("GET /api/source")), "GET /api/source");
  if (identity.json("environment") !== "PERFORMANCE") throw new Error("Contention requires a disposable PERFORMANCE environment");
  const accounts = [];
  const jar = http.cookieJar();
  for (let member = 1; member <= profile.virtualUsers; member++) {
    jar.clear(target);
    requireSuccess(http.get(`${target}/api/session`, parameters("GET /api/session")), "GET /api/session");
    const csrf = decodeURIComponent(jar.cookiesForURL(target)["__Host-XSRF-TOKEN"]?.[0] ?? "");
    const body = `username=member${String(member).padStart(4, "0")}&password=${encodeURIComponent(credentials.password)}`;
    requireSuccess(http.post(`${target}/api/session`, body, {
      ...parameters("POST /api/session"),
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-XSRF-TOKEN": csrf }
    }), "POST /api/session");
    requireSuccess(http.get(`${target}/api/session`, parameters("GET /api/session")), "GET /api/session");
    const cookies = Object.fromEntries(Object.entries(jar.cookiesForURL(target)).map(([name, values]) => [name, values[0]]));
    accounts.push({ cookies, csrf: decodeURIComponent(cookies["__Host-XSRF-TOKEN"] ?? "") });
  }
  const cards = requireSuccess(http.get(`${target}/api/public/booking-cards`, parameters("GET /api/public/booking-cards")), "GET /api/public/booking-cards").json();
  const courts = requireSuccess(http.get(`${target}/api/public/courts`, parameters("GET /api/public/courts")), "GET /api/public/courts").json();
  if (!cards[0]?.id || !courts[0]?.id) throw new Error("Contention requires seeded booking cards and courts");
  const start = new Date(Date.now() + 86_400_000);
  start.setUTCHours(14, 0, 0, 0);
  return { accounts, booking: {
    courtIds: [courts[0].id], cardId: cards[0].id,
    startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString(),
    participants: [{ guestName: "Load Test Guest" }]
  } };
}

export default function (data) {
  const account = data.accounts[__VU - 1];
  attempts.add(1);
  const response = http.post(`${target}/api/bookings`, JSON.stringify(data.booking), {
    ...parameters("POST /api/bookings", account),
    responseCallback: bookingStatuses,
    headers: { "Content-Type": "application/json", "X-XSRF-TOKEN": account.csrf,
      "Idempotency-Key": `k6-${__ENV.PERF_RUN_ID}-contention-${__VU}` }
  });
  const conflict = response.status === 409 && response.json("type") === "urn:courtside:error:court-unavailable";
  const created = response.status === 201;
  conflicts.add(conflict ? 1 : 0);
  creations.add(created ? 1 : 0);
  conflictRate.add(conflict);
  latency.add(response.timings.duration);
  record(response, "POST /api/bookings", conflict || created);
  if (!created) return;
  const bookingId = response.json("id");
  if (!bookingId) throw new Error("The contention winner returned no booking ID");
  sleep(profile.bookingHoldSeconds);
  const cancellation = http.del(`${target}/api/bookings/${bookingId}`, null, parameters("DELETE /api/bookings/:id", account));
  cancellations.add(cancellation.status === 204 ? 1 : 0);
  record(cancellation, "DELETE /api/bookings/:id", cancellation.status === 204);
}

export function handleSummary(data) {
  return { "/results/raw-summary.json": JSON.stringify(data, null, 2) };
}
