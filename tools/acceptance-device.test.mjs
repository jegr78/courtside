import { test } from "node:test";
import assert from "node:assert/strict";
import { restoreCommand, sameServeConfiguration } from "../acceptance/device/outage.mjs";
import { contrast, judge } from "../acceptance/device/verdicts.mjs";

const served = (funnel) => ({
  TCP: { 443: { HTTPS: true }, 8443: { HTTPS: true } },
  Web: {
    "box.example.org:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8080" } } },
    "box.example.org:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8025" } } }
  },
  ...(funnel ? { AllowFunnel: { "box.example.org:443": true } } : {})
});

test("given a funnelled HTTPS handler, when the restore command is derived, then it reopens the funnel to the same target", () => {
  // when
  const command = restoreCommand(served(true));
  // then
  assert.deepEqual(command, ["tailscale", "funnel", "--bg", "--https=443", "http://127.0.0.1:8080"], "the funnel comes back on port 443 to the proxy");
});

test("given a tailnet-only HTTPS handler, when the restore command is derived, then it serves again without opening a funnel", () => {
  // when
  const command = restoreCommand(served(false));
  // then
  assert.equal(command[1], "serve", "a handler that was never public stays off the funnel");
});

test("given no handler on port 443, when the restore command is derived, then the outage refuses to start", () => {
  // given
  const status = { Web: { "box.example.org:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8025" } } } } };
  // when / then
  assert.throws(() => restoreCommand(status), /no HTTPS handler on port 443/);
});

test("given a second path handler on port 443, when the restore command is derived, then the outage refuses to start", () => {
  // given
  const status = served(true);
  status.Web["box.example.org:443"].Handlers["/docs"] = { Path: "/srv/docs" };
  // when / then
  assert.throws(() => restoreCommand(status), /exactly one handler/, "turning 443 off would drop a handler the restore cannot bring back");
});

test("given a proxy target that is not a plain URL, when the restore command is derived, then the outage refuses to start", () => {
  // given
  const status = served(true);
  status.Web["box.example.org:443"].Handlers["/"].Proxy = "http://127.0.0.1:8080; reboot";
  // when / then
  assert.throws(() => restoreCommand(status), /not a plain URL/, "the target reaches a remote shell, so only a plain URL may pass");
});

test("given the same serve status in another key order, when compared, then it counts as restored", () => {
  // given
  const before = served(true);
  const after = { AllowFunnel: before.AllowFunnel, Web: before.Web, TCP: before.TCP };
  // when / then
  assert.equal(sameServeConfiguration(before, after), true, "key order is not a configuration difference");
});

test("given a serve status without the funnel, when compared with the funnelled one, then it is not restored", () => {
  // when / then
  assert.equal(sameServeConfiguration(served(true), served(false)), false, "a lost funnel is a difference");
});

test("given white and black, when their contrast is computed, then it is 21 to 1", () => {
  // when / then
  assert.equal(Math.round(contrast("rgb(255, 255, 255)", "rgb(0, 0, 0)")), 21);
});

test("given dark text on the light background, when the theme switch is judged, then it passes", () => {
  // given
  const check = { check: "theme-switch", afterOneSecond: [{ label: "theme label", color: "rgb(23, 33, 29)", background: "rgb(252, 251, 249)" }] };
  // when / then
  assert.equal(judge(check).verdict, "pass");
});

test("given white text on the light background, when the theme switch is judged, then it names the label", () => {
  // given
  const check = { check: "theme-switch", afterOneSecond: [{ label: "first weekday", color: "rgb(255, 255, 255)", background: "rgb(252, 251, 249)" }] };
  // when
  const { verdict, reason } = judge(check);
  // then
  assert.equal(verdict, "fail");
  assert.match(reason, /first weekday/);
});

test("given a select the dialog no longer renders, when the select heights are judged, then it fails instead of passing unmeasured", () => {
  // given
  const check = { check: "select-heights", fields: [{ testId: "booking-duration", missing: true }, { tag: "select", testId: "booking-card", height: 45 }] };
  // when
  const { verdict, reason } = judge(check);
  // then
  assert.equal(verdict, "fail");
  assert.equal(reason, "not found: booking-duration");
});

test("given a label the page no longer renders, when the theme switch is judged, then it fails instead of passing unmeasured", () => {
  // given
  const check = { check: "theme-switch", afterOneSecond: [{ label: "theme label", missing: true }] };
  // when
  const { verdict, reason } = judge(check);
  // then
  assert.equal(verdict, "fail");
  assert.equal(reason, "not found: theme label");
});

test("given a select lower than a touch target, when the select heights are judged, then it fails on that select only", () => {
  // given
  const check = { check: "select-heights", fields: [
    { tag: "select", testId: "booking-duration", height: 25 },
    { tag: "select", testId: "booking-card", height: 45 },
    { tag: "input", testId: "member-search", height: 30 }
  ] };
  // when
  const { verdict, reason } = judge(check);
  // then
  assert.equal(verdict, "fail");
  assert.equal(reason, "lower than 44 px: booking-duration 25 px", "only the low select is named; inputs are not judged");
});

test("given a confirmation above the viewport, when its placement is judged, then it fails with the distance", () => {
  // given
  const check = { check: "saved-message", placement: { top: -755, bottom: -705, viewport: 750, inView: false } };
  // when
  const { verdict, reason } = judge(check);
  // then
  assert.equal(verdict, "fail");
  assert.match(reason, /755 px outside/);
});

test("given every offline element and a verified cancellation, when the offline bookings are judged, then they pass", () => {
  // given
  const check = { check: "offline-bookings", offline: { listed: true, offlineStatus: true, asOf: "as of", within: 12 }, plan: { notice: "offline" }, cancelled: "204 verified" };
  // when / then
  assert.equal(judge(check).verdict, "pass");
});

test("given an offline view that took 92 s, when the offline bookings are judged, then they fail on the wait", () => {
  // given
  const check = { check: "offline-bookings", offline: { listed: true, offlineStatus: true, asOf: "as of", within: 92 }, plan: { notice: "offline" }, cancelled: "204 verified" };
  // when
  const { verdict, reason } = judge(check);
  // then
  assert.equal(verdict, "fail");
  assert.equal(reason, "missing: the offline view within 15 s (took up to 92 s)", "a member waiting a minute and a half for the offline view is not a pass");
});

test("given an offline view without the booking and an unverified cancellation, when judged, then both are named", () => {
  // given
  const check = { check: "offline-bookings", offline: { listed: false, offlineStatus: true, asOf: "as of", within: 92 }, plan: { notice: "offline" }, cancelled: "422 not among cancelled bookings" };
  // when
  const { verdict, reason } = judge(check);
  // then
  assert.equal(verdict, "fail");
  assert.match(reason, /the booking in My bookings/);
  assert.match(reason, /verified cancellation/);
});

test("given a check that errored or was skipped, when judged, then the verdict says so instead of passing", () => {
  // when / then
  assert.equal(judge({ check: "outage", error: "stayed reachable" }).verdict, "error");
  assert.equal(judge({ check: "offline-bookings", skipped: "no outage host" }).verdict, "skipped");
});

test("given an unknown check, when judged, then it refuses rather than passing", () => {
  // when / then
  assert.throws(() => judge({ check: "unknown" }), /no verdict defined/);
});

const surface = (overrides = {}) => ({ name: "plan", documentOverflow: false, overflow: [], occluded: [], zoom: [], smallTargets: [], truncated: [], ...overrides });

test("given pages that fit with small targets, when judged, then they pass and count the targets as observations", () => {
  // given
  const check = { check: "member-pages", surfaces: [surface({ smallTargets: ["a#x"] }), surface({ name: "my-bookings", truncated: [{ selector: "span" }] })] };
  // when
  const { verdict, reason } = judge(check);
  // then
  assert.equal(verdict, "pass");
  assert.equal(reason, "2 pages fit the screen; observed 1 targets below 44 px, 1 truncated texts and 0 controls under sticky bars");
});

test("given a field below 16 px, when the pages are judged, then they fail because Safari zooms into it", () => {
  // given
  const check = { check: "visitor-pages", surfaces: [surface({ name: "sign-in", zoom: [{ selector: "input#username", fontSize: "14px" }] })] };
  // when
  const { verdict, reason } = judge(check);
  // then
  assert.equal(verdict, "fail");
  assert.equal(reason, "sign-in: input#username 14px below 16 px, so Safari zooms in");
});

test("given a page that scrolls sideways and one with an element past the edge, when judged, then each fault names its page", () => {
  // given
  const check = { check: "admin-pages", surfaces: [surface({ name: "audit", documentOverflow: true }), surface({ name: "roster", overflow: [{ selector: "table" }] })] };
  // when
  const { verdict, reason } = judge(check);
  // then
  assert.equal(verdict, "fail");
  assert.equal(reason, "audit: the page scrolls sideways; roster: 1 element(s) beyond the screen edge");
});

test("given a control under the sticky tab bar, when judged, then it is an observation and not a fault", () => {
  // given
  const check = { check: "member-pages", surfaces: [surface({ occluded: [{ selector: "a", by: "nav" }] })] };
  // when
  const { verdict, reason } = judge(check);
  // then
  assert.equal(verdict, "pass", "the plan scrolls under its sticky bars by design");
  assert.match(reason, /1 controls under sticky bars/);
});

test("given a page that could not be opened, when judged, then the pages fail instead of passing unmeasured", () => {
  // given
  const check = { check: "admin-pages", surfaces: [{ name: "export", error: "waited 30 s for the page" }] };
  // when / then
  assert.equal(judge(check).verdict, "fail");
});
