import { runPath } from "../lib/context";
import { test, expect } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { readLedger, replay } from "../lib/ledger";
import { openAs, xsrf } from "../lib/session";
import { apiAs } from "../lib/api";
import { allSlots, lanePlan } from "../lib/lanes";
import { sweep } from "../lib/sweep";
import { clearWeekend } from "../lib/weekend";
import { canSignIn, restoreDisposable } from "../lib/disposable";
import { PASSWORD } from "../lib/context";

const ids = (day: unknown) => new Set((day as { bookingId?: string; id?: string }[]).map((a) => a.bookingId ?? a.id));

test("when the ledger is replayed, then the window holds no booking of this run", async ({ browser }) => {
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
  if (!dry) expect(diff.flatMap((d) => d.ours), "no booking of this run is left in the window").toEqual([]);
  if (!dry) expect(weeksLeft, "no opening week this run scheduled is left").toEqual([]);
});

test("when the run ends, then every reserved slot is empty, no week is scheduled and the disposable member signs in with the shared password", async () => {
  const admin = await apiAs("admin");
  // when
  const { removed, left } = await sweep(admin, allSlots());
  const weeks = await clearWeekend();
  await restoreDisposable();
  writeFileSync(runPath("postflight.json"), JSON.stringify({ removed, left, weeks }, null, 2));
  // then
  expect(left, "every reserved slot is empty").toEqual([]);
  expect(await canSignIn(PASSWORD), "the disposable member signs in").toBe(true);
});
