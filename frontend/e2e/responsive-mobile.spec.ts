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

test("member and administration surfaces remain usable on a touch viewport", async ({ page, journeyService }) => {
  // given
  await signIn(page, "doe.jane");

  // when
  await page.getByTestId("my-bookings-link").tap();

  // then
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.getByTestId("court-plan-link").tap();
  await page.getByTestId("selected-date").fill(journeyService.visualDate);
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
  await expect(page.getByTestId("save-club-config")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.goto("/admin/facility");

  // then
  await expect(page.getByTestId("admin-facility-view")).toBeVisible();
  await expect(page.getByTestId("create-court")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when — the roster is the widest table this product has, so it is where a phone gives out first
  await page.goto("/admin/roster");

  // then
  await expect(page.locator('[data-testid^="roster-row-"]').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.goto("/admin/membership-types");

  // then
  await expect(page.getByTestId("create-membership-type")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.goto("/admin/import");

  // then
  await expect(page.getByTestId("no-sources")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.goto("/admin/audit");

  // then
  await expect(page.getByTestId("audit-row").first()).toBeVisible();
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
