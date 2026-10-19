import { randomUUID } from "node:crypto";
import { test, expect } from "../lib/fixtures";
import { capture } from "../lib/checks";
import { apiAs, type Api } from "../lib/api";
import { lanePlan } from "../lib/lanes";
import { addDays, zonedInstant } from "../config/calendar.mjs";
import { governingHours } from "../config/lanes.mjs";
import { latestMailTo } from "../lib/mail";
import { persona } from "../lib/context";
import { openAs } from "../lib/session";
import { step } from "../lib/steps";
import { discovery, disposableRecord, projectName } from "../lib/journey";
import { recordCreated } from "../lib/ledger";
import { precondition } from "../lib/precondition";
import { answers } from "../lib/core.mjs";

type Entry = { id: string; startsOn: string; endsOn: string; courtId?: string };
type Grid = { openingPeriods: Entry[]; courtClosures: Entry[]; openingWeeks: unknown[] };

// One profile: the notice is the server's, the form is walked on every desktop by 46, and a closure
// takes the whole court day, which a second profile on the same day would count twice.
const PROFILE = "desktop-firefox";
const NOTE = "Acceptance net replacement";

test.beforeEach(() => { test.skip(projectName() !== PROFILE, `the closure notice journey runs on ${PROFILE}`); });
test.setTimeout(150_000);

type Notice = { id: string; closure?: string };
const closedNotices = async (api: Api) => ((await (await api.get("/api/account/notifications?limit=100")).json()).items as Notice[])
  .filter((notice) => notice.closure === "COURT_CLOSED").map((notice) => notice.id);

const covers = (entries: Entry[], date: string) => entries.some((entry) => entry.startsOn <= date && date <= entry.endsOn);

test("given a disposable member's booking ten days after the lanes, when the admin closes its court that day, then the form counts it before saving and the member reads the notice in Courtside and by mail without the admin's note", async ({ browser }) => {
  // given
  const day = addDays(lanePlan().sunday, 10);
  const admin = await apiAs("admin");
  const member = await apiAs("disposable");
  const grid = await (await admin.get(`/api/public/booking-grid?from=${day}&to=${day}`)).json() as Grid;
  const courts = await (await admin.get("/api/public/courts")).json() as { id: string; number: number; name?: string }[];
  const court = courts[courts.length - 1];
  const { opensAt } = governingHours(grid, day);
  precondition(!covers(grid.openingPeriods, day) && !covers(grid.courtClosures, day),
    `no season, holiday or court closure of the club covers ${day}`);
  precondition(opensAt !== null, `the weekly hours open ${day}`);
  const card = discovery.cards.find((candidate: { active: boolean; allowedRoles: string[] }) => candidate.active && candidate.allowedRoles.length === 0);
  const startsAt = zonedInstant(day, opensAt!.slice(0, 5), lanePlan().timeZone);
  const booked = await member.post("/api/bookings", {
    courtIds: [court.id], cardId: card.id,
    startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
    participants: [{ personId: discovery.personIds["memberB"] }]
  }, { "Idempotency-Key": randomUUID() });
  const booking = await booked.json().catch(() => ({})) as { id?: string; violations?: { code: string }[] };
  precondition(booked.ok() && booking.id,
    `the disposable member can book court ${court.number} on ${day} at ${opensAt} (answered ${booked.status()} ${(booking.violations ?? []).map((v) => v.code).join(", ")})`);
  recordCreated({ kind: "booking", id: booking.id, by: "disposable", project: projectName(), date: day });
  const email = disposableRecord(persona("disposable").username).email;
  const page = await openAs(browser, "admin");
  let closureId: string | undefined;
  try {
    // when
    await step("admin", "describe a closure over the booking", async () => {
      await page.goto("/admin/facility/opening-hours/exceptions");
      await expect(page.getByTestId("admin-availability-view")).toBeVisible();
      await page.getByTestId("court-closure-court").selectOption(court.id);
      await page.getByTestId("court-closure-name").fill(NOTE);
      await page.getByTestId("court-closure-starts-on").fill(day);
      await page.getByTestId("court-closure-ends-on").fill(day);
    });
    // then
    await step("admin", "count before saving", async () => {
      await expect(page.getByTestId("court-closure-affected"), "product: the form counts the booking before saving").toContainText("1");
      await capture(page, "closure-affects-booking");
    });
    // when
    const since = new Date();
    const earlier = new Set(await closedNotices(member));
    await step("admin", "save the closure", async () => {
      const saved = page.waitForResponse(answers("POST", "/api/admin/court-closures"));
      await page.getByTestId("save-court-closure").click();
      const response = await saved;
      const body = await response.json().catch(() => ({}));
      expect(response.status(), `product: the closure is stored (${body.type ?? ""})`).toBe(201);
      closureId = body.id;
      recordCreated({ kind: "court-closure", id: body.id, project: projectName(), date: day });
      await expect(page.getByTestId(`court-closure-${body.id}`), "product: the closure is listed").toBeVisible();
    });
    // then
    await step("disposable", "notice in the notification centre", async () => {
      await expect.poll(async () => (await closedNotices(member)).filter((id) => !earlier.has(id)).length,
        { message: "product: the member gets exactly one closure notice", timeout: 30_000 }).toBe(1);
      const noticeId = (await closedNotices(member)).find((id) => !earlier.has(id))!;
      const centre = await openAs(browser, "disposable");
      try {
        await centre.goto("/my-messages");
        const notice = centre.getByTestId(`notification-${noticeId}`);
        await expect(notice, "product: the notification centre shows it as a closed court").toHaveAttribute("data-closure", "COURT_CLOSED");
        await expect(notice.getByTestId("notification-summary"), "product: the notice keeps the admin's note to the board").not.toContainText(NOTE);
        await capture(centre, "closure-notice");
      } finally { await centre.context().close(); }
    });
    await step("disposable", "notice by mail", async () => {
      const mail = await latestMailTo(email, since);
      expect(mail, "product: the closure notice reached Mailpit").not.toBeNull();
      expect(mail!.text, "product: the mail names the booking's start").toContain(opensAt!.slice(0, 5));
      expect(mail!.text, "product: the mail names the booking's year").toContain(day.slice(0, 4));
      expect(mail!.text, "product: the mail names the day of the month").toMatch(new RegExp(`\\b${Number(day.slice(8))}\\b`));
      if (court.name) expect(mail!.text, "product: the mail names the court by its club name").toContain(court.name);
      else expect(mail!.text, "product: the mail names the court by its number").toMatch(new RegExp(`\\b${court.number}\\b`));
      expect(mail!.text, "product: the mail keeps the admin's note to the board").not.toContain(NOTE);
    });
  } finally {
    // then — nothing of the journey is left
    await step("admin", "remove closure and booking", async () => {
      if (closureId) expect((await admin.del(`/api/admin/court-closures/${closureId}`)).status(), "product: the closure is removed").toBe(204);
      expect((await member.del(`/api/bookings/${booking.id}`)).status(), "product: the booking is cancelled").toBeLessThan(300);
      const after = await (await admin.get(`/api/public/booking-grid?from=${day}&to=${day}`)).json() as Grid;
      expect(covers(after.courtClosures, day), "product: the closure is gone").toBe(false);
    });
    await page.context().close();
  }
});
