import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import * as httpDiagnostics from "../performance/http-diagnostics.js";

const source = readFileSync(new URL("../performance/protocol.js", import.meta.url), "utf8");
const contract = JSON.parse(readFileSync(new URL("../performance/contract.json", import.meta.url), "utf8"));

function protocol({ loginStatuses = [200], cancellationStatus = 204, refreshStatus = 200 } = {}) {
  const requests = [];
  const checks = [];
  const logged = [];
  const metrics = new Map();
  let now = Date.UTC(2026, 0, 1);
  let bookingId = 0;
  let sessionReads = 0;
  class Metric {
    constructor(name) { this.values = []; metrics.set(name, this.values); }
    add(value) { this.values.push(value); }
  }
  class Clock extends Date {
    static now() { return now; }
  }
  function request(method, url, body, parameters) {
    requests.push({ method, url, parameters });
    now += 10;
    const path = new URL(url).pathname;
    const login = method === "POST" && path === "/api/session";
    const sessionRead = method === "GET" && path === "/api/session";
    const status = login ? loginStatuses.shift() ?? 200 : method === "POST" ? 201 : method === "DELETE" ? cancellationStatus
      : sessionRead && ++sessionReads % 2 === 0 ? refreshStatus : 200;
    const data = path.endsWith("booking-cards") ? [{ id: "card" }] : path.endsWith("courts") ? [{ id: "court" }] : { id: `booking-${++bookingId}` };
    return { status, timings: { duration: login && status === 200 ? 300 : 10 },
      request: { method, url }, cookies: {}, json: () => data };
  }
  const context = {
    http: {
      get: (url, parameters) => request("GET", url, null, parameters),
      post: (url, body, parameters) => request("POST", url, body, parameters),
      del: (url, body, parameters) => request("DELETE", url, body, parameters),
      cookieJar: () => ({ cookiesForURL: () => ({ "__Host-XSRF-TOKEN": ["token"] }) })
    },
    check: (response, predicates) => { for (const [name, predicate] of Object.entries(predicates)) checks.push({ name, passed: predicate(response) }); },
    group: (name, action) => action(), sleep: seconds => { now += seconds * 1000; },
    Counter: Metric, Rate: Metric, Trend: Metric, Date: Clock, console: { error: line => logged.push(line) }, ...httpDiagnostics,
    open: path => JSON.stringify(path.endsWith("contract.json") ? contract : { password: "test-password" }),
    __ENV: { PERF_PROFILE: "smoke", PERF_RUN_ID: "test-run", PERF_TARGET: "https://proxy:443" },
    __VU: 21, __ITER: 0
  };
  const executable = source.replace(/^import .*;\n/gm, "").replace("export const options", "globalThis.options")
    .replace("export default function ()", "globalThis.iteration = function ()").replace("export function handleSummary", "function handleSummary");
  runInNewContext(executable, context);
  return { requests, checks, metrics, logged, options: context.options,
    iterate: iteration => { context.__ITER = iteration; context.iteration(); },
    advanceDay: () => { now += 86_400_000; } };
}

test("given changing booking IDs and dates, when executing journeys, then request labels and checks stay bounded", () => {
  // given
  const run = protocol();

  // when
  run.iterate(0);
  run.iterate(10);
  run.iterate(1);
  run.advanceDay();
  run.iterate(2);
  const cancellations = run.requests.filter(request => request.method === "DELETE");
  const reads = run.requests.filter(request => request.url.includes("?date="));

  // then
  assert.notEqual(cancellations[0].url, cancellations[1].url);
  assert.equal(cancellations[0].parameters.tags.name, "DELETE /api/bookings/:id");
  assert.equal(cancellations[1].parameters.tags.name, cancellations[0].parameters.tags.name);
  assert.notEqual(reads[0].url, reads[1].url);
  assert.equal(reads[0].parameters.tags.name, "GET /api/bookings");
  assert.equal(reads[1].parameters.tags.name, reads[0].parameters.tags.name);
  assert.deepEqual([...new Set(run.checks.filter(check => check.name.startsWith("DELETE")).map(check => check.name))],
    ["DELETE /api/bookings/:id status 204"]);
  assert.equal(run.options.systemTags.includes("url"), false);
  assert.equal(run.options.systemTags.includes("vu"), false);
  assert.equal(run.options.systemTags.includes("iter"), false);
  for (const tag of ["name", "status", "method", "check", "group", "scenario", "expected_response"]) {
    assert.equal(run.options.systemTags.includes(tag), true);
  }
});

test("given a failed cancellation, when normalizing labels, then the failure remains observable", () => {
  // given
  const run = protocol({ cancellationStatus: 500 });

  // when
  run.iterate(0);

  // then
  assert.deepEqual(run.checks.find(check => check.name.startsWith("DELETE")),
    { name: "DELETE /api/bookings/:id status 204", passed: false });
  assert.equal(run.metrics.get("technical_errors").at(-1), true);
  assert.equal(run.metrics.get("unexpected_server_errors").at(-1), 1);
  assert.ok(run.logged.includes("DELETE /api/bookings/:id returned unexpected status 500 without a problem type"),
    `the failed cancellation must be described in the run log, got ${JSON.stringify(run.logged)}`);
});

test("given refused login attempts, when authentication eventually succeeds, then retries and elapsed time are measured separately", () => {
  // given
  const run = protocol({ loginStatuses: [429, 429, 200] });

  // when
  run.iterate(0);
  run.iterate(1);
  run.iterate(2);
  run.iterate(3);

  // then
  assert.deepEqual(run.metrics.get("login_attempt_failures"), [true, true, false]);
  assert.deepEqual(run.metrics.get("login_duration"), [10, 10, 300]);
  assert.deepEqual(run.metrics.get("login_success_duration"), [300]);
  assert.deepEqual(run.metrics.get("login_authenticated_users"), [1]);
  assert.equal(run.metrics.get("login_time_to_authenticated").length, 1);
  assert.equal(run.metrics.get("login_time_to_authenticated")[0], 2070);
});

test("given only refused logins, when iterations continue, then no successful login duration is invented", () => {
  // given
  const run = protocol({ loginStatuses: [429, 503] });

  // when
  run.iterate(0);
  run.iterate(1);

  // then
  assert.deepEqual(run.metrics.get("login_attempt_failures"), [true, true]);
  assert.deepEqual(run.metrics.get("login_success_duration"), []);
  assert.deepEqual(run.metrics.get("login_time_to_authenticated"), []);
  assert.deepEqual(run.metrics.get("login_authenticated_users"), []);
  assert.equal(run.metrics.get("unexpected_server_errors").includes(1), true);
});

test("given a failed session refresh, when a login POST succeeds, then no authenticated journey is reported", () => {
  // given
  const run = protocol({ refreshStatus: 503 });

  // when
  run.iterate(0);

  // then
  assert.deepEqual(run.metrics.get("login_attempt_failures"), [false]);
  assert.deepEqual(run.metrics.get("login_success_duration"), [300]);
  assert.deepEqual(run.metrics.get("login_time_to_authenticated"), []);
  assert.deepEqual(run.metrics.get("login_authenticated_users"), []);
  assert.equal(run.requests.some(request => request.url.includes("/api/bookings")), false);
});
