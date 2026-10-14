import { type Page } from "@playwright/test";
import { routePattern } from "./declared-routes";
import { become, concretePath, PERSONAS, personas, routerPages } from "./page-sweep";
import { expect, expectAdministrationOverview, expectShownAsEmpty, routeLongSeries, selectJourneyDate, seriesBookingId, test } from "./fixtures";
import { LEAGUE_MATCH_CARD, MEMBER_BOOKING_CARD } from "./shipped-rows";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= viewportWidth) return [];
    return [...document.querySelectorAll("body, main, [data-testid='admin-shell'], [data-testid='admin-configuration-view'], [data-testid='admin-configuration-view'] form, [data-testid='admin-deadlines-view'], [data-testid='admin-rule-sets-view'], [data-testid='rule-set-overview'], fieldset")]
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

function renderedTextWidth(element: import("@playwright/test").Locator): Promise<number> {
  return element.evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getBoundingClientRect().width;
  });
}

async function expectNoFieldSafariZoomsInto(page: Page) {
  const small = await page.locator("input, select, textarea").evaluateAll((fields) => fields
    .filter((field) => field.checkVisibility() && !["checkbox", "radio", "hidden", "submit", "button"].includes((field as HTMLInputElement).type))
    .filter((field) => parseFloat(getComputedStyle(field).fontSize) < 16)
    .map((field) => `${field.id || field.getAttribute("data-testid")} ${getComputedStyle(field).fontSize}`));
  expect(small, "a touch screen keeps every field at 16 px, or Safari on iOS zooms into it").toEqual([]);
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

async function boundsWithinOverlay(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((element) => {
    const overlay = element.closest("[data-testid='modal-overlay']")!.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, overlayTop: overlay.top, overlayBottom: overlay.bottom };
  });
}

test("the booking dialog keeps its actions on screen while the browser bar covers part of the viewport", async ({ page, journeyService }) => {
  // given
  await signIn(page, "doe.jane");
  await selectJourneyDate(page, journeyService.visualDate);
  await page.locator('[data-testid="free-slot"][data-court-number="2"][data-slot="12:00"]:visible').tap();
  await page.getByTestId("booking-more-summary").tap();

  // when
  // Emulation keeps 100vh equal to the visible height, so the overlay shrinks the way a shown browser bar shrinks it.
  await page.getByTestId("modal-overlay").evaluate((overlay) => { overlay.style.bottom = "110px"; });

  // then
  const dialog = await boundsWithinOverlay(page, "booking-dialog");
  expect(dialog.top, "the dialog starts inside the area the browser still shows").toBeGreaterThanOrEqual(dialog.overlayTop);
  expect(dialog.bottom, "the dialog ends inside the area the browser still shows").toBeLessThanOrEqual(dialog.overlayBottom);
  const submit = await boundsWithinOverlay(page, "booking-submit");
  expect(submit.bottom, "the book button lies fully above the covered part").toBeLessThanOrEqual(submit.overlayBottom);

  // when
  await page.getByTestId("booking-note").scrollIntoViewIfNeeded();

  // then
  const note = await boundsWithinOverlay(page, "booking-note");
  const actions = await boundsWithinOverlay(page, "booking-submit");
  expect(note.bottom, "the note scrolls into view above the actions instead of being cut off").toBeLessThanOrEqual(actions.top);
  expect(actions, "the actions stay in place while the form scrolls").toEqual(submit);
});

test("given the booking dialog on a touch screen, when its fields are drawn, then a select is as tall as a text input and a full touch target", async ({ page, journeyService }) => {
  // given
  await signIn(page, "doe.jane");
  await selectJourneyDate(page, journeyService.visualDate);

  // when
  await page.locator('[data-testid="free-slot"][data-court-number="2"][data-slot="12:00"]:visible').tap();

  // then
  const select = (await page.getByTestId("booking-duration").boundingBox())!;
  const input = (await page.getByTestId("member-search").boundingBox())!;
  expect(Math.round(select.height), "the duration select matches the members field").toBe(Math.round(input.height));
  expect(select.height, "the duration select is a full touch target").toBeGreaterThanOrEqual(44);
});

test("given the dark theme, when a member switches to light, then every control takes the light colours at once", async ({ page, journeyService }) => {
  // given
  await page.addInitScript(() => {
    if (sessionStorage.getItem("theme-seeded")) return;
    sessionStorage.setItem("theme-seeded", "1");
    localStorage.setItem("courtside.theme", "dark");
  });
  await signIn(page, "doe.jane");
  await selectJourneyDate(page, journeyService.visualDate);
  await page.getByTestId("preferences-menu").tap();

  // when
  await page.locator("#theme-preference").selectOption("light");

  // then
  const drawn = await page.evaluate(() => {
    const colours = (element: Element) => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor });
    const fresh = document.createElement("button");
    fresh.className = "button-secondary";
    document.body.append(fresh);
    const reference = colours(fresh);
    fresh.remove();
    return {
      reference, page: getComputedStyle(document.body).color,
      now: colours(document.querySelector('[data-testid="mobile-current-time"]')!),
      header: getComputedStyle(document.querySelector('[data-testid^="court-column-"]')!).color
    };
  });
  expect(drawn.now, "the Now button is restyled like a secondary button drawn in the light theme").toEqual(drawn.reference);
  expect(drawn.header, "the plan header inherits the light text colour").toBe(drawn.page);
  expect(drawn.page, "the page text is the light theme's").toBe(drawn.reference.color);
});

for (const viewport of [undefined, { width: 320, height: 568 }]) {
  test(`given a phone ${viewport ? `${viewport.width} px wide` : "of the project's size"}, when a booking is refused, then the reason and its reference are on screen inside the alert`, async ({ page, journeyService }) => {
    // given
    if (viewport) await page.setViewportSize(viewport);
    await signIn(page, "doe.jane");
    await selectJourneyDate(page, journeyService.visualDate);
    await page.locator('[data-testid="free-slot"][data-court-number="2"][data-slot="12:00"]:visible').tap();
    await page.getByTestId("booking-more-summary").tap();
    await page.route("**/api/bookings", async (route) => route.request().method() === "POST"
      ? route.fulfill({ status: 409, contentType: "application/problem+json", json: {
        type: "urn:courtside:error:court-unavailable", title: "Court unavailable", status: 409,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7"
      } })
      : route.fallback());

    // when
    await page.getByTestId("booking-submit").tap();

    // then
    const refusal = page.getByTestId("booking-dialog").getByRole("alert");
    await expect(refusal).toContainText("4bf92f3577b34da6a3ce929d0e0e4736");
    await expect(refusal, "the reason for the refusal is on screen where the member pressed Book").toBeInViewport({ ratio: 1 });
    const overflow = await refusal.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow, "the reference wraps inside the alert").toBeLessThanOrEqual(0);
    const alertHeight = (await refusal.boundingBox())!.height;
    const dialogHeight = (await page.getByTestId("booking-dialog").boundingBox())!.height;
    expect(alertHeight, "the refusal leaves most of the dialog to the form").toBeLessThanOrEqual(dialogHeight / 4);
    await expect(page.getByTestId("booking-duration"), "the form stays usable beside the refusal").toBeInViewport({ ratio: 1 });

    // when
    await refusal.getByTestId("booking-reference").tap();

    // then
    await expect(refusal.getByTestId("booking-reference-value"), "the reference opens for support").toBeInViewport({ ratio: 1 });
  });
}

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

test("a member holding two upcoming bookings sees both on the phone without scrolling", async ({ page, journeyService }) => {
  // given
  const booking = "70000000-0000-0000-0000-0000000000b1";
  await journeyService.executeSql(`
    INSERT INTO booking (id, card_id, status, booked_by, note)
    VALUES ('${booking}', '11111111-1111-1111-1111-111111111111', 'CONFIRMED', '00000000-0000-0000-0000-000000000102', NULL);
    INSERT INTO booking_participant (id, booking_id, kind, person_id, position)
    VALUES ('71000000-0000-0000-0000-0000000000b1', '${booking}', 'MEMBER', '00000000-0000-0000-0000-000000000101', 0);
    INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status)
    VALUES ('72000000-0000-0000-0000-0000000000b1', '${booking}', 'dddddddd-0000-0000-0000-000000000003',
      (DATE '${journeyService.visualDate}' + 3 + TIME '09:00') AT TIME ZONE 'Europe/Berlin',
      (DATE '${journeyService.visualDate}' + 3 + TIME '10:00') AT TIME ZONE 'Europe/Berlin', 'CONFIRMED');`);
  try {
    await signIn(page, "doe.jane");

    // when
    await page.getByTestId("my-bookings-link").tap();

    // then
    const upcoming = page.getByTestId("upcoming-bookings").locator("li[data-status]");
    await expect(upcoming).toHaveCount(2);
    const bar = await page.getByTestId("primary-navigation-bar").boundingBox();
    expect(bar).not.toBeNull();
    for (const entry of await upcoming.all()) {
      await expect(entry, "each upcoming booking is on screen as the page opens").toBeInViewport({ ratio: 1 });
      const box = await entry.boundingBox();
      expect(box!.y + box!.height, "and not hidden behind the navigation bar").toBeLessThanOrEqual(bar!.y);
    }
  } finally {
    await journeyService.executeSql(`DELETE FROM booking WHERE id = '${booking}';`);
  }
});

test("a member reads a notification and marks it read on the phone", async ({ page, journeyService }) => {
  // given
  const notification = "7c000000-0000-0000-0000-0000000000c1";
  await journeyService.executeSql(`
    INSERT INTO notification (id, account_id, kind, parameters, created_at)
    VALUES ('${notification}', '00000000-0000-0000-0000-000000000102', 'BOOKING_REMINDER', '{}', now());`);
  try {
    await signIn(page, "doe.jane");

    // when
    await page.getByTestId("my-messages-link").tap();

    // then
    const entry = page.getByTestId(`notification-${notification}`);
    await expect(entry).toHaveAttribute("data-read", "false");
    await expectNoHorizontalOverflow(page);
    for (const target of [entry.getByRole("link"), entry.getByTestId("notification-mark-read")]) {
      const box = await target.boundingBox();
      expect(box!.height, "each action on an entry is a target a thumb can hit").toBeGreaterThanOrEqual(44);
    }

    // when
    await entry.getByTestId("notification-mark-read").tap();

    // then
    await expect(entry).toHaveAttribute("data-read", "true");
    await expectNoHorizontalOverflow(page);
  } finally {
    await journeyService.executeSql(`DELETE FROM notification WHERE id = '${notification}';`);
  }
});

test("given a refused message on a phone, when the board reads the message log, then every field of the entry is on a card inside the screen", async ({ page, journeyService }) => {
  // given
  const record = "7c000000-0000-0000-0000-0000000000d1";
  await journeyService.executeSql(`
    INSERT INTO message_record (id, account_id, kind, state, message_id, reason, status_code, queued_at, settled_at)
    VALUES ('${record}', '00000000-0000-0000-0000-000000000102', 'CREDENTIALS_NEW_ACCOUNT', 'REFUSED',
      '<0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.1759349460000@relay.example.org>', 'SendFailedException', '550',
      now(), now());`);
  try {
    await signIn(page, "configuration-admin");
    await expect(page.getByTestId("administration-link"), "the board is signed in").toBeVisible({ timeout: 10_000 });

    // when
    await page.goto("/admin/messages");

    // then
    const entry = page.locator(`[data-testid="message-row"][data-entry-id="${record}"]`);
    await expect(entry, "the seeded message is listed").toBeVisible({ timeout: 10_000 });
    await expect.poll(() => entry.evaluate((element) => getComputedStyle(element).display),
      { message: "a message is a card on a phone", timeout: 10_000 }).toBe("grid");
    await expect(entry.getByRole("cell"), "the card keeps every column").toHaveCount(6, { timeout: 10_000 });
    for (const testId of ["message-queued-at", "message-person-link", "message-kind", "message-state", "message-outcome", "message-id"]) {
      const field = entry.getByTestId(testId);
      await expect(field, `${testId} is shown`).toBeVisible({ timeout: 10_000 });
      await expect.poll(() => field.evaluate((element) => element.getBoundingClientRect().right <= document.documentElement.clientWidth),
        { message: `${testId} ends inside the screen`, timeout: 10_000 }).toBe(true);
    }
    const queuedAt = entry.getByTestId("message-queued-at");
    const words = (await queuedAt.textContent())!.trim().split(/\s+/).length;
    await expect.poll(() => queuedAt.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size;
    }), { message: "the date is not broken after every word", timeout: 10_000 }).toBeLessThan(words);
    await expect.poll(() => entry.evaluate((element) => element.scrollWidth <= element.clientWidth),
      { message: "nothing on the card runs past its edge", timeout: 10_000 }).toBe(true);
    await expectNoHorizontalOverflow(page);
  } finally {
    await journeyService.executeSql(`DELETE FROM message_record WHERE id = '${record}';`);
  }
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
  await expect(page.locator("#theme-preference")).toBeVisible();
  await expectNoFieldSafariZoomsInto(page);
  await page.getByTestId("logout").tap();
  await signIn(page, "configuration-admin");
  await page.getByTestId("administration-link").tap();

  // then — the destinations are folded behind one control at this width, and the control says
  // which one is open rather than leaving that to a marker nobody can see while it is folded
  await expect.poll(() => page.evaluate(() => window.scrollY), { message: "a new page opens at its top" }).toBe(0);
  await expect(page.getByTestId("admin-menu")).toBeVisible();
  await expect(page.getByTestId("admin-courts-link")).not.toBeVisible();
  await expectAdministrationOverview(page);
  await expectNoHorizontalOverflow(page);

  // when
  const pageTop = async () => (await page.getByTestId("admin-overview-view").boundingBox())!.y
    + await page.evaluate(() => window.scrollY);
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
  await expect(page.getByTestId("logo-url")).toBeEnabled();
  await expectNoHorizontalOverflow(page);

  // when — the footer carries its legal links only once a club has set them, so without this the
  // overflow guard never sees the row it exists to protect
  await page.getByTestId("imprint-url").fill("/imprint");
  await page.getByTestId("privacy-url").fill("/privacy");

  // then
  await expect(page.getByTestId("save-bar")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.getByTestId("save-club-config").tap();

  // then
  await expect(page.getByTestId("footer-imprint")).toBeVisible();
  await expect(page.getByTestId("footer-privacy")).toBeVisible();
  await expect(page.getByTestId("footer-documentation")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  // when
  await page.getByTestId("admin-menu").tap();
  await page.getByTestId("admin-deadlines-link").tap();

  // then
  await expect(page.getByTestId("booking-reminder-hours")).toBeEnabled();
  await expectNoHorizontalOverflow(page);

  // when
  await page.getByTestId("admin-menu").tap();
  await page.getByTestId("admin-rule-sets-link").tap();

  // then
  await expect(page.getByTestId("rule-set-name")).toBeVisible();
  const ruleSetRow = page.getByTestId("rule-set-overview").locator("tbody tr").first();
  expect(await ruleSetRow.evaluate((element) => getComputedStyle(element).display), "a rule set is a card on a phone").toBe("grid");
  await expectNoHorizontalOverflow(page);
  await expect(page.getByTestId("rule-BOOKING_HOURS-earliestStart")).toBeVisible();
  await expectNoFieldSafariZoomsInto(page);

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
  await expect(navigation.getByTestId("mobile-current-time"), "the return to now needs no swipe")
    .toBeInViewport({ ratio: 1 });
  await expect(navigation.getByTestId("mobile-week-next")).toBeVisible();
  const dayList = navigation.getByTestId("mobile-week-days");
  expect(await dayList.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
    await dayList.evaluate((element) => element.clientWidth)
  );
  const dayWidth = await navigation.locator('[data-testid^="day-selector-"]').first()
    .evaluate((day) => day.getBoundingClientRect().width);
  expect(await dayList.evaluate((element) => element.clientWidth), "the return to now leaves room for two days")
    .toBeGreaterThanOrEqual(2 * dayWidth);
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
  await expect(navigation.getByTestId("mobile-current-time"), "the return to now stays put while the days scroll")
    .toBeInViewport({ ratio: 1 });

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

test("given elapsed rows on a phone, when the plan loads, then every row names its time beside one column per court", async ({ page }) => {
  // given
  await page.setViewportSize({ width: 390, height: 844 });

  // when
  await signIn(page, "doe.jane");
  await expect(page.getByTestId("slot-row-08:00")).toHaveAttribute("data-state", "past");

  // then
  for (const heading of await page.locator('[data-testid^="slot-heading-"]').all()) {
    expect(await renderedTextWidth(heading), `${await heading.getAttribute("data-testid")} shows its time`)
      .toBeGreaterThan(0);
  }
  const rowDecorations = await page.locator('[data-testid^="slot-row-"]').evaluateAll((rows) => rows
    .map((row) => [getComputedStyle(row, "::before").content, getComputedStyle(row, "::after").content])
    .filter((contents) => contents.some((content) => content !== "none")));
  expect(rowDecorations, "a row renders no box of its own beside its cells").toEqual([]);
  const edges = await page.getByTestId("day-plan-table").evaluate((table) => ({
    table: table.getBoundingClientRect().right,
    lastCourt: [...table.querySelectorAll('[data-testid^="court-heading-"]')].at(-1)!.getBoundingClientRect().right
  }));
  expect(edges.lastCourt, "the last court's column ends where the table ends").toBeCloseTo(edges.table, 0);
  const elapsedSlot = page.locator('[data-testid="free-slot"][data-state="past"]').first();
  expect(await elapsedSlot.evaluate((slot) => getComputedStyle(slot, "::after").content),
    "an elapsed slot is marked by its hatching, not by a dash").toBe("none");
});

test("given bookings on a phone, when the plan scrolls past the navigation, then the courts stay named and bookings keep their label", async ({ page, journeyService }) => {
  // given
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "doe.jane");
  await selectJourneyDate(page, journeyService.visualDate);
  const allocation = page.getByTestId("allocation").first();
  await expect(allocation).toBeVisible();

  // then
  expect(await renderedTextWidth(allocation.locator("span").first()), "a booking names what occupies the court")
    .toBeGreaterThan(0);

  // when
  await page.locator('[data-testid^="slot-row-"]').last().scrollIntoViewIfNeeded();

  // then
  const heading = page.getByTestId("court-heading-1");
  await expect.poll(() => heading.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
  }), "the court heading stays uncovered while the plan scrolls").toBe(true);
});

function lastRowOfBookingIsOccupied(page: Page, bookingId: string, slot: string): Promise<boolean> {
  return page.evaluate(({ bookingId, slot }) => {
    const row = document.querySelector(`[data-testid="slot-row-${slot}"]`)!;
    row.scrollIntoView({ block: "center" });
    const column = document.querySelector(`[data-booking-id="${bookingId}"]`)!.closest("td")!.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    const hit = document.elementFromPoint(column.left + column.width / 2, bounds.top + bounds.height / 2);
    if (hit?.getAttribute("data-testid") !== "allocation-extent") return false;
    const transparent = (color: string) => /^rgba\(.*,\s*0\)$/.test(color);
    let behind = hit.parentElement;
    while (behind && transparent(getComputedStyle(behind).backgroundColor)) behind = behind.parentElement;
    const backdrop = behind ? getComputedStyle(behind).backgroundColor : "rgb(255, 255, 255)";
    const extent = getComputedStyle(hit);
    const filled = !transparent(extent.backgroundColor) && extent.backgroundColor !== backdrop;
    const outlined = parseFloat(extent.borderTopWidth) > 0 && extent.borderTopColor !== backdrop;
    return filled || outlined;
  }, { bookingId, slot });
}

test("given an own booking beside a league match and a squad training on four courts, when a phone shows the plan, then each booking shows its marker and a short label that fits and the match fills its rows", async ({ page, journeyService }) => {
  // given
  const own = "70000000-0000-0000-0000-0000000000c1";
  const match = "70000000-0000-0000-0000-0000000000c2";
  const squad = "70000000-0000-0000-0000-0000000000c3";
  const squadCard = "60000000-0000-0000-0000-0000000000c3";
  const at = (time: string) => `(DATE '${journeyService.visualDate}' + TIME '${time}') AT TIME ZONE 'Europe/Berlin'`;
  await journeyService.executeSql(`
    INSERT INTO booking_card (id, label, color, counts_against_limits, guest_allowed)
    VALUES ('${squadCard}', 'Training Men Masters', '#34584A', false, false);
    INSERT INTO booking (id, card_id, status, booked_by, note) VALUES
      ('${own}', '${MEMBER_BOOKING_CARD}', 'CONFIRMED', '00000000-0000-0000-0000-000000000102', NULL),
      ('${match}', '${LEAGUE_MATCH_CARD}', 'CONFIRMED', (SELECT id FROM user_account WHERE username = 'bootstrap-admin'), NULL),
      ('${squad}', '${squadCard}', 'CONFIRMED', (SELECT id FROM user_account WHERE username = 'bootstrap-admin'), NULL);
    INSERT INTO booking_participant (id, booking_id, kind, person_id, position) VALUES
      ('71000000-0000-0000-0000-0000000000c1', '${own}', 'MEMBER', '00000000-0000-0000-0000-000000000101', 0),
      ('71000000-0000-0000-0000-0000000000c2', '${own}', 'MEMBER', '00000000-0000-0000-0000-000000000103', 1);
    INSERT INTO court_allocation (id, booking_id, court_id, starts_at, ends_at, status) VALUES
      ('72000000-0000-0000-0000-0000000000c1', '${own}', 'dddddddd-0000-0000-0000-000000000002', ${at("14:00")}, ${at("15:00")}, 'CONFIRMED'),
      ('72000000-0000-0000-0000-0000000000c2', '${match}', 'dddddddd-0000-0000-0000-000000000003', ${at("14:00")}, ${at("16:00")}, 'CONFIRMED'),
      ('72000000-0000-0000-0000-0000000000c3', '${squad}', 'dddddddd-0000-0000-0000-000000000004', ${at("14:00")}, ${at("15:00")}, 'CONFIRMED');`);
  try {
    await signIn(page, "doe.jane");
    await expect(page.getByTestId("my-bookings-link")).toBeVisible({ timeout: 10_000 });
    await selectJourneyDate(page, journeyService.visualDate);
    const ownBooking = page.locator(`[data-testid="own-allocation"][data-booking-id="${own}"]`);
    const leagueMatch = page.locator(`[data-testid="allocation"][data-booking-id="${match}"]`);
    const squadTraining = page.locator(`[data-testid="allocation"][data-booking-id="${squad}"]`);
    const escaped = (text: string | null) => (text ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(page.locator('[data-testid^="court-column-"]')).toHaveCount(4, { timeout: 10_000 });

    for (const width of [375, 320]) {
      // when
      await page.setViewportSize({ width, height: 800 });

      // then
      await expect(ownBooking.getByTestId("own-marker"), `at ${width} px the own booking carries its marker`)
        .toBeVisible({ timeout: 10_000 });
      await expect(leagueMatch.getByTestId("own-marker"), "the league match carries no own marker").toHaveCount(0, { timeout: 10_000 });
      for (const allocation of [ownBooking, leagueMatch, squadTraining]) {
        const shortLabel = allocation.getByTestId("allocation-short-label");
        await expect(shortLabel, `at ${width} px a booking names itself in a short label`).toBeVisible({ timeout: 10_000 });
        await expect(allocation.getByTestId("allocation-label")).toBeHidden({ timeout: 10_000 });
        await expect(allocation.getByTestId("allocation-period"), `at ${width} px the time gives way to the label`).toBeHidden({ timeout: 10_000 });
        await expect.poll(() => shortLabel.evaluate((label) => label.scrollWidth <= label.clientWidth), {
          message: `at ${width} px the short label fits its column without being cut`, timeout: 10_000
        }).toBe(true);
        const fullLabel = escaped(await allocation.getByTestId("allocation-label").textContent());
        await expect(allocation, "the accessible name keeps the full label").toHaveAccessibleName(new RegExp(`(^| )${fullLabel}( \\(.+\\))?, `), { timeout: 10_000 });
        await expect(allocation, "the accessible name contains the visible short label")
          .toHaveAccessibleName(new RegExp(escaped(await shortLabel.textContent()), "i"), { timeout: 10_000 });
      }
      await expect(page.getByTestId(`legend-card-${LEAGUE_MATCH_CARD}`), "the legend decodes the short label of the match")
        .toHaveText(await leagueMatch.getByTestId("allocation-short-label").textContent() ?? "", { timeout: 10_000 });
      await expect(squadTraining.getByTestId("allocation-short-label"), "a long shared first word gives way to the word starts")
        .toHaveText("TrMM", { timeout: 10_000 });
      await expect.poll(() => lastRowOfBookingIsOccupied(page, match, "15:30"), {
        message: `at ${width} px the last row of the match is drawn occupied, not left blank`, timeout: 10_000
      }).toBe(true);
    }

    // when
    await page.emulateMedia({ forcedColors: "active" });

    // then
    await expect.poll(() => lastRowOfBookingIsOccupied(page, match, "15:30"), {
      message: "in forced colours the last row of the match is still drawn occupied", timeout: 10_000
    }).toBe(true);
    await page.emulateMedia({ forcedColors: "none" });

    // when
    await page.setViewportSize({ width: 1280, height: 900 });

    // then
    for (const allocation of [ownBooking, leagueMatch, squadTraining]) {
      await expect(allocation.getByTestId("allocation-label"), "a wide column keeps the full label").toBeVisible({ timeout: 10_000 });
      await expect(allocation.getByTestId("allocation-short-label")).toBeHidden({ timeout: 10_000 });
    }
    await expect.poll(() => lastRowOfBookingIsOccupied(page, match, "15:30"), {
      message: "on a wide screen the last row of the match is drawn occupied", timeout: 10_000
    }).toBe(true);
  } finally {
    await journeyService.executeSql(`
      DELETE FROM booking WHERE id IN ('${own}', '${match}', '${squad}');
      DELETE FROM booking_card WHERE id = '${squadCard}';`);
  }
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

test("a booking on a day the club has since closed stays in the phone plan", async ({ page }) => {
  // given
  const week = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
  await page.route("**/api/public/booking-grid", async (route) => route.fulfill({ json: {
    timeZone: "Europe/Berlin",
    slotMinutes: 30,
    openingWeeks: [],
    openingHours: week.map((dayOfWeek) => ({ dayOfWeek, opensAt: null, closesAt: null }))
  } }));
  await page.route("**/api/bookings?*", async (route) => {
    const date = new URL(route.request().url()).searchParams.get("date");
    await route.fulfill({ json: [{
      bookingId: "33333333-3333-3333-3333-333333333333",
      courtId: "dddddddd-0000-0000-0000-000000000001",
      startsAt: `${date}T18:00:00+02:00`,
      endsAt: `${date}T19:00:00+02:00`,
      cardLabel: "Member booking",
      cardColor: "#176b55",
      ownBooking: false,
      showGenericOccupancy: true,
      participantCount: 2
    }] });
  });

  // when
  await signIn(page, "doe.jane");

  // then
  await expect(page.getByTestId("day-closed-notice")).toBeVisible();
  await expect(page.getByTestId("allocation")).toBeVisible();
  await expect(page.locator('[data-testid^="slot-row-"][data-state="outside"]').first()).toBeVisible();
  await expect(page.getByTestId("outside-slot").first()).toBeVisible();
  await expect(page.getByTestId("free-slot"), "a closed day offers nothing to book").toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

async function expectInsideViewport(locator: import("@playwright/test").Locator, name: string) {
  const width = await locator.page().evaluate(() => document.documentElement.clientWidth);
  const box = await locator.boundingBox();
  expect(box, `${name} is rendered`).not.toBeNull();
  expect([box!.x >= 0, box!.x + box!.width <= width], `${name} lies inside the ${width} px viewport`).toEqual([true, true]);
}

for (const width of [820, 1024]) {
  test(`given a ${width} px wide window in English, when the new booking card form is read, then no role label or colour field overlaps another`, async ({ page }) => {
    // given
    await page.setViewportSize({ width, height: 1180 });
    await signIn(page, "configuration-admin");
    await expect(page.getByTestId("administration-link")).toBeVisible();
    await page.evaluate(() => window.localStorage.setItem("courtside.locale", "en-GB"));

    // when
    await page.goto("/admin/facility/booking-cards");
    await expect(page.getByTestId("new-card-role-GROUNDSKEEPER")).toBeVisible();
    await expect(page.locator("html"), "English carries the longest role names").toHaveAttribute("lang", "en");
    await page.evaluate(() => document.fonts.ready);

    // then
    const crowded = await page.getByTestId("create-card").evaluate((button) => {
      const labels = [...(button as HTMLButtonElement).form!.querySelectorAll("input[type=checkbox]")].map((box) => box.closest("label")!);
      const findings: string[] = [];
      for (const label of labels) {
        const range = document.createRange();
        range.selectNodeContents(label);
        if (range.getBoundingClientRect().right > label.getBoundingClientRect().right + 0.5) findings.push(`${label.textContent} runs past its own box`);
      }
      for (const [index, label] of labels.entries()) {
        const box = label.getBoundingClientRect();
        for (const other of labels.slice(index + 1)) {
          const next = other.getBoundingClientRect();
          if (box.left < next.right && next.left < box.right && box.top < next.bottom && next.top < box.bottom) findings.push(`${label.textContent} overlaps ${other.textContent}`);
        }
      }
      return findings;
    });
    expect(crowded, "every checkbox label beside its own box").toEqual([]);
    const hex = await page.getByTestId("new-card-color-value").boundingBox();
    const picker = await page.getByTestId("new-card-color").boundingBox();
    expect(hex!.x + hex!.width, "the hex field ends before the colour picker").toBeLessThanOrEqual(picker!.x);
  });
}

for (const width of [820, 1024]) {
  test(`given a ${width} px wide window, when the new court form is read, then the number field ends before the name field`, async ({ page }) => {
    // given
    await page.setViewportSize({ width, height: 1180 });
    await signIn(page, "configuration-admin");
    await expect(page.getByTestId("administration-link")).toBeVisible();

    // when
    await page.goto("/admin/facility/courts");
    await expect(page.getByTestId("new-court-number")).toBeVisible();

    // then
    const number = await page.getByTestId("new-court-number").boundingBox();
    const name = await page.getByTestId("new-court-name").boundingBox();
    expect(number!.y, "the two fields share a row at this width").toBeCloseTo(name!.y, 0);
    expect(number!.x + number!.width, "the number input stays inside its column").toBeLessThanOrEqual(name!.x);
  });
}

test("courts and slot fillers show each entry's name, status and actions on a phone", async ({ page }) => {
  // given
  await signIn(page, "configuration-admin");
  await expect(page.getByTestId("administration-link")).toBeVisible();

  // when
  await page.goto("/admin/facility/courts");

  // then
  const court = page.locator('[data-testid^="court-row-"]').first();
  await expect(court).toBeVisible();
  const courtId = (await court.getAttribute("data-testid"))!.replace("court-row-", "");
  expect(await court.evaluate((element) => getComputedStyle(element).display), "a court is a card on a phone").toBe("grid");
  await expect(court.getByTestId("court-label-name")).toBeVisible();
  await expect(page.getByRole("table").getByRole("columnheader"), "the card keeps its column headers for a screen reader").toHaveCount(4);
  await expect(court.getByRole("cell")).toHaveCount(4);
  await expectInsideViewport(page.getByTestId(`edit-court-number-${courtId}`), "the court number");
  await expectInsideViewport(page.getByTestId(`edit-court-name-${courtId}`), "the court name");
  await expectInsideViewport(page.getByTestId(`court-status-${courtId}`), "the court status");
  await expectInsideViewport(page.getByTestId(`toggle-court-${courtId}`), "the court's deactivate action");
  await expectInsideViewport(page.getByTestId(`court-impact-${courtId}`), "the court's impact question");
  await expectNoHorizontalOverflow(page);

  // when
  await page.goto("/admin/facility/slot-fillers");

  // then
  const row = page.locator('[data-testid^="participant-card-row-"]').first();
  await expect(row).toBeVisible();
  const filler = (await row.getAttribute("data-testid"))!.replace("participant-card-row-", "");
  expect(await row.evaluate((element) => getComputedStyle(element).display), "a slot filler is a card on a phone").toBe("grid");
  await expect(row.getByTestId("participant-card-label-owned")).toBeVisible();
  await expect(page.getByRole("table").getByRole("columnheader"), "the card keeps its column headers for a screen reader").toHaveCount(3);
  await expect(row.getByRole("cell")).toHaveCount(3);
  await expectInsideViewport(page.getByTestId(`edit-participant-card-label-${filler}`), "the slot filler's label");
  await expectInsideViewport(page.getByTestId(`edit-participant-card-capacity-${filler}`), "the slot filler's count");
  await expectInsideViewport(page.getByTestId(`participant-card-status-${filler}`), "the slot filler's status");
  await expectInsideViewport(page.getByTestId(`toggle-participant-card-${filler}`), "the slot filler's deactivate action");
  await expectNoHorizontalOverflow(page);
});

async function phoneLegibility(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const describe = (element: Element) => {
      const testId = element.getAttribute("data-testid");
      const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `<${element.tagName.toLowerCase()}${testId ? ` data-testid="${testId}"` : ""}> "${text}"`;
    };
    // A clipping ancestor such as sr-only hides a control, a scrolling one only moves it.
    const clippedAway = (element: Element) => {
      let { left, right, top, bottom } = element.getBoundingClientRect();
      for (let current = element.parentElement; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (!/hidden|clip/.test(style.overflowX + style.overflowY)) continue;
        const clip = current.getBoundingClientRect();
        [left, right, top, bottom] = [Math.max(left, clip.left), Math.min(right, clip.right), Math.max(top, clip.top), Math.min(bottom, clip.bottom)];
      }
      return right - left <= 1 || bottom - top <= 1;
    };
    const shown = (element: Element) => element.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      && element.getClientRects().length > 0 && !clippedAway(element);
    const carousel = (element: Element) => {
      for (let current = element.parentElement; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (/auto|scroll/.test(style.overflowX) && style.scrollSnapType !== "none") return current;
      }
      return undefined;
    };
    const inside = (bounds: DOMRect) => bounds.left >= -0.5 && bounds.right <= width + 0.5;
    const findings: string[] = [];
    for (const element of document.body.querySelectorAll("*")) {
      const ownText = [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "");
      if (!ownText || !shown(element) || element.closest(".day-plan-slot")) continue;
      const size = parseFloat(getComputedStyle(element).fontSize);
      if (size < 10) findings.push(`${describe(element)} renders its text at ${size}px`);
    }
    const carousels = new Map<Element, DOMRect[]>();
    for (const control of document.body.querySelectorAll("a[href], button, input:not([type='hidden']), select, textarea, summary")) {
      const bounds = control.getBoundingClientRect();
      if (!shown(control) || bounds.width <= 1 || bounds.height <= 1) continue;
      const scroller = carousel(control);
      if (scroller) {
        carousels.set(scroller, [...carousels.get(scroller) ?? [], bounds]);
      } else if (!inside(bounds)) {
        findings.push(`${describe(control)} spans ${Math.round(bounds.left)}..${Math.round(bounds.right)} of a ${width}px viewport`);
      }
    }
    for (const [scroller, controls] of carousels) {
      if (!inside(scroller.getBoundingClientRect()) || !controls.some(inside)) {
        findings.push(`${describe(scroller)} scrolls sideways without a control fully in view`);
      }
    }
    return findings;
  });
}

test("given the narrowest supported phone, when a member opens each of their pages, then none scrolls sideways", async ({ page }) => {
  // given
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/login");
  await page.evaluate(() => window.localStorage.setItem("courtside.locale", "de-DE"));
  await become(page, "doe.jane");
  const paths = routerPages().filter((route) => !route.redirect && !/[:*]/.test(route.path)
    && personas(route.path).includes("doe.jane")).map((route) => route.path);
  const overflowing: string[] = [];

  // when
  for (const path of paths) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("html"), "German carries the longest single words").toHaveAttribute("lang", "de");
    const excess = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (excess > 0) overflowing.push(`${new URL(page.url()).pathname} by ${excess}px`);
  }

  // then
  expect(paths.length, "the sweep reached member pages").toBeGreaterThan(3);
  expect(overflowing, "a member page wider than a 320 px screen").toEqual([]);
});

test("given a German word longer than a 320 px line, when a heading wraps it, then it breaks at a syllable with a hyphen", async ({ page }) => {
  // given
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/login");
  await page.evaluate(() => window.localStorage.setItem("courtside.locale", "de-DE"));
  await become(page, "doe.jane");

  // when
  await page.goto("/my-messages");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("Benachrichtigungen", { timeout: 10_000 });
  const secondLineStart = await heading.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.firstChild!);
    const lines = [...range.getClientRects()];
    const last = lines[lines.length - 1];
    const x = last.left + 2;
    const y = last.top + last.height / 2;
    const caret = document.caretPositionFromPoint?.(x, y);
    return { lines: new Set(lines.map((line) => Math.round(line.top))).size, offset: caret ? caret.offset : document.caretRangeFromPoint(x, y)!.startOffset };
  });
  await page.evaluate(() => document.fonts.ready);
  const drawn = await heading.screenshot();
  const hyphenateWith = (character: string) => heading.evaluate((element, value) => {
    element.style.setProperty("hyphenate-character", value);
    element.style.setProperty("-webkit-hyphenate-character", value);
  }, character);
  await hyphenateWith('"+"');
  const redrawn = await heading.screenshot();
  await hyphenateWith("");
  const restored = await heading.screenshot();

  // then
  await expect(page.locator("html"), "the browser hyphenates by the document language").toHaveAttribute("lang", "de");
  expect(secondLineStart.lines, "the word does not fit one 320 px line").toBe(2);
  expect([2, 6, 10, 12, 15], "the word breaks at a syllable of Be-nach-rich-ti-gun-gen, not at an arbitrary letter")
    .toContain(secondLineStart.offset);
  expect(drawn.equals(restored), "the heading draws the same twice, so a difference below is the hyphen").toBe(true);
  expect(drawn.equals(redrawn), "the first line ends with a hyphen the browser drew").toBe(false);
});

test("every page keeps its text legible and its controls on screen at phone width", async ({ page }) => {
  // given
  const pages = routerPages();
  const visits = PERSONAS
    .map((persona) => ({ persona, paths: pages.filter((route) => personas(route.path).includes(persona)).map((route) => route.path) }));
  const landed = new Set<string>();
  const findings: string[] = [];
  const unresolved: string[] = [];

  // when
  for (const { persona, paths } of visits) {
    await become(page, persona);
    for (const path of paths) {
      const concrete = await concretePath(page, path);
      if (concrete === undefined) {
        unresolved.push(`${path} as ${persona}`);
        continue;
      }
      await page.goto(concrete);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      const at = new URL(page.url()).pathname;
      landed.add(at);
      findings.push(...(await phoneLegibility(page)).map((finding) => `${at} as ${persona}: ${finding}`));
    }
  }

  // then
  const missed = pages.filter((route) => !route.redirect && ![...landed].some((path) => routePattern(route.path).test(path)));
  expect.soft(unresolved, "a parameter route whose list page links to no instance").toEqual([]);
  expect.soft(missed.map((route) => route.path), "a page the guard never reached").toEqual([]);
  expect([...new Set(findings)], "text below 10px or a control beyond the phone's edge").toEqual([]);
});

test("given today's plan on a phone, when its grid first appears, then the page already stands where it stays", async ({ page }) => {
  // given
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (!document.querySelector('[data-testid="week-grid"]')) return;
      (window as unknown as { gridShownAt?: number }).gridShownAt = window.scrollY;
      observer.disconnect();
    }).observe(document, { childList: true, subtree: true });
  });

  // when
  await signIn(page, "doe.jane");
  await expect(page.getByTestId("week-grid")).toBeVisible();
  const settled = await page.evaluate(() => new Promise<number>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => resolve(window.scrollY), 300)))));

  // then
  const shownAt = await page.evaluate(() => (window as unknown as { gridShownAt?: number }).gridShownAt);
  expect(settled, "the plan scrolls the page to the current time").toBeGreaterThan(0);
  expect(shownAt, "a page that moves after the grid appears moves it under a tap already on its way").toBe(settled);
});

async function selectedDayPlacement(page: Page) {
  return page.getByTestId("mobile-week-navigation").evaluate((navigation) => {
    const box = (testId: string) => navigation.querySelector(`[data-testid${testId}]`)!.getBoundingClientRect();
    const strip = box('="mobile-week-days"');
    const now = box('="mobile-current-time"');
    const day = box('^="day-selector-"][aria-pressed="true"');
    return {
      insideStrip: day.left >= strip.left - 0.5 && day.right <= strip.right + 0.5,
      clearOfNow: day.right <= now.left || day.left >= now.right,
      edges: `day ${day.left}..${day.right}, strip ${strip.left}..${strip.right}, now ${now.left}..${now.right}`
    };
  });
}

for (const phone of [{ name: "iPhone SE", width: 375, height: 667 }, { name: "landscape iPhone", width: 852, height: 393 }]) {
  test(`given a ${phone.name}, when the court plan opens and a later day is chosen, then the selected day lies whole inside the day strip and clear of the return to now`, async ({ page }) => {
    // given
    await page.setViewportSize({ width: phone.width, height: phone.height });

    // when
    await page.goto("/");
    const navigation = page.getByTestId("mobile-week-navigation");
    await expect(navigation).toBeVisible();

    // then
    await expect.poll(() => selectedDayPlacement(page), { message: "today's card is whole on first render", timeout: 10_000 })
      .toMatchObject({ insideStrip: true, clearOfNow: true });

    // when
    const lastDay = navigation.locator('[data-testid^="day-selector-"]').last();
    // A tap on a card's visible sliver does not scroll the strip first, as click() would.
    await lastDay.dispatchEvent("click");

    // then
    await expect(lastDay).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => selectedDayPlacement(page), { message: "the chosen card is whole after the selection changes", timeout: 10_000 })
      .toMatchObject({ insideStrip: true, clearOfNow: true });
  });
}

test("a closed day on a phone shows its opening times as empty rather than as a ghost time", async ({ page, browserName }) => {
  // given
  await signIn(page, "configuration-admin");
  await expect(page.getByTestId("administration-link"), "the administrator is signed in").toBeVisible();
  await page.goto("/admin/facility/opening-hours");
  await expect(page.getByTestId("admin-opening-hours-view"), "the opening hours open").toBeVisible();

  // when
  await page.getByTestId("hours-closed-SUNDAY").check();

  // then
  for (const testId of ["hours-open-SUNDAY", "hours-close-SUNDAY"]) {
    const field = page.getByTestId(testId);
    await expect(field, `${browserName} locks ${testId} on a closed day`).toBeDisabled();
    await expectShownAsEmpty(field, browserName);
  }
  await expectNoHorizontalOverflow(page);
});

const landscapePhones = [{ width: 852, height: 393 }, { width: 915, height: 412 }];

async function gridBelowPinnedParts(page: Page) {
  return page.evaluate(() => {
    const navigation = document.querySelector('[data-testid="mobile-week-navigation"]')!.getBoundingClientRect();
    const heading = document.querySelector('[data-testid="court-heading-1"]')!.getBoundingClientRect();
    const pinned = Math.max(0, navigation.bottom, heading.bottom);
    const wholeRows = [...document.querySelectorAll('[data-testid^="slot-row-"]')].map((row) => row.getBoundingClientRect())
      .filter((row) => row.top >= pinned - 0.5 && row.bottom <= window.innerHeight + 0.5).length;
    return { pinnedShare: pinned / window.innerHeight, wholeRows };
  });
}

for (const phone of landscapePhones) {
  test(`given a phone in landscape at ${phone.width} x ${phone.height}, when the plan scrolls to the afternoon, then the pinned parts leave most of the height to the grid`, async ({ page, journeyService }) => {
    // given
    await page.setViewportSize(phone);
    await signIn(page, "doe.jane");
    await expect(page.getByTestId("my-bookings-link"), "the member is signed in").toBeVisible({ timeout: 10_000 });
    await selectJourneyDate(page, journeyService.visualDate);
    await expect(page.getByTestId("slot-row-15:00")).toBeVisible({ timeout: 10_000 });

    // then
    // Within a pixel, because scrolling to the start lands on whole device pixels.
    await expect.poll(async () => Math.abs((await page.getByTestId("week-grid").boundingBox())!.y),
      { message: "a later day starts its plan at the top of the screen, with no room kept for a strip that scrolled away", timeout: 10_000 })
      .toBeLessThanOrEqual(1);

    // when
    await page.getByTestId("slot-row-15:00").evaluate((row) => row.scrollIntoView({ block: "center" }));

    // then
    await expect(page.getByTestId("court-heading-1"), "the courts stay named while the grid scrolls").toBeInViewport({ ratio: 1, timeout: 10_000 });
    const grid = await gridBelowPinnedParts(page);
    expect(grid.pinnedShare, "the pinned day strip and column header take at most a fifth of the height").toBeLessThanOrEqual(0.2);
    expect(grid.wholeRows, "at least six whole time rows show below the pinned parts").toBeGreaterThanOrEqual(6);

    // when
    await page.evaluate(() => window.scrollTo(0, 0));

    // then
    await expect(page.getByTestId("mobile-week-navigation"), "the day strip returns at the top of the page").toBeInViewport({ timeout: 10_000 });
  });

  test(`given a phone in landscape at ${phone.width} x ${phone.height}, when the booking dialog opens, then it shows that the form continues and keeps every field reachable`, async ({ page, journeyService }) => {
    // given
    await page.setViewportSize(phone);
    await signIn(page, "doe.jane");
    await expect(page.getByTestId("my-bookings-link"), "the member is signed in").toBeVisible({ timeout: 10_000 });
    await selectJourneyDate(page, journeyService.visualDate);

    // when
    await page.locator('[data-testid="free-slot"][data-court-number="2"][data-slot="12:00"]:visible').tap();

    // then
    const dialog = page.getByTestId("booking-dialog");
    const continues = dialog.getByTestId("dialog-continues");
    await expect(dialog.getByTestId("booking-duration"), "the first field is on screen").toBeInViewport({ ratio: 1, timeout: 10_000 });
    await expect(dialog.getByTestId("booking-submit"), "the book button is on screen").toBeInViewport({ ratio: 1, timeout: 10_000 });
    const overflow = await dialog.getByTestId("booking-duration").evaluate((field) => {
      let body = field.parentElement!;
      while (!/auto|scroll/.test(getComputedStyle(body).overflowY)) body = body.parentElement!;
      return body.scrollHeight - body.clientHeight;
    });
    expect(overflow, "the form is taller than the space the dialog gives it").toBeGreaterThan(0);
    await expect(continues, "the dialog signals that the form continues below").toBeVisible({ timeout: 10_000 });

    // when
    await page.emulateMedia({ forcedColors: "active" });

    // then
    await expect.poll(() => continues.evaluate((signal) => getComputedStyle(signal).backgroundColor),
      { message: "in forced colours the signal keeps a solid backdrop", timeout: 10_000 }).not.toBe("rgba(0, 0, 0, 0)");
    await page.emulateMedia({ forcedColors: "none" });

    // when
    await dialog.getByTestId("booking-duration").focus();
    await dialog.getByTestId("dialog-body").evaluate((body) => {
      const field = body.querySelector('[data-testid="booking-card"]')!.getBoundingClientRect();
      body.scrollTop += field.bottom - body.getBoundingClientRect().bottom + 8;
    });
    for (let step = 0; step < 20 && await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) !== "booking-card"; step += 1) {
      await page.keyboard.press("Tab");
    }

    // then
    await expect(dialog.getByTestId("booking-card"), "the keyboard reaches the kind of booking").toBeFocused({ timeout: 10_000 });
    await expect.poll(async () => {
      const field = await dialog.getByTestId("booking-card").boundingBox();
      const signal = await continues.boundingBox();
      return signal === null || field!.y + field!.height <= signal.y + 0.5;
    }, { message: "the focused field is scrolled clear of the signal", timeout: 10_000 }).toBe(true);

    // when
    await dialog.getByTestId("dialog-body").evaluate((body) => body.scrollTo(0, body.scrollHeight));

    // then
    await expect(dialog.getByTestId("booking-more-summary"), "the last control of the form is reachable").toBeInViewport({ ratio: 1, timeout: 10_000 });
    await expect(continues, "the signal goes once nothing lies below").toBeHidden({ timeout: 10_000 });
    await expect(dialog.getByTestId("booking-submit"), "the book button stays on screen").toBeInViewport({ ratio: 1, timeout: 10_000 });
  });
}

async function bodyOverflow(dialog: import("@playwright/test").Locator) {
  return dialog.getByTestId("dialog-body").evaluate((body) => body.scrollHeight - body.clientHeight);
}

for (const phone of landscapePhones) {
  test(`given a phone in landscape at ${phone.width} x ${phone.height}, when a series move is previewed, then its actions stay on screen`, async ({ page }) => {
    // given
    await page.setViewportSize(phone);
    await signIn(page, "doe.jane");
    await expect(page.getByTestId("my-bookings-link"), "the member is signed in").toBeVisible({ timeout: 10_000 });
    await page.getByTestId("my-bookings-link").click();
    await expect(page.getByTestId("my-bookings-page")).toBeVisible({ timeout: 10_000 });

    // when
    await page.locator(`[data-testid="move-booking"][data-booking-id="${seriesBookingId}"]`).click();
    const dialog = page.getByTestId("move-dialog");
    await dialog.getByTestId("move-duration").fill("90");

    // then
    expect(await bodyOverflow(dialog), "the move form is taller than the space the dialog gives it").toBeGreaterThan(0);
    await expect(dialog.getByTestId("preview-move"), "the preview button is on screen").toBeInViewport({ ratio: 1, timeout: 10_000 });

    // when
    await dialog.getByTestId("preview-move").click();

    // then
    await expect(dialog.getByTestId("move-preview")).toBeAttached({ timeout: 10_000 });
    await expect(dialog.getByTestId("confirm-move"), "the confirm button is on screen").toBeInViewport({ ratio: 1, timeout: 10_000 });
    await dialog.getByTestId("dialog-body").evaluate((body) => body.scrollTo(0, body.scrollHeight));
    await expect(dialog.getByTestId("move-preview"), "the preview is reachable by scrolling the form").toBeInViewport({ timeout: 10_000 });
  });

  test(`given a phone in landscape at ${phone.width} x ${phone.height}, when a long series is to be cancelled whole, then the confirmation stays on screen`, async ({ page, journeyService }) => {
    // given
    await routeLongSeries(page, journeyService.visualDate);
    await page.setViewportSize(phone);
    await signIn(page, "doe.jane");
    await expect(page.getByTestId("my-bookings-link"), "the member is signed in").toBeVisible({ timeout: 10_000 });
    await page.getByTestId("my-bookings-link").click();
    await expect(page.getByTestId("my-bookings-page")).toBeVisible({ timeout: 10_000 });

    // when
    await page.locator(`[data-testid="personal-cancel"][data-booking-id="${seriesBookingId}"]`).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("scope-WHOLE_SERIES").check();

    // then
    await expect(dialog.locator("li"), "every occurrence of the series is listed").toHaveCount(12, { timeout: 10_000 });
    expect(await bodyOverflow(dialog), "the list of occurrences is taller than the space the dialog gives it").toBeGreaterThan(0);
    await expect(dialog.getByTestId("confirm-cancellation"), "the confirmation is on screen").toBeInViewport({ ratio: 1, timeout: 10_000 });
    for (let step = 0; step < 10 && await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) !== "confirm-cancellation"; step += 1) {
      await page.keyboard.press("Tab");
    }
    await expect(dialog.getByTestId("confirm-cancellation"), "the keyboard reaches the confirmation").toBeFocused({ timeout: 10_000 });
    await dialog.getByTestId("dialog-body").evaluate((body) => body.scrollTo(0, body.scrollHeight));
    await expect(dialog.locator("li").last(), "the last occurrence is reachable by scrolling the list").toBeInViewport({ ratio: 1, timeout: 10_000 });
  });
}
