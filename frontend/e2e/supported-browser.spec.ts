import { expect, test } from "./fixtures";

async function signIn(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
}

test("a member can navigate the core signed-in journey", async ({ page }) => {
  // given
  await page.goto("/");
  await expect(page.getByTestId("court-plan-view")).toBeVisible();

  // when
  await signIn(page, "doe.jane");
  await page.getByTestId("my-bookings-link").click();

  // then
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();
  const logoutResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/logout") && response.request().method() === "POST");
  await page.getByTestId("logout").click();
  expect((await logoutResponse).status()).toBe(204);
  await expect(page.getByTestId("my-bookings-page")).not.toBeVisible();
  await expect(page.getByTestId("logout")).not.toBeVisible();
  await expect(page.getByTestId("sign-in-link").or(page.getByTestId("login-submit"))).toBeVisible();
});

test("an administrator can open both core administration views", async ({ page }) => {
  // given
  await signIn(page, "configuration-admin");

  // when
  await page.getByTestId("admin-configuration-link").click();

  // then
  await expect(page.getByTestId("admin-configuration-view")).toBeVisible();

  // when
  await page.goto("/admin/facility");

  // then
  await expect(page.getByTestId("admin-facility-view")).toBeVisible();
});
