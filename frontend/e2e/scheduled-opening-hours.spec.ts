import { expect, test } from "./fixtures";

const NEXT_MONDAY = "2026-05-18";
const THIS_MONDAY = "2026-05-11";

test("a board schedules shorter hours from next week, and only that week's plan opens by them", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await page.getByTestId("administration-link").click();
  await page.getByTestId("admin-opening-hours-link").click();
  await expect(page.getByTestId("hours-open-MONDAY")).toBeEnabled();

  // when
  await page.getByTestId("opening-hours-effective-from").fill(NEXT_MONDAY);
  await page.getByTestId("hours-open-MONDAY").fill("10:00");
  await page.getByTestId("hours-close-MONDAY").fill("18:00");
  const stored = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/opening-hours") && response.request().method() === "PUT");
  await page.getByTestId("save-opening-hours").click();

  // then
  expect((await stored).request().postDataJSON()).toMatchObject({ effectiveFrom: NEXT_MONDAY });
  await expect(page.getByTestId(`opening-week-${NEXT_MONDAY}`)).toBeVisible();
  await expect(page.getByTestId("opening-week-beginning")).toBeVisible();

  // when
  await page.goto("/");
  await page.getByTestId(`day-selector-${THIS_MONDAY}`).click();

  // then
  await expect(page.locator('[data-testid^="slot-row-"]').first(), "this week keeps the hours it had")
    .toHaveAttribute("data-slot", "08:00");

  // when
  await page.getByTestId("week-next").click();
  await page.getByTestId(`day-selector-${NEXT_MONDAY}`).click();

  // then
  await expect(page.locator('[data-testid^="slot-row-"]').first(), "the scheduled week opens later")
    .toHaveAttribute("data-slot", "10:00");
  await expect(page.locator('[data-testid^="slot-row-"]').last()).toHaveAttribute("data-slot", "17:30");
});
