import { test, expect } from "@playwright/test";
import { loadavg } from "node:os";
import { writeFileSync } from "node:fs";
import { apiAs, readRoster } from "../lib/api";
import { canSignIn } from "../lib/disposable";
import { allSlots, instantOf, lanePlan } from "../lib/lanes";
import { availabilityConflicts, governingHours, weekendConflicts } from "../config/lanes.mjs";
import { addDays } from "../config/calendar.mjs";
import { config, disposables, PASSWORD, runPath, type PersonaKey } from "../lib/context";
import { mailAvailable } from "../lib/mail";
import { DISPOSABLE_PROFILES, disposableFor, profilesOf, resetQuota } from "../config/disposables.mjs";
import { attendanceErasureSql, foreignWordings, laneLimitConflicts, leavesBookingHours, occupying, waitlistErasureSql } from "../lib/core.mjs";
import { noShowLimitFor, personaUsernames } from "../lib/attendance";
import { readLedger } from "../lib/ledger";
import { erase } from "../lib/erasure";
import { PARTNER_MARKER } from "../lib/journey";
import { MEMBERS } from "../lib/waitlist";


test("when the environment is checked before a run, then every precondition holds", async () => {
  // when
  const admin = await apiAs("admin");
  const checks: Record<string, unknown> = {};
  try {
    const source = await (await admin.get("/api/source")).json();
    checks.version = source.version;
    checks.mail = config.mail ? await fetch(`${config.mail.url}/api/v1/info`).then((r) => r.ok, () => false) : "not configured";
    checks.metrics = config.metrics ? await fetch(`${config.metrics.url}?query=up`).then((r) => r.json()).then((j) => j.status, () => "unreachable") : "not configured";
    checks.windowStart = allSlots()[0]?.date ?? null;
    checks.load = loadavg()[0];
    checks.waitlistErasure = checks.version === config.expectedVersion
      ? erase(waitlistErasureSql(MEMBERS.map((key) => config.personas[key])), "erase-waitlist-entries-before.sql")
      : { attempted: false };
    checks.attendanceErasure = checks.version === config.expectedVersion
      ? erase(attendanceErasureSql(personaUsernames()), "erase-attendance-before.sql")
      : { attempted: false };
    checks.attendanceRecorded = (await (await admin.get("/api/admin/attendance-policy")).json() as { enabled?: boolean }).enabled === true;
    const noShowWalker = disposableFor(DISPOSABLE_PROFILES[0], disposables);
    const noShowPerson = (await readRoster(admin)).find((entry) => entry.username === noShowWalker)?.personId;
    checks.disposableNoShowLimit = noShowPerson ? await noShowLimitFor(admin, noShowPerson) : null;
    checks.noShowSeedable = config.erasure !== undefined;
    const courts = await (await admin.get("/api/public/courts")).json() as { id: string; number: number }[];
    const days = new Map<string, unknown>();
    for (const slot of allSlots()) if (!days.has(slot.date)) days.set(slot.date, await (await admin.get(`/api/bookings?date=${slot.date}`)).json());
    checks.occupiedSlots = allSlots().flatMap((s) => occupying(days.get(s.date) as never, courts.find((c) => c.number === s.court)!.id,
      instantOf(s, "start"), instantOf(s, "end")).map((id) => `${s.profile}/${s.journey}: ${id}`));
    const plan = lanePlan();
    checks.weekendConflicts = weekendConflicts({ plan, saturday: days.get(plan.saturday) as never ?? [],
      sunday: await (await admin.get(`/api/bookings?date=${plan.sunday}`)).json() });
    const open: Record<string, number> = {};
    const eligibility: Record<string, { maxWeeklyBookedHours?: number; minBookingMinutes?: number }> = {};
    for (const key of ["memberA", "memberB", "memberC", "trainer", "youth", "sport", "grounds"] as PersonaKey[]) {
      const api = await apiAs(key);
      eligibility[key] = await (await api.get("/api/booking-eligibility")).json();
      let count = 0; let cursor: string | undefined;
      do {
        const page = await (await api.get(`/api/my/bookings?limit=50${cursor ? `&cursor=${cursor}` : ""}`)).json();
        count += page.items.filter((b: { status: string; endsAt: string }) => b.status === "CONFIRMED" && Date.parse(b.endsAt) > Date.now()).length;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      open[key] = count;
      await api.dispose();
    }
    checks.openBookings = open;
    checks.laneLimitConflicts = laneLimitConflicts(eligibility, 60);
    checks.disposablesSignIn = Object.fromEntries(await Promise.all(disposables.map(async (username, index) => [`disposable ${index + 1}`, await canSignIn(PASSWORD, username)])));
    const weeks = await (await admin.get("/api/admin/opening-hours/schedule")).json() as { effectiveFrom: string | null }[];
    checks.futureWeeks = weeks.slice(1).map((w) => w.effectiveFrom);
    const grid = await (await admin.get(`/api/public/booking-grid?from=${plan.days[0]}&to=${plan.days.at(-1)}`)).json();
    checks.availabilityConflicts = availabilityConflicts(grid, { ...plan, slots: allSlots() }, courts);
    const noticeDay = addDays(plan.sunday, 10);
    const noticeGrid = await (await admin.get(`/api/public/booking-grid?from=${noticeDay}&to=${noticeDay}`)).json() as
      { openingPeriods: { startsOn: string; endsOn: string }[]; courtClosures: { startsOn: string; endsOn: string }[] };
    checks.closureNoticeDay = {
      day: noticeDay,
      covered: [...noticeGrid.openingPeriods, ...noticeGrid.courtClosures].some((entry) => entry.startsOn <= noticeDay && noticeDay <= entry.endsOn),
      opens: governingHours(noticeGrid, noticeDay).opensAt !== null
    };
    const participantCards = await (await admin.get("/api/admin/participant-cards")).json() as { id: string; active: boolean }[];
    checks.partnerMarkerActive = participantCards.some((card) => card.id === PARTNER_MARKER && card.active);
    checks.foreignWordings = foreignWordings(await (await admin.get("/api/admin/message-templates")).json(), readLedger());
    if (config.personas.restricted) {
      const restricted = await apiAs("restricted");
      const { bookingHours } = await (await restricted.get("/api/booking-eligibility")).json() as { bookingHours?: { earliestStart: string; latestEnd: string } | null };
      const earliest = allSlots().filter((slot) => slot.journey === "singles");
      checks.restrictedHours = bookingHours ?? null;
      const limits = await (await restricted.get("/api/booking-eligibility")).json() as { maxWeeklyBookedHours?: number; minBookingMinutes?: number };
      checks.restrictedLimits = { maxWeeklyBookedHours: limits.maxWeeklyBookedHours ?? null, minBookingMinutes: limits.minBookingMinutes ?? null };
      checks.restrictedLanesInside = bookingHours ? earliest.filter((slot) => !leavesBookingHours(slot, bookingHours)).map((slot) => `${slot.profile} ${slot.start}`) : [];
    }
    const roster = { entries: await readRoster(admin) };
    const resetQuotas: Record<string, unknown> = {};
    for (const [index, username] of disposables.entries()) {
      const email = roster.entries.find((e) => e.username === username)?.email;
      const mails = mailAvailable()
        ? await fetch(`${config.mail!.url}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`).then((r) => r.json(), () => ({ messages: [] }))
        : { messages: [] };
      const sentAt = (mails.messages ?? []).filter((m: { Subject: string }) => /Code|code/.test(m.Subject)).map((m: { Created: string }) => Date.parse(m.Created));
      resetQuotas[`disposable ${index + 1}`] = resetQuota({ sentAt, now: Date.now(), perHour: config.resetCodesPerHour, needed: profilesOf(username, disposables).length + 1 });
    }
    checks.resetQuotas = resetQuotas;
  } finally {
    writeFileSync(runPath("preflight.json"), JSON.stringify(checks, null, 2));
    await admin.dispose();
  }
  // then
  expect.soft(checks.version, `PRECONDITION: the instance runs ${config.expectedVersion}`).toBe(config.expectedVersion);
  if (config.mail) expect.soft(checks.mail, "PRECONDITION: the mail API answers").toBe(true);
  if (config.metrics) expect.soft(checks.metrics, "PRECONDITION: the metrics endpoint answers").toBe("success");
  expect.soft(checks.occupiedSlots, "PRECONDITION: every reserved slot is free").toEqual([]);
  const waitlistErasure = checks.waitlistErasure as { attempted: boolean; exit?: number };
  if (waitlistErasure.attempted) expect.soft(waitlistErasure.exit, "PRECONDITION: the members' closed waitlist entries are erased").toBe(0);
  const attendanceErasure = checks.attendanceErasure as { attempted: boolean; exit?: number };
  if (attendanceErasure.attempted) expect.soft(attendanceErasure.exit, "PRECONDITION: the personas' recorded attendance and seeded no-shows are erased").toBe(0);
  expect.soft(checks.attendanceRecorded, "PRECONDITION: the club records attendance (Fristen und Erinnerungen, Anwesenheit erfassen)").toBe(true);
  expect.soft((checks.disposableNoShowLimit as { maxNoShows?: number } | null)?.maxNoShows, "PRECONDITION: the rule set of the disposable member who walks the no-show journey carries NO_SHOW_LIMIT with one no-show").toBe(1);
  expect.soft(checks.noShowSeedable, "PRECONDITION: an erasure path is configured, which seeds the started booking a no-show needs").toBe(true);
  if (!config.notifyClubBookings) expect.soft(checks.weekendConflicts, "PRECONDITION: no club booking lies before a Saturday later opening or on the window's Sunday").toEqual([]);
  for (const [key, count] of Object.entries(checks.openBookings as Record<string, number>)) expect.soft(count, `PRECONDITION: ${key} has at most 6 open bookings`).toBeLessThanOrEqual(6);
  expect.soft(checks.laneLimitConflicts, "PRECONDITION: no lane persona's category limits the weekly hours or asks for a booking longer than a lane").toEqual([]);
  for (const [account, signsIn] of Object.entries(checks.disposablesSignIn as Record<string, boolean>)) {
    expect.soft(signsIn, `PRECONDITION: ${account} signs in with the shared password`).toBe(true);
  }
  expect.soft(checks.futureWeeks, "PRECONDITION: no opening week is scheduled after today").toEqual([]);
  expect.soft(checks.availabilityConflicts, "PRECONDITION: no season, holiday or court closure changes a lane or the hours of the window's weekend").toEqual([]);
  expect.soft(checks.closureNoticeDay, "PRECONDITION: the tenth day after the window has no season, holiday or court closure and the weekly hours open it")
    .toEqual({ day: (checks.closureNoticeDay as { day: string }).day, covered: false, opens: true });
  expect.soft(checks.partnerMarkerActive, "PRECONDITION: the looking-for-a-partner participant card is active").toBe(true);
  expect.soft(checks.foreignWordings, "PRECONDITION: every message uses the shipped wording, so a run reads mail it can recognise and resets only what it wrote").toEqual([]);
  if (config.personas.restricted) {
    expect.soft(checks.restrictedHours, "PRECONDITION: the restricted member's category sets booking hours").toBeTruthy();
    expect.soft(checks.restrictedLanesInside, "PRECONDITION: the earliest lane hour lies outside the restricted member's booking hours").toEqual([]);
  }
  for (const [account, quota] of Object.entries(checks.resetQuotas as Record<string, { ok: boolean; sentInLastHour: number; freeAt: string | null }>)) {
    expect.soft(quota.ok, `PRECONDITION: ${account} can still receive the reset codes this run needs (${quota.sentInLastHour} sent in the last hour, enough again at ${quota.freeAt})`).toBe(true);
  }
});
