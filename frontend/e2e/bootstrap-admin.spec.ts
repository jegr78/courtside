import { expect, test } from "@playwright/test";

test("language and theme preferences persist across reloads", async ({ page }) => {
  // given
  await page.goto("/");

  // then
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#locale-preference")).toHaveValue("de");
  await expect(page.locator("#theme-preference")).toHaveValue("dark");

  // when
  await page.locator("#locale-preference").selectOption("en");
  await page.locator("#theme-preference").selectOption("light");
  await page.reload();

  // then
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("#locale-preference")).toHaveValue("en");
  await expect(page.locator("#theme-preference")).toHaveValue("light");
});

test("the application shell identifies the exact running build", async ({ page, request }) => {
  // given
  const source = await (await request.get("/api/source")).json() as {
    version: string;
    commit?: string;
    environment: string;
  };

  // when
  await page.goto("/");
  await page.getByTestId("build-identity").click();

  // then
  await expect(page.getByTestId("build-identity")).toContainText(`v${source.version}`);
  await expect(page.getByRole("dialog")).toContainText(source.version);
  await expect(page.getByRole("dialog")).toContainText(source.environment);
  if (source.commit) {
    await expect(page.getByRole("dialog")).toContainText(source.commit);
  }
});

test("the bootstrap admin can replace the initial password and maintain a session", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("bootstrap-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();

  await expect(page.getByTestId("initial-password-view")).toBeVisible();
  await page.getByTestId("new-password").fill("permanent-password");
  await page.getByTestId("confirm-password").fill("permanent-password");
  await page.getByTestId("password-submit").click();

  await expect(page.getByTestId("sign-in-link")).toBeVisible();
  await page.getByTestId("sign-in-link").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("bootstrap-admin");
  await page.getByTestId("password").fill("permanent-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
});

test("a seeded member stays signed in across a reload and can sign out", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();

  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await expect(page.getByTestId("week-grid")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
});

test("a seeded member can book a free slot and cancel it again", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await page.getByTestId("week-next").click();
  const freeSlot = page.getByTestId("free-slot").first();
  await expect(freeSlot).toBeVisible();

  // when
  await freeSlot.click();
  await page.getByTestId("member-search").fill("Mary");
  await page.getByTestId("member-match").click();
  await page.getByTestId("booking-submit").click();

  // then
  const gridBooking = page.getByTestId("own-allocation");
  await expect(gridBooking).toBeVisible();
  const bookingId = await gridBooking.getAttribute("data-booking-id");
  expect(bookingId).not.toBeNull();

  await page.reload();
  await page.getByTestId("my-bookings-link").click();
  const personalBooking = page.locator(`[data-testid="personal-cancel"][data-booking-id="${bookingId}"]`);
  await expect(personalBooking).toBeVisible();

  // when
  await personalBooking.click();
  await page.getByTestId("confirm-cancellation").click();

  // then
  await expect(personalBooking).not.toBeVisible();
});

test("an admin changes club configuration and a booking rule through the browser", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("admin-configuration-link").click();
  await expect(page.getByTestId("admin-configuration-view")).toBeVisible();

  // when
  await page.getByTestId("club-name").fill("Example Racquet Club");
  await page.getByTestId("save-club-config").click();
  await page.getByTestId("rule-ADVANCE_WINDOW-maxDays").fill("1");
  await page.getByTestId("save-rule-ADVANCE_WINDOW").click();

  // then
  await expect(page.getByTestId("admin-save-success")).toBeVisible();
  await expect(page.getByText("Example Racquet Club")).toBeVisible();

  // when
  await page.goto("/");
  await page.getByTestId("logout").click();
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("week-next").click();
  await page.getByTestId("free-slot").first().click();
  await page.getByTestId("member-search").fill("Mary");
  await page.getByTestId("member-match").click();
  await page.getByTestId("booking-submit").click();

  // then
  await expect(page.locator('[data-code="booking.rule.advanceWindow.exceeded"]')).toBeVisible();
});

test("an admin takes a court out of service and restores it through the browser", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("admin-facility-link").click();
  await expect(page.getByTestId("admin-facility-view")).toBeVisible();
  const court = "dddddddd-0000-0000-0000-000000000004";

  // when
  await page.getByTestId(`toggle-court-${court}`).click();
  await page.goto("/");

  // then
  await expect(page.getByTestId("court-column-4")).not.toBeVisible();

  // when
  await page.getByTestId("admin-facility-link").click();
  await page.getByTestId(`toggle-court-${court}`).click();
  await page.goto("/");

  // then
  await expect(page.getByTestId("court-column-4")).toBeVisible();
});
