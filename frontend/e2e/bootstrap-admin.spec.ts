import { expect, test } from "@playwright/test";

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
