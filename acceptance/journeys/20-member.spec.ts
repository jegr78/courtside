import type { Locator, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { test, expect } from "../lib/fixtures";
import { apiAs } from "../lib/api";
import { capture } from "../lib/checks";
import { latestMailTo } from "../lib/mail";
import { openAs, xsrf } from "../lib/session";
import { step } from "../lib/steps";
import { addPartner, bookAt, cancelQuietly, discovery, onPhonesAndChrome, openSlot, projectName, submitBooking } from "../lib/journey";
import { instantOf } from "../lib/lanes";
import { recordCreated } from "../lib/ledger";
import { latestNotificationKinds, leaveWaitlist, openWaitlistEntries, unreadNotifications } from "../lib/waitlist";
import { answers, leavesBookingHours } from "../lib/core.mjs";
import { config } from "../lib/context";
import { precondition } from "../lib/precondition";

test.beforeEach(() => { test.skip(!onPhonesAndChrome(), "member journeys run on phones and desktop chrome"); });

test("given a member, when a singles court is booked with a partner and cancelled, then the confirmation is mailed and the partner is told of the cancellation", async ({ browser, lanes }) => {
  // given
  const slot = await lanes.take("singles");
  const page = await openAs(browser, "memberA");
  const ids: string[] = [];
  const since = new Date();
  try {
    await step("memberA", "plan", () => capture(page, "plan"));
    // when
    ids.push(await step("memberA", "book singles", () => bookAt(page, "memberA", slot, (p) => addPartner(p, "memberB"))));
    // then
    await expect(page.getByTestId("own-allocation").first(), "product: the plan shows the own booking").toBeVisible();
    await step("memberA", "plan with own booking", () => capture(page, "plan-own-booking"));
    await step("memberA", "confirmation mail", async () => {
      const mail = await latestMailTo(discovery.emails["memberA"], since, new RegExp(slot.start));
      expect(mail, "product: booking confirmation reached Mailpit").not.toBeNull();
    });
    // when — the booker cancels
    const cancelledSince = new Date();
    await step("memberA", "cancel", async () => {
      const cancelled = await page.request.delete(`/api/bookings/${ids[0]}`, { headers: { "X-XSRF-TOKEN": await xsrf(page) } });
      expect(cancelled.status(), "product: the cancellation is accepted").toBeLessThan(300);
    });
    // then — the partner hears of it in the notification centre and by mail
    await step("memberB", "cancellation notice", async () => {
      await expect.poll(() => latestNotificationKinds("memberB", cancelledSince),
        { message: "product: the partner's notification centre lists the cancellation", timeout: 30_000 }).toContain("BOOKING_CANCELLED");
      expect(await latestMailTo(discovery.emails["memberB"], cancelledSince), "product: the cancellation reached the partner in Mailpit").not.toBeNull();
    });
  } finally { await cancelQuietly(page, ids); await page.context().close(); }
});

test("given a member, when a doubles court is booked with three others, then the booking is made", async ({ browser, lanes }) => {
  // given
  const slot = await lanes.take("doubles");
  const page = await openAs(browser, "memberB");
  const ids: string[] = [];
  try {
    // when / then
    ids.push(await step("memberB", "book doubles", () => bookAt(page, "memberB", slot, async (p) => {
      for (const key of ["memberA", "memberC", "treasurer"]) await addPartner(p, key);
    })));
  } finally { await cancelQuietly(page, ids); await page.context().close(); }
});

test("given a member, when a court is booked with a guest, then the booking is made", async ({ browser, lanes }) => {
  // given
  const slot = await lanes.take("guest");
  const page = await openAs(browser, "memberC");
  const ids: string[] = [];
  try {
    // when / then
    ids.push(await step("memberC", "book with guest", () => bookAt(page, "memberC", slot, async (p) => {
      await p.getByTestId("booking-more-summary").click();
      await capture(p, "booking-more");
      await p.getByTestId("guest-name").fill("Richard Roe");
    })));
  } finally { await cancelQuietly(page, ids); await page.context().close(); }
});

test("given a member looking for a partner, when the open place is offered, then another member takes it and the holder is told", async ({ browser, lanes }) => {
  // given
  const slot = await lanes.take("participant");
  const holder = await openAs(browser, "memberA");
  const ids: string[] = [];
  try {
    ids.push(await step("memberA", "book looking for a partner", () => bookAt(holder, "memberA", slot, async (p) => {
      await p.getByTestId("booking-more-summary").click();
      await p.getByTestId("participant-card").selectOption(discovery.partnerMarker);
    })));
    // when — the holder offers the open place
    await step("memberA", "offer the open place", async () => {
      await holder.getByTestId("my-bookings-link").click();
      const offer = holder.locator(`[data-testid="publish-open-place"][data-booking-id="${ids[0]}"]`);
      await showInMyBookings(holder, offer);
      const published = holder.waitForResponse(answers("PUT", `/api/my/bookings/${ids[0]}/partner-invitation`));
      await offer.click();
      expect((await published).status(), "product: offering the open place is accepted").toBeLessThan(300);
      await expect(holder.locator(`[data-testid="withdraw-open-place"][data-booking-id="${ids[0]}"]`), "product: the offer can be withdrawn").toBeVisible();
      await capture(holder, "open-place-offered");
    });
    const takenSince = new Date();
    const taker = await openAs(browser, "memberC");
    try {
      // then — another member finds it and takes it
      await step("memberC", "take the open place", async () => {
        const places = await (await (await apiAs("memberC")).get("/api/partner-invitations")).json() as { invitationId: string; startsAt: string }[];
        const place = places.find((candidate) => Date.parse(candidate.startsAt) === instantOf(slot, "start").getTime());
        expect(place, "product: memberC is offered the open place").toBeTruthy();
        await taker.getByTestId("my-bookings-link").click();
        const take = taker.locator(`[data-testid="take-open-place"][data-invitation-id="${place!.invitationId}"]`);
        await expect(take, "product: My bookings lists the open place").toBeVisible();
        await capture(taker, "open-places");
        const accepted = taker.waitForResponse(answers("POST", `/api/partner-invitations/${place!.invitationId}/acceptance`));
        await take.click();
        expect((await accepted).status(), "product: taking the open place is accepted").toBeLessThan(300);
      });
    } finally { await taker.context().close(); }
    // then — the holder is told who plays
    await step("memberA", "partner found notice", async () => {
      await expect.poll(() => latestNotificationKinds("memberA", takenSince),
        { message: "product: the holder's notification centre lists the partner", timeout: 30_000 }).toContain("BOOKING_PARTNER_FOUND");
      expect(await latestMailTo(discovery.emails["memberA"], takenSince), "product: the partner notice reached Mailpit").not.toBeNull();
    });
  } finally { await cancelQuietly(holder, ids); await holder.context().close(); }
});

async function showInMyBookings(page: Page, target: Locator) {
  const entries = page.locator('[data-testid="my-bookings-page"] li');
  await expect(entries.first()).toBeAttached();
  const more = page.getByTestId("load-more-bookings");
  for (let pageNo = 0; pageNo < 10 && !(await target.isVisible()) && await more.isVisible(); pageNo++) {
    const shown = await entries.count();
    await more.click();
    await expect.poll(() => entries.count()).toBeGreaterThan(shown);
  }
  await expect(target, "product: My bookings lists the booking").toBeVisible();
}

test("given a member, when a booking is made, cancelled and made again, then my bookings follows each step", async ({ browser, lanes }) => {
  // given
  const slot = await lanes.take("rebook");
  const page = await openAs(browser, "memberB");
  const ids: string[] = [];
  try {
    await step("memberB", "my bookings", async () => {
      await page.getByTestId("my-bookings-link").click();
      await expect(page.getByTestId("my-bookings-page")).toBeVisible();
      await capture(page, "my-bookings");
      await page.getByTestId("court-plan-link").click();
    });
    // when
    const first = await step("memberB", "book", () => bookAt(page, "memberB", slot, (p) => addPartner(p, "memberC")));
    ids.push(first);
    // then — the booking is listed, then cancelled
    await step("memberB", "cancel", async () => {
      await page.getByTestId("my-bookings-link").click();
      const row = page.locator(`[data-testid="personal-cancel"][data-booking-id="${first}"]`);
      const entries = page.locator('[data-testid="my-bookings-page"] li');
      await expect(entries.first()).toBeAttached();
      const more = page.getByTestId("load-more-bookings");
      for (let pageNo = 0; pageNo < 10 && !(await row.isVisible()) && await more.isVisible(); pageNo++) {
        const shown = await entries.count();
        await more.click();
        await expect.poll(() => entries.count()).toBeGreaterThan(shown);
      }
      await expect(row, "product: the new booking is listed with a cancel action").toBeVisible();
      await capture(page, "my-bookings-with-new");
      await row.click();
      await capture(page, "cancel-confirmation");
      const cancelled = page.waitForResponse(answers("DELETE", `/api/bookings/${first}`));
      await page.getByTestId("confirm-cancellation").click();
      expect((await cancelled).status(), "product: the cancellation is accepted").toBeLessThan(300);
      await expect(page.locator('p[role="status"]:not([data-testid])'), "product: My bookings finishes loading after the cancellation").toHaveCount(0);
      await expect(page.locator(`[data-testid="booking-${first}"][data-status="CONFIRMED"]`), "product: the booking is no longer listed as confirmed").toHaveCount(0);
      await expect(row, "product: the cancelled booking loses its cancel action").toHaveCount(0);
      await capture(page, "my-bookings-after-cancel");
      await page.getByTestId("court-plan-link").click();
    });
    // when / then — the slot can be booked again
    ids.push(await step("memberB", "book again", () => bookAt(page, "memberB", slot, (p) => addPartner(p, "memberC"))));
  } finally { await cancelQuietly(page, ids); await page.context().close(); }
});

test("given a member whose category books only within set hours, when a slot outside them is chosen, then the dialog and the server refuse it", async ({ browser, lanes }) => {
  // given
  precondition(config.personas.restricted !== undefined, "personas.restricted is not configured, so booking hours are not checkable");
  const slot = await lanes.take("singles");
  const api = await apiAs("restricted");
  const { bookingHours } = await (await api.get("/api/booking-eligibility")).json() as { bookingHours?: { earliestStart: string; latestEnd: string } };
  precondition(bookingHours !== undefined && bookingHours !== null, "the restricted member's category sets booking hours");
  precondition(leavesBookingHours(slot, bookingHours!), `the ${slot.start} lane lies outside the booking hours ${bookingHours!.earliestStart} to ${bookingHours!.latestEnd}`);
  const page = await openAs(browser, "restricted");
  try {
    // when
    await openSlot(page, slot);
    // then — the dialog names the hours and offers no booking
    await expect(page.getByTestId("booking-outside-hours"), "product: the dialog names the booking hours").toBeVisible();
    await expect(page.getByTestId("booking-submit"), "product: the dialog offers no booking outside them").toBeDisabled();
    await capture(page, "booking-outside-hours");
    // when / then — a request that bypasses the dialog is refused for the hours
    const courts = await (await api.get("/api/public/courts")).json() as { id: string; number: number }[];
    const card = discovery.cards.find((candidate: { active: boolean; allowedRoles: string[] }) => candidate.active && candidate.allowedRoles.length === 0);
    const refused = await api.post("/api/bookings", {
      courtIds: [courts.find((court) => court.number === slot.court)!.id], cardId: card.id,
      startsAt: instantOf(slot, "start").toISOString(), endsAt: instantOf(slot, "end").toISOString(),
      participants: [{ personId: discovery.personIds["memberB"] }]
    }, { "Idempotency-Key": randomUUID() });
    const body = await refused.json().catch(() => ({}));
    if (refused.ok() && body.id) {
      recordCreated({ kind: "booking", id: body.id, by: "restricted", project: projectName() });
      await api.del(`/api/bookings/${body.id}`);
    }
    expect((body.violations ?? []).map((violation: { code: string }) => violation.code), `product: the server refuses the hours (${refused.status()} ${JSON.stringify(body)})`)
      .toContain("booking.rule.bookingHours.outside");
  } finally { await page.context().close(); }
});

let choicesBefore: { kind: string; declinable: boolean; enabled: boolean }[] | undefined;
test.afterEach(async () => {
  if (!choicesBefore) return;
  const api = await apiAs("memberC");
  const restored = await api.put("/api/account/messages", { declined: choicesBefore.filter((c) => c.declinable && !c.enabled).map((c) => c.kind) });
  expect(restored.ok(), `memberC's message choices are restored (${restored.status()})`).toBe(true);
  choicesBefore = undefined;
});

test("given a member, when the message choices are changed and changed back, then each save is confirmed", async ({ browser }) => {
  // given
  const api = await apiAs("memberC");
  choicesBefore = await (await api.get("/api/account/messages")).json() as { kind: string; declinable: boolean; enabled: boolean }[];
  const page = await openAs(browser, "memberC");
  try {
    // when
    await page.getByTestId("my-messages-link").click();
    await expect(page.getByTestId("my-messages-view")).toBeVisible();
    await capture(page, "my-messages");
    const choice = page.getByTestId("message-choice-BOOKING_REMINDER");
    const checked = await choice.isChecked();
    await choice.click();
    await page.getByTestId("my-messages-save").click();
    // then
    await expect(page.getByTestId("my-messages-saved"), "product: the changed choice is saved").toBeVisible();
    await capture(page, "my-messages-saved");
    // when
    await choice.click();
    await page.getByTestId("my-messages-save").click();
    await expect(choice, "product: the choice is back to its original state").toBeChecked({ checked });
  } finally {
    await page.context().close();
  }
});

test("given two members on the same slot, when both submit, then the second is refused with a reason, queues for it and takes it when it frees", async ({ browser, lanes }) => {
  // given
  const slot = await lanes.take("contention");
  const first = await openAs(browser, "memberB");
  const second = await openAs(browser, "memberC");
  const ids: string[] = [];
  try {
    await openSlot(first, slot);
    await openSlot(second, slot);
    await addPartner(first, "memberA");
    await addPartner(second, "memberA");
    // when
    const won = await submitBooking(first, "memberB");
    if (won.id) ids.push(won.id);
    // then
    expect(won.status, "product: the first submission is accepted").toBeLessThan(300);
    const lost = await submitBooking(second, "memberC");
    if (lost.id) ids.push(lost.id);
    expect(lost.status, "product: the second submission is refused").toBeGreaterThanOrEqual(400);
    await expect(second.getByTestId("booking-dialog").getByRole("alert"), "product: the refusal gives a reason").toBeVisible();
    await capture(second, "conflict", { expectedStatuses: [409, 422, 400] });

    // when — the refused member queues for the taken slot
    await step("memberC", "join the waitlist", async () => {
      await second.getByTestId("booking-close").click();
      const taken = second.locator(`[data-testid="allocation"][data-booking-id="${won.id}"]`);
      await expect(taken, "product: the taken slot offers its waitlist").toBeVisible();
      await taken.click();
      await expect(second.getByTestId("waitlist-explanation"), "product: the dialog explains the waitlist").toBeVisible();
      await addPartner(second, "treasurer");
      await capture(second, "waitlist-dialog");
      const joined = second.waitForResponse(answers("POST", "/api/my/waitlist"));
      await second.getByTestId("booking-submit").click();
      expect((await joined).status(), "product: joining the waitlist is accepted").toBeLessThan(300);
      expect(await openWaitlistEntries("memberC", [slot]), "product: memberC waits for the slot").toHaveLength(1);
    });
    const unreadBefore = await unreadNotifications("memberC");
    const offeredSince = new Date();
    let offerAnswered = new Date();

    // when — the holder cancels
    await step("memberB", "cancel the queued slot", async () => {
      const cancelled = await first.request.delete(`/api/bookings/${won.id}`, { headers: { "X-XSRF-TOKEN": await xsrf(first) } });
      expect(cancelled.status(), "product: the holder's cancellation is accepted").toBeLessThan(300);
    });

    // then — the offer reaches the waiting member, and taking it books the slot
    await step("memberC", "take the offer", async () => {
      await expect.poll(() => unreadNotifications("memberC"), { message: "product: the offer counts as unread", timeout: 30_000 }).toBeGreaterThan(unreadBefore);
      await second.goto("/");
      await expect(second.getByTestId("my-messages-unread"), "product: the navigation shows unread messages").toBeVisible();
      await second.getByTestId("my-messages-link").click();
      const offer = second.locator('[data-testid="notification-offer"][data-open="true"]').first();
      await expect(offer, "product: the notification centre shows the open offer").toBeVisible();
      await capture(second, "notification-offer");
      const [entry] = await openWaitlistEntries("memberC", [slot]);
      expect(entry?.state, "product: the waiting entry is offered the slot").toBe("OFFERED");
      await second.getByTestId("my-bookings-link").click();
      const offered = second.getByTestId(`waitlist-entry-${entry.id}`);
      await expect(offered).toHaveAttribute("data-state", "OFFERED");
      await capture(second, "waitlist-offered");
      offerAnswered = new Date();
      const accepted = second.waitForResponse(answers("POST", `/api/my/waitlist/${entry.id}/acceptance`));
      await offered.getByTestId("waitlist-accept").click();
      const answer = await accepted;
      expect(answer.status(), "product: taking the offer books the slot").toBeLessThan(300);
      const booked = (await answer.json()).id as string;
      recordCreated({ kind: "booking", id: booked, by: "memberC", project: projectName() });
      ids.push(booked);
      await expect(offered, "product: the entry turns into a booking").toHaveAttribute("data-state", "BOOKED");
    });
    await step("memberC", "offer mail", async () => {
      expect(await latestMailTo(discovery.emails["memberC"], offeredSince, undefined, offerAnswered), "product: the offer reached Mailpit before it was taken").not.toBeNull();
    });
  } finally {
    await leaveWaitlist("memberC", [slot]).catch(() => undefined);
    await cancelQuietly(first, ids); await first.context().close(); await second.context().close();
  }
});

test("given a member, when the preferences menu is opened and the theme switched, then both themes render", async ({ browser }) => {
  // given
  const page = await openAs(browser, "memberA");
  try {
    // when / then — each theme is captured
    await page.getByTestId("preferences-menu").click();
    await capture(page, "preferences-open");
    const theme = page.locator("#theme-preference");
    const original = await theme.inputValue();
    await theme.selectOption(original === "dark" ? "light" : "dark");
    await capture(page, "preferences-other-theme");
    await theme.selectOption(original);
  } finally { await page.context().close(); }
});
