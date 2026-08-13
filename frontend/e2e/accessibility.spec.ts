import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

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
  throw new Error(`Keyboard focus did not reach ${testId}`);
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

  test(`${locale} member views and booking dialog meet automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await page.locator("#locale-preference").selectOption(locale);
    await signIn(page, "doe.jane");

    // when / then
    await expectNoWcagViolations(page);
    await page.getByTestId("week-next").click();
    await page.locator('[data-testid="free-slot"][data-state="free"]').first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoWcagViolations(page);
    await page.keyboard.press("Escape");
    await page.getByTestId("my-bookings-link").click();
    await expect(page.getByTestId("my-bookings-page")).toBeVisible();
    await expectNoWcagViolations(page);
  });

  test(`${locale} administration views meet automated WCAG 2.2 AA checks`, async ({ page }) => {
    // given
    await page.goto("/");
    await page.locator("#locale-preference").selectOption(locale);
    await signIn(page, "configuration-admin");

    // when / then
    await page.getByTestId("admin-configuration-link").click();
    await expect(page.getByTestId("admin-configuration-view")).toBeVisible();
    await expectNoWcagViolations(page);
    await page.goto("/admin/facility");
    await expect(page.getByTestId("admin-facility-view")).toBeVisible();
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

test("booking dialog traps focus in both directions and restores its trigger", async ({ page, browserName }) => {
  // given
  await signIn(page, "doe.jane");
  await page.getByTestId("week-next").click();
  const trigger = page.locator('[data-testid="free-slot"][data-state="free"]').first();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const focusable = dialog.locator('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
  const first = focusable.first();
  const last = focusable.last();

  // when / then
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Shift+Tab" : "Shift+Tab");
  await expect(last).toBeFocused();
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
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

test("the core layout reflows at 400 percent zoom", async ({ page }) => {
  // given
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");

  // when
  await page.evaluate(() => { document.documentElement.style.zoom = "4"; });

  // then
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
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
