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

async function expectWholeEntriesAtEdges(body: Locator) {
  await expect.poll(() => body.evaluate((element) => {
    const frame = element.getBoundingClientRect();
    return [...element.querySelectorAll("a, p")]
      .map((entry) => entry.getBoundingClientRect())
      .filter((box) => box.bottom > frame.top + 1 && box.top < frame.bottom - 1)
      .filter((box) => box.top < frame.top - 1 || box.bottom > frame.bottom + 1)
      .map((box) => ({ top: box.top, bottom: box.bottom, frameTop: frame.top, frameBottom: frame.bottom }));
  }), { message: "no entry is cut at an edge of the navigation", timeout: 10_000 }).toEqual([]);
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
    await expect(page.getByTestId("admin-sidebar-precedes")).toBeVisible({ timeout: 10_000 });
    await expectWholeEntriesAtEdges(body);
    // when
    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await page.getByTestId("admin-operator-health-link").click();
    // then
    await expect(page.getByTestId("admin-operator-health-link")).toHaveAttribute("aria-current", "page");
    await expectInside(page.getByTestId("admin-operator-health-link"), body);
    await expect(page.getByTestId("admin-sidebar-continues")).toHaveCount(0);
    await expect(page.getByTestId("admin-sidebar-precedes")).toBeVisible();
    await expectWholeEntriesAtEdges(body);
    // when
    await body.evaluate((element) => { element.scrollTop = 0; });
    // then
    await expect(page.getByTestId("admin-sidebar-precedes")).toHaveCount(0);
  });
}

test("given an administrative page taller than the window, when the page scrolls, then the navigation spans the window", async ({ page }) => {
  // given
  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 640 });
  await page.goto("/admin/usage");
  await expect(page.getByTestId("admin-usage-link")).toHaveAttribute("aria-current", "page");
  const frame = page.getByTestId("admin-navigation-frame");
  await frame.evaluate((element) => { (element.nextElementSibling as HTMLElement).style.minHeight = "3000px"; });
  // when
  await page.evaluate(() => window.scrollTo(0, 800));
  // then
  await expect.poll(() => frame.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { top: Math.round(box.top), bottom: Math.round(box.bottom), viewport: window.innerHeight };
  }), { message: "the stuck navigation keeps a margin to both window edges", timeout: 10_000 })
    .toEqual({ top: 32, bottom: 640 - 32, viewport: 640 });
  const body = page.getByTestId("admin-navigation-scroll");
  const slack = await body.evaluate((element) => {
    const end = element.nextElementSibling!.getBoundingClientRect().bottom;
    const tallest = Math.max(...[...element.querySelectorAll("a, p")].map((entry) => entry.getBoundingClientRect().height));
    return { below: element.parentElement!.getBoundingClientRect().bottom - end, tallest };
  });
  expect(slack.below, `less than one entry stays empty below the cue: ${JSON.stringify(slack)}`).toBeLessThan(slack.tallest + 16);
  await expectWholeEntriesAtEdges(body);
});

async function leftEdge(page: Page, testId: string): Promise<number> {
  return Math.round((await page.getByTestId(testId).boundingBox())!.x);
}

for (const width of [1440, 1920]) {
  test(`given a ${width} px desktop, when a member moves between their pages and goes offline, then the navigation, the offline notice and each page start at one edge`, async ({ page, context }) => {
    // given
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await page.getByTestId("username").fill("doe.jane");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    const navigation = await leftEdge(page, "primary-navigation");

    // then
    expect(await leftEdge(page, "court-plan-view"), "the court plan starts where the navigation starts").toBe(navigation);

    // when
    await page.getByTestId("my-messages-link").click();

    // then
    await expect(page.getByTestId("my-messages-view")).toBeVisible();
    expect(await leftEdge(page, "my-messages-view"), "the narrower messages page starts where the navigation starts").toBe(navigation);

    // when
    await page.getByTestId("my-bookings-link").click();
    await expect(page.getByTestId("my-bookings-page")).toBeVisible();
    await context.setOffline(true);

    // then
    await expect(page.getByTestId("offline-status")).toBeVisible();
    expect(await leftEdge(page, "offline-status"), "the offline notice starts where the navigation starts").toBe(navigation);
    expect(await leftEdge(page, "my-bookings-page"), "the offline bookings start where the notice starts").toBe(navigation);
    await context.setOffline(false);
  });
}
