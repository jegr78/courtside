import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { readLedger, replay } from "../lib/ledger";
import { openAs, xsrf } from "../lib/session";
import { adminPut, apiAs } from "../lib/api";
import { allSlots, lanePlan } from "../lib/lanes";
import { sweep } from "../lib/sweep";
import { clearWeekend } from "../lib/weekend";
import { canSignIn, restoreDisposable } from "../lib/disposable";
import { config, disposables, PASSWORD, runPath } from "../lib/context";
import { deactivationLeftover, waitlistErasureSql, welcomeErasureSql } from "../lib/core.mjs";
import { erase } from "../lib/erasure";
import { leaveWaitlist, MEMBERS, openWaitlistEntries } from "../lib/waitlist";

const ids = (day: unknown) => new Set((day as { bookingId?: string; id?: string }[]).map((a) => a.bookingId ?? a.id));

test("when the ledger is replayed, then the window holds no booking of this run", async ({ browser }) => {
  // when
  const page = await openAs(browser, "admin");
  const dry = process.env.CLEANUP_DRY === "1";
  const ledgerIds = new Set(readLedger().map((e) => e.id));
  const before = Object.fromEntries(await Promise.all(lanePlan().days.map(async (d) => [d, await (await page.request.get(`/api/bookings?date=${d}`)).json()])));
  const open = lanePlan().days.flatMap((d) => [...ids(before[d])].filter((id) => ledgerIds.has(id!)).map((id) => ({ date: d, id })));
  const outcome = dry ? [] : await replay(page.request, await xsrf(page), readLedger().filter((e) => open.some((o) => o.id === e.id) || e.kind === "series" || e.kind === "opening-week"));
  const baseline = JSON.parse(readFileSync(runPath("baseline.json"), "utf8")).days;
  const diff = [];
  for (const date of lanePlan().days) {
    const now = ids(await (await page.request.get(`/api/bookings?date=${date}`)).json());
    const was = ids(baseline[date]);
    const added = [...now].filter((id) => !was.has(id));
    const removed = [...was].filter((id) => !now.has(id));
    if (added.length || removed.length) diff.push({ date, added, removed, ours: added.filter((id) => ledgerIds.has(id!)) });
  }
  const weeks = (await (await page.request.get("/api/admin/opening-hours/schedule")).json()) as { effectiveFrom: string | null }[];
  const ourWeeks = new Set(readLedger().filter((e) => e.kind === "opening-week").map((e) => e.id));
  const weeksLeft = weeks.map((w) => w.effectiveFrom).filter((d): d is string => d !== null && ourWeeks.has(d));
  writeFileSync(runPath(`cleanup${dry ? "-dry" : ""}.json`), JSON.stringify({ open, outcome, diff, weeksLeft }, null, 2));
  console.log(JSON.stringify({ open: open.length, failed: outcome.filter((o) => o.outcome === "failed").length, diff }));
  // then
  if (!dry) expect(diff.flatMap((d) => d.ours), "no booking of this run is left in the window").toEqual([]);
  if (!dry) expect(weeksLeft, "no opening week this run scheduled is left").toEqual([]);
});

test("when the run ends, then no reserved slot holds a booking of this run, no week is scheduled and the disposable member signs in with the shared password", async () => {
  const admin = await apiAs("admin");
  // when
  const { removed, left, foreign } = await sweep(admin, allSlots());
  const weeks = await clearWeekend();
  for (const username of disposables) await restoreDisposable(username);
  for (const key of MEMBERS) await leaveWaitlist(key, allSlots());
  const accounts = await Promise.all(readLedger().filter((entry) => entry.kind === "account").map(async (entry) => {
    const answer = await adminPut(admin, `/api/admin/roster/${entry.id}/account/active`, { active: false });
    const type = answer.status() >= 300 ? (await answer.json().catch(() => ({})) as { type?: string }).type : undefined;
    return { personId: entry.id, status: answer.status(), type };
  }));
  const erasure = erase(welcomeErasureSql(accounts.map((account) => account.personId)), "erase-welcome-accounts.sql");
  const waitlistErasure = erase(waitlistErasureSql(MEMBERS.map((key) => config.personas[key])), "erase-waitlist-entries.sql");
  const queued = Object.fromEntries(await Promise.all(MEMBERS.map(async (key) => [key, (await openWaitlistEntries(key, allSlots())).length])));
  writeFileSync(runPath("postflight.json"), JSON.stringify({ removed, left, foreign, weeks: weeks.removed, foreignWeeks: weeks.foreign, queued, accounts, erasure, waitlistErasure }, null, 2));
  // then
  expect(left, "no reserved slot holds a booking of this run").toEqual([]);
  expect(queued, "no member is left waiting on a waitlist").toEqual({ memberA: 0, memberB: 0, memberC: 0 });
  expect(deactivationLeftover(accounts), "every account this run created is deactivated").toEqual([]);
  if (erasure.attempted) expect(erasure.erased, `every welcome account this run created is erased (exit ${erasure.exit})`).toBe(accounts.length);
  if (waitlistErasure.attempted) expect(waitlistErasure.exit, "the members' closed waitlist entries are erased").toBe(0);
  for (const [index, username] of disposables.entries()) expect(await canSignIn(PASSWORD, username), `disposable ${index + 1} signs in`).toBe(true);
});
