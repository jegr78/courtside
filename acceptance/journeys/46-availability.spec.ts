import { randomUUID } from "node:crypto";
import { type Page } from "@playwright/test";
import { test, expect } from "../lib/fixtures";
import { capture } from "../lib/checks";
import { apiAs, type Api } from "../lib/api";
import { lanePlan } from "../lib/lanes";
import { addDays, zonedInstant } from "../config/calendar.mjs";
import { governingHours } from "../config/lanes.mjs";
import { gotoDayBeyondWindow } from "../lib/plan";
import { openAs } from "../lib/session";
import { step } from "../lib/steps";
import { discovery, projectName } from "../lib/journey";
import { recordCreated } from "../lib/ledger";
import { precondition } from "../lib/precondition";
import { answers, occupying } from "../lib/core.mjs";

type Entry = { id: string; startsOn: string; endsOn: string; courtId?: string };
type Grid = { openingPeriods: Entry[]; courtClosures: Entry[]; openingWeeks: unknown[] };

test.beforeEach(() => { test.skip(!/desktop/.test(projectName()), "the availability journey runs on the desktop browsers"); });
test.setTimeout(150_000);

const covers = (entries: Entry[], date: string) => entries.some((entry) => entry.startsOn <= date && date <= entry.endsOn);

async function refusedCodes(api: Api, courtId: string, date: string, opensAt: string): Promise<string[]> {
  const card = discovery.cards.find((candidate: { active: boolean; allowedRoles: string[] }) => candidate.active && candidate.allowedRoles.length === 0);
  const startsAt = zonedInstant(date, opensAt, lanePlan().timeZone);
  const refused = await api.post("/api/bookings", {
    courtIds: [courtId], cardId: card.id,
    startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
    participants: [{ personId: discovery.personIds["memberB"] }]
  }, { "Idempotency-Key": randomUUID() });
  const body = await refused.json().catch(() => ({}));
  expect([201, 422], `product: the booking is decided by the rules (${JSON.stringify(body)})`).toContain(refused.status());
  if (refused.ok() && body.id) {
    recordCreated({ kind: "booking", id: body.id, by: "memberA", project: projectName() });
    await api.del(`/api/bookings/${body.id}`);
  }
  return (body.violations ?? []).map((violation: { code: string }) => violation.code);
}

async function saveEntry(page: Page, form: "opening-period" | "court-closure", path: string): Promise<string> {
  const saved = page.waitForResponse(answers("POST", path));
  await page.getByTestId(`save-${form}`).click();
  const response = await saved;
  const body = await response.json().catch(() => ({}));
  expect(response.status(), `product: the ${form} is stored (${body.type ?? ""})`).toBe(201);
  recordCreated({ kind: form, id: body.id, project: projectName() });
  await expect(page.getByTestId(`${form}-${body.id}`), `product: the ${form} is listed`).toBeVisible();
  return body.id;
}

async function removeEntry(page: Page, form: "opening-period" | "court-closure", path: string, id: string) {
  const removed = page.waitForResponse(answers("DELETE", `${path}/${id}`));
  await page.getByTestId(`remove-${form}-${id}`).click();
  expect((await removed).status(), `product: the ${form} is removed`).toBe(204);
  await expect(page.getByTestId(`${form}-${id}`), `product: the removed ${form} leaves the list`).toHaveCount(0);
}

// The time field shows the value in the application language, as the product's own formatter does.
function shownTime(page: Page, time: string) {
  return page.evaluate((value) => {
    const [hour, minute] = value.split(":").map(Number);
    return new Intl.DateTimeFormat(document.documentElement.lang, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
      .format(Date.UTC(1970, 0, 1, hour, minute)).replace(/[\u00a0\u202f]/g, " ");
  }, time);
}

test("given a day beyond the lanes, when the admin adds a holiday and closes a court the day after, then the plan shows both, bookings there are refused and removing both opens the days again", async ({ browser }) => {
  // given
  const holiday = addDays(lanePlan().sunday, 8);
  const closed = addDays(holiday, 1);
  const admin = await apiAs("admin");
  const member = await apiAs("memberA");
  const grid = await (await admin.get(`/api/public/booking-grid?from=${holiday}&to=${closed}`)).json() as Grid;
  const courts = await (await admin.get("/api/public/courts")).json() as { id: string; number: number }[];
  const court = courts[0];
  const hours = governingHours(grid, closed);
  precondition(![holiday, closed].some((date) => covers(grid.openingPeriods, date) || covers(grid.courtClosures, date)),
    `no season, holiday or court closure of the club covers ${holiday} or ${closed}`);
  precondition(governingHours(grid, holiday).opensAt !== null && hours.opensAt !== null && hours.closesAt !== null,
    `the weekly hours open ${holiday} and ${closed}`);
  const opensAt = hours.opensAt!.slice(0, 5);
  const page = await openAs(browser, "admin");
  const created: { form: "opening-period" | "court-closure"; path: string; id: string }[] = [];
  try {
    // when
    await step("admin", "add holiday and court closure", async () => {
      await page.goto("/admin/facility/opening-hours");
      await page.getByTestId("opening-hours-exceptions-link").click();
      await expect(page.getByTestId("admin-availability-view")).toBeVisible();
      await expect(page.getByTestId("opening-period-form")).toBeVisible();
      await page.getByTestId("opening-period-kind").selectOption("HOLIDAY");
      await page.getByTestId("opening-period-name").fill("Acceptance holiday");
      await page.getByTestId("opening-period-starts-on").fill(holiday);
      await page.getByTestId("opening-period-ends-on").fill(holiday);
      await expect(page.getByTestId("opening-period-closed-MONDAY"), "product: a new holiday is not closed by default").not.toBeChecked();
      await expect(page.getByTestId("opening-period-opens-MONDAY"), "product: a new holiday starts with its day's weekly hours")
        .toHaveValue(await shownTime(page, governingHours(grid, holiday).opensAt!.slice(0, 5)));
      await page.getByTestId("opening-period-closed-MONDAY").check();
      created.push({ form: "opening-period", path: "/api/admin/opening-periods",
        id: await saveEntry(page, "opening-period", "/api/admin/opening-periods") });
      await page.getByTestId("court-closure-court").selectOption(court.id);
      await page.getByTestId("court-closure-name").fill("Acceptance closure");
      await page.getByTestId("court-closure-starts-on").fill(closed);
      await page.getByTestId("court-closure-ends-on").fill(closed);
      created.push({ form: "court-closure", path: "/api/admin/court-closures",
        id: await saveEntry(page, "court-closure", "/api/admin/court-closures") });
      await capture(page, "availability-entries");
    });
    // then
    await step("admin", "plan shows holiday and closed court", async () => {
      await page.goto("/");
      await gotoDayBeyondWindow(page, holiday);
      await expect(page.getByTestId("day-holiday-notice"), "product: the plan names the holiday").toContainText("Acceptance holiday");
      // A booking already on the day keeps its grid, and the plan then says the day is closed above it.
      await expect(page.locator('[data-testid="day-closed"], [data-testid="day-closed-notice"]').first(), "product: the holiday closes the day").toBeVisible();
      await gotoDayBeyondWindow(page, closed);
      await expect(page.locator(`[data-testid="closed-court-slot"][data-date="${closed}"][data-court-number="${court.number}"]`).first(),
        "product: the closed court reads as closed").toBeVisible();
      await expect(page.locator(`[data-testid="free-slot"][data-date="${closed}"][data-court-number="${court.number}"]`),
        "product: the closed court offers no slot").toHaveCount(0);
      await capture(page, "plan-closed-court");
    });
    await step("memberA", "bookings refused", async () => {
      expect(await refusedCodes(member, court.id, holiday, governingHours(grid, holiday).opensAt!.slice(0, 5)),
        "product: the server refuses a booking on the holiday").toContain("booking.rule.openingHours.closed");
      expect(await refusedCodes(member, court.id, closed, opensAt), "product: the server refuses a booking on the closed court")
        .toContain("booking.rule.openingHours.courtClosed");
    });
    // when
    await step("admin", "remove both", async () => {
      await page.goto("/admin/facility/opening-hours/exceptions");
      await expect(page.getByTestId("admin-availability-view")).toBeVisible();
      for (const entry of created.splice(0)) await removeEntry(page, entry.form, entry.path, entry.id);
    });
    // then
    await step("admin", "days open again", async () => {
      const after = await (await admin.get(`/api/public/booking-grid?from=${holiday}&to=${closed}`)).json() as Grid;
      expect(covers(after.openingPeriods, holiday) || covers(after.courtClosures, closed), "product: nothing of the journey is left").toBe(false);
      await page.goto("/");
      await gotoDayBeyondWindow(page, closed);
      await expect(page.locator(`[data-testid="free-slot"][data-date="${closed}"][data-court-number="${court.number}"]`).first(),
        "product: the court offers its slots again").toBeAttached();
    });
  } finally {
    for (const entry of created) await admin.del(`${entry.path}/${entry.id}`);
    await page.context().close();
  }
});

test("given a day beyond the lanes, when the admin gives it a holiday window that opens later, then the server refuses a booking before the window and accepts one inside it", async ({ browser }) => {
  // given
  const holiday = addDays(lanePlan().sunday, 11);
  const admin = await apiAs("admin");
  const member = await apiAs("memberA");
  const grid = await (await admin.get(`/api/public/booking-grid?from=${holiday}&to=${holiday}`)).json() as Grid;
  const regular = governingHours(grid, holiday);
  precondition(!covers(grid.openingPeriods, holiday), `no season or holiday of the club covers ${holiday}`);
  precondition(regular.opensAt !== null && regular.closesAt !== null, `the weekly hours open ${holiday}`);
  const regularOpening = regular.opensAt!.slice(0, 5);
  const windowOpening = `${String(Number(regularOpening.slice(0, 2)) + 2).padStart(2, "0")}${regularOpening.slice(2)}`;
  precondition(windowOpening < regular.closesAt!.slice(0, 5), `the weekly hours of ${holiday} last beyond ${windowOpening}`);
  const courts = await (await admin.get("/api/public/courts")).json() as { id: string; number: number }[];
  const startsAt = zonedInstant(holiday, windowOpening, lanePlan().timeZone);
  const day = await (await admin.get(`/api/bookings?date=${holiday}`)).json();
  const court = courts.find((candidate) => occupying(day, candidate.id, startsAt, new Date(startsAt.getTime() + 60 * 60_000)).length === 0);
  precondition(court, `a court is free at ${windowOpening} on ${holiday}`);
  const page = await openAs(browser, "admin");
  let created: string | undefined;
  try {
    // when
    await step("admin", "add holiday window", async () => {
      await page.goto("/admin/facility/opening-hours/exceptions");
      await expect(page.getByTestId("opening-period-form")).toBeVisible();
      await page.getByTestId("opening-period-name").fill("Acceptance late opening");
      await page.getByTestId("opening-period-starts-on").fill(holiday);
      await page.getByTestId("opening-period-ends-on").fill(holiday);
      await page.getByTestId("opening-period-opens-MONDAY").fill(windowOpening);
      created = await saveEntry(page, "opening-period", "/api/admin/opening-periods");
    });
    // then
    await step("memberA", "booking before the window refused, inside accepted", async () => {
      expect(await refusedCodes(member, court.id, holiday, regularOpening), "product: the server refuses a booking before the holiday window")
        .toContain("booking.rule.openingHours.outside");
      expect(await refusedCodes(member, court.id, holiday, windowOpening), "product: the server accepts a booking inside the holiday window")
        .toEqual([]);
    });
    // when
    await step("admin", "remove holiday window", async () => {
      await page.goto("/admin/facility/opening-hours/exceptions");
      await removeEntry(page, "opening-period", "/api/admin/opening-periods", created!);
      created = undefined;
    });
  } finally {
    if (created) await admin.del(`/api/admin/opening-periods/${created}`);
    await page.context().close();
  }
});
