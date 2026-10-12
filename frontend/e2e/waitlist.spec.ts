import type { Page } from "@playwright/test";
import { expect, selectJourneyDate, test } from "./fixtures";

const janeDoe = "00000000-0000-0000-0000-000000000101";

async function signIn(page: Page, username: string) {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible({ timeout: 10_000 });
}

async function signOut(page: Page) {
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible({ timeout: 10_000 });
}

test("a member queues for a taken court, is offered it when it frees and books it in Courtside", async ({ page, journeyService }) => {
  // given — a court somebody else holds
  await signIn(page, "doe.jane");
  await selectJourneyDate(page, journeyService.visualDate);
  await page.locator('[data-testid="free-slot"][data-court-number="3"][data-slot="15:00"][data-state="free"]').click();
  await page.getByTestId("member-search").fill("Major");
  await page.getByTestId("member-match").first().click();
  await page.getByTestId("booking-submit").click();
  const held = page.locator('tr[data-slot="15:00"] [data-testid="own-allocation"]');
  await expect(held).toBeVisible({ timeout: 10_000 });
  const bookingId = await held.getAttribute("data-booking-id");
  await signOut(page);

  // when — another member joins its waitlist
  await signIn(page, "roe.jane");
  await selectJourneyDate(page, journeyService.visualDate);
  await page.locator(`tr[data-slot="15:00"] [data-testid="allocation"][data-booking-id="${bookingId}"]`).click();
  await expect(page.getByTestId("waitlist-explanation")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("member-search").fill("Doe");
  await page.locator(`[data-testid="member-match"][data-person-id="${janeDoe}"]`).click();
  await page.getByTestId("booking-submit").click();
  await expect(page.getByRole("status")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("my-bookings-link").click();
  await expect(page.getByTestId("waitlist-entries").locator('[data-state="WAITING"]')).toHaveCount(1, { timeout: 10_000 });
  await signOut(page);

  // when — the holder cancels
  await signIn(page, "doe.jane");
  await page.getByTestId("my-bookings-link").click();
  await page.locator(`[data-testid="personal-cancel"][data-booking-id="${bookingId}"]`).click();
  await page.getByTestId("confirm-cancellation").click();
  await expect(page.locator(`[data-testid="personal-cancel"][data-booking-id="${bookingId}"]`)).toHaveCount(0, { timeout: 10_000 });
  await page.getByTestId("court-plan-link").click();
  await selectJourneyDate(page, journeyService.visualDate);
  await expect(page.locator('tr[data-slot="15:00"] [data-testid="allocation"][data-state="reserved"]'),
    "the freed court is held for the member whose turn it is").toBeVisible({ timeout: 10_000 });
  await signOut(page);

  // then — the waiting member finds the offer in the centre and books it without email
  await signIn(page, "roe.jane");
  await page.getByTestId("my-messages-link").click();
  const offer = page.locator('[data-testid="notification-offer"][data-open="true"]');
  await expect(offer).toBeVisible({ timeout: 10_000 });
  await page.locator('a[href^="/my-bookings#waitlist-"]').first().click();
  const entry = page.getByTestId("waitlist-entries").locator('[data-state="OFFERED"]');
  await expect(entry).toHaveCount(1, { timeout: 10_000 });
  await entry.getByTestId("waitlist-accept").click();
  await expect(page.getByTestId("waitlist-entries").locator('[data-state="BOOKED"]')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId("upcoming-bookings").getByTestId("personal-cancel")).not.toHaveCount(0, { timeout: 10_000 });
});
