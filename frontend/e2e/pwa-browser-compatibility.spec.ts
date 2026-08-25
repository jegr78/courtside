import { expect, test } from "./fixtures";

test("an installed PWA preserves the signed-in mutation and logout journey", async ({ page }) => {
  // given
  await page.goto("/");
  expect(await page.evaluate(() => "serviceWorker" in navigator)).toBe(true);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();

  // when
  const localeResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/account/locale") && response.request().method() === "PUT");
  await page.locator("#locale-preference").selectOption("en");

  // then
  expect((await localeResponse).status()).toBe(204);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const logoutResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/logout") && response.request().method() === "POST");
  await page.getByTestId("logout").click();
  expect((await logoutResponse).status()).toBe(204);
  await expect(page.getByTestId("logout")).not.toBeVisible();
});
