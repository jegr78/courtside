import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

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
  assert.equal(config.notifyClubBookings, false, "club bookings are protected unless the operator says otherwise");
});

test("given notifyClubBookings, when parsed, then true is kept and anything but a boolean is refused", () => {
  // when / then
  assert.equal(parseConfig({ ...valid(), notifyClubBookings: true }, env).notifyClubBookings, true);
  assert.equal(field({ ...valid(), notifyClubBookings: "yes" }), "notifyClubBookings");
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

import { availabilityConflicts, governingHours, journeysOf, LaneError, laterOpeningOf, planLanes, PROFILE_NAMES, slotIn, weekInForce, weekendConflicts } from "../acceptance/config/lanes.mjs";
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

const day = (dayOfWeek, opensAt) => ({ dayOfWeek, opensAt, closesAt: "22:00" });
const week = (effectiveFrom, opensAt) => ({ effectiveFrom, days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].map((d) => day(d, opensAt)) });

test("given a booking grid with a later week, when the governing hours of a date are read, then the last started week decides", () => {
  // given
  const grid = { openingWeeks: [week(null, "06:00"), week("2030-03-13", "09:00")] };
  // when / then
  assert.equal(governingHours(grid, "2030-03-12").opensAt, "06:00");
  assert.equal(governingHours(grid, "2030-03-13").opensAt, "09:00");
});

test("given windows before and after the change from summer time, when the first lane becomes an instant, then both keep their local hour", () => {
  // given
  const before = planLanes({ start: "2026-10-19", courts: [1, 3, 2], hoursOf: open("06:00", "23:00") });
  const after = planLanes({ start: "2026-10-26", courts: [1, 3, 2], hoursOf: open("06:00", "23:00") });
  // when
  const instant = (plan) => at(plan.slots[0].date, plan.slots[0].start, "Europe/Berlin").toISOString();
  // then
  assert.equal(instant(before), "2026-10-19T04:00:00.000Z", "summer time is two hours ahead");
  assert.equal(instant(after), "2026-10-26T05:00:00.000Z", "winter time is one hour ahead");
});

test("given a later week in the schedule, when the week in force on a day is read, then its seven days come back without its start", () => {
  // given
  const grid = { openingWeeks: [week(null, "06:00"), week("2030-03-13", "09:00")] };
  // when
  const days = weekInForce(grid, "2030-03-16");
  // then
  assert.equal(days.length, 7);
  assert.ok(days.every((day) => day.opensAt === "09:00"), "the later week governs");
  assert.ok(days.every((day) => !("effectiveFrom" in day)));
});

const lanePlanOf = (slots) => ({ saturday: "2030-03-16", sunday: "2030-03-17", slots });
const lane = { profile: "desktop-chrome", journey: "singles", date: "2030-03-13", court: 2, start: "08:00", end: "09:00" };
const everyDay = (opensAt, closesAt) => ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
  .map((dayOfWeek) => ({ dayOfWeek, opensAt, closesAt }));
const courtsOf = [{ id: "court-1", number: 1 }, { id: "court-2", number: 2 }];

test("given a holiday that closes a lane's day, when the lanes are checked, then the holiday and the lane are named", () => {
  // given
  const grid = { openingPeriods: [{ kind: "HOLIDAY", name: "Founding day", startsOn: "2030-03-13", endsOn: "2030-03-13", days: everyDay(null, null) }], courtClosures: [] };
  // when
  const conflicts = availabilityConflicts(grid, lanePlanOf([lane]), courtsOf);
  // then
  assert.deepEqual(conflicts, ['holiday "Founding day" closes 2030-03-13, the day of lane desktop-chrome/singles 08:00-09:00']);
});

test("given a season whose hours leave out a lane, when the lanes are checked, then its hours are named", () => {
  // given
  const grid = { openingPeriods: [{ kind: "SEASON", name: "Winter", startsOn: "2030-03-01", endsOn: "2030-03-31", days: everyDay("09:00:00", "20:00:00") }], courtClosures: [] };
  // when
  const conflicts = availabilityConflicts(grid, { ...lanePlanOf([lane]), saturday: "2030-04-06", sunday: "2030-04-07" }, courtsOf);
  // then
  assert.deepEqual(conflicts, ['season "Winter" opens 2030-03-13 only 09:00 to 20:00, outside lane desktop-chrome/singles 08:00-09:00']);
});

test("given a season with longer hours and a holiday inside it that keeps the lane open, when the lanes are checked, then the holiday decides and nothing conflicts", () => {
  // given
  const grid = { openingPeriods: [
    { kind: "SEASON", name: "Winter", startsOn: "2030-03-01", endsOn: "2030-03-12", days: everyDay("09:00:00", "20:00:00") },
    { kind: "HOLIDAY", name: "Open day", startsOn: "2030-03-13", endsOn: "2030-03-13", days: everyDay("07:00:00", "21:00:00") }], courtClosures: [] };
  // when / then
  assert.deepEqual(availabilityConflicts(grid, lanePlanOf([lane]), courtsOf), []);
});

test("given a closure of a lane's court and one of another court, when the lanes are checked, then only the lane's court is named", () => {
  // given
  const grid = { openingPeriods: [], courtClosures: [
    { courtId: "court-2", name: "Resurfacing", startsOn: "2030-03-10", endsOn: "2030-03-14" },
    { courtId: "court-1", name: "Lights", startsOn: "2030-03-13", endsOn: "2030-03-13" }] };
  // when
  const conflicts = availabilityConflicts(grid, lanePlanOf([lane]), courtsOf);
  // then
  assert.deepEqual(conflicts, ['court closure "Resurfacing" closes court 2 on 2030-03-13, lane desktop-chrome/singles 08:00-09:00']);
});

test("given a season over the window's weekend, when the lanes are checked, then it is named for the weekend journeys", () => {
  // given
  const grid = { openingPeriods: [{ kind: "SEASON", name: "Spring", startsOn: "2030-03-17", endsOn: "2030-04-30", days: everyDay("06:00:00", "23:00:00") }], courtClosures: [] };
  // when
  const conflicts = availabilityConflicts(grid, lanePlanOf([]), courtsOf);
  // then
  assert.deepEqual(conflicts, ['season "Spring" covers 2030-03-17 and would override the weekly hours the weekend journeys change']);
});

test("given a Saturday slot, when its later opening is read, then it is one hour after the slot ends", () => {
  // when / then
  assert.equal(laterOpeningOf({ start: "08:00", end: "09:00" }), "10:00");
});

test("given club bookings on the window's weekend, when the weekend journeys are checked, then those a later opening or a closed Sunday would displace are named", () => {
  // given
  const plan = { saturday: "2030-03-16", sunday: "2030-03-17", timeZone: "UTC", slots: [
    { journey: "saturday-opening", date: "2030-03-16", start: "08:00", end: "09:00" },
    { journey: "saturday-opening", date: "2030-03-16", start: "09:00", end: "10:00" }] };
  const saturday = [
    { bookingId: "early", startsAt: "2030-03-16T10:00:00Z", endsAt: "2030-03-16T11:00:00Z" },
    { bookingId: "late", startsAt: "2030-03-16T11:00:00Z", endsAt: "2030-03-16T12:00:00Z" }];
  const sunday = [{ bookingId: "sunday", startsAt: "2030-03-17T15:00:00Z", endsAt: "2030-03-17T16:00:00Z" }];
  // when
  const conflicts = weekendConflicts({ plan, saturday, sunday });
  // then
  assert.deepEqual(conflicts, ["early", "sunday"], "a booking before the latest later opening and every Sunday booking would be displaced");
});

import { admitted, answers, sweepSlots, weeksToClear, attribute, classify, classifyErrors, foreignWordings, occupying, replayEntries } from "../acceptance/lib/core.mjs";
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

test("given a reserved slot holding a booking of this run and one of somebody else, when swept, then only the run's booking is cancelled", async () => {
  // given
  const occupants = { rebook: ["ours", "foreign"] };
  const cancelled = [];
  // when
  const outcome = await sweepSlots({
    slots: [{ journey: "rebook" }],
    read: async (slot) => occupants[slot.journey].filter((id) => !cancelled.includes(id)),
    cancel: async (id) => { cancelled.push(id); return 204; },
    ours: new Set(["ours"])
  });
  // then
  assert.deepEqual(cancelled, ["ours"], "a foreign booking is never cancelled");
  assert.deepEqual(outcome, { removed: [{ journey: "rebook", id: "ours", status: 204 }], left: [], foreign: [{ journey: "rebook", id: "foreign" }] });
});

test("given a booking of this run that could not be cancelled, when swept, then it is reported as left", async () => {
  // when
  const outcome = await sweepSlots({ slots: [{ journey: "guest" }], read: async () => ["ours"], cancel: async () => 409, ours: new Set(["ours"]) });
  // then
  assert.deepEqual(outcome.left, [{ journey: "guest", id: "ours" }]);
});

test("given future weeks of the run and of the club, when the weekend is cleared, then only the run's weeks are removed and the club's are named", () => {
  // when
  const plan = weeksToClear({ scheduled: ["2030-03-16", "2030-04-01"], ours: new Set(["2030-03-16", "2030-03-17"]) });
  // then
  assert.deepEqual(plan, { remove: ["2030-03-16"], foreign: ["2030-04-01"] });
});

test("given a ledger with an opening week, when replayed, then that week's schedule entry is removed", async () => {
  // given
  const paths = [];
  // when
  await replayEntries([{ kind: "opening-week", id: "2030-03-16" }], async (path) => { paths.push(path); return { status: () => 204 }; });
  // then
  assert.deepEqual(paths, ["/api/admin/opening-hours/schedule/2030-03-16"]);
});

test("given a ledger with a season and a court closure, when replayed, then each is removed through its own path", async () => {
  // given
  const paths = [];
  // when
  await replayEntries([{ kind: "opening-period", id: "p-1" }, { kind: "court-closure", id: "c-1" }], async (path) => { paths.push(path); return { status: () => 204 }; });
  // then
  assert.deepEqual(paths, ["/api/admin/opening-periods/p-1", "/api/admin/court-closures/c-1"]);
});

test("given a ledger with a message wording, when replayed, then that wording is reset", async () => {
  // given
  const paths = [];
  // when
  await replayEntries([{ kind: "template", id: "ACCOUNT_USERNAME_REMINDER/de" }], async (path) => { paths.push(path); return { status: () => 204 }; });
  // then
  assert.deepEqual(paths, ["/api/admin/message-templates/ACCOUNT_USERNAME_REMINDER/de"]);
});

test("given stored wordings, when the run's own are known, then only the others are named as foreign", () => {
  // given
  const templates = [
    { kind: "ACCOUNT_USERNAME_REMINDER", languages: [{ language: "de", own: { subject: "s", body: "b" } }, { language: "en", own: null }] },
    { kind: "BOOKING_CONFIRMED", languages: [{ language: "de", own: null }, { language: "en", own: { subject: "s", body: "b" } }] }
  ];
  // when
  const foreign = foreignWordings(templates, [{ kind: "template", id: "ACCOUNT_USERNAME_REMINDER/de" }]);
  // then
  assert.deepEqual(foreign, ["BOOKING_CONFIRMED/en"]);
});

const answer = (status, retryAfter) => ({ status: () => status, headers: () => (retryAfter ? { "retry-after": retryAfter } : {}) });

test("given a sign-in refused for capacity, when admitted, then it is sent again after the Retry-After the instance named", async () => {
  // given
  const answers = [answer(429, "2"), answer(200)];
  const waits = [];
  // when
  const response = await admitted(async () => answers.shift(), async (ms) => { waits.push(ms); });
  // then
  assert.equal(response.status(), 200, "the second attempt's answer is returned");
  assert.deepEqual(waits, [2000], "the wait follows Retry-After");
});

test("given an instance that keeps refusing, when admitted, then the fifth refusal is returned instead of waiting forever", async () => {
  // given
  let calls = 0;
  // when
  const response = await admitted(async () => { calls++; return answer(429); }, async () => undefined);
  // then
  assert.equal(response.status(), 429);
  assert.equal(calls, 5, "five attempts and no more");
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

import { assertPrivacySafe, forbiddenTerms, releaseSummary } from "../acceptance/report/release-summary.mjs";

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

test("given a configuration and a roster, when the forbidden terms are built, then every disposable, every roster name and the bare host are in them", () => {
  // given
  const config = { baseUrl: "https://club.example.org:8443", personas: { admin: "jane.doe", disposable: "john.major" }, disposables: ["john.major", "mary.roe"] };
  const discovery = { roster: [{ username: "richard.doe", firstName: "Richard", lastName: "Doe" }, { username: null, firstName: "Mary", lastName: "Major" }] };
  // when
  const terms = forbiddenTerms(config, discovery);
  // then
  assert.ok(terms.usernames.includes("mary.roe"), "the second disposable is forbidden");
  assert.ok(terms.usernames.includes("richard.doe"), "a roster username is forbidden");
  assert.deepEqual(terms.hosts, ["club.example.org"], "the host without its port");
  assert.deepEqual(terms.names, ["Richard Doe", "Doe, Richard", "Mary Major", "Major, Mary"], "full names in both orders are forbidden");
  assert.deepEqual(terms.nameParts, ["Richard", "Doe", "Mary", "Major"], "each name part is forbidden as written");
});

test("given a roster surname that the summary template uses, when summarised, then only the written review text is checked for it", () => {
  // given
  const terms = { usernames: [], hosts: [], names: [], nameParts: ["Acceptance", "Admin"] };
  const summarise = (reason) => releaseSummary({ version: "1", runId: "r", harnessCommit: "c", cells: { passed: 1, failed: 0, skipped: 0 },
    reviewed: { ...reviewed, findings: [{ ...reviewed.findings[0], review: { ...reviewed.findings[0].review, reason } }] }, forbidden: terms });
  // when / then
  assert.match(summarise("A heading level is skipped."), /Acceptance of 1/, "the template's own heading is not a name");
  assert.throws(() => summarise("Seen by Admin only."), /person/, "a name in the review text is refused");
});

test("given roster entries named like ordinary words, when the summary uses those words, then it is not refused", () => {
  // given
  const terms = forbiddenTerms({ baseUrl: "https://club.example.org", personas: {}, disposables: [] }, { roster: [{ username: "test.admin", firstName: "Test", lastName: "Admin" }] });
  // when / then
  assert.doesNotThrow(() => assertPrivacySafe("The admin signs in again before saving.", terms));
  assert.throws(() => assertPrivacySafe("Reported by Test Admin.", terms), /person/);
  assert.throws(() => assertPrivacySafe("Seen by Admin only.", terms), /person/, "a capitalised name part alone is refused");
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
  assert.equal(first[0].title, second[0].title, "the host is not part of the title");
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

import { findFont } from "../acceptance/report/sheets.mjs";

test("given font directories, when a font for the sheet labels is looked up, then a TrueType file is found and a missing directory is skipped", () => {
  // given
  const root = mkdtempSync(join(tmpdir(), "acceptance-fonts-"));
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested", "Sans.ttf"), "");
  writeFileSync(join(root, "readme.txt"), "");
  // when / then
  assert.equal(findFont([join(root, "missing"), root]), join(root, "nested", "Sans.ttf"));
  assert.equal(findFont([join(root, "missing")]), null);
  rmSync(root, { recursive: true, force: true });
});

import { resultsFileFor } from "../acceptance/run.mjs";

test("when the postflight runs alone, then it writes its own results file and the matrix keeps results.json", () => {
  // when / then
  assert.equal(resultsFileFor(["postflight"]), "postflight-results.json");
  assert.equal(resultsFileFor(["desktop-chrome", "ipad"]), "results.json");
});

import { disposableFor, DISPOSABLE_PROFILES, resetQuota } from "../acceptance/config/disposables.mjs";

test("given several disposable accounts, when parsed, then all are kept in order and the first stands for the role", () => {
  // given
  const raw = valid(); raw.personas.disposable = ["jane.spare", "john.spare", "mary.spare"];
  // when
  const config = parseConfig(raw, env);
  // then
  assert.deepEqual(config.disposables, ["jane.spare", "john.spare", "mary.spare"]);
  assert.equal(config.personas.disposable, "jane.spare");
  assert.deepEqual(parseConfig(valid(), env).disposables, ["jane.disposable"]);
});

test("given an empty disposable list or a disposable account that repeats another actor, when parsed, then personas.disposable is refused", () => {
  // given
  const empty = valid(); empty.personas.disposable = [];
  const repeated = valid(); repeated.personas.disposable = ["jane.spare", "jane.spare"];
  const shared = valid(); shared.personas.disposable = ["jane.spare", shared.personas.memberA];
  // when / then
  for (const raw of [empty, repeated, shared]) assert.equal(field(raw), "personas.disposable");
});

test("given three accounts, when the disposable profiles ask for theirs, then each gets its own and other profiles get the first", () => {
  // given
  const accounts = ["jane.spare", "john.spare", "mary.spare"];
  // when
  const assigned = DISPOSABLE_PROFILES.map((profile) => disposableFor(profile, accounts));
  // then
  assert.deepEqual(new Set(assigned).size, 3);
  assert.equal(disposableFor("pixel-7", accounts), "jane.spare");
  assert.equal(disposableFor(DISPOSABLE_PROFILES[2], ["jane.spare"]), "jane.spare");
});

test("given reset codes sent in the last hour, when the quota is asked, then a run starts only if its codes fit and otherwise names when they will", () => {
  // given
  const now = Date.parse("2030-03-11T10:00:00Z");
  const sent = ["2030-03-11T09:10:00Z", "2030-03-11T09:20:00Z", "2030-03-11T09:30:00Z", "2030-03-11T08:30:00Z"].map(Date.parse);
  // when
  const fits = resetQuota({ sentAt: sent, now, perHour: 5, needed: 2 });
  const tight = resetQuota({ sentAt: sent, now, perHour: 5, needed: 4 });
  // then
  assert.deepEqual(fits, { ok: true, sentInLastHour: 3, freeAt: null });
  assert.deepEqual(tight, { ok: false, sentInLastHour: 3, freeAt: "2030-03-11T10:20:00.000Z" });
});

test("given no reset limit or a configured one, when parsed, then the instance default of five applies or the configured one, and a non-positive one is refused", () => {
  // when / then
  assert.equal(parseConfig(valid(), env).resetCodesPerHour, 5);
  assert.equal(parseConfig({ ...valid(), resetCodesPerHour: 8 }, env).resetCodesPerHour, 8);
  assert.equal(field({ ...valid(), resetCodesPerHour: 0 }), "resetCodesPerHour");
});


const response = (method, url) => ({ url: () => url, request: () => ({ method: () => method }) });

test("given a request the client sends with a query, when a journey waits for its path, then the answer is recognised", () => {
  // given
  const cancel = answers("DELETE", "/api/bookings/42");
  // when / then
  assert.equal(cancel(response("DELETE", "https://club.example.org/api/bookings/42?")), true, "an empty query still names the booking");
  assert.equal(cancel(response("DELETE", "https://club.example.org/api/bookings/42?reason=RAIN")), true, "a reason in the query still names the booking");
  assert.equal(cancel(response("DELETE", "https://club.example.org/api/bookings/42")), true, "a request without query still names the booking");
});

test("given another path or method, when a journey waits for an answer, then it is not taken for the awaited one", () => {
  // given
  const cancel = answers("DELETE", "/api/bookings/42");
  // when / then
  assert.equal(cancel(response("GET", "https://club.example.org/api/bookings/42")), false, "a read is no cancellation");
  assert.equal(cancel(response("DELETE", "https://club.example.org/api/bookings/420")), false, "another booking is not this one");
  assert.equal(cancel(response("DELETE", "https://club.example.org/archive/api/bookings/42")), false, "a path that only ends alike is not this one");
  assert.equal(answers("POST", /\/move$/)(response("POST", "https://club.example.org/api/booking-series/7/move?scope=THIS")), true,
    "a pattern matches the path without the query");
});

test("given the acceptance journeys, when they wait for an answer, then they name it by method and path", () => {
  // given
  const directory = new URL("../acceptance/journeys/", import.meta.url);
  const waits = readdirSync(directory).filter((name) => name.endsWith(".ts"))
    .flatMap((name) => [...readFileSync(new URL(name, directory), "utf8").matchAll(/waitForResponse\(([^\n]*)/g)]
      .map((match) => `${name}: ${match[1]}`));
  // when
  const handWritten = waits.filter((wait) => !/: answers\(/.test(wait));
  // then
  assert.ok(waits.length >= 5, "the journeys wait for their answers");
  assert.deepEqual(handWritten, [], "a hand-written URL comparison breaks on the next query the client adds");
});

test("given an account in a category with booking hours, when the restricted persona is configured, then it is kept and an account another actor uses is refused", () => {
  // when / then
  assert.equal(parseConfig({ ...valid(), personas: { ...valid().personas, restricted: "jane.restricted" } }, env).personas.restricted, "jane.restricted");
  assert.equal(parseConfig(valid(), env).personas.restricted, undefined, "the booking-hours journey is optional");
  assert.equal(field({ ...valid(), personas: { ...valid().personas, restricted: "jane.membera" } }), "personas.restricted");
});

test("given welcomeAccounts, when parsed, then it is off unless the operator turns it on and anything but a boolean is refused", () => {
  // when / then
  assert.equal(parseConfig(valid(), env).welcomeAccounts, false, "a run creates no account unless asked to");
  assert.equal(parseConfig({ ...valid(), welcomeAccounts: true }, env).welcomeAccounts, true);
  assert.equal(field({ ...valid(), welcomeAccounts: "yes" }), "welcomeAccounts");
});

import { leavesBookingHours } from "../acceptance/lib/core.mjs";

test("given booking hours, when a lane slot is judged, then a slot that starts before or ends after them leaves them and one inside does not", () => {
  // given
  const hours = { earliestStart: "16:00:00", latestEnd: "21:00:00" };
  // when / then
  assert.equal(leavesBookingHours({ start: "08:00", end: "09:00" }, hours), true, "a morning slot starts before the window");
  assert.equal(leavesBookingHours({ start: "20:00", end: "21:00" }, hours), false, "a slot that ends with the window lies inside it");
  assert.equal(leavesBookingHours({ start: "16:00", end: "17:00" }, hours), false, "a slot that starts with the window lies inside it");
  assert.equal(leavesBookingHours({ start: "20:30", end: "21:30" }, hours), true, "a slot that runs past the window leaves it");
});

import { laneLimitConflicts, limitRefusals } from "../acceptance/lib/core.mjs";

test("given the personas' eligibility, when the lanes are checked, then a weekly limit or a minimum longer than a lane is named and absent limits pass", () => {
  // given
  const eligibility = {
    memberA: { violations: [] },
    memberB: { violations: [], maxWeeklyBookedHours: 40 },
    memberC: { violations: [], minBookingMinutes: 90 },
    trainer: { violations: [], minBookingMinutes: 60, maxBookingMinutes: 120 }
  };
  // when
  const conflicts = laneLimitConflicts(eligibility, 60);
  // then
  assert.deepEqual(conflicts, ["memberB: at most 40 h a week", "memberC: at least 90 minutes per booking"],
    "a weekly limit can stop a later lane and a minimum longer than a lane stops every one; a minimum a lane meets passes");
});

test("given a weekly limit and a minimum, when the journey plans its refused requests, then one is short of the minimum and one passes the week", () => {
  // when
  const refusals = limitRefusals({ maxWeeklyBookedHours: 1, minBookingMinutes: 60 }, 30);
  // then
  assert.deepEqual(refusals, { shortMinutes: 30, longMinutes: 90 }, "30 minutes miss a 60-minute minimum and 90 pass a one-hour week");
  assert.equal(limitRefusals({ maxWeeklyBookedHours: 1, minBookingMinutes: 30 }, 30), null,
    "a minimum of one grid cell leaves no shorter period on the grid, so the journey cannot ask for one");
  assert.equal(limitRefusals({ minBookingMinutes: 60 }, 30), null, "without a weekly limit the journey has nothing to pass");
});

test("given an erasure target, when parsed, then host and container are kept, and a host that could pass for an option or carries a shell character is refused", () => {
  // when / then
  assert.deepEqual(parseConfig({ ...valid(), erasure: { ssh: "ops-host", container: "club-db-1" } }, env).erasure, { ssh: "ops-host", container: "club-db-1" });
  assert.equal(parseConfig(valid(), env).erasure, undefined, "without a target nothing is erased");
  assert.equal(field({ ...valid(), erasure: { ssh: "-oProxyCommand=x", container: "club-db-1" } }), "erasure.ssh");
  assert.equal(field({ ...valid(), erasure: { ssh: "ops-host", container: "db;rm" } }), "erasure.container");
  assert.equal(field({ ...valid(), erasure: { ssh: "ops-host", container: "club-db-1", user: "root" } }), "erasure.user");
});

import { deactivationLeftover, erasureCommand, erasedCount, waitlistErasureSql, welcomeErasureSql } from "../acceptance/lib/core.mjs";

test("given the persons a run recorded, when the erasure is written, then it names exactly them and erases only a deactivated welcome account nothing depends on", () => {
  // given
  const ids = ["3f2b1c4d-0000-4000-8000-000000000001", "3f2b1c4d-0000-4000-8000-000000000002"];
  // when
  const sql = welcomeErasureSql(ids);
  // then
  for (const id of ids) assert.ok(sql.includes(`'${id}'`), `the erasure names ${id}`);
  assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/, "the erasure is one transaction");
  for (const guard of ["NOT ua.enabled", "ua.username LIKE 'acceptance-welcome-%'", "p.email LIKE 'acceptance-welcome-%'", "booking b WHERE b.booked_by", "member m WHERE", "booking_participant", "waitlist_participant", "import_external_reference"]) {
    assert.ok(sql.includes(guard), `the erasure keeps the guard ${guard}`);
  }
  assert.match(sql, /LEFT JOIN user_account ua ON ua\.person_id = p\.id/, "a person whose account was never created is erased too");
  assert.match(sql, /ua\.id IS NULL OR/, "a missing account passes the account guards");
  assert.equal(welcomeErasureSql([]), null, "a run that created no account erases nothing");
  assert.throws(() => welcomeErasureSql(["1'; DROP TABLE person; --"]), /not a person id/);
});

test("given the member personas, when the waitlist erasure is written, then it removes only their closed entries in one transaction", () => {
  // given
  const usernames = ["acceptance.member-a", "acceptance.member-b"];
  // when
  const sql = waitlistErasureSql(usernames);
  // then
  assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/, "the erasure is one transaction");
  assert.ok(sql.includes("ua.username IN ('acceptance.member-a', 'acceptance.member-b')"), "the erasure names exactly the personas");
  assert.ok(sql.includes("w.state NOT IN ('WAITING', 'OFFERED')"), "an open entry stays, so a queue is never cut");
  assert.match(sql, /DELETE FROM waitlist_entry WHERE id IN \(SELECT id FROM erased\)/);
  assert.equal(erasedCount("erased 7\n"), 7, "the count line has the shape the postflight reads");
  assert.throws(() => waitlistErasureSql(["x'); DELETE FROM booking; --"]), /not a username/);
  assert.equal(waitlistErasureSql([]), null, "no persona, no statement");
});

test("given an erasure target, when the command is built, then ssh runs psql in the named container and the statement travels on standard input", () => {
  // when
  const [program, args] = erasureCommand({ ssh: "ops-host", container: "club-db-1" });
  // then
  assert.equal(program, "ssh");
  assert.deepEqual(args, ["-o", "BatchMode=yes", "--", "ops-host",
    `docker exec -i club-db-1 sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At'`],
    "the remote shell receives one quoted command, so the container's shell expands its own variables");
  assert.equal(erasedCount("erased 2\n"), 2);
  assert.equal(erasedCount("ERROR: relation"), null);
});

test("given the deactivation answers, when the postflight judges them, then only a refusal for an existing account is left over", () => {
  // given
  const answers = [
    { personId: "a", status: 200 },
    { personId: "b", status: 404, type: "urn:courtside:error:account-not-found" },
    { personId: "c", status: 404, type: "urn:courtside:error:person-not-found" },
    { personId: "d", status: 403, type: "urn:courtside:error:recent-authentication-required" }
  ];
  // when
  const leftover = deactivationLeftover(answers);
  // then
  assert.deepEqual(leftover.map((answer) => answer.personId), ["c", "d"],
    "a person the run recorded before its account existed has nothing to deactivate, anything else is a leftover");
});
