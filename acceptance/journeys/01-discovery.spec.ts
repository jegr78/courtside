import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { config, disposables, persona, runPath, type PersonaKey } from "../lib/context";
import { addDays, defaultWindowStart, localDate, resolveWindowStart, zonedInstant } from "../config/calendar.mjs";
import { firstUsableWeek, governingHours, LAST_JOURNEY_DAY_AFTER_SUNDAY, lastBookableDay, planLanes, shortestAdvanceWindow } from "../config/lanes.mjs";
import { occupying } from "../lib/core.mjs";
import { openAs } from "../lib/session";
import { apiAs, readRoster } from "../lib/api";
import { PARTNER_MARKER } from "../lib/journey";

test("when the admin reads the club, then discovery, lanes and baseline are written", async ({ browser }) => {
  // when
  const page = await openAs(browser, "admin");
  const api = page.request;
  const grid = await (await api.get("/api/public/booking-grid")).json();
  expect(60 % grid.slotMinutes, `PRECONDITION: the ${grid.slotMinutes}-minute booking grid divides an hour`).toBe(0);
  const timeZone = config.timeZone ?? grid.timeZone;
  const activeCourts = (await (await api.get("/api/public/courts")).json() as { number: number }[]).map((court) => court.number);
  const courts = config.courts ?? activeCourts.slice(0, 3);
  expect(courts.filter((court: number) => !activeCourts.includes(court)), "PRECONDITION: every configured court is active").toEqual([]);
  const hoursOf = (date: string) => governingHours(grid, date);
  const start = config.window.start !== undefined
    ? resolveWindowStart(config.window.start, new Date(), timeZone)
    : await firstFreeWeek(api, { timeZone, courts, hoursOf });
  const lanes = { timeZone, ...planLanes({ start, courts, hoursOf }) };
  writeFileSync(runPath("lanes.json"), JSON.stringify(lanes, null, 2));
  const cards = await (await api.get("/api/admin/booking-cards")).json();
  const participantCards = await (await api.get("/api/admin/participant-cards")).json();
  const roster = { entries: await readRoster(await apiAs("admin")) };
  const keys: PersonaKey[] = ["admin", "trainer", "youth", "sport", "grounds", "treasurer", "memberA", "memberB", "memberC", "disposable",
    ...(config.personas.external ? ["external" as const] : [])];
  const entryOf = (key: PersonaKey) => roster.entries.find((e) => e.username === persona(key).username)!;
  const entryNamed = (username: string) => roster.entries.find((e) => e.username === username)!;
  const days = Object.fromEntries(await Promise.all(lanes.days.map(async (date: string) =>
    [date, await (await api.get(`/api/bookings?date=${date}`)).json()])));
  const active = cards.filter((c: { active: boolean }) => c.active);
  const byRole = (role: string) => active.find((c: { allowedRoles: string[] }) => c.allowedRoles.includes(role))?.id;

  // then
  for (const key of keys) expect(entryOf(key), `${key} is on the roster`).toBeTruthy();
  disposables.forEach((username, index) => expect(entryNamed(username), `disposable ${index + 1} is on the roster`).toBeTruthy());
  writeFileSync(runPath("discovery.json"), JSON.stringify({
    cards, participantCards, partnerMarker: PARTNER_MARKER,
    cardFor: { training: byRole("TRAINER"), youth: byRole("YOUTH_DIRECTOR"), league: byRole("SPORT_DIRECTOR"), closure: byRole("GROUNDSKEEPER"), treasurer: byRole("TREASURER") },
    personIds: Object.fromEntries(keys.map((k) => [k, entryOf(k).personId])),
    emails: Object.fromEntries(keys.map((k) => [k, entryOf(k).email])),
    roster: roster.entries.map((e: { username: string | null; firstName: string; lastName: string }) => ({ username: e.username, firstName: e.firstName, lastName: e.lastName })),
    lastNames: Object.fromEntries([...keys.map((k) => [k, entryOf(k).lastName]), ...disposables.map((u, i) => [`disposable-${i}`, entryNamed(u).lastName])]),
    disposables: Object.fromEntries(disposables.map((username) => {
      const entry = entryNamed(username);
      return [username, { personId: entry.personId, email: entry.email, enabled: entry.enabled, locale: entry.locale ?? null }];
    }))
  }, null, 2));
  writeFileSync(runPath("baseline.json"), JSON.stringify({ days }, null, 2));
});

type Lookup = { get: (path: string) => Promise<{ json: () => Promise<any> }> };

// The club's own bookings move from week to week, so the window is the first week whose lanes are all free.
async function firstFreeWeek(api: Lookup, { timeZone, courts, hoursOf }: { timeZone: string; courts: number[]; hoursOf: (date: string) => unknown }) {
  const courtIds = new Map((await (await api.get("/api/public/courts")).json() as { id: string; number: number }[]).map((court) => [court.number, court.id]));
  const ruleSets = await Promise.all((await (await api.get("/api/admin/rule-sets")).json() as { id: string; active: boolean }[])
    .map(async (set) => ({ ...set, rules: await (await api.get(`/api/admin/rule-sets/${set.id}/rules`)).json() })));
  const advance = shortestAdvanceWindow(ruleSets);
  const latestBookable = lastBookableDay(localDate(new Date(), timeZone), advance, addDays);
  const first = defaultWindowStart(new Date(), timeZone);
  const days = new Map<string, unknown>();
  const weeks = [];
  for (let week = 0; week < 8; week++) {
    const start = addDays(first, 7 * week);
    const plan = planLanes({ start, courts, hoursOf } as never) as { sunday: string; slots: { profile: string; journey: string; date: string; court: number; start: string; end: string }[] };
    const occupied: string[] = [];
    for (const slot of plan.slots) {
      if (!days.has(slot.date)) days.set(slot.date, await (await api.get(`/api/bookings?date=${slot.date}`)).json());
      const ids = occupying(days.get(slot.date) as never, courtIds.get(slot.court)!, zonedInstant(slot.date, slot.start, timeZone), zonedInstant(slot.date, slot.end, timeZone)) as string[];
      occupied.push(...ids.map((id) => `${slot.profile}/${slot.journey} ${slot.date} ${slot.start} court ${slot.court}: ${id}`));
    }
    weeks.push({ start, lastDay: addDays(plan.sunday, LAST_JOURNEY_DAY_AFTER_SUNDAY), occupied });
  }
  const chosen = firstUsableWeek(weeks, latestBookable);
  writeFileSync(runPath("window-choice.json"), JSON.stringify({ chosen, latestBookable, weeks }, null, 2));
  return chosen;
}
