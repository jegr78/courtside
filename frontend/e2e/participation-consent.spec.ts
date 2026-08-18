import { expect, test } from "./fixtures";

const withdrawalBooking = "70000000-0000-0000-0000-000000000007";

test("a member takes themselves out of a booking somebody else recorded them in", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await page.getByTestId("my-bookings-link").click();
  const participation = page.getByTestId(`participation-${withdrawalBooking}`);
  await expect(participation).toBeVisible();

  // when
  await participation.getByTestId("withdraw-participation").click();

  // then
  await expect(participation).toHaveCount(0);
});
