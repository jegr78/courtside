import { expect, test } from "@playwright/test";

test("language and theme preferences persist across reloads", async ({ page }) => {
  // given
  await page.goto("/");

  // then
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByLabel("Sprache")).toHaveValue("de");
  await expect(page.getByLabel("Darstellung")).toHaveValue("dark");

  // when
  await page.getByLabel("Sprache").selectOption("en");
  await page.getByLabel("Theme").selectOption("light");
  await page.reload();

  // then
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByLabel("Language")).toHaveValue("en");
  await expect(page.getByLabel("Theme")).toHaveValue("light");
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
  await page.goto("/");
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("bootstrap-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();

  await expect(page.getByTestId("initial-password-view")).toBeVisible();
  await page.getByTestId("new-password").fill("permanent-password");
  await page.getByTestId("confirm-password").fill("permanent-password");
  await page.getByTestId("password-submit").click();

  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("bootstrap-admin");
  await page.getByTestId("password").fill("permanent-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("home-view")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("home-view")).toBeVisible();
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
});

test("a seeded member stays signed in across a reload and can sign out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();

  await expect(page.getByTestId("home-view")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Court occupancy" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Court 1" })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("home-view")).toBeVisible();
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
});

test("a seeded member can book a free slot and cancel it again", async ({ page }) => {
  // given
  await page.goto("/");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("home-view")).toBeVisible();
  await page.getByTestId("week-next").click();
  const freeSlot = page.getByRole("button", { name: /^Book Court 1 at/ }).first();
  await expect(freeSlot).toBeVisible();

  // when
  await freeSlot.click();
  await page.getByLabel("Search members").fill("Mary");
  await page.getByRole("button", { name: "Add Mary Major" }).click();
  await page.getByRole("button", { name: "Book now" }).click();

  // then
  const gridBooking = page.getByRole("button", { name: "Member booking, cancel booking" });
  await expect(gridBooking).toBeVisible();

  await page.reload();
  const personalBooking = page.getByRole("button", { name: "Cancel Member booking" });
  await expect(personalBooking).toBeVisible();

  // when
  await personalBooking.click();
  await page.getByRole("button", { name: "Confirm cancellation" }).click();

  // then
  await expect(personalBooking).not.toBeVisible();
});
