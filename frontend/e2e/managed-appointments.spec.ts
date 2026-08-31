import { expect, test } from "./fixtures";

async function signIn(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await page.getByTestId("my-bookings-link").click();
}

test("sport and youth directors find the same managed league match", async ({ page }) => {
  for (const username of ["sport.major", "youth.miles"]) {
    // given
    await signIn(page, username);

    // when / then
    await expect(page.getByTestId("managed-appointments-title")).toBeVisible();
    const leagueMatch = page.locator("article").filter({
      has: page.locator('[data-booking-id="70000000-0000-0000-0000-000000000004"]')
    });
    await expect(leagueMatch).toBeVisible();
    await leagueMatch.getByTestId("managed-details").click();
    await expect(page.getByTestId("managed-note")).toContainText("Prepare score sheets");
    await page.getByTestId("close-managed-appointment").click();
    const logout = page.waitForResponse((response) => response.url().endsWith("/api/session/logout"));
    await page.getByTestId("preferences-menu").click();
    await page.getByTestId("logout").click();
    expect((await logout).status()).toBe(204);
    await expect(page.getByTestId("login-view")).toBeVisible();
  }
});

test("an authorized officer cancels a managed appointment through the browser", async ({ page }) => {
  // given
  await signIn(page, "sport.major");
  const bookingId = "70000000-0000-0000-0000-000000000006";
  const cancel = page.locator(`[data-testid="managed-cancel"][data-booking-id="${bookingId}"]`);

  // when
  await cancel.click();
  await page.getByTestId("confirm-cancellation").click();

  // then
  await expect(cancel).not.toBeVisible();
  await expect(page.getByTestId(`booking-${bookingId}`)).toHaveAttribute("data-status", "CANCELLED");
});

test("an officer sees only the appointments the card's managing roles cover", async ({ page }) => {
  // given
  await signIn(page, "keeper.roe");

  // when / then
  await expect(page.getByTestId("managed-appointments-title")).toBeVisible();
  await expect(page.getByTestId("booking-70000000-0000-0000-0000-000000000005")).toBeVisible();
  await expect(page.getByTestId("booking-70000000-0000-0000-0000-000000000004")).toHaveCount(0);
});

test("an ordinary member has no managed-appointments area", async ({ page }) => {
  // when
  await signIn(page, "doe.jane");

  // then
  await expect(page.getByTestId("managed-appointments-title")).toHaveCount(0);
});

test("an officer creates a weekly series and finds its appointments in the managed list", async ({ page }) => {
  // given — the clock is pinned to a Tuesday, so these three Mondays are the same ones every run
  await signIn(page, "sport.major");
  await page.getByTestId("new-series").click();
  await page.getByTestId("series-courts").selectOption(["dddddddd-0000-0000-0000-000000000004"]);
  await page.getByTestId("series-card").selectOption("33333333-3333-3333-3333-333333333333");
  await page.getByTestId("series-starts-on").fill("2026-05-18");
  await page.getByTestId("series-start-time").fill("18:00");
  await page.getByTestId("series-weekday-MONDAY").check();
  await page.getByTestId("series-occurrence-count").fill("3");

  // when
  await page.getByTestId("preview-series").click();
  await expect(page.getByTestId("series-occurrence-2")).toBeVisible();
  const created = page.waitForResponse((response) =>
    response.url().endsWith("/api/booking-series") && response.request().method() === "POST");
  await page.getByTestId("confirm-series").click();
  const { bookingIds } = await (await created).json() as { bookingIds: string[] };

  // then — the appointments are in the list the officer manages, without a reload
  expect(bookingIds).toHaveLength(3);
  await expect(page.getByTestId("series-created")).toBeVisible();
  const managedList = page.getByTestId("managed-bookings");
  for (const bookingId of bookingIds) {
    await expect(managedList.getByTestId(`booking-${bookingId}`)).toBeVisible();
  }
});
