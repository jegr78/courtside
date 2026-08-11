import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = readFileSync(fileURLToPath(new URL("../performance/protocol.js", import.meta.url)), "utf8");
const browserScript = readFileSync(fileURLToPath(new URL("../performance/browser.js", import.meta.url)), "utf8");

test("given core API journeys, when inspecting the protocol script, then authentication and CSRF are exercised", () => {
  // when / then
  assert.match(script, /\/api\/session/);
  assert.match(script, /X-XSRF-TOKEN/);
  assert.match(script, /noCookiesReset: true/);
  assert.match(script, /cookiesForURL/);
  assert.doesNotMatch(script, /insecureSkipTLSVerify/);
  assert.match(script, /member.*__VU/);
  assert.match(script, /\/api\/public\/config/);
  assert.match(script, /\/api\/public\/booking-grid/);
  assert.match(script, /\/api\/bookings/);
});

test("given booking contention, when inspecting result handling, then conflicts are domain outcomes", () => {
  // when / then
  assert.match(script, /booking_conflicts/);
  assert.match(script, /booking_contention_duration/);
  assert.match(script, /booking_conflict_rate/);
  assert.match(script, /contentionVirtualUsers/);
  assert.match(script, /__ITER === 0/);
  assert.match(script, /response\.status === 409/);
  assert.match(script, /urn:courtside:error:court-unavailable/);
  assert.match(script, /PERF_RUN_ID/);
  assert.match(script, /unexpected_server_errors/);
  assert.match(script, /technical_errors/);
});

test("given a completed run, when exporting results, then HTML and machine summaries are produced", () => {
  // when / then
  assert.match(script, /handleSummary/);
  assert.match(script, /\/results\/raw-summary\.json/);
});

test("given the automated smoke profile, when applying thresholds, then shared-runner latency stays diagnostic", () => {
  // when / then
  assert.match(script, /profileName === "smoke" \? \{\} :/);
  assert.match(script, /technical_errors/);
  assert.match(script, /unexpected_server_errors/);
});

test("given a browser journey, when inspecting it, then UI actions and API state checks stay language neutral", () => {
  // when / then
  assert.match(browserScript, /getByTestId\("login-view"\)/);
  assert.match(browserScript, /getByTestId\("week-next"\)/);
  assert.match(browserScript, /\/api\/bookings/);
  assert.match(browserScript, /bookingId/);
  assert.match(browserScript, /authenticated === true/);
  assert.match(browserScript, /member.*__VU/);
  assert.doesNotMatch(browserScript, /getByText|getByLabel/);
});

test("given browser measurements, when inspecting thresholds, then p75 Web Vitals and journey failures are bounded", () => {
  // when / then
  assert.match(browserScript, /browser_web_vital_lcp/);
  assert.match(browserScript, /browser_web_vital_inp/);
  assert.match(browserScript, /browser_web_vital_cls/);
  assert.match(browserScript, /p\(75\)/);
  assert.match(browserScript, /browser_errors/);
  assert.match(browserScript, /browser_requests/);
  assert.match(browserScript, /browser_journey_duration/);
  assert.match(browserScript, /browser_journey_success/);
});
