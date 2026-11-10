import { test, expect } from "../lib/fixtures";
import { capture, offSite } from "../lib/checks";
import { apiAs } from "../lib/api";
import { config, persona } from "../lib/context";
import { discovery, openSlot, projectName, submitBooking } from "../lib/journey";
import { lanePlan } from "../lib/lanes";
import { recordCreated } from "../lib/ledger";
import { holdersWithEmail } from "../lib/core.mjs";
import { approveAtPayPal, creditOf, externalCard, type Credit } from "../lib/paypal";
import { precondition } from "../lib/precondition";
import { openAs, reauthenticateIfAsked } from "../lib/session";
import { step } from "../lib/steps";
import { PAYPAL_PROFILE } from "../config/lanes.mjs";
import type { Page } from "@playwright/test";

test.beforeEach(() => { test.skip(projectName() !== PAYPAL_PROFILE, "the PayPal sandbox walk runs once, on the desktop Chrome profile"); });

const lines = (credit: Credit, kind: string, bookingId: string) => credit.items.filter((entry) => entry.kind === kind && entry.bookingId === bookingId);

async function cancelOwn(page: Page, bookingId: string) {
  await page.goto("/my-bookings");
  const cancel = page.locator(`[data-testid="personal-cancel"][data-booking-id="${bookingId}"]`);
  await expect(cancel, "product: My bookings offers the booking for cancellation").toBeVisible();
  await cancel.click();
  await page.getByTestId("confirm-cancellation").click();
  await expect(cancel, "product: the cancelled booking leaves My bookings").toHaveCount(0);
}

test("given an external player and the club's PayPal sandbox, when the player pays at PayPal, cancels, pays the next booking from the credit and cancels it, and the treasurer returns the PayPal payment, then every step leaves its ledger line and the balance ends where it began", async ({ browser, lanes }) => {
  // given
  precondition(config.paypal !== undefined, "paypal is not configured, so the PayPal sandbox walk is not checkable");
  const card = externalCard(discovery.cards);
  precondition(card !== undefined, "an active card open to EXTERNAL records no players and carries a price for external players");
  precondition(lanePlan().slots.some((slot) => slot.journey === "paypal-pay"), "the club has fewer than three courts in courts, so the PayPal lanes have no court of their own");
  const paidSlot = await lanes.take("paypal-pay");
  const creditSlot = await lanes.take("paypal-credit");
  const player = await apiAs("external");
  const start = await creditOf(player);
  const holders = holdersWithEmail(await (await (await apiAs("treasurer")).post("/api/treasury/credit/account-search", { query: persona("external").username })).json(), discovery.emails.external);
  expect(holders, "the treasurer's search finds exactly the external player's account").toHaveLength(1);
  recordCreated({ kind: "credit", id: holders[0].accountId, before: start.balanceMinor, by: "external", project: projectName() });
  const origin = new URL(config.baseUrl).origin;
  const page = await openAs(browser, "external");
  let treasurer: Page | undefined;
  try {
    // when
    const paid = await step("external", "pay at PayPal", async () => {
      await openSlot(page, paidSlot);
      await page.getByTestId("booking-card").selectOption(card!.id);
      await expect(page.getByTestId("booking-submit"), "product: a player without credit is sent to PayPal").toHaveAttribute("data-payment", "PAYPAL");
      await capture(page, "paypal-booking-dialog");
      const booking = await submitBooking(page, "external");
      expect(booking.status, `product: the booking that waits for PayPal is accepted (${JSON.stringify(booking.body)})`).toBeLessThan(300);
      await offSite(page, () => approveAtPayPal(page, origin, config.paypal!));
      await expect(page.getByTestId("paypal-outcome"), "product: the return from PayPal confirms the booking").toHaveAttribute("data-outcome", "CONFIRMED");
      await capture(page, "paypal-return");
      return booking.id!;
    });
    // then
    const afterPayment = await creditOf(player);
    expect(lines(afterPayment, "PAYPAL_PAYMENT", paid), "product: the ledger records the PayPal payment").toHaveLength(1);
    expect(afterPayment.balanceMinor, "product: a booking paid at PayPal leaves the balance unchanged").toBe(start.balanceMinor);
    const orderId = lines(afterPayment, "PAYPAL_PAYMENT", paid)[0]?.paypalOrderId;
    expect(orderId, "product: the payment line names PayPal's order").toBeTruthy();

    // when
    await step("external", "cancel the paid booking", () => cancelOwn(page, paid));
    // then
    const afterCancel = await creditOf(player);
    const price = lines(afterCancel, "BOOKING_REFUND", paid)[0]?.amountMinor ?? 0;
    expect(price, "product: the cancelled PayPal booking becomes credit").toBeGreaterThan(0);
    expect(afterCancel.balanceMinor, "product: the balance holds the cancelled booking's price").toBe(start.balanceMinor + price);

    // when
    const fromCredit = await step("external", "pay from credit", async () => {
      await page.goto("/");
      await openSlot(page, creditSlot);
      await page.getByTestId("booking-card").selectOption(card!.id);
      await expect(page.getByTestId("booking-balance"), "product: the dialog shows the credit that pays").toBeVisible();
      await expect(page.getByTestId("booking-submit"), "product: a player with enough credit is not sent to PayPal").not.toHaveAttribute("data-payment", "PAYPAL");
      await capture(page, "paypal-credit-dialog");
      const booking = await submitBooking(page, "external");
      expect(booking.status, `product: the booking paid from credit is accepted (${JSON.stringify(booking.body)})`).toBeLessThan(300);
      await expect(page.getByTestId("booking-dialog"), "product: the dialog closes after a booking paid from credit").not.toBeVisible();
      return booking.id!;
    });
    // then
    const afterDebit = await creditOf(player);
    expect(lines(afterDebit, "BOOKING_DEBIT", fromCredit), "product: the ledger records the debit for the booking").toHaveLength(1);
    expect(new URL(page.url()).origin, "product: paying from credit never leaves the club's site").toBe(origin);

    // when
    await step("external", "cancel the booking paid from credit", () => cancelOwn(page, fromCredit));
    const beforeReturn = await creditOf(player);
    expect(lines(beforeReturn, "BOOKING_REFUND", fromCredit), "product: the cancelled credit booking returns its price").toHaveLength(1);

    treasurer = await openAs(browser, "treasurer");
    await step("treasurer", "return the PayPal payment", async () => {
      await treasurer!.goto("/admin/credit");
      await expect(treasurer!.getByTestId("admin-credit-view"), "product: the treasurer reaches the credit page").toBeVisible();
      await treasurer!.getByTestId("credit-search").fill(persona("external").username);
      await expect(treasurer!.getByTestId("credit-holder"), "product: the search narrows the holders to the external player").toHaveCount(1);
      await treasurer!.getByTestId("credit-holder-open").click();
      await expect(treasurer!.getByTestId("credit-balance"), "product: the treasurer sees the player's balance").toHaveAttribute("data-balance-minor", String(beforeReturn.balanceMinor));
      const payment = treasurer!.locator('[data-testid="credit-entry"][data-kind="PAYPAL_PAYMENT"]').filter({ has: treasurer!.getByTestId("paypal-refund") }).first();
      await expect(payment, "product: the paid and cancelled booking offers a return through PayPal").toBeVisible();
      await payment.getByTestId("paypal-refund").click();
      await treasurer!.getByTestId("paypal-refund-confirm").click();
      await reauthenticateIfAsked(treasurer!);
      await expect(treasurer!.getByTestId("paypal-refund-outcome"), "product: the treasurer sees the outcome of the return").toBeVisible();
      await capture(treasurer!, "paypal-refund");
    });
    // then
    const end = await creditOf(player);
    const refund = end.items.filter((entry) => entry.kind === "PAYPAL_REFUND" && entry.paypalOrderId === orderId);
    expect(refund, "product: the ledger carries one PayPal return for the order").toHaveLength(1);
    expect(refund[0]?.amountMinor, "product: the return takes back exactly the paid price").toBe(-price);
    expect(end.balanceMinor, "product: the balance ends where the walk began").toBe(start.balanceMinor);
    await expect(treasurer.locator('[data-testid="credit-entry"][data-kind="PAYPAL_REFUND"]').getByTestId("paypal-refund-state").first(),
      "product: PayPal completed the return").toHaveAttribute("data-status", "COMPLETED");
  } finally {
    await treasurer?.context().close();
    await page.context().close();
  }
});
