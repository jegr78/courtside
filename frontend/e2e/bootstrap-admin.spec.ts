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

  await page.reload();
  await page.getByTestId("my-bookings-link").click();
  const personalBooking = page.getByTestId("personal-cancel");
  await expect(personalBooking).toBeVisible();

  // when
  await personalBooking.click();
  await page.getByTestId("confirm-cancellation").click();

  // then
  await expect(personalBooking).not.toBeVisible();
});
