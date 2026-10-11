import { runPath } from "../lib/context";
import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { persona, type PersonaKey } from "../lib/context";
import { resolveWindowStart } from "../config/calendar.mjs";
import { governingHours, planLanes } from "../config/lanes.mjs";
import { config } from "../lib/context";
import { openAs, xsrf } from "../lib/session";

test("when the admin reads the club, then discovery, lanes and baseline are written", async ({ browser }) => {
  // when
  const page = await openAs(browser, "admin");
  const api = page.request;
  const headers = { "X-XSRF-TOKEN": await xsrf(page) };
  const grid = await (await api.get("/api/public/booking-grid")).json();
  const timeZone = config.timeZone ?? grid.timeZone;
  const activeCourts = (await (await api.get("/api/public/courts")).json() as { number: number }[]).map((court) => court.number);
  const courts = config.courts ?? activeCourts.slice(0, 3);
  expect(courts.filter((court: number) => !activeCourts.includes(court)), "PRECONDITION: every configured court is active").toEqual([]);
  const start = resolveWindowStart(config.window.start, new Date(), timeZone);
  const lanes = { timeZone, ...planLanes({ start, courts, hoursOf: (date: string) => governingHours(grid, date) }) };
  writeFileSync(runPath("lanes.json"), JSON.stringify(lanes, null, 2));
  const cards = await (await api.get("/api/admin/booking-cards")).json();
  const participantCards = await (await api.get("/api/admin/participant-cards")).json();
  const rosterResponse = await api.post("/api/admin/roster-search", { data: {}, headers });
  const roster = await rosterResponse.json();
  writeFileSync(runPath("roster-raw-shape.json"), JSON.stringify({ status: rosterResponse.status(), keys: Object.keys(roster), count: roster.entries?.length, matching: roster.matching, sampleKeys: Object.keys(roster.entries?.[0] ?? {}) }, null, 2));
  const keys: PersonaKey[] = ["admin", "trainer", "youth", "sport", "grounds", "treasurer", "memberA", "memberB", "memberC", "disposable"];
  const entryOf = (key: PersonaKey) => roster.entries.find((e: { username: string }) => e.username === persona(key).username);
  const days = Object.fromEntries(await Promise.all(lanes.days.map(async (date: string) =>
    [date, await (await api.get(`/api/bookings?date=${date}`)).json()])));
  const active = cards.filter((c: { active: boolean }) => c.active);
  const byRole = (role: string) => active.find((c: { allowedRoles: string[] }) => c.allowedRoles.includes(role))?.id;

  // then
  for (const key of keys) expect(entryOf(key), `${key} is on the roster`).toBeTruthy();
  writeFileSync(runPath("discovery.json"), JSON.stringify({
    cards, participantCards,
    cardFor: { training: byRole("TRAINER"), youth: byRole("YOUTH_DIRECTOR"), league: byRole("SPORT_DIRECTOR"), closure: byRole("GROUNDSKEEPER"), treasurer: byRole("TREASURER") },
    personIds: Object.fromEntries(keys.map((k) => [k, entryOf(k).personId])),
    emails: Object.fromEntries(keys.map((k) => [k, entryOf(k).email])),
    lastNames: Object.fromEntries(keys.map((k) => [k, entryOf(k).lastName])),
    disposable: { enabled: entryOf("disposable").enabled, locale: entryOf("disposable").locale ?? null }
  }, null, 2));
  writeFileSync(runPath("baseline.json"), JSON.stringify({ days }, null, 2));
});
