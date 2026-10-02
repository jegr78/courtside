import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { buildPerformanceResult, parseArguments, performanceRunPlan, validatePerformanceResult } from "./courtside.mjs";

const scriptPath = new URL("../performance/contention.js", import.meta.url);
const contract = JSON.parse(readFileSync(new URL("../performance/contract.json", import.meta.url), "utf8"));

function contention({ conflictType = "urn:courtside:error:court-unavailable", cancellationStatus = 204, environment = "PERFORMANCE", duplicateWinners = false } = {}) {
  const metrics = new Map();
  const requests = [];
  const checks = [];
  let cookies = {};
  let occupied = false;
  let data;
  let overlapping = false;
  class Metric {
    constructor(name) { this.values = metrics.get(name) ?? []; metrics.set(name, this.values); }
    add(value) { this.values.push(value); }
  }
  function request(method, url, body, parameters) {
    requests.push({ method, url, body, parameters });
    const path = new URL(url).pathname;
    let status = 200;
    let response = {};
    if (path === "/api/source") response = { environment };
    else if (path === "/api/session") {
      if (method === "POST") cookies.SESSION = [new URLSearchParams(body).get("username")];
      cookies["__Host-XSRF-TOKEN"] = ["token"];
    } else if (path.endsWith("booking-cards")) response = [{ id: "card" }];
    else if (path.endsWith("courts")) response = [{ id: "court" }];
    else if (method === "POST") {
      status = occupied && !duplicateWinners ? 409 : 201;
      response = status === 409 ? { type: conflictType } : { id: "booking-id" };
      occupied = true;
    } else if (method === "DELETE") { status = cancellationStatus; occupied = false; }
    return { status, request: { method, url }, timings: { duration: 10 }, json: key => key ? response[key] : response };
  }
  const context = {
    http: {
      get: (url, parameters) => request("GET", url, null, parameters),
      post: (url, body, parameters) => request("POST", url, body, parameters),
      del: (url, body, parameters) => request("DELETE", url, body, parameters),
      cookieJar: () => ({ clear: () => { cookies = {}; }, cookiesForURL: () => cookies }),
      expectedStatuses: (...statuses) => statuses
    },
    check: (response, predicates) => { for (const [name, predicate] of Object.entries(predicates)) checks.push({ name, passed: predicate(response) }); },
    sleep: () => {
      if (overlapping) return;
      overlapping = true;
      for (let vu = 2; vu <= contract.profiles.contention.virtualUsers; vu++) {
        context.__VU = vu;
        context.iteration(data);
      }
      context.__VU = 1;
    },
    Counter: Metric, Rate: Metric, Trend: Metric,
    open: path => JSON.stringify(path.endsWith("contract.json") ? contract : { password: "test-password" }),
    __ENV: { PERF_PROFILE: "contention", PERF_RUN_ID: "test-run", PERF_TARGET: "https://proxy:443" }, __VU: 1
  };
  const source = existsSync(scriptPath) ? readFileSync(scriptPath, "utf8") : "";
  runInNewContext(source.replace(/^import .*;\n/gm, "").replace("export const options", "globalThis.options")
    .replace("export function setup", "globalThis.setup = function setup")
    .replace("export default function", "globalThis.iteration = function")
    .replace("export function handleSummary", "function handleSummary"), context);
  return { metrics, requests, checks, options: context.options,
    setup: () => { data = context.setup(); return data; }, run: () => context.iteration(data) };
}

test("given a contention profile, when planning execution, then it is local, manual and bounded", () => {
  // when / then
  assert.throws(() => parseArguments(["perf-run", "contention"]), /--confirm courtside-perf/);
  const options = parseArguments(["perf-run", "contention", "--confirm", "courtside-perf"]);
  const plan = performanceRunPlan(options, "/results", "/root.crt");
  assert.equal(plan.args.at(-1), "/scripts/contention.js");
  assert.equal(plan.args.includes("K6_WEB_DASHBOARD_PERIOD=1s"), true);
  assert.equal(contract.profiles.contention.virtualUsers, contract.workloads.reference.contentionVirtualUsers);
  assert.equal(contract.profiles.contention.limits.maximumVirtualUsers, 20);
  assert.equal(contract.profiles.contention.limits.maximumDuration, "2m");
});

test("given preauthenticated members, when booking the same slot concurrently, then one winner and nineteen typed conflicts are recorded", () => {
  // given
  const run = contention();
  const data = run.setup();
  assert.equal(run.requests.filter(request => request.method === "POST" && request.url.endsWith("/api/session")).length, 20);
  assert.equal(run.requests.some(request => request.url.endsWith("/api/bookings")), false);

  // when
  run.run();
  const attempts = run.requests.filter(request => request.method === "POST" && request.url.endsWith("/api/bookings"));

  // then
  assert.equal(data.accounts.length, 20);
  assert.equal(attempts.length, 20);
  assert.equal(new Set(attempts.map(request => request.body)).size, 1);
  assert.equal(new Set(attempts.map(request => request.parameters.headers["Idempotency-Key"])).size, 20);
  assert.equal(new Set(attempts.map(request => request.parameters.cookies.SESSION)).size, 20);
  assert.deepEqual(Array.from(attempts[0].parameters.responseCallback), [201, 409]);
  assert.equal(run.metrics.get("booking_creations").reduce((sum, value) => sum + value, 0), 1);
  assert.equal(run.metrics.get("booking_conflicts").reduce((sum, value) => sum + value, 0), 19);
  assert.equal(run.metrics.get("booking_cancellations").reduce((sum, value) => sum + value, 0), 1);
  assert.equal(run.metrics.get("technical_errors").some(Boolean), false);
  assert.equal(run.options.scenarios.contention.executor, "per-vu-iterations");
  assert.equal(run.options.scenarios.contention.iterations, 1);
  assert.deepEqual(Array.from(run.options.thresholds.booking_creations), ["count==1"]);
  assert.deepEqual(Array.from(run.options.thresholds.booking_conflicts), ["count==19"]);
});

test("given an unrelated conflict and failed cleanup, when booking contention runs, then neither is accepted as a domain success", () => {
  // given
  const run = contention({ conflictType: "urn:courtside:error:booking-rules-violated", cancellationStatus: 500 });
  run.setup();

  // when
  run.run();

  // then
  assert.equal(run.metrics.get("booking_conflicts").reduce((sum, value) => sum + value, 0), 0);
  assert.equal(run.metrics.get("booking_cancellations").reduce((sum, value) => sum + value, 0), 0);
  assert.equal(run.metrics.get("technical_errors").some(Boolean), true);
  assert.equal(run.metrics.get("unexpected_server_errors").includes(1), true);
});

test("given a persistent environment marker, when setting up contention, then authentication and booking never start", () => {
  // given
  const run = contention({ environment: "UAT" });

  // when / then
  assert.throws(() => run.setup(), /PERFORMANCE/);
  assert.equal(run.requests.length, 1);
});

test("given duplicate booking winners, when technical requests succeed, then contention counts still fail qualification", () => {
  // given
  const run = contention({ duplicateWinners: true });
  run.setup();

  // when
  run.run();
  const creations = run.metrics.get("booking_creations").reduce((sum, value) => sum + value, 0);
  const conflicts = run.metrics.get("booking_conflicts").reduce((sum, value) => sum + value, 0);

  // then
  assert.equal(run.metrics.get("technical_errors").some(Boolean), false);
  assert.equal(creations, 20);
  assert.equal(conflicts, 0);
  assert.notEqual(creations, Number(run.options.thresholds.booking_creations[0].split("==")[1]));
  assert.notEqual(conflicts, Number(run.options.thresholds.booking_conflicts[0].split("==")[1]));
});

test("given contention outcomes, when building a result, then the schema preserves qualification and cleanup failures", () => {
  // given
  const metric = count => ({ values: { count }, thresholds: { bounded: { ok: true } } });
  const raw = { state: { testRunDurationMs: 6000 }, metrics: {
    http_req_duration: { values: { "p(50)": 10, "p(90)": 20, "p(95)": 30, "p(99)": 40 } },
    http_reqs: { values: { count: 84, rate: 14 } }, iterations: metric(20),
    technical_errors: { values: { rate: 0 }, thresholds: { bounded: { ok: true } } },
    unexpected_server_errors: metric(0), contention_attempts: metric(20), booking_creations: metric(1),
    booking_conflicts: metric(19), booking_conflict_rate: { values: { rate: 0.95 } },
    booking_contention_duration: { ...metric(0), values: { "p(50)": 100, "p(90)": 200, "p(95)": 300, "p(99)": 400 } },
    booking_cancellations: { ...metric(0), thresholds: { bounded: { ok: false } } }
  } };

  // when
  const result = buildPerformanceResult({ contract, contractDigest: `sha256:${"a".repeat(64)}`,
    source: { version: "1.0.0", commit: "abcdef0", environment: "PERFORMANCE" },
    profileName: "contention", startedAt: "2026-01-01T00:00:00Z", raw, platform: "linux", architecture: "x64" });

  // then
  assert.doesNotThrow(() => validatePerformanceResult(result));
  assert.equal(result.thresholds.contention, true);
  assert.equal(result.thresholds.cleanup, false);
  assert.equal(result.metrics.bookingConflicts, 19);
  assert.deepEqual(result.metrics.latencyMilliseconds, { p50: 100, p90: 200, p95: 300, p99: 400 });
  assert.equal(result.metrics.bookingCancellations, 0);
  assert.equal(result.load.readShare, 0);
  assert.equal(result.load.writeShare, 1);
  const incomplete = structuredClone(result);
  delete incomplete.thresholds.contention;
  assert.throws(() => validatePerformanceResult(incomplete), /contention/);
  assert.throws(() => validatePerformanceResult({ ...result, load: { ...result.load, virtualUsers: 21 } }));
  assert.throws(() => validatePerformanceResult({ ...result, metrics: { ...result.metrics, bookingConflicts: 0 } }));
  assert.throws(() => validatePerformanceResult({ ...result, thresholds: { ...result.thresholds, cleanup: true } }));
});
