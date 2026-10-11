import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const json = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));

test("given the acceptance package, when its browser dependencies are read, then they equal the frontend's pins", () => {
  // given
  const acceptance = json("acceptance/package.json");
  const frontend = json("frontend/package.json");
  // when
  const pins = ["@playwright/test", "@axe-core/playwright"].map((name) =>
    [acceptance.dependencies?.[name], frontend.devDependencies?.[name] ?? frontend.dependencies?.[name]]);
  // then
  for (const [own, theirs] of pins) assert.equal(own, theirs, "acceptance pins the frontend's exact version");
});

test("given the acceptance package, when axe's Playwright core is read, then it is the pinned Playwright version", () => {
  // given
  const acceptance = json("acceptance/package.json");
  const lock = json("acceptance/package-lock.json");
  // when
  const resolved = lock.packages["node_modules/@axe-core/playwright/node_modules/playwright-core"]?.version
    ?? lock.packages["node_modules/playwright-core"]?.version;
  // then
  assert.equal(resolved, acceptance.dependencies["@playwright/test"], "axe drives the same Playwright the journeys use");
});

import { ConfigError, parseConfig, PERSONA_KEYS } from "../acceptance/config/schema.mjs";

const valid = () => ({
  baseUrl: "https://club.example.org",
  expectedVersion: "1.2.3-rc.4",
  personas: Object.fromEntries(PERSONA_KEYS.map((key) => [key, `jane.${key.toLowerCase()}`]))
});
const env = { ACCEPTANCE_PASSWORD: "placeholder-secret" };
const field = (raw, environment = env) => {
  try { parseConfig(raw, environment); } catch (error) { assert.ok(error instanceof ConfigError, error.message); return error.field; }
  return null;
};

test("given a minimal configuration, when parsed, then defaults are filled and the password comes from the environment", () => {
  // when
  const config = parseConfig(valid(), env);
  // then
  assert.equal(config.password, "placeholder-secret");
  assert.equal(config.loadLimit, 5.5);
  assert.deepEqual(config.window, {});
  assert.deepEqual(config.logs, {});
});

test("given a configuration without baseUrl, when parsed, then the refusal names the field", () => {
  // given
  const raw = valid(); delete raw.baseUrl;
  // when / then
  assert.equal(field(raw), "baseUrl");
});

test("given no password in the environment, when parsed, then the refusal names ACCEPTANCE_PASSWORD", () => {
  // when / then
  assert.equal(field(valid(), {}), "ACCEPTANCE_PASSWORD");
});

test("given two actors with one username, when parsed, then the refusal names the second actor", () => {
  // given
  const raw = valid(); raw.personas.memberB = raw.personas.memberA;
  // when / then
  assert.equal(field(raw), "personas.memberB");
});

test("given a missing actor, when parsed, then the refusal names it", () => {
  // given
  const raw = valid(); delete raw.personas.grounds;
  // when / then
  assert.equal(field(raw), "personas.grounds");
});

test("given a window start that is not a Monday, when parsed, then the refusal names window.start", () => {
  // given
  const raw = { ...valid(), window: { start: "2030-01-02" } };
  // when / then
  assert.equal(field(raw), "window.start");
});

test("given fewer than two courts or a repeated court, when parsed, then the refusal names courts", () => {
  // when / then
  assert.equal(field({ ...valid(), courts: [1] }), "courts");
  assert.equal(field({ ...valid(), courts: [1, 1] }), "courts");
});

test("given an unknown time zone, an unknown key or a non-websocket Firefox endpoint, when parsed, then each is refused by name", () => {
  // when / then
  assert.equal(field({ ...valid(), timeZone: "Mars/Olympus" }), "timeZone");
  assert.equal(field({ ...valid(), baseURL: "https://club.example.org" }), "baseURL");
  assert.equal(field({ ...valid(), browsers: { firefox: { wsEndpoint: "http://127.0.0.1:1" } } }), "browsers.firefox.wsEndpoint");
});

test("given the example configuration, when parsed, then it is valid", () => {
  // given
  const example = JSON.parse(readFileSync(new URL("../acceptance/config.example.json", import.meta.url), "utf8"));
  // when / then
  assert.doesNotThrow(() => parseConfig(example, env));
});

import { addDays, defaultWindowStart, localDate, resolveWindowStart, windowDays, weekdayOf, zonedInstant } from "../acceptance/config/calendar.mjs";

test("given an instant after UTC midnight's eve, when the club day is read in a zone ahead of UTC, then it is the club's next day", () => {
  // given
  const lateEvening = new Date(Date.UTC(2030, 2, 3, 23, 30));
  // when / then
  assert.equal(localDate(lateEvening, "UTC"), "2030-03-03");
  assert.equal(localDate(lateEvening, "Europe/Berlin"), "2030-03-04");
});

test("when the default window is asked for on each weekday, then it starts on the first Monday after today", () => {
  // when / then
  assert.equal(defaultWindowStart(new Date(Date.UTC(2030, 2, 6, 12)), "UTC"), "2030-03-11");
  assert.equal(defaultWindowStart(new Date(Date.UTC(2030, 2, 10, 12)), "UTC"), "2030-03-11");
  assert.equal(defaultWindowStart(new Date(Date.UTC(2030, 2, 11, 12)), "UTC"), "2030-03-18");
});

test("given a configured start on today or earlier, when resolved, then it is refused by name, and a later Monday is kept", () => {
  // given
  const now = new Date(Date.UTC(2030, 2, 11, 12));
  // when / then
  assert.throws(() => resolveWindowStart("2030-03-11", now, "UTC"), /window\.start/);
  assert.equal(resolveWindowStart("2030-03-25", now, "UTC"), "2030-03-25");
  assert.equal(resolveWindowStart(undefined, now, "UTC"), "2030-03-18");
});

test("when a window is laid out, then it holds seven consecutive days from Monday to Sunday across a month end", () => {
  // when
  const days = windowDays("2030-04-29");
  // then
  assert.deepEqual(days, ["2030-04-29", "2030-04-30", "2030-05-01", "2030-05-02", "2030-05-03", "2030-05-04", "2030-05-05"]);
  assert.deepEqual([weekdayOf(days[0]), weekdayOf(days[6])], ["MONDAY", "SUNDAY"]);
  assert.equal(addDays("2030-12-31", 1), "2031-01-01");
});

test("given a week that ends with the change from summer time, when local hours become instants, then each keeps its local hour", () => {
  // when
  const saturday = zonedInstant("2026-10-24", "10:00", "Europe/Berlin");
  const sunday = zonedInstant("2026-10-25", "10:00", "Europe/Berlin");
  // then
  assert.equal(saturday.toISOString(), "2026-10-24T08:00:00.000Z");
  assert.equal(sunday.toISOString(), "2026-10-25T09:00:00.000Z");
});

import { governingHours, journeysOf, LaneError, planLanes, PROFILE_NAMES, slotIn } from "../acceptance/config/lanes.mjs";
import { zonedInstant as at } from "../acceptance/config/calendar.mjs";

const open = (opensAt, closesAt) => () => ({ opensAt, closesAt });
const plan = (hoursOf = open("06:00", "23:00"), courts = [1, 3, 2]) => planLanes({ start: "2030-03-11", courts, hoursOf });
const overlap = (a, b) => a.date === b.date && a.court === b.court && a.start < b.end && b.start < a.end;

test("when the lanes are planned, then no two slots overlap and each lies inside the day's opening hours", () => {
  // when
  const { slots } = plan(open("07:30", "23:00"));
  // then
  assert.deepEqual(slots.flatMap((a, i) => slots.slice(i + 1).filter((b) => overlap(a, b)).map((b) => `${a.profile}/${a.journey}x${b.profile}/${b.journey}`)), []);
  assert.deepEqual(slots.filter((slot) => slot.start < "08:00" || slot.end > "23:00"), []);
});

test("when the lanes are planned, then weekday lanes use the first two courts and only the opening journey uses the weekend", () => {
  // when
  const lanes = plan();
  // then
  assert.deepEqual([...new Set(lanes.slots.filter((s) => s.date < lanes.saturday).map((s) => s.court))].sort(), [1, 3]);
  assert.deepEqual([...new Set(lanes.slots.filter((s) => s.date >= lanes.saturday).map((s) => s.journey))], ["saturday-opening"]);
  assert.deepEqual([...new Set(lanes.slots.filter((s) => s.journey === "saturday-opening").map((s) => s.court))].sort(), [1, 2, 3]);
});

test("given every profile, when its journeys are resolved, then each has a slot and unknown pairs are refused", () => {
  // given
  const lanes = plan();
  // when / then
  for (const profile of PROFILE_NAMES) for (const journey of journeysOf(profile)) assert.equal(slotIn(lanes, profile, journey).journey, journey);
  assert.throws(() => slotIn(lanes, "iphone-se", "trainer"), /trainer does not run on iphone-se/);
});

test("given a lane day too short for its journeys, when planned, then the refusal names the profile and the day", () => {
  // when / then
  assert.throws(() => plan(open("06:00", "12:00")), (error) => error instanceof LaneError && /desktop-chrome/.test(error.message) && /2030-03-11/.test(error.message));
});

test("given a closed lane day, when planned, then the refusal names the day", () => {
  // when / then
  assert.throws(() => plan((date) => date === "2030-03-13" ? { opensAt: null, closesAt: null } : { opensAt: "06:00", closesAt: "23:00" }), /2030-03-13 is closed/);
});

test("given a booking grid with a later week, when the governing hours of a date are read, then the last started week decides", () => {
  // given
  const day = (dayOfWeek, opensAt) => ({ dayOfWeek, opensAt, closesAt: "22:00" });
  const week = (effectiveFrom, opensAt) => ({ effectiveFrom, days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].map((d) => day(d, opensAt)) });
  const grid = { openingWeeks: [week(null, "06:00"), week("2030-03-13", "09:00")] };
  // when / then
  assert.equal(governingHours(grid, "2030-03-12").opensAt, "06:00");
  assert.equal(governingHours(grid, "2030-03-13").opensAt, "09:00");
});

test("given lanes across the change from summer time, when the Sunday slot becomes an instant, then it keeps its local hour", () => {
  // given
  const lanes = planLanes({ start: "2026-10-19", courts: [1, 3, 2], hoursOf: open("06:00", "23:00") });
  // when
  const sunday = at(lanes.sunday, "10:00", "Europe/Berlin");
  // then
  assert.equal(sunday.toISOString(), "2026-10-25T09:00:00.000Z");
});

import { attribute, classify, classifyErrors, occupying, replayEntries } from "../acceptance/lib/core.mjs";
import { claimRunDirectory, harnessCommit } from "../acceptance/lib/run-directory.mjs";
import { findExecutable } from "../acceptance/lib/executable.mjs";
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const utc = (time) => `2030-03-11T${time}:00Z`;

test("given allocations on several courts and times, when one slot is swept, then only bookings overlapping it on that court are chosen", () => {
  // given
  const allocations = [
    { bookingId: "inside", courtId: "c1", startsAt: utc("08:00"), endsAt: utc("08:30") },
    { bookingId: "straddling", courtId: "c1", startsAt: utc("07:30"), endsAt: utc("08:30") },
    { bookingId: "touching", courtId: "c1", startsAt: utc("09:00"), endsAt: utc("10:00") },
    { bookingId: "other-court", courtId: "c2", startsAt: utc("08:00"), endsAt: utc("09:00") },
    { bookingId: "inside", courtId: "c1", startsAt: utc("08:30"), endsAt: utc("09:00") }
  ];
  // when
  const chosen = occupying(allocations, "c1", new Date(utc("08:00")), new Date(utc("09:00")));
  // then
  assert.deepEqual(chosen, ["inside", "straddling"]);
});

test("given an answer that is not a list, when swept, then the refusal says what came back", () => {
  // when / then
  assert.throws(() => occupying({ type: "urn:courtside:error:request-rate-limited" }, "c1", new Date(), new Date()), /request-rate-limited/);
});

test("given a ledger with a booking already cancelled, when replayed, then it is reported as gone and the rest cancelled", async () => {
  // given
  const statuses = { a: 204, b: 404, c: 500 };
  const remove = async (path) => ({ status: () => statuses[path.split("/").at(-1).split("?")[0]] });
  // when
  const outcome = await replayEntries([{ kind: "booking", id: "a" }, { kind: "booking", id: "b" }, { kind: "booking", id: "c" }], remove);
  // then
  assert.deepEqual(outcome.map((item) => item.outcome), ["cancelled", "gone", "failed"]);
});

test("when failure messages are classified, then a timeout makes it harness and otherwise the first prefix decides", () => {
  // when / then
  assert.equal(classify("Error: PRECONDITION: slot singles could not be cleared"), "precondition");
  assert.equal(classify("Error: product: the booking in singles is accepted"), "product");
  assert.equal(classify("Error: expect(locator).toBeVisible() failed"), "harness");
  assert.equal(classifyErrors(["Test timeout of 60000ms exceeded.", "Error: product: the series is created"]), "harness");
  assert.equal(classifyErrors(["Error: product: the scheduled week is removed", "Error: PRECONDITION: removing answered 500"]), "product");
  assert.equal(classifyErrors([]), "harness");
});

test("given two overlapping steps, when an error falls in both windows, then it is attributed to both and marked ambiguous", () => {
  // given
  const steps = [
    { project: "p1", persona: "memberA", name: "book", start: utc("10:00"), end: "2030-03-11T10:00:10Z" },
    { project: "p2", persona: "admin", name: "roster", start: "2030-03-11T10:00:05Z", end: "2030-03-11T10:00:20Z" }
  ];
  const lines = ["2030-03-11T10:00:07.123456789Z ERROR o.c.Booking boom", "2030-03-11T10:00:30.000Z WARN later", "2030-03-11T10:00:08Z INFO fine"];
  // when
  const result = attribute(lines, steps);
  // then
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].steps.map((step) => step.name), ["book", "roster"]);
  assert.equal(result[0].ambiguous, true);
  assert.deepEqual(result[1].steps, [], "a line outside every step stays unattributed");
});

test("given a run directory that already holds results, when claimed, then it is refused, and a fresh one is created", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "acceptance-run-"));
  const used = join(root, "used");
  mkdirSync(used); writeFileSync(join(used, "results.json"), "{}");
  // when / then
  assert.throws(() => claimRunDirectory(used), /already holds results/);
  claimRunDirectory(join(root, "fresh"));
  rmSync(root, { recursive: true, force: true });
});

test("given a source stamp beside the harness, when the commit is read, then the stamp wins over the repository head", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "acceptance-source-"));
  writeFileSync(join(root, "source.json"), JSON.stringify({ commit: "0123456789abcdef0123456789abcdef01234567" }));
  // when / then
  assert.equal(harnessCommit(new URL(`file://${root}/`)), "0123456789abcdef0123456789abcdef01234567");
  rmSync(root, { recursive: true, force: true });
});

test("given a PATH with a relative entry and an executable in an absolute one, when looked up, then only the absolute match is returned", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "acceptance-path-"));
  const binary = join(root, "probe-tool");
  writeFileSync(binary, "#!/bin/sh\n"); chmodSync(binary, 0o755);
  // when / then
  assert.equal(findExecutable("probe-tool", `relative-dir:${root}`), binary);
  assert.equal(findExecutable("probe-tool", "relative-dir"), null);
  rmSync(root, { recursive: true, force: true });
});

import { collectFindings } from "../acceptance/report/findings.mjs";
import { applyReview, validateReview } from "../acceptance/report/review.mjs";

const row = (overrides) => ({ project: "pixel-7", persona: "admin", label: "overview", url: "https://club.example.org/admin", shot: "shots/a.png", axe: [], console: [], httpErrors: [], ...overrides });

test("given the same findings in two runs with other ids and dates, when collected, then their keys are equal", () => {
  // given
  const first = [row({ console: ["pageerror: /api/bookings?date=2030-03-11 due to access control checks."], httpErrors: [{ url: "https://club.example.org/api/bookings/3f2b6c1e-0000-4000-8000-000000000001", status: 500 }], axe: [{ id: "heading-order", impact: "moderate", targets: ["#series-title"] }] })];
  const second = [row({ console: ["pageerror: /api/bookings?date=2030-04-08 due to access control checks."], httpErrors: [{ url: "https://club.example.org/api/bookings/aa11bb22-0000-4000-8000-000000000002", status: 500 }], axe: [{ id: "heading-order", impact: "moderate", targets: ["#series-title"] }] })];
  const failures = [{ project: "ipad", file: "journeys/40-admin.spec.ts", title: "when the admin visits every administration page, then each renders", class: "product", error: "Error: product: x" }];
  // when
  const keys = (metrics) => collectFindings({ metrics, failures }).map((finding) => finding.key).sort();
  // then
  assert.deepEqual(keys(first), keys(second));
  assert.ok(keys(first).includes("axe:heading-order"));
  assert.ok(keys(first).includes("http:500:/api/bookings/:id"));
  assert.ok(keys(first).includes("failure:journeys/40-admin.spec.ts:when the admin visits every administration page, then each renders:ipad"));
});

test("given a harness or precondition failure, when collected, then it is not a product finding", () => {
  // when
  const findings = collectFindings({ metrics: [], failures: [{ project: "ipad", file: "f", title: "t", class: "harness", error: "timeout" }] });
  // then
  assert.deepEqual(findings, []);
});

test("given a finding without an assessment, when the review is applied, then the report is a draft that names it", () => {
  // given
  const findings = collectFindings({ metrics: [row({ axe: [{ id: "heading-order", impact: "moderate", targets: [] }, { id: "color-contrast", impact: "serious", targets: [] }] })], failures: [] });
  const review = { assessments: { "axe:heading-order": { assessment: "known-issue", reason: "tracked", followUp: "none", issue: 1243 } }, manual: [] };
  // when
  const applied = applyReview(findings, review);
  // then
  assert.equal(applied.status, "draft");
  assert.deepEqual(applied.unassessed, ["axe:color-contrast"]);
});

test("given every finding assessed and a manual finding, when the review is applied, then the report is final and lists the manual one", () => {
  // given
  const findings = collectFindings({ metrics: [row({ axe: [{ id: "heading-order", impact: "moderate", targets: [] }] })], failures: [] });
  const review = {
    assessments: {
      "axe:heading-order": { assessment: "known-issue", reason: "tracked", followUp: "none", issue: 1243 },
      "manual:update-notice": { assessment: "product-defect", reason: "shown without a deployment", followUp: "open an issue" }
    },
    manual: [{ key: "manual:update-notice", severity: "major", kind: "PWA", title: "Update notice without a deployment", detail: "", where: [{ project: "desktop-firefox" }] }]
  };
  // when
  const applied = applyReview(findings, review);
  // then
  assert.equal(applied.status, "final");
  assert.deepEqual(applied.findings.map((finding) => finding.key).sort(), ["axe:heading-order", "manual:update-notice"]);
});

test("given an assessment for a key this run did not produce, when applied, then it is reported stale", () => {
  // when
  const applied = applyReview([], { assessments: { "axe:gone": { assessment: "capture-artefact", reason: "r", followUp: "none" } }, manual: [] });
  // then
  assert.deepEqual(applied.stale, ["axe:gone"]);
});

test("given a known issue without an issue number or an unknown assessment, when validated, then each is refused", () => {
  // when / then
  assert.throws(() => validateReview({ assessments: { k: { assessment: "known-issue", reason: "r", followUp: "f" } }, manual: [] }), /issue/);
  assert.throws(() => validateReview({ assessments: { k: { assessment: "fine", reason: "r", followUp: "f" } }, manual: [] }), /assessment/);
  assert.throws(() => validateReview({ assessments: { k: { assessment: "harness-gap", reason: "", followUp: "f" } }, manual: [] }), /reason/);
});

import { assertPrivacySafe, releaseSummary } from "../acceptance/report/release-summary.mjs";

const forbidden = { usernames: ["jane.doe"], hosts: ["club.example.org"], names: ["Jane Doe"] };
const reviewed = {
  status: "final", unassessed: [], stale: [],
  findings: [{ key: "axe:heading-order", severity: "hint", kind: "accessibility", title: "axe heading-order (moderate)",
    review: { assessment: "known-issue", reason: "The series form skips a heading level.", followUp: "Planned in 0.2.0.", issue: 1243 } }]
};

test("given a final review, when summarised, then version, run, cells and each finding with its issue are listed", () => {
  // when
  const summary = releaseSummary({ version: "1.2.3", runId: "20300311T090000Z", harnessCommit: "abc1234", cells: { passed: 188, failed: 0, skipped: 144 }, reviewed, forbidden });
  // then
  assert.match(summary, /1\.2\.3/);
  assert.match(summary, /188 passed, 0 failed, 144 skipped/);
  assert.match(summary, /`axe:heading-order`.*known issue.*#1243/);
  assert.doesNotMatch(summary, /draft/i);
});

test("given a draft review, when summarised, then the summary says it is not final and names the open keys", () => {
  // when
  const summary = releaseSummary({ version: "1.2.3", runId: "r", harnessCommit: "c", cells: { passed: 1, failed: 0, skipped: 0 }, reviewed: { ...reviewed, status: "draft", unassessed: ["axe:color-contrast"] }, forbidden });
  // then
  assert.match(summary, /Draft/);
  assert.match(summary, /axe:color-contrast/);
});

test("given a reason that names a username, an address, a host, a person or an image, when summarised, then each is refused without echoing it", () => {
  // given
  const leaking = (reason) => ({ ...reviewed, findings: [{ ...reviewed.findings[0], review: { ...reviewed.findings[0].review, reason } }] });
  const summarise = (reason) => releaseSummary({ version: "1", runId: "r", harnessCommit: "c", cells: { passed: 1, failed: 0, skipped: 0 }, reviewed: leaking(reason), forbidden });
  // when / then
  for (const [reason, kind] of [["seen for jane.doe", /username/], ["mail to someone@example.org", /email/], ["on club.example.org", /host/], ["Jane Doe saw it", /name/], ["![shot](a.png)", /image/]]) {
    assert.throws(() => summarise(reason), (error) => kind.test(error.message) && !error.message.includes(reason));
  }
});

import { coverageOf } from "../acceptance/report/html.mjs";

test("given Playwright results with passed, skipped and failed cells, when coverage is read, then setup and discovery are left out and each cell keeps its status", () => {
  // given
  const results = { suites: [{ file: "journeys/20-member.spec.ts", specs: [{ title: "t", tests: [
    { projectName: "pixel-7", status: "expected", results: [{ status: "passed" }] },
    { projectName: "ipad", status: "skipped", results: [{ status: "skipped" }], annotations: [{ type: "skip", description: "member journeys run on phones" }] },
    { projectName: "narrow", status: "unexpected", results: [{ status: "failed", errors: [{ message: "Error: product: x" }] }] }
  ] }] }, { file: "journeys/00-setup.spec.ts", specs: [{ title: "s", tests: [{ projectName: "setup-chromium", status: "expected", results: [{ status: "passed" }] }] }] }] };
  // when
  const { rows, cells } = coverageOf(results);
  // then
  assert.deepEqual(cells, { passed: 1, failed: 1, skipped: 1 });
  assert.deepEqual(rows.map((row) => row.flow), ["t"]);
  assert.equal(rows[0].cells.ipad.reason, "member journeys run on phones");
});

test("given the same WebKit page error from two instances, when collected, then the key and title carry no host", () => {
  // given
  const message = (host) => [row({ console: [`pageerror: /${host}/api/bookings?date=2030-03-11 due to access control checks.`] })];
  // when
  const first = collectFindings({ metrics: message("club.example.org"), failures: [] });
  const second = collectFindings({ metrics: message("courts.example.org"), failures: [] });
  // then
  assert.equal(first[0].key, second[0].key);
  assert.doesNotMatch(first[0].title, /example\.org/);
});

import { parseArguments, waitForLoad } from "../acceptance/run.mjs";

test("when arguments are parsed, then a later phase needs an existing run and projects narrow the matrix", () => {
  // when / then
  assert.deepEqual(parseArguments([]), { phase: "all", run: null, projects: [] });
  assert.deepEqual(parseArguments(["--phase", "matrix", "--project", "ipad", "--project", "narrow"]), { phase: "matrix", run: null, projects: ["ipad", "narrow"] });
  assert.throws(() => parseArguments(["--phase", "report"]), /--run/);
  assert.throws(() => parseArguments(["--phase", "everything"]), /phase/);
});

test("given a load that falls below the limit, when waited for, then it returns, and a load that never falls stops at the deadline", async () => {
  // given
  const loads = [7, 6, 4];
  // when / then
  await waitForLoad({ limit: 5.5, loadavg: () => [loads.shift() ?? 4], sleep: async () => {}, deadlineMs: 1_000, now: (() => { let t = 0; return () => (t += 1); })() });
  await assert.rejects(waitForLoad({ limit: 5.5, loadavg: () => [9], sleep: async () => {}, deadlineMs: 3, now: (() => { let t = 0; return () => (t += 1); })() }), /load stayed above 5.5/);
});
