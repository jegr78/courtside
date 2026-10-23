import { type Locator, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { tabToTestId } from "./accessibility-checks";

test.setTimeout(60_000);

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
}

async function expectInside(link: Locator, body: Locator) {
  const item = await link.boundingBox();
  const frame = await body.boundingBox();
  expect(item).not.toBeNull();
  expect(frame).not.toBeNull();
  expect(item!.y).toBeGreaterThanOrEqual(frame!.y - 1);
  expect(item!.y + item!.height).toBeLessThanOrEqual(frame!.y + frame!.height + 1);
}

test("given a landscape phone account menu, when the member opens it, then a cue marks hidden entries and keyboard reaches sign out", async ({ page, browserName }) => {
  // given
  await signIn(page);
  await page.setViewportSize({ width: 852, height: 393 });
  await page.getByTestId("preferences-menu").click();
  await expectInside(page.getByTestId("logout"), page.getByTestId("preferences-body"));
  await expect(page.getByTestId("preferences-continues")).toHaveCount(0, { timeout: 10_000 });
  await page.getByTestId("preferences-menu").click();
  await page.setViewportSize({ width: 852, height: 350 });
  // when
  await page.getByTestId("preferences-menu").click();
  // then
  const cue = page.getByTestId("preferences-continues");
  await expect(cue).toBeVisible({ timeout: 10_000 });
  const box = await cue.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(350);
  // when
  await tabToTestId(page, "logout", browserName === "webkit" ? "Alt+Tab" : "Tab");
  // then
  await expect(page.getByTestId("logout")).toBeFocused();
  await expectInside(page.getByTestId("logout"), page.getByTestId("preferences-body"));
  const tail = await page.getByTestId("preferences-body").evaluate((element) => ({
    remaining: element.scrollHeight - element.clientHeight - element.scrollTop,
    bodyPadding: getComputedStyle(element).paddingBottom,
    contentPadding: getComputedStyle(element.firstElementChild!).paddingBottom
  }));
  await expect(cue, JSON.stringify(tail)).toHaveCount(0, { timeout: 10_000 });
});

for (const height of [640, 800]) {
  test(`given a ${height} pixel desktop, when administration opens a deep destination, then its active link stays within the navigation`, async ({ page }) => {
    // given
    await signIn(page);
    await page.setViewportSize({ width: 1440, height });
    // when
    await page.goto("/admin/usage");
    // then
    await expect(page.getByTestId("admin-usage-link")).toHaveAttribute("aria-current", "page");
    await expectInside(page.getByTestId("admin-usage-link"), page.getByTestId("admin-navigation-frame"));
    const body = page.getByTestId("admin-navigation-scroll");
    await expect(body).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("admin-sidebar-continues")).toBeVisible({ timeout: 10_000 });
    // when
    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.getByTestId("admin-operator-health-link").click();
    // then
    await expect(page.getByTestId("admin-operator-health-link")).toHaveAttribute("aria-current", "page");
    await expectInside(page.getByTestId("admin-operator-health-link"), body);
    await expect(page.getByTestId("admin-sidebar-continues")).toHaveCount(0);
  });
}
