import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { capture } from "../lib/checks";
import { apiAs, apiAsAgain, type Api } from "../lib/api";
import { lanePlan } from "../lib/lanes";
import { addDays, localDate, zonedInstant } from "../config/calendar.mjs";
import { governingHours } from "../config/lanes.mjs";
import { persona } from "../lib/context";
import { openAs, reauthenticateIfAsked } from "../lib/session";
import { step } from "../lib/steps";
import { discovery, disposableRecord, projectName } from "../lib/journey";
import { recordCreated } from "../lib/ledger";
import { precondition } from "../lib/precondition";
import { PERIOD_PROFILE as PROFILE, readMembershipPeriods, restoreMembershipPeriods } from "../lib/membership";
import { answers, comparablePeriods, membershipPeriodProblems, occupying, violationCodes } from "../lib/core.mjs";

test.beforeEach(() => { test.skip(projectName() !== PROFILE, `the membership period journey runs on ${PROFILE}`); });

type Slot = { day: string; courtId: string; startsAt: Date };

async function book(member: Api, slot: Slot) {
  const card = discovery.cards.find((candidate: { active: boolean; allowedRoles: string[] }) => candidate.active && candidate.allowedRoles.length === 0);
  const answer = await member.post("/api/bookings", {
    courtIds: [slot.courtId], cardId: card.id, startsAt: slot.startsAt.toISOString(),
    endsAt: new Date(slot.startsAt.getTime() + 60 * 60_000).toISOString(),
    participants: [{ personId: discovery.personIds["memberB"] }]
  }, { "Idempotency-Key": randomUUID() });
  const body = await answer.json().catch(() => ({}));
  if (answer.ok() && body.id) recordCreated({ kind: "booking", id: body.id, by: "disposable", project: projectName(), date: slot.day });
  return { status: answer.status(), id: body.id as string | undefined, codes: violationCodes(body) as string[] };
}

async function moveStart(page: Page, periodId: string, startedOn: string, state: string) {
  await page.getByTestId(`correct-period-${periodId}`).click();
  const form = page.getByRole("dialog");
  await form.getByTestId("period-started-on").fill(startedOn);
  await form.getByTestId("save-period").click();
  await reauthenticateIfAsked(page);
  await expect(page.getByRole("dialog"), "product: the corrected period is saved").toHaveCount(0);
  await expect(page.getByTestId(`membership-period-state-${periodId}`), `product: the period reads ${state}`).toHaveAttribute("data-state", state);
}

test("given the disposable member's running membership, when the board moves its start to tomorrow, then the member's booking is refused for holding no membership today and an overlapping period is refused, and once the start is today the same booking is accepted", async ({ browser }) => {
  // given
  const admin = await apiAs("admin");
  const personId = disposableRecord(persona("disposable").username).personId;
  const timeZone = lanePlan().timeZone;
  const today = localDate(new Date(), timeZone);
  const day = addDays(lanePlan().sunday, 10);
  const before = await readMembershipPeriods(admin, personId);
  const problems = membershipPeriodProblems(before, day) as string[];
  precondition(problems.length === 0, `the disposable member of ${PROFILE} ${problems.join("; ")}`);
  const running = before.find((period) => period.state === "RUNNING")!;
  recordCreated({ kind: "membership-period", id: personId, periods: before, by: "admin", project: projectName() });

  const courts = await (await admin.get("/api/public/courts")).json() as { id: string; number: number }[];
  const { opensAt } = governingHours(await (await admin.get(`/api/public/booking-grid?from=${day}&to=${day}`)).json(), day);
  precondition(opensAt !== null, `the weekly hours open ${day}`);
  const slot = { day, courtId: courts[0].id, startsAt: zonedInstant(day, opensAt!.slice(0, 5), timeZone) };
  const occupied = occupying(await (await admin.get(`/api/bookings?date=${day}`)).json(), slot.courtId, slot.startsAt, new Date(slot.startsAt.getTime() + 60 * 60_000));
  precondition(occupied.length === 0, `court ${courts[0].number} is free on ${day} at ${opensAt}, it holds ${occupied.join(", ")}`);

  const page = await openAs(browser, "admin");
  try {
    // when
    await step("admin", "membership period scheduled", async () => {
      await page.goto(`/admin/roster/${personId}`);
      await expect(page.getByTestId("membership-periods"), "product: the person page lists the membership periods").toBeVisible();
      await moveStart(page, running.id, addDays(today, 1), "scheduled");
      await capture(page, "membership-period-scheduled");
    });

    // then
    const refused = await book(await apiAsAgain("disposable"), slot);
    expect(refused.codes, `product: a period that begins tomorrow grants no booking today (answered ${refused.status})`).toContain("booking.rule.noCourtBooking");
    expect(refused.id, "product: the refused booking is not written").toBeUndefined();

    await step("admin", "membership period overlap refused", async () => {
      await page.getByTestId("add-period").click();
      const form = page.getByRole("dialog");
      await form.getByTestId("period-type").selectOption({ index: 1 });
      await form.getByTestId("period-started-on").fill(addDays(today, 2));
      const path = `/api/admin/roster/${personId}/membership-periods`;
      const written = page.waitForResponse(answers("POST", path));
      await form.getByTestId("save-period").click();
      let answer = await written;
      if (answer.status() === 401 || answer.status() === 403) {
        const repeated = page.waitForResponse(answers("POST", path));
        await reauthenticateIfAsked(page);
        answer = await repeated;
      }
      expect(answer.status(), "product: an overlapping period is not written").toBe(409);
      expect((await answer.json()).type, "product: the refusal names the overlap").toBe("urn:courtside:error:membership-periods-overlap");
      await expect(form.getByRole("alert"), "product: the form says why").toBeVisible();
      await capture(page, "membership-period-overlap");
      await form.getByTestId("cancel-period").click();
    });

    await step("admin", "membership period from today", async () => {
      await moveStart(page, running.id, today, "running");
      await capture(page, "membership-period-running");
    });

    const accepted = await book(await apiAsAgain("disposable"), slot);
    expect(accepted.status, `product: a period running today lets the member book (${accepted.codes.join(", ")})`).toBe(201);
    expect(accepted.id, "product: the accepted booking has an id").toBeTruthy();
    const cancelled = await (await apiAs("disposable")).del(`/api/bookings/${accepted.id}`);
    expect(cancelled.status(), "product: the member cancels the booking again").toBeLessThan(300);
  } finally {
    await page.context().close();
    const restored = await restoreMembershipPeriods(admin);
    await apiAsAgain("disposable");
    expect(restored.filter((outcome) => outcome.status >= 300), "every period is put back").toEqual([]);
    expect(comparablePeriods(await readMembershipPeriods(admin, personId)), "the periods are what they were before the run").toEqual(comparablePeriods(before));
  }
});
