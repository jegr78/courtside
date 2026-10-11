import { type Page } from "@playwright/test";
import { test, expect } from "../lib/fixtures";
import { capture } from "../lib/checks";
import { lanePlan } from "../lib/lanes";
import { hh, hourOf } from "../config/calendar.mjs";
import { latestMailTo } from "../lib/mail";
import { gotoDay } from "../lib/plan";
import { openAs } from "../lib/session";
import { step } from "../lib/steps";
import { addPartner, bookAt, cancelQuietly, discovery, onDesksAndTablet } from "../lib/journey";
import { clearWeekend } from "../lib/weekend";

test.beforeEach(() => { test.skip(!onDesksAndTablet(), "opening-hours journeys run on desks, tablet and one phone"); });
test.beforeEach(async () => { await clearWeekend(); });
test.afterEach(async ({}, info) => { if (info.status !== "skipped") await clearWeekend(); });
test.setTimeout(150_000);

async function scheduledWeeks(page: Page): Promise<(string | null)[]> {
  const weeks = await (await page.request.get("/api/admin/opening-hours/schedule")).json() as { effectiveFrom: string | null }[];
  return weeks.map((week) => week.effectiveFrom);
}

async function openOpeningHours(page: Page, effectiveFrom: string) {
  await page.goto("/admin/facility/opening-hours");
  await expect(page.getByTestId("admin-opening-hours-view")).toBeVisible();
  await expect(page.getByTestId("opening-weeks")).toBeVisible();
  await page.getByTestId("opening-hours-effective-from").fill(effectiveFrom);
  // A week saved with today's date replaces the hours in force and cannot be removed again.
  await expect(page.getByTestId("opening-hours-effective-from")).toHaveValue(effectiveFrom);
}

async function saveWeek(page: Page, effectiveFrom: string) {
  const saved = page.waitForResponse((r) => r.url().includes("/api/admin/opening-hours") && r.request().method() === "PUT");
  await page.getByTestId("save-opening-hours").click();
  expect((await saved).status(), "product: the scheduled week is stored").toBeLessThan(300);
  await expect(page.getByTestId(`opening-week-${effectiveFrom}`), "product: the scheduled week is listed").toBeVisible();
  expect(await scheduledWeeks(page), "product: the schedule holds the new week").toContain(effectiveFrom);
}

async function removeWeek(page: Page, effectiveFrom: string) {
  const removed = page.waitForResponse((r) => r.url().endsWith(`/api/admin/opening-hours/schedule/${effectiveFrom}`) && r.request().method() === "DELETE");
  await page.getByTestId(`remove-opening-week-${effectiveFrom}`).click();
  expect((await removed).status(), "product: the scheduled week is removed").toBeLessThan(300);
  await expect(page.getByTestId(`opening-week-${effectiveFrom}`), "product: the removed week leaves the list").toHaveCount(0);
  expect(await scheduledWeeks(page), "product: the schedule no longer holds the week").not.toContain(effectiveFrom);
}

test("given a member booking early on a Saturday, when the admin schedules a later Saturday opening, then the preview names it, the member is told and removing the week restores the plan", async ({ browser, lanes }) => {
  const slot = await lanes.take("saturday-opening");
  const saturday = lanePlan().saturday;
  const laterOpening = hh(hourOf(slot.end) + 1);
  const member = await openAs(browser, "memberA");
  const admin = await openAs(browser, "admin");
  const ids: string[] = [];
  try {
    const booked = await step("memberA", "book early saturday", () => bookAt(member, "memberA", slot, (p) => addPartner(p, "memberC")));
    ids.push(booked);
    const since = new Date();
    await step("admin", "later saturday opening", async () => {
      await openOpeningHours(admin, saturday);
      await admin.getByTestId("hours-open-SATURDAY").fill(laterOpening);
      await admin.getByTestId("opening-hours-impact-SATURDAY").click();
      await expect(admin.getByTestId(`impact-booking-${booked}`), "product: the impact preview names the booking").toBeVisible();
      await capture(admin, "opening-hours-impact");
      await saveWeek(admin, saturday);
      await capture(admin, "opening-hours-scheduled");
    });
    await step("memberA", "displacement mail", async () => {
      const mail = await latestMailTo(discovery.emails.memberA, since);
      expect(mail, "product: memberA is told the booking now lies outside the opening hours").not.toBeNull();
    });
    await step("memberA", "plan with later opening", async () => {
      await member.goto("/");
      await gotoDay(member, saturday);
      const early = await member.locator(`button[data-testid="free-slot"][data-date="${saturday}"]`)
        .evaluateAll((cells, before) => cells.map((c) => c.getAttribute("data-slot")).filter((s) => s !== null && s < before), laterOpening);
      expect(early, "product: no slot before the new opening is offered").toEqual([]);
      await expect(member.locator(`[data-testid="outside-slot"][data-date="${saturday}"]`).first(), "product: the closed morning is shown as outside").toBeAttached();
      await capture(member, "plan-later-opening");
    });
    await step("admin", "remove scheduled week", () => removeWeek(admin, saturday));
    await step("memberA", "plan restored", async () => {
      await member.goto("/");
      await gotoDay(member, saturday);
      const offered = await member.locator(`button[data-testid="free-slot"][data-date="${saturday}"]`)
        .evaluateAll((cells) => cells.map((c) => c.getAttribute("data-slot")));
      expect(offered.some((s) => s !== null && s < laterOpening), "product: a slot before the removed later opening is bookable again").toBe(true);
    });
  } finally {
    await cancelQuietly(member, ids);
    await admin.context().close();
    await member.context().close();
  }
});

test("when the admin closes Sundays from a later date and removes that week again, then the plan shows the closed day and then the open one", async ({ browser }) => {
  const admin = await openAs(browser, "admin");
  const sunday = lanePlan().sunday;
  try {
    await step("admin", "close sunday", async () => {
      await openOpeningHours(admin, sunday);
      await admin.getByTestId("hours-closed-SUNDAY").check();
      await expect(admin.getByTestId("hours-open-SUNDAY")).toBeDisabled();
      await admin.getByTestId("opening-hours-impact-SUNDAY").click();
      await expect(admin.getByTestId("impact-SUNDAY"), "product: the impact preview answers for the closed day").toBeVisible();
      await capture(admin, "opening-hours-close-impact");
      await saveWeek(admin, sunday);
    });
    await step("admin", "plan with closed sunday", async () => {
      await admin.goto("/");
      await gotoDay(admin, sunday);
      await expect(admin.locator('[data-testid="day-closed"], [data-testid="day-closed-notice"]').first(), "product: the plan shows Sunday as closed").toBeVisible();
      await capture(admin, "plan-closed-day");
    });
    await step("admin", "reopen sunday", async () => {
      await admin.goto("/admin/facility/opening-hours");
      await expect(admin.getByTestId("opening-weeks")).toBeVisible();
      await removeWeek(admin, sunday);
      await admin.goto("/");
      await gotoDay(admin, sunday);
      await expect(admin.locator(`[data-testid="free-slot"][data-date="${sunday}"], [data-testid="outside-slot"][data-date="${sunday}"]`).first(), "product: Sunday is open again").toBeAttached();
    });
  } finally {
    await admin.context().close();
  }
});
