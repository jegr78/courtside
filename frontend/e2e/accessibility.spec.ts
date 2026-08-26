import AxeBuilder from "@axe-core/playwright";
import { expect, selectJourneyDate, test } from "./fixtures";
import { productFailure } from "./browser-diagnostics";

async function expectNoWcagViolations(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function signIn(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
}

async function tabToTestId(page: import("@playwright/test").Page, testId: string, limit = 100, key = "Tab") {
  for (let step = 0; step < limit; step += 1) {
    if (await page.evaluate((value) => document.activeElement?.getAttribute("data-testid") === value, testId)) return;
    await page.keyboard.press(key);
  }
  throw productFailure(`Keyboard focus did not reach ${testId}`);
}

for (const locale of ["de", "en"]) {
  test(`${locale} public and login views meet automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await page.locator("#locale-preference").selectOption(locale);

    // when / then
    await expectNoWcagViolations(page);
    await page.getByTestId("sign-in-link").click();
    await expectNoWcagViolations(page);
  });

  test(`${locale} member views and booking dialog meet automated WCAG 2.2 AA checks`, async ({ page, journeyService }) => {
    // given
    await page.goto("/");
    await page.locator("#locale-preference").selectOption(locale);
    await signIn(page, "doe.jane");

    // when / then
    await expectNoWcagViolations(page);
    await selectJourneyDate(page, journeyService.visualDate);
    await page.locator('[data-testid="free-slot"][data-state="free"]').first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoWcagViolations(page);
    await page.keyboard.press("Escape");
    await page.getByTestId("my-bookings-link").click();
    await expect(page.getByTestId("my-bookings-page")).toBeVisible();
    await expectNoWcagViolations(page);
    await page.getByTestId("my-messages-link").click();
    await expect(page.getByTestId("my-messages-view")).toBeVisible();
    await expectNoWcagViolations(page);
  });

  test(`${locale} the series form meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await page.locator("#locale-preference").selectOption(locale);
    await signIn(page, "sport.major");
    await page.getByTestId("my-bookings-link").click();

    // when
    await page.getByTestId("new-series").click();
    await expect(page.getByTestId("series-courts")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} administration configuration meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await page.locator("#locale-preference").selectOption(locale);
    await signIn(page, "configuration-admin");

    // when
    await page.goto("/admin/configuration");
    await expect(page.getByTestId("admin-configuration-view")).toBeVisible();
    await expect(page.getByTestId("save-club-config")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} facility and audit administration meet automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await page.locator("#locale-preference").selectOption(locale);
    await signIn(page, "configuration-admin");

    // when
    await page.goto("/admin/facility");
    await expect(page.getByTestId("admin-facility-view")).toBeVisible();
    await expect(page.getByTestId("create-court")).toBeVisible();

    // then
    await expectNoWcagViolations(page);

    // when
    const courtToggled = page.waitForResponse((response) =>
      response.url().endsWith("/api/admin/courts/dddddddd-0000-0000-0000-000000000002/active")
        && response.request().method() === "PUT"
    );
    await page.getByTestId("toggle-court-dddddddd-0000-0000-0000-000000000002").click();
    await courtToggled;
    await page.goto("/admin/audit");
    await expect(page.getByTestId("admin-audit-view")).toBeVisible();
    await expect(page.getByTestId("audit-row").first()).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} roster administration meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await page.locator("#locale-preference").selectOption(locale);
    await signIn(page, "configuration-admin");

    // when
    await page.goto("/admin/roster");
    await expect(page.getByTestId("admin-roster-view")).toBeVisible();
    await expect(page.getByTestId("create-person")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} membership type administration meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await page.locator("#locale-preference").selectOption(locale);
    await signIn(page, "configuration-admin");

    // when
    await page.goto("/admin/membership-types");
    await expect(page.getByTestId("admin-membership-types-view")).toBeVisible();
    await expect(page.getByTestId("create-membership-type")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} import administration meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await page.locator("#locale-preference").selectOption(locale);
    await signIn(page, "configuration-admin");

    // when
    await page.goto("/admin/import");
    await expect(page.getByTestId("no-sources")).toBeVisible();
    await page.getByTestId("new-source").click();
    await expect(page.getByTestId("column-EXTERNAL_ID")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });

  test(`${locale} message log administration meets automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await page.locator("#locale-preference").selectOption(locale);
    await signIn(page, "configuration-admin");

    // when — empty, because the control this view adds is the filter and it is on screen either
    // way; the table's own markup is the shape the roster and the audit table are checked with
    await page.goto("/admin/messages");
    await expect(page.getByTestId("messages-empty")).toBeVisible();

    // then
    await expectNoWcagViolations(page);
  });
}

test("initial password and validation states meet automated WCAG 2.2 AA checks", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("bootstrap-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("initial-password-view")).toBeVisible();

  // when / then
  await expectNoWcagViolations(page);
  await page.getByTestId("new-password").fill("first-password");
  await page.getByTestId("confirm-password").fill("second-password");
  await page.getByTestId("password-submit").click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expectNoWcagViolations(page);
});

test("initial password change is operable using only the keyboard", async ({ page, browserName }) => {
  // given
  await page.goto("/login");
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await page.getByTestId("username").focus();
  await page.keyboard.type("bootstrap-admin");
  await page.keyboard.press(tabKey);
  await page.keyboard.type("temporary-password");
  await tabToTestId(page, "login-submit", 100, tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("initial-password-view")).toBeVisible();

  // when
  await tabToTestId(page, "new-password", 100, tabKey);
  await page.keyboard.type("permanent-password");
  await page.keyboard.press(tabKey);
  await page.keyboard.type("permanent-password");
  await tabToTestId(page, "password-submit", 100, tabKey);
  await page.keyboard.press("Enter");

  // then
  await expect(page.getByTestId("login-view")).toBeVisible();
});

test("booking dialog traps focus in both directions and restores its trigger", async ({ page, journeyService }) => {
  // given
  await signIn(page, "doe.jane");
  await selectJourneyDate(page, journeyService.visualDate);
  const trigger = page.locator('[data-testid="free-slot"][data-state="free"]').first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("booking-submit")).toBeEnabled();
  const focusable = dialog.locator('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
  const first = focusable.first();
  const last = focusable.last();

  // when / then
  await expect(first).toBeFocused();
  await first.press("Shift+Tab");
  await expect(last).toBeFocused();
  await last.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});

test("a booking is operable using only the keyboard", async ({ page, browserName, journeyService }) => {
  // given
  await signIn(page, "doe.jane");
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await selectJourneyDate(page, journeyService.visualDate);
  await page.getByTestId("court-plan-link").focus();
  await tabToTestId(page, "free-slot", 200, tabKey);
  const bookingsBefore = await page.getByTestId("own-allocation").count();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();

  // when
  await tabToTestId(page, "member-search", 100, tabKey);
  await page.keyboard.type("Mary");
  await expect(page.getByTestId("member-match")).toBeVisible();
  await tabToTestId(page, "member-match", 100, tabKey);
  await page.keyboard.press("Enter");
  await tabToTestId(page, "booking-submit", 100, tabKey);
  await page.keyboard.press("Enter");

  // then
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByTestId("own-allocation")).toHaveCount(bookingsBefore + 1);
});

test("login and cancellation are operable using only the keyboard", async ({ page, browserName }) => {
  // given
  await page.goto("/login");

  // when
  await expect(page.getByTestId("username")).toBeFocused();
  await page.keyboard.type("doe.jane");
  await page.keyboard.press("Tab");
  await page.keyboard.type("temporary-password");
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await tabToTestId(page, "login-submit", 100, tabKey);
  await page.keyboard.press("Enter");

  // then
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await tabToTestId(page, "my-bookings-link", 100, tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();
  await tabToTestId(page, "personal-cancel", 100, tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").locator(":focus")).toHaveCount(1);
  await tabToTestId(page, "confirm-cancellation", 100, tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("series management is operable using only the keyboard", async ({ page, browserName }) => {
  // given
  await signIn(page, "doe.jane");
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await tabToTestId(page, "my-bookings-link", 100, tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();

  // when
  await tabToTestId(page, "move-booking", 100, tabKey);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await tabToTestId(page, "move-duration", 100, tabKey);
  await page.keyboard.type("90");
  await tabToTestId(page, "preview-move", 100, tabKey);
  await page.keyboard.press("Enter");

  // then
  await expect(page.getByTestId("move-preview")).toBeVisible();
});

test("core administration is operable using only the keyboard", async ({ page, browserName }) => {
  // given
  await signIn(page, "configuration-admin");
  await page.goto("/admin/configuration");
  await expect(page.getByTestId("admin-configuration-view")).toBeVisible();
  await expect(page.getByTestId("club-name")).toHaveValue("Courtside");

  // when
  const tabKey = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await tabToTestId(page, "club-name", 100, tabKey);
  await tabToTestId(page, "save-club-config", 100, tabKey);
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/config") && response.request().method() === "PUT"
  );
  await page.keyboard.press("Enter");

  // then
  expect((await saved).status()).toBe(200);
  await expect(page.getByTestId("admin-save-success")).toBeVisible();
});

test("the core layout reflows at the 400 percent zoom equivalent", async ({ page }) => {
  // given
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await expect(page.getByTestId("court-plan-view")).toBeVisible();

  // when
  await page.setViewportSize({ width: 320, height: 720 });
  await page.evaluate(() => document.fonts.ready);

  // then
  await expect(async () => {
    const layout = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
      fonts: document.fonts.status,
      reflowed: window.matchMedia("(max-width: 640px)").matches
    }));
    // A face still loading renders in a fallback whose metrics are not the layout under test.
    expect(layout.fonts).toBe("loaded");
    expect(layout.reflowed).toBe(true);
    expect(layout.content).toBeLessThanOrEqual(layout.viewport);
  }).toPass();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
});

test("reduced motion and forced colours preserve the core controls", async ({ page }) => {
  // given
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });

  // when
  await page.goto("/");

  // then
  await expect(page.getByTestId("week-next")).toBeVisible();
  const transitionDuration = await page.getByTestId("week-next").evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).transitionDuration));
  expect(transitionDuration).toBeLessThanOrEqual(0.001);
  await page.getByTestId("week-next").focus();
  await expect(page.getByTestId("week-next")).toBeFocused();
});
