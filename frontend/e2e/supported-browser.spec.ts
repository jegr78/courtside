import { expect, selectJourneyDate, test } from "./fixtures";

async function signIn(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  const sessionResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session") && response.request().method() === "POST");
  await page.getByTestId("login-submit").click();
  expect((await sessionResponse).status()).toBe(200);
  await expect(page.getByTestId("logout")).toBeVisible();
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
  await expect(page.getByTestId("save-club-config")).toBeVisible();

  // when
  await page.goto("/admin/facility");

  // then
  await expect(page.getByTestId("admin-facility-view")).toBeVisible();
  await expect(page.getByTestId("create-court")).toBeVisible();
});

test("a member books a court with an idempotency key the browser could generate", async ({ page, journeyService }, testInfo) => {
  // given
  const overTls = testInfo.project.metadata.plainOrigin !== true;
  await signIn(page, "doe.jane");
  // The two projects cover the two generators: a club with TLS and one without.
  expect(await page.evaluate(() => window.isSecureContext)).toBe(overTls);
  expect(await page.evaluate(() => typeof crypto.randomUUID === "function")).toBe(overTls);
  await selectJourneyDate(page, journeyService.visualDate);

  // when
  await page.locator('[data-testid="free-slot"][data-court-number="2"][data-slot="12:00"][data-state="free"]').click();
  await page.getByTestId("booking-card").selectOption("11111111-1111-1111-1111-111111111111");
  await page.getByTestId("member-search").fill("Mary");
  await page.getByTestId("member-match").click();
  const created = page.waitForResponse((response) =>
    response.url().endsWith("/api/bookings") && response.request().method() === "POST");
  await page.getByTestId("booking-submit").click();

  // then
  expect((await created).status()).toBe(201);
  expect(await (await created).request().headerValue("Idempotency-Key"))
    .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
