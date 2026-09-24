import { expect, selectJourneyDate, test } from "./fixtures";

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

async function expectPrimaryNavigationFits(
  page: import("@playwright/test").Page,
  accessibleNames: string[]
) {
  const bar = page.getByTestId("primary-navigation-bar");
  await expect(bar).toBeVisible();
  const layout = await bar.evaluate((element) => {
    const barBounds = element.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      links: [...element.querySelectorAll("a")].map((link) => {
        const bounds = link.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, visible: bounds.width > 0 && bounds.height > 0 };
      }),
      left: barBounds.left,
      right: barBounds.right
    };
  });
  expect(layout.links).toHaveLength(accessibleNames.length);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  for (const link of layout.links) {
    expect(link.visible).toBe(true);
    expect(link.left).toBeGreaterThanOrEqual(layout.left);
    expect(link.right).toBeLessThanOrEqual(layout.right);
  }
  for (const name of accessibleNames) await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
}

test("administrator and member destinations fit the narrow phone bar", async ({ page }) => {
  // given
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/login");
  await page.evaluate(() => window.localStorage.setItem("courtside.locale", "de-DE"));
  await signIn(page, "configuration-admin");

  // then
  await expectPrimaryNavigationFits(page, ["Platzplan", "Meine Buchungen", "Benachrichtigungen", "Verwaltung"]);

  // when
  await page.evaluate(() => window.localStorage.setItem("courtside.locale", "en-GB"));
  await page.reload();

  // then
  await expectPrimaryNavigationFits(page, ["Court plan", "My bookings", "Notifications", "Administration"]);

  // when
  await page.context().clearCookies();
  await page.evaluate(() => window.localStorage.setItem("courtside.locale", "de-DE"));
  await signIn(page, "doe.jane");

  // then
  await expectPrimaryNavigationFits(page, ["Platzplan", "Meine Buchungen", "Benachrichtigungen"]);

  // when
  await page.evaluate(() => window.localStorage.setItem("courtside.locale", "en-GB"));
  await page.reload();

  // then
  await expectPrimaryNavigationFits(page, ["Court plan", "My bookings", "Notifications"]);
});

test("the account menu stays inside the narrowest supported viewport", async ({ page }) => {
  // given
  await page.setViewportSize({ width: 320, height: 720 });
  await signIn(page, "configuration-admin");
  await expect(page.getByTestId("administration-link")).toBeVisible();
  await page.goto("/admin/configuration");
  await page.getByTestId("club-name").fill("C");
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/config") && response.request().method() === "PUT"
  );
  await page.getByTestId("save-club-config").tap();
  const response = await saved;
  expect(response.status()).toBe(200);
  expect((await response.json() as { clubName: string }).clubName).toBe("C");
  await expect(page.getByTestId("admin-save-success")).toBeVisible();
  await expect(page.getByTestId("club-brand-name")).toHaveText("C");
  await page.goto("/");
  await expect(page.getByTestId("club-brand-name")).toHaveText("C");
  await expect(page.getByTestId("week-date")).toBeEnabled();

  // when
  await page.getByTestId("preferences-menu").tap();

  // then
  const panel = page.locator("details:has([data-testid='preferences-menu']) > div");
  const viewport = page.viewportSize();
  const bounds = await panel.boundingBox();
  expect(viewport).not.toBeNull();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);

  const controls = [
    ...await panel.locator("label").all(),
    page.getByTestId("account-security-link"),
    page.getByTestId("logout")
  ];
  for (const control of controls) {
    await expect(control).toBeVisible();
    const controlBounds = await control.boundingBox();
    expect(controlBounds).not.toBeNull();
    expect(controlBounds!.x).toBeGreaterThanOrEqual(0);
    expect(controlBounds!.x + controlBounds!.width).toBeLessThanOrEqual(viewport!.width);
  }

  // and the account actions remain reachable rather than merely painted inside the viewport
  await page.getByTestId("account-security-link").tap();
  await expect(page).toHaveURL(/\/account\/security$/);
  await page.getByTestId("preferences-menu").tap();
  await page.getByTestId("logout").tap();
  await expect(page).toHaveURL(/\/login$/);
});

test("a member reaches every destination from the bottom of a touch viewport", async ({ page }) => {
  // given
  await signIn(page, "doe.jane");
  await expect(page.getByTestId("court-plan-link")).toBeVisible();

  // when
  const bar = page.getByTestId("primary-navigation-bar");
  const box = await bar.boundingBox();
  const viewport = page.viewportSize();

  // then — pinned to the bottom edge rather than merely present somewhere down the page
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.round(box!.y + box!.height)).toBe(viewport!.height);

  // then — every destination is a target a thumb can hit
  const links = await bar.locator("a").all();
  expect(links.length).toBeGreaterThan(1);
  for (const link of links) {
    const target = await link.boundingBox();
    expect(target!.height).toBeGreaterThanOrEqual(44);
  }

  // when
  await page.getByTestId("my-messages-link").tap();

  // then
  await expect(page.getByTestId("my-messages-view")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  const clearance = await page.evaluate(() => {
    const bar = document.querySelector("[data-testid='primary-navigation-bar']");
    const footer = document.querySelector("footer");
    if (bar === null || footer === null) return null;
    return {
      bar: bar.getBoundingClientRect().height,
      reserved: parseFloat(getComputedStyle(footer).paddingBottom)
    };
  });

  // then — at the end of the page the bar takes the last band of the viewport, so the space
  // reserved below the footer's own content has to be at least as tall as the bar
  expect(clearance).not.toBeNull();
  expect(clearance!.bar).toBeGreaterThan(0);
  expect(clearance!.reserved).toBeGreaterThanOrEqual(clearance!.bar);
});

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
  await selectJourneyDate(page, journeyService.visualDate);
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
  await expect(page.getByTestId("admin-setup-view")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  const pageTop = async () => (await page.getByTestId("admin-setup-view").boundingBox())!.y;
  const before = await pageTop();
  await page.getByTestId("admin-menu").tap();

  // then
  await expect(page.getByTestId("admin-configuration-link")).toBeVisible();
  expect(await pageTop(), "the open menu lies over the page instead of pushing it down").toBe(before);
  await expectNoHorizontalOverflow(page);

  // when
  await page.getByTestId("admin-configuration-link").tap();

  // then
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
  await expect(page.getByTestId("footer-documentation")).toBeVisible();
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
  await expect(page.getByRole("table").getByRole("columnheader")).toHaveCount(6);
  await expect(rosterRow.getByRole("cell")).toHaveCount(6);
  await expect(page.getByTestId("roster-sort-field")).toBeVisible();
  await expect(page.getByRole("table").getByRole("columnheader").first().getByRole("button"))
    .toHaveAttribute("tabindex", "-1");
  expect(await rosterRow.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expectNoHorizontalOverflow(page);

  // when
  await page.goto("/admin/membership-types");

  // then
  await expect(page.getByTestId("create-membership-type")).toBeVisible();
  const typeRow = page.getByTestId("membership-type-cccccccc-0000-0000-0000-000000000001");
  expect(await typeRow.evaluate((element) => getComputedStyle(element).display)).toBe("grid");
  await expect(typeRow.getByTestId("membership-type-label-name")).toBeVisible();
  await expect(typeRow.getByTestId("membership-type-label-rule-set")).toBeVisible();
  expect(await typeRow.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
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

test("a free slot fills its cell and remains large enough to tap", async ({ page, journeyService }) => {
  // given
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "doe.jane");
  await selectJourneyDate(page, journeyService.visualDate);
  const slot = page.locator('[data-testid="free-slot"][data-state="free"]').first();
  await expect(slot).toBeVisible();

  // then
  const phoneBounds = await slot.boundingBox();
  expect(phoneBounds).not.toBeNull();
  expect(phoneBounds!.width).toBeGreaterThanOrEqual(44);
  expect(phoneBounds!.height).toBeGreaterThanOrEqual(44);
  expect(await slot.evaluate((element) => getComputedStyle(element, "::after").content)).not.toContain("✓");

  // when
  await page.setViewportSize({ width: 1280, height: 900 });

  // then
  const desktopGeometry = await slot.evaluate((element) => {
    const slotBounds = element.getBoundingClientRect();
    const cellBounds = element.parentElement!.getBoundingClientRect();
    return {
      slot: { width: slotBounds.width, height: slotBounds.height },
      cell: { width: cellBounds.width, height: cellBounds.height }
    };
  });
  expect(desktopGeometry.slot.width).toBeGreaterThanOrEqual(desktopGeometry.cell.width - 8);
  expect(desktopGeometry.slot.height).toBeGreaterThanOrEqual(desktopGeometry.cell.height - 8);
});

test("the phone reaches the whole week before the first bookable row", async ({ page }) => {
  // given
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "doe.jane");
  const navigation = page.getByTestId("mobile-week-navigation");
  await expect(navigation).toBeVisible();

  // then — one compact strip owns week changes, day choices, and the return to now
  await expect(navigation.locator('[data-testid^="day-selector-"]')).toHaveCount(7);
  await expect(navigation.getByTestId("mobile-week-previous")).toBeVisible();
  await expect(navigation.getByTestId("mobile-current-time")).toBeVisible();
  await expect(navigation.getByTestId("mobile-week-next")).toBeVisible();
  expect(await navigation.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
    await navigation.evaluate((element) => element.clientWidth)
  );
  const currentDay = navigation.locator('[data-testid^="day-selector-"][aria-pressed="true"]');
  const currentDayId = await currentDay.getAttribute("data-testid");
  expect(currentDayId).not.toBeNull();

  // The plan keeps elapsed rows for context and brings the current one into view on its own.
  const firstBookable = page.locator('[data-testid="free-slot"][data-state="free"]').first();
  const bounds = await firstBookable.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);

  // when — any day in the shown week is a direct choice rather than a sequence of next-day steps
  const lastDay = navigation.locator('[data-testid^="day-selector-"]').last();
  await lastDay.click();

  // then
  await expect(lastDay).toHaveAttribute("aria-pressed", "true");

  // when
  await navigation.getByTestId("mobile-current-time").click();

  // then
  const restoredDay = navigation.getByTestId(currentDayId!);
  await expect(restoredDay).toHaveAttribute("aria-pressed", "true");
  await expect(restoredDay).toBeInViewport();

  // when — returning from another week replaces the strip before today's card exists again
  await navigation.getByTestId("mobile-week-next").click();
  await expect(navigation.getByTestId(currentDayId!)).toHaveCount(0);
  const otherWeekLastDay = navigation.locator('[data-testid^="day-selector-"]').last();
  await otherWeekLastDay.click();
  await navigation.getByTestId("mobile-current-time").click();

  // then — the freshly loaded card is selected and scrolled back into the horizontal viewport
  const restoredFromOtherWeek = navigation.getByTestId(currentDayId!);
  await expect(restoredFromOtherWeek).toHaveAttribute("aria-pressed", "true");
  await expect(restoredFromOtherWeek).toBeInViewport();
});

test("the court plan describes its served cards, remaining room, and elapsed rows", async ({ page }) => {
  // given — a club-defined card must reach the plan without a frontend release
  await page.route("**/api/public/booking-card-legend", async (route) => route.fulfill({ json: [{
    id: "90000000-0000-0000-0000-000000000099",
    label: "Club championship",
    color: "#176b55",
    showGenericOccupancy: false
  }] }));
  await signIn(page, "doe.jane");

  // then
  const legend = page.getByTestId("court-plan-legend");
  await expect(legend).toContainText("Club championship");
  await expect(page.getByTestId("legend-card-90000000-0000-0000-0000-000000000099"))
    .toHaveCSS("background-color", "rgb(23, 107, 85)");
  const selectedDate = await page.locator('[data-testid^="day-selector-"][aria-pressed="true"]')
    .getAttribute("data-testid");
  const freeCount = page.getByTestId(`day-free-count-${selectedDate!.replace("day-selector-", "")}`);
  expect(Number(await freeCount.getAttribute("data-free-count"))).toBeGreaterThan(0);
  await expect(page.getByTestId("slot-row-08:00")).toHaveAttribute("data-state", "past");
  await expect(page.getByTestId("slot-row-12:00")).toHaveAttribute("data-state", "remaining");
});

test("the phone plan shows every court's availability at once", async ({ page, journeyService }) => {
  // given
  await page.route("**/api/public/courts", async (route) => route.fulfill({
    json: Array.from({ length: 8 }, (_, index) => ({
      id: index < 4
        ? `dddddddd-0000-0000-0000-00000000000${index + 1}`
        : `90000000-0000-0000-0000-00000000000${index + 1}`,
      number: index + 1,
      name: index === 0 ? "Centre Court" : null
    }))
  }));
  await signIn(page, "doe.jane");
  await selectJourneyDate(page, journeyService.visualDate);
  const plan = page.getByTestId("week-grid");
  const headings = page.locator('[data-testid^="court-heading-"]');
  await expect(plan).toBeVisible();

  // then — eight courts cover the density called out by the issue, not just the smaller seed fixture
  await expect(headings).toHaveCount(8);
  await expect(page.getByTestId("court-selector")).toHaveCount(0);
  for (const heading of await headings.all()) await expect(heading).toBeVisible();
  await expect(page.getByTestId("allocation").first()).toBeVisible();
  await expect(page.getByTestId("free-slot").first()).toBeVisible();
  expect(await plan.evaluate((element) => element.scrollWidth)).toBe(await plan.evaluate((element) => element.clientWidth));
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
  const selectedDay = page.locator('[data-testid^="day-selector-"][aria-pressed="true"]');
  const nextDay = selectedDay.locator("xpath=following-sibling::*[starts-with(@data-testid, 'day-selector-')][1]");
  await nextDay.click();

  // then
  await expect.poll(async () => {
    const navigationBounds = await page.getByTestId("mobile-week-navigation").boundingBox();
    const planBounds = await plan.boundingBox();
    return navigationBounds && planBounds ? planBounds.y - (navigationBounds.y + navigationBounds.height) : -1;
  }).toBeGreaterThanOrEqual(-1);
});
