import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { config, disposables, persona, runPath, type PersonaKey } from "../lib/context";
import { resolveWindowStart } from "../config/calendar.mjs";
import { governingHours, planLanes } from "../config/lanes.mjs";
import { openAs } from "../lib/session";
import { apiAs, readRoster } from "../lib/api";

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
  const start = resolveWindowStart(config.window.start, new Date(), timeZone);
  const lanes = { timeZone, ...planLanes({ start, courts, hoursOf: (date: string) => governingHours(grid, date) }) };
  writeFileSync(runPath("lanes.json"), JSON.stringify(lanes, null, 2));
  const cards = await (await api.get("/api/admin/booking-cards")).json();
  const participantCards = await (await api.get("/api/admin/participant-cards")).json();
  const roster = { entries: await readRoster(await apiAs("admin")) };
  const keys: PersonaKey[] = ["admin", "trainer", "youth", "sport", "grounds", "treasurer", "memberA", "memberB", "memberC", "disposable"];
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
    cards, participantCards,
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
