import { expect, test } from "./fixtures";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function signIn(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
}

test("member and administration surfaces remain usable on a touch viewport", async ({ page }) => {
  // given
  await signIn(page, "doe.jane");

  // when
  await page.getByTestId("my-bookings-link").tap();

  // then
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.getByTestId("court-plan-link").tap();
  await page.getByTestId("week-next").tap();
  await page.getByTestId("court-selector-2").tap();
  await page.locator('[data-testid="free-slot"][data-court-number="2"][data-slot="12:00"]:visible').tap();

  // then
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.getByTestId("booking-close").tap();
  await page.getByTestId("logout").tap();
  await signIn(page, "configuration-admin");
  await page.getByTestId("admin-configuration-link").tap();

  // then
  await expect(page.getByTestId("admin-configuration-view")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.goto("/admin/facility");

  // then
  await expect(page.getByTestId("admin-facility-view")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("the initial-password form remains usable on a touch viewport", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("bootstrap-admin");
  await page.getByTestId("password").fill("temporary-password");

  // when
  await page.getByTestId("login-submit").tap();

  // then
  await expect(page.getByTestId("initial-password-view")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("new-password").fill("permanent-password");
  await page.getByTestId("confirm-password").fill("permanent-password");
  await expect(page.getByTestId("password-submit")).toBeVisible();
});
