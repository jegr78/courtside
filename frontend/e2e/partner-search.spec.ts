import type { Page } from "@playwright/test";
import { expect, selectJourneyDate, test } from "./fixtures";

const lookingForAPartner = "66666666-6666-6666-6666-666666666666";

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

test("a member offers the open place of their booking and another member takes it", async ({ page, journeyService }) => {
  // given — a booking whose second slot is the partner marker
  await signIn(page, "doe.jane");
  await selectJourneyDate(page, journeyService.visualDate);
  await page.locator('[data-testid="free-slot"][data-court-number="3"][data-slot="17:00"][data-state="free"]').click();
  await page.getByTestId("booking-more-summary").click();
  await page.getByTestId("participant-card").first().selectOption(lookingForAPartner);
  await page.getByTestId("booking-submit").click();
  const held = page.locator('tr[data-slot="17:00"] [data-testid="own-allocation"]');
  await expect(held).toBeVisible({ timeout: 10_000 });
  const bookingId = await held.getAttribute("data-booking-id");

  // when — its holder offers the place
  await page.getByTestId("my-bookings-link").click();
  await page.locator(`[data-testid="publish-open-place"][data-booking-id="${bookingId}"]`).click();
  await expect(page.locator(`[data-testid="withdraw-open-place"][data-booking-id="${bookingId}"]`)).toBeVisible({ timeout: 10_000 });
  await signOut(page);

  // then — another member sees the slot and nobody's name, and takes it
  await signIn(page, "roe.jane");
  await page.getByTestId("my-bookings-link").click();
  const place = page.getByTestId("open-places").locator("li");
  await expect(place).toHaveCount(1, { timeout: 10_000 });
  await expect(place, "an open place names nobody").not.toContainText("Doe");
  await place.getByTestId("take-open-place").click();
  await expect(page.getByTestId(`participation-${bookingId}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("open-places")).toHaveCount(0);
  await signOut(page);

  // then — the holder's booking no longer offers a place
  await signIn(page, "doe.jane");
  await page.getByTestId("my-bookings-link").click();
  await expect(page.getByTestId(`booking-${bookingId}`)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`[data-booking-id="${bookingId}"][data-testid$="open-place"]`)).toHaveCount(0);
});
