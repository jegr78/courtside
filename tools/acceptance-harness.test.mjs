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
