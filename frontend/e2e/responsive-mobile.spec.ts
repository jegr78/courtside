import { expect, test } from "./fixtures";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= viewportWidth) return [];
    return [...document.querySelectorAll("body, main, [data-testid='admin-shell'], [data-testid='admin-configuration-view'], [data-testid='admin-configuration-view'] form, fieldset")]
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        testId: element.getAttribute("data-testid"),
        className: element.getAttribute("class"),
        left: Math.round(element.getBoundingClientRect().left),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        right: Math.round(element.getBoundingClientRect().right),
        viewportWidth
      }));
  });
  expect(overflow).toEqual([]);
}

async function signIn(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
}

test("member and administration surfaces remain usable on a touch viewport", async ({ page, journeyService }) => {
  // given
  await signIn(page, "doe.jane");

  // when
  await page.getByTestId("my-bookings-link").tap();

  // then
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.getByTestId("court-plan-link").tap();
  await page.getByTestId("selected-date").fill(journeyService.visualDate);
  await page.getByTestId("court-selector-2").tap();
  await page.locator('[data-testid="free-slot"][data-court-number="2"][data-slot="12:00"]:visible').tap();

  // then
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.getByTestId("booking-close").tap();
  await page.getByTestId("preferences-menu").tap();
  await page.getByTestId("logout").tap();
  await signIn(page, "configuration-admin");
  await page.getByTestId("administration-link").tap();

  // then — the destinations are folded behind one control at this width, and the control says
  // which one is open rather than leaving that to a marker nobody can see while it is folded
  await expect(page.getByTestId("admin-menu")).toBeVisible();
  await expect(page.getByTestId("admin-courts-link")).not.toBeVisible();
  await expect(page.getByTestId("admin-configuration-view")).toBeVisible();
  await expect(page.getByTestId("save-club-config")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when — the footer carries its legal links only once a club has set them, so without this the
  // overflow guard never sees the row it exists to protect
  await page.getByTestId("imprint-url").fill("/imprint");
  await page.getByTestId("privacy-url").fill("/privacy");
  await page.getByTestId("save-club-config").tap();

  // then
  await expect(page.getByTestId("footer-imprint")).toBeVisible();
  await expect(page.getByTestId("footer-privacy")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.getByTestId("admin-menu").tap();
  await page.getByTestId("admin-courts-link").tap();

  // then
  await expect(page.getByTestId("admin-courts-view")).toBeVisible();
  await expect(page.getByTestId("create-court")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.goto("/admin/roster");

  // then
  const rosterRow = page.locator('[data-testid^="roster-row-"]').first();
  await expect(rosterRow).toBeVisible();
  expect(await rosterRow.evaluate((element) => getComputedStyle(element).display)).toBe("grid");
  await expect(rosterRow.getByTestId("roster-label-membership")).toBeVisible();
  await expect(page.getByRole("table").getByRole("columnheader")).toHaveCount(4);
  await expect(rosterRow.getByRole("cell")).toHaveCount(4);
  expect(await rosterRow.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expectNoHorizontalOverflow(page);

  // when
  await page.goto("/admin/membership-types");

  // then
  await expect(page.getByTestId("create-membership-type")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.goto("/admin/import");

  // then
  await expect(page.getByTestId("no-sources")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.goto("/admin/audit");

  // then
  const auditRow = page.getByTestId("audit-row").first();
  await expect(auditRow).toBeVisible();
  expect(await auditRow.evaluate((element) => getComputedStyle(element).display)).toBe("grid");
  await expect(auditRow.getByTestId("audit-label-actor")).toBeVisible();
  await expect(page.getByRole("table").getByRole("columnheader")).toHaveCount(4);
  await expect(auditRow.getByRole("cell")).toHaveCount(4);
  expect(await auditRow.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test("the initial-password form remains usable on a touch viewport", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("bootstrap-admin");
  await page.getByTestId("password").fill("temporary-password");

  // when
  await page.getByTestId("login-submit").tap();

  // then
  await expect(page.getByTestId("initial-password-view")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.getByTestId("new-password").fill("permanent-password");
  await page.getByTestId("confirm-password").fill("permanent-password");
  await expect(page.getByTestId("password-submit")).toBeVisible();
});

test("a court selector wider than the phone shows where more courts continue", async ({ page }) => {
  // given
  await signIn(page, "doe.jane");
  const selector = page.getByTestId("court-selector");
  await expect(selector).toBeVisible();
  expect(await selector.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

  // then
  await expect(page.getByTestId("court-selector-continuation")).toBeVisible();

  // when
  await selector.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));

  // then
  await expect(page.getByTestId("court-selector-continuation")).toBeHidden();
});

test("a vertical gesture over the phone plan scrolls the page rather than a nested grid", async ({ page }) => {
  // given
  await signIn(page, "doe.jane");
  const plan = page.getByTestId("week-grid");
  await expect(plan).toBeVisible();

  // then
  expect(await plan.evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
  expect(await plan.evaluate((element) => element.scrollHeight)).toBe(await plan.evaluate((element) => element.clientHeight));
  expect(await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight)).toBe(true);

  // when
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const selectedDate = page.getByTestId("selected-date");
  const nextDate = await selectedDate.evaluate((element: HTMLInputElement) => {
    const date = new Date(`${element.value}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  });
  await selectedDate.fill(nextDate);

  // then
  await expect.poll(async () => Math.abs((await plan.boundingBox())?.y ?? Number.POSITIVE_INFINITY)).toBeLessThan(1);
});
