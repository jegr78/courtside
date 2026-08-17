import { type Locator, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

test.use({ viewport: { width: 1440, height: 1000 }, colorScheme: "dark", locale: "de-DE" });

const screenshotOptions = {
  animations: "disabled" as const,
  caret: "hide" as const,
  fullPage: true
};

test("stable member surfaces match their reviewed baselines", async ({ page, journeyService }) => {
  // given
  await page.goto("/");
  await selectVisualDate(page, journeyService.visualDate);

  // then
  await stableScreenshot(page, "court-plan.png", dynamicDates(page));

  // when
  await signIn(page, "doe.jane");
  await selectVisualDate(page, journeyService.visualDate);
  const slot = page.locator('[data-testid="free-slot"][data-court-number="1"][data-slot="12:00"]');
  await slot.click();
  await expect(page.getByTestId("booking-dialog")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));

  // then
  await stableScreenshot(page, "booking-dialog.png", dynamicDates(page));

  // when
  await page.getByTestId("booking-submit").click();
  await expect(page.getByTestId("booking-dialog").locator("[data-code]")).toBeVisible();

  // then
  await stableScreenshot(page, "booking-validation.png", dynamicDates(page));

  // when
  await page.getByTestId("booking-close").click();
  await page.getByTestId("my-bookings-link").click();
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();

  // then
  await stableScreenshot(page, "personal-bookings.png", page.locator("time"));

  // when
  await page.getByTestId("move-booking").click();
  await page.getByTestId("move-start-time").fill("11:00");
  await page.getByTestId("preview-move").click();
  await expect(page.getByTestId("move-preview")).toBeVisible();

  // then
  await stableScreenshot(page, "series-preview.png", page.getByTestId("move-preview").locator("p"));
});

test("stable administration surfaces match their reviewed baselines", async ({ page }) => {
  // given
  await signIn(page, "configuration-admin");

  // when
  await page.getByTestId("admin-configuration-link").click();
  await expect(page.getByTestId("admin-configuration-view")).toBeVisible();

  // then
  await stableScreenshot(page, "admin-configuration.png");

  // when
  await page.goto("/admin/facility");
  await expect(page.getByTestId("admin-facility-view")).toBeVisible();

  // then
  await stableScreenshot(page, "admin-facility.png");
});

async function signIn(page: Page, username: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
}

async function selectVisualDate(page: Page, date: string): Promise<void> {
  await expect(page.getByTestId("week-grid")).toBeVisible();
  const day = page.getByTestId(`day-selector-${date}`);
  if (await day.count() === 0) {
    await page.getByTestId("week-next").click();
  }
  await day.click();
}

function dynamicDates(page: Page): Locator {
  return page.locator('[data-testid^="day-selector-"], time');
}

async function stableScreenshot(page: Page, name: string, mask?: Locator): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(name, { ...screenshotOptions, ...(mask ? { mask: [mask] } : {}) });
}
