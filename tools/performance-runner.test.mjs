import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = readFileSync(fileURLToPath(new URL("../performance/protocol.js", import.meta.url)), "utf8");
const browserScript = readFileSync(fileURLToPath(new URL("../performance/browser.js", import.meta.url)), "utf8");
const funnelScript = readFileSync(fileURLToPath(new URL("../performance/funnel.js", import.meta.url)), "utf8");

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

test("given a browser journey, when inspecting it, then the member workflow stays in the language-neutral UI", () => {
  // when / then
  assert.match(browserScript, /getByTestId\("login-view"\)/);
  assert.match(browserScript, /getByTestId\("week-next"\)/);
  assert.match(browserScript, /getByTestId\("free-slot"\)/);
  assert.match(browserScript, /getByTestId\("booking-submit"\)/);
  assert.match(browserScript, /waitForResponse/);
  assert.match(browserScript, /response\.json\(\)/);
  assert.match(browserScript, /data-testid="own-allocation"/);
  assert.match(browserScript, /getByTestId\("my-bookings-link"\)/);
  assert.match(browserScript, /data-testid="personal-cancel"/);
  assert.match(browserScript, /getByTestId\("confirm-cancellation"\)/);
  assert.match(browserScript, /member.*__VU/);
  assert.doesNotMatch(browserScript, /page\.evaluate|fetch\(|http\.(?:get|post|put|patch|del)\(/);
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

test("given a public Funnel smoke, when inspecting its journey, then it is bounded and read-only", () => {
  // when / then
  assert.match(funnelScript, /profile\.virtualUsers/);
  assert.match(funnelScript, /profile\.duration/);
  assert.match(funnelScript, /blacklistIPs/);
  assert.match(funnelScript, /127\.0\.0\.0\/8/);
  assert.match(funnelScript, /fc00::\/7/);
  assert.match(funnelScript, /\/api\/source/);
  assert.match(funnelScript, /environment.*UAT/);
  assert.match(funnelScript, /\/manifest\.webmanifest/);
  assert.match(funnelScript, /\/api\/public\/config/);
  assert.match(funnelScript, /\/api\/public\/booking-grid/);
  assert.match(funnelScript, /XSRF-TOKEN/);
  assert.match(funnelScript, /\/api-ui\//);
  assert.match(funnelScript, /\/api\/openapi\.yaml/);
  assert.match(funnelScript, /\/actuator\/health/);
  assert.doesNotMatch(funnelScript, /http\.(?:post|put|patch|del)\(/);
  assert.doesNotMatch(funnelScript, /insecureSkipTLSVerify/);
});

test("given Funnel artifacts, when exporting them, then the public target is not retained", () => {
  // when / then
  assert.match(funnelScript, /\/results\/raw-summary\.json/);
  assert.match(funnelScript, /\/results\/report\.html/);
  assert.doesNotMatch(funnelScript, /JSON\.stringify\([^)]*target/);
});
