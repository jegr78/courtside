import { test, expect } from "../lib/fixtures";
import { apiAs } from "../lib/api";
import { capture } from "../lib/checks";
import { latestMailTo } from "../lib/mail";
import { openAs } from "../lib/session";
import { step } from "../lib/steps";
import { addPartner, bookAt, cancelQuietly, discovery, onPhonesAndChrome, openSlot, submitBooking } from "../lib/journey";

test.beforeEach(() => { test.skip(!onPhonesAndChrome(), "member journeys run on phones and desktop chrome"); });

test("given a member, when a singles court is booked with a partner, then the plan shows it and a confirmation is mailed", async ({ browser, lanes }) => {
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

test("given a member, when a court is booked with a participant card, then the booking is made", async ({ browser, lanes }) => {
  // given
  const card = discovery.participantCards.find((c: { active: boolean }) => c.active);
  test.skip(!card, "no active participant card");
  const slot = await lanes.take("participant");
  const page = await openAs(browser, "memberA");
  const ids: string[] = [];
  try {
    // when / then
    ids.push(await step("memberA", "book with participant card", () => bookAt(page, "memberA", slot, async (p) => {
      await p.getByTestId("booking-more-summary").click();
      await p.getByTestId("participant-card").selectOption(card.id);
    })));
  } finally { await cancelQuietly(page, ids); await page.context().close(); }
});

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
      const cancelled = page.waitForResponse((r) => r.url().endsWith(`/api/bookings/${first}`) && r.request().method() === "DELETE");
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

test("given two members on the same slot, when both submit, then the second is refused with a reason", async ({ browser, lanes }) => {
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
  } finally { await cancelQuietly(first, ids); await first.context().close(); await second.context().close(); }
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
