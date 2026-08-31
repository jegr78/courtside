import { type Locator, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Locale, theme, viewport and timezone are fixed here; the renderer is fixed by the project,
// which draws in the pinned image rather than in whatever browser the host provides.
test.use({
  viewport: { width: 1440, height: 1000 }, colorScheme: "dark", locale: "de-DE",
  timezoneId: "Europe/Berlin"
});

const screenshotOptions = {
  animations: "disabled" as const,
  caret: "hide" as const
};

test("stable member surfaces match their reviewed baselines", async ({ page, journeyService }) => {
  // given
  await page.goto("/");
  await expect(page.getByTestId("public-club-name")).toBeVisible();
  await selectVisualDate(page, journeyService.visualDate);

  // then
  await stableScreenshot(page.getByTestId("court-plan-view"), "court-plan.png", dynamicDates(page));

  // when
  await signIn(page, "doe.jane");
  await selectVisualDate(page, journeyService.visualDate);
  const slot = page.locator('[data-testid="free-slot"][data-court-number="1"][data-slot="12:00"]');
  await slot.click();
  await expect(page.getByTestId("booking-dialog")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));

  // then
  // The dialog carries no dynamic content of its own - the journey date and slot are pinned - so
  // masking the day strip behind it would only hide the controls this baseline exists to guard.
  await stableScreenshot(page.getByTestId("booking-dialog"), "booking-dialog.png");

  // when
  await page.getByTestId("booking-submit").click();
  await expect(page.getByTestId("booking-dialog").locator("[data-code]")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("booking-dialog"), "booking-validation.png");

  // when
  await page.getByTestId("booking-close").click();
  await page.getByTestId("my-bookings-link").click();
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("my-bookings-page"), "personal-bookings.png", page.locator("time"));

  // when
  await page.getByTestId("my-messages-link").click();
  await expect(page.getByTestId("my-messages-view")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("my-messages-view"), "my-messages.png");

  // when
  await page.getByTestId("my-bookings-link").click();
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();

  // when
  await page.getByTestId("move-booking").click();
  await page.getByTestId("move-start-time").fill("11:00");
  await page.getByTestId("preview-move").click();
  await expect(page.getByTestId("move-preview")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("move-dialog"), "series-preview.png",
    page.getByTestId("move-preview").locator("li p"));
});

test("stable administration surfaces match their reviewed baselines", async ({ page }) => {
  // given
  await signIn(page, "configuration-admin");

  // then
  await stableScreenshot(page.getByTestId("primary-navigation"), "primary-navigation.png");

  // when — every gate below waits for something the view renders only once its data arrived,
  // never for the section itself, which is on screen while the request is still in flight
  await page.getByTestId("administration-link").click();
  await expect(page.getByTestId("save-club-config")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-configuration-view"), "admin-configuration.png");

  // when
  await page.goto("/admin/facility");
  await expect(page.getByTestId("create-court")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-facility-view"), "admin-facility.png");

  // when
  await page.goto("/admin/roster");
  await expect(page.locator('[data-testid^="roster-row-"]').first()).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-roster-view"), "admin-roster.png");

  // when
  await page.goto("/admin/membership-types");
  await expect(page.getByTestId("create-membership-type")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-membership-types-view"), "admin-membership-types.png");

  // when
  await page.goto("/admin/import");
  await expect(page.getByTestId("no-sources")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-import-view"), "admin-import.png");

  // when — the journey world is reset between tests, so the empty log is the one state this
  // surface reaches deterministically; a populated one would be masked down to its own chrome
  await page.goto("/admin/audit");
  await expect(page.getByTestId("audit-empty")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-audit-view"), "admin-audit.png");

  // when — the same reset makes the empty message log the one state it reaches deterministically
  await page.goto("/admin/messages");
  await expect(page.getByTestId("messages-empty")).toBeVisible();

  // then
  await stableScreenshot(page.getByTestId("admin-messages-view"), "admin-messages.png");
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

async function stableScreenshot(surface: Locator, name: string, mask?: Locator): Promise<void> {
  await surface.page().evaluate(() => document.fonts.ready);
  await expect(surface).toHaveScreenshot(name, {
    ...screenshotOptions, mask: mask ? [mask] : []
  });
}
