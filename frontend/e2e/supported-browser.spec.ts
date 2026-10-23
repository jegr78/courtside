import { expect, expectShownAsEmpty, selectJourneyDate, selectPreference, test, textFill, transparentText } from "./fixtures";

interface CookieFacts {
  name: string;
  path: string | null;
  sameSite: string | null;
  secure: boolean;
  httpOnly: boolean;
  maxAge: string | null;
  isEmpty: boolean;
}

async function cookieFacts(response: import("@playwright/test").Response): Promise<CookieFacts[]> {
  return (await response.headersArray())
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => {
      const [pair, ...rawAttributes] = header.value.split(";").map((part) => part.trim());
      const separator = pair.indexOf("=");
      const attributes = new Map(rawAttributes.map((attribute) => {
        const attributeSeparator = attribute.indexOf("=");
        return attributeSeparator < 0
          ? [attribute.toLowerCase(), ""]
          : [attribute.slice(0, attributeSeparator).toLowerCase(), attribute.slice(attributeSeparator + 1)];
      }));
      return {
        name: pair.slice(0, separator),
        path: attributes.get("path") ?? null,
        sameSite: attributes.get("samesite") ?? null,
        secure: attributes.has("secure"),
        httpOnly: attributes.has("httponly"),
        maxAge: attributes.get("max-age") ?? null,
        isEmpty: pair.slice(separator + 1).length === 0
      };
    });
}

function expectIssuedCookie(cookie: CookieFacts, name: string, secure: boolean) {
  expect(cookie).toEqual({
    name,
    path: "/",
    sameSite: "Lax",
    secure,
    httpOnly: name.endsWith("SESSION"),
    maxAge: null,
    isEmpty: false
  });
}

async function signIn(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  const secure = new URL(page.url()).protocol === "https:";
  const sessionName = secure ? "__Host-SESSION" : "SESSION";
  const csrfName = secure ? "__Host-XSRF-TOKEN" : "XSRF-TOKEN";
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  const allocationResponses = allocationResponseWaiter(page, 1);
  const sessionResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session") && response.request().method() === "POST");
  const csrfResponse = page.waitForResponse(async (response) =>
    (await cookieFacts(response)).some((cookie) => cookie.name === csrfName && !cookie.isEmpty));
  try {
    await page.getByTestId("login-submit").click();
    const response = await sessionResponse;
    expect(response.status()).toBe(200);
    const sessionCookie = (await cookieFacts(response)).find((cookie) => cookie.name === sessionName);
    expect(sessionCookie).toBeDefined();
    expectIssuedCookie(sessionCookie!, sessionName, secure);
    await allocationResponses.completion;
    const csrfCookie = (await cookieFacts(await csrfResponse))
      .find((cookie) => cookie.name === csrfName && !cookie.isEmpty);
    expect(csrfCookie).toBeDefined();
    expectIssuedCookie(csrfCookie!, csrfName, secure);
    await expect(page.getByTestId("my-bookings-link")).toBeVisible();
    await expect(page.getByTestId("court-plan-legend")).toBeVisible();
  } finally {
    allocationResponses.cancel();
  }
}

function allocationResponseWaiter(page: import("@playwright/test").Page, count: number) {
  let cancel = () => {};
  const completion = new Promise<void>((resolve, reject) => {
    let observed = 0;
    let settled = false;
    const finish = (result: () => void) => {
      if (settled) return;
      settled = true;
      page.off("response", onResponse);
      page.off("close", onClose);
      result();
    };
    const onResponse = (response: import("@playwright/test").Response) => {
      const url = new URL(response.url());
      if (response.request().method() !== "GET" || url.pathname !== "/api/bookings" || !url.searchParams.has("from")) return;
      if (!response.ok()) {
        finish(() => reject(new Error(`Allocation request failed with status ${response.status()}`)));
        return;
      }
      observed += 1;
      if (observed !== count) return;
      finish(resolve);
    };
    const onClose = () => finish(() => reject(new Error("Page closed before allocation requests completed")));
    cancel = () => finish(resolve);
    page.on("response", onResponse);
    page.once("close", onClose);
  });
  void completion.catch(() => {});
  return { completion, cancel };
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
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("logout").click();
  const response = await logoutResponse;
  expect(response.status()).toBe(204);
  const secure = new URL(page.url()).protocol === "https:";
  expect(await cookieFacts(response)).toEqual(expect.arrayContaining([
    { name: secure ? "__Host-SESSION" : "SESSION", path: "/", sameSite: "Lax", secure,
      httpOnly: true, maxAge: "0", isEmpty: true },
    { name: secure ? "__Host-XSRF-TOKEN" : "XSRF-TOKEN", path: "/", sameSite: "Lax", secure,
      httpOnly: false, maxAge: null, isEmpty: true }
  ]));
  await expect(page.getByTestId("my-bookings-page")).not.toBeVisible();
  await expect(page.getByTestId("my-bookings-link")).not.toBeVisible();
  await expect(page.getByTestId("sign-in-link").or(page.getByTestId("login-submit"))).toBeVisible();
});

test("an administrator can open both core administration views", async ({ page }) => {
  // given
  await signIn(page, "configuration-admin");

  // when
  await page.getByTestId("administration-link").click();

  // then
  await expect(page.getByTestId("admin-overview-view")).toBeVisible();

  // when
  await page.getByTestId("admin-configuration-link").click();

  // then
  await expect(page.getByTestId("admin-configuration-view")).toBeVisible();
  await expect(page.getByTestId("logo-url")).toBeEnabled();

  // when
  await page.goto("/admin/facility");

  // then
  await expect(page.getByTestId("admin-courts-view")).toBeVisible();
  await expect(page.getByTestId("create-court")).toBeVisible();
});

test("an empty time filter hides the browser's ghost value until it is focused or filled", async ({ page, browserName }) => {
  // given
  await signIn(page, "configuration-admin");
  await page.goto("/admin/audit");
  const from = page.getByTestId("audit-filter-from");
  const hint = page.getByTestId("audit-filter-from-empty");
  await expect(page.getByTestId("admin-audit-view"), "the change log opens").toBeVisible();

  // then
  await expectShownAsEmpty(from, browserName);

  // when
  await from.focus();

  // then
  await expect.poll(() => textFill(from), { message: `${browserName} reveals the editable fields on focus`, timeout: 10_000 }).not.toBe(transparentText);
  await expect(hint, `${browserName} hides the hint while the field is edited`).toBeHidden({ timeout: 10_000 });

  // when
  await from.fill("2026-10-03T12:30");
  await page.getByTestId("audit-filter-query").focus();

  // then
  await expect(from, `${browserName} no longer marks a filled filter as empty`).not.toHaveAttribute("data-empty", { timeout: 10_000 });
  await expect.poll(() => textFill(from), { message: `${browserName} shows a chosen time`, timeout: 10_000 }).not.toBe(transparentText);
  await expect(hint, `${browserName} drops the hint once a time is chosen`).toHaveCount(0, { timeout: 10_000 });
});

test("a closed day shows its opening times as empty rather than as a ghost time", async ({ page, browserName }) => {
  // given
  await signIn(page, "configuration-admin");
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
});

test("given a notification marked read from the keyboard, when the request runs, fails and succeeds, then the focus never falls to the page", async ({ page, journeyService }) => {
  // given
  const unread = "7c000000-0000-0000-0000-0000000000a3";
  await journeyService.executeSql(`
    INSERT INTO notification (id, account_id, kind, parameters, created_at, read_at) VALUES
      ('${unread}', '00000000-0000-0000-0000-000000000102', 'BOOKING_DISPLACED', '{"closure": "DAY_CLOSED"}', now(), NULL);`);
  try {
    await signIn(page, "doe.jane");
    await page.getByTestId("my-messages-link").click();
    const entry = page.getByTestId(`notification-${unread}`);
    const button = entry.getByTestId("notification-mark-read");
    let answer: (status: number) => void = () => undefined;
    await page.route(`**/api/account/notifications/${unread}/read`, async (route) => {
      const status = await new Promise<number>((resolve) => { answer = resolve; });
      if (status === 0) await route.continue();
      else await route.fulfill({ status, contentType: "application/problem+json",
        body: JSON.stringify({ type: "urn:courtside:error:internal", title: "Internal error", status }) });
    });
    await button.focus();

    // when
    await page.keyboard.press("Enter");

    // then
    await expect(button, "the pressed button keeps the focus while its request runs").toBeFocused({ timeout: 10_000 });
    answer(500);
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 10_000 });
    await expect(button, "a refused request leaves the focus where the member pressed").toBeFocused({ timeout: 10_000 });
    await page.keyboard.press("Enter");
    await expect(button).toBeFocused({ timeout: 10_000 });
    answer(0);
    await expect(entry).toHaveAttribute("data-read", "true", { timeout: 10_000 });
    await expect(entry, "the read entry takes the focus from the button it no longer shows").toBeFocused({ timeout: 10_000 });
  } finally {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await journeyService.executeSql(`DELETE FROM notification WHERE id = '${unread}';`);
  }
});

test("a member's pages load without the administration and without the language nobody chose", async ({ page }) => {
  // given
  await page.addInitScript(() => window.localStorage.setItem("courtside.locale", "de"));
  const scripts: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname);
  });

  // when
  await signIn(page, "doe.jane");
  await page.getByTestId("my-bookings-link").click();
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();

  // then
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  expect(scripts.filter((path) => /\/assets\/(?:AdminRoutes|en)-[^/]+\.js$/.test(path)),
    "a member's first load carries the member surface and the active language only").toEqual([]);
});

test("an administration chunk a newer deployment replaced offers a reload rather than a blank page", async ({ page }) => {
  // given
  await signIn(page, "configuration-admin");
  await page.route(/\/assets\/AdminRoutes-[^/]+\.js$/, (route) => route.fulfill({ status: 404 }));

  // when
  await page.getByTestId("administration-link").click();

  // then
  await expect(page.getByTestId("load-failure")).toBeVisible();
  await expect(page.getByTestId("retry-load")).toBeEnabled();
  await expect(page.getByTestId("admin-overview-view")).toHaveCount(0);
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
  const response = await created;
  expect(response.status()).toBe(201);
  expect(await response.request().headerValue("X-XSRF-TOKEN")).toBeTruthy();
  expect(await response.request().headerValue("Idempotency-Key"))
    .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("an expired session cannot turn a supported browser back into an authenticated client", async ({ page, journeyService }) => {
  // given
  await signIn(page, "doe.jane");
  const secure = new URL(page.url()).protocol === "https:";
  const sessionName = secure ? "__Host-SESSION" : "SESSION";
  const otherSessionName = secure ? "SESSION" : "__Host-SESSION";
  const otherCsrfName = secure ? "XSRF-TOKEN" : "__Host-XSRF-TOKEN";
  expect((await page.context().cookies()).some((cookie) => cookie.name === sessionName)).toBe(true);
  await journeyService.executeSql(
    "UPDATE spring_session SET last_access_time = 0, max_inactive_interval = 1, expiry_time = 1");
  const sessionResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session") && response.request().method() === "GET");
  // A page the service worker controls never sees Set-Cookie, so the clearing answer is read where the worker's fetches are reported too.
  const expiryResponse = page.context().waitForEvent("response", async (response) =>
    (await cookieFacts(response)).some((cookie) => cookie.name === sessionName
      && cookie.isEmpty && cookie.maxAge === "0"));

  // when
  await page.reload();

  // then
  const response = await sessionResponse;
  const expiryCookies = await cookieFacts(await expiryResponse);
  expect(await response.json()).toMatchObject({ authenticated: false });
  await expect(page.getByTestId("sign-in-link").or(page.getByTestId("login-submit"))).toBeVisible();
  expect(expiryCookies).toContainEqual({ name: sessionName, path: "/", sameSite: "Lax", secure,
    httpOnly: true, maxAge: "0", isEmpty: true });
  expect((await page.context().cookies()).some((cookie) => cookie.name === sessionName)).toBe(false);
  const names = expiryCookies.map(({ name }) => name);
  expect(names).not.toContain(otherSessionName);
  expect(names).not.toContain(otherCsrfName);
});


test.describe("localized summaries", () => {
  test.use({ timezoneId: "UTC", locale: "en-US", serviceWorkers: "block" });

  test("given an English UTC browser, when German summaries load, then dates and reasons follow the app and club", async ({ page }) => {
    test.setTimeout(60_000);
    // given
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("UTC");
    expect(await page.evaluate(() => navigator.language)).toBe("en-US");
    await page.route("**/api/account/sessions", (route) => route.fulfill({ json: [{
      handle: "A234567890123456789012", current: true, browserFamily: "FIREFOX",
      createdAt: "2026-10-23T16:53:00Z", lastActivityAt: "2026-10-23T22:10:00Z"
    }] }));
    await page.route("**/api/admin/reports/usage**", (route) => route.fulfill({ json: {
      from: "2026-10-20", to: "2026-11-01", timeZone: "Europe/Berlin",
      capacity: { capacityMinutes: 0, closedMinutes: 0, uses: [] },
      cancellations: { cancelled: 0, byHolder: 0, byClub: 0, released: 0, reasons: [], cards: [] },
      attendance: { tracked: false, attended: 0, noShows: 0, liftedNoShows: 0 },
      ruleRejections: { attempts: 3, rules: ["closed", "outside", "courtClosed"].map((code) => ({
        code: `booking.rule.openingHours.${code}`, attempts: 1
      })) }
    } }));
    await signIn(page, "configuration-admin");
    await selectPreference(page, "#locale-preference", "de");

    // when
    await page.goto("/account/security");

    // then
    const session = page.getByTestId("account-security-view");
    await expect(session).toContainText("23.10.2026, 18:53");
    await expect(session).toContainText("24.10.2026, 00:10");
    await page.goto("/admin/usage");
    await expect(page.getByTestId("usage-period")).toHaveText("20.10.2026 bis 01.11.2026");
    await expect(page.getByTestId("usage-rule-label")).toHaveText([
      "Einrichtung geschlossen", "Außerhalb der Öffnungszeiten", "Platz gesperrt"
    ]);
    await selectPreference(page, "#locale-preference", "en");
    await expect(page.getByTestId("usage-period")).toHaveText("Oct 20, 2026 to Nov 1, 2026");
    await expect(page.getByTestId("usage-rule-label")).toHaveText([
      "Facility closed", "Outside opening hours", "Court closure"
    ]);
  });
});

test.describe("application locale editors with an English browser", () => {
  test.describe.configure({ timeout: 90_000 });
  const localeExpect = expect.configure({ timeout: 10_000 });
  test.use({ locale: "en-US" });

  test("given German application language and an English browser, when dates and times are edited and saved, then localized editing persists ISO values after reload", async ({ page }) => {
    // given
    await page.addInitScript(() => {
      if (!window.localStorage.getItem("courtside.locale")) window.localStorage.setItem("courtside.locale", "de");
    });
    await signIn(page, "configuration-admin");
    const weekDate = page.getByTestId("week-date");
    await weekDate.focus();
    await weekDate.press("ControlOrMeta+A");
    await weekDate.press("Backspace");
    await localeExpect(weekDate).toHaveValue("");
    await weekDate.pressSequentially("2");
    await localeExpect(weekDate).toHaveValue("2");
    await weekDate.pressSequentially("6.08.2026");
    await localeExpect(weekDate).toHaveValue("26.08.2026");
    await page.goto("/admin/facility/opening-hours");
    await localeExpect(page.locator("html")).toHaveAttribute("lang", "de");
    localeExpect(await page.evaluate(() => navigator.language)).toBe("en-US");
    const date = page.getByTestId("opening-hours-effective-from");
    const [day, month, year] = (await date.inputValue()).split(".").map(Number);
    const later = new Date(Date.UTC(year, month - 1, day + 7));
    const iso = later.toISOString().slice(0, 10);
    const localized = `${String(later.getUTCDate()).padStart(2, "0")}.${String(later.getUTCMonth() + 1).padStart(2, "0")}.${later.getUTCFullYear()}`;
    const opens = page.getByTestId("hours-open-MONDAY");
    const closes = page.getByTestId("hours-close-MONDAY");

    // when
    await date.fill(localized);
    await localeExpect(date).toBeFocused();
    await localeExpect(date).toHaveValue(localized);
    await opens.fill("09:30");
    await localeExpect(opens).toBeFocused();
    await localeExpect(opens).toHaveValue("09:30");
    await closes.fill("18:30");
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/admin/opening-hours") && response.request().method() === "PUT");
    await page.getByTestId("save-opening-hours").click();

    // then
    const response = await saved;
    localeExpect(response.status()).toBe(200);
    localeExpect(response.request().postDataJSON()).toMatchObject({ effectiveFrom: iso,
      days: localeExpect.arrayContaining([localeExpect.objectContaining({ dayOfWeek: "MONDAY", opensAt: "09:30", closesAt: "18:30" })]) });
    await page.reload();
    await page.getByTestId(`edit-opening-week-${iso}`).click();
    await localeExpect(date).toHaveValue(localized);
    await localeExpect(opens).toHaveValue("09:30");
    await localeExpect(closes).toHaveValue("18:30");
    await selectPreference(page, "#locale-preference", "en");
    await localeExpect(date).toHaveValue(`${iso.slice(5, 7)}/${iso.slice(8)}/${iso.slice(0, 4)}`);
    await localeExpect(opens).toHaveValue("09:30 AM");
    await localeExpect(closes).toHaveValue("06:30 PM");
  });

  test("given English twelve-hour rule times, when desktop and mobile widths render, then AM and PM fit without page overflow", async ({ page }) => {
    // given
    await page.addInitScript(() => window.localStorage.setItem("courtside.locale", "en"));
    await signIn(page, "configuration-admin");
    await page.goto("/admin/rule-sets");
    const first = page.getByTestId("rule-BOOKING_HOURS-earliestStart");
    const last = page.getByTestId("rule-BOOKING_HOURS-latestEnd");

    // when
    await first.fill("04:00 PM");
    await last.fill("11:59 PM");

    // then
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const field of [first, last]) {
        const geometry = await field.evaluate((element) => {
          const input = element as HTMLInputElement;
          const style = getComputedStyle(input);
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d")!;
          context.font = style.font;
          const textWidth = context.measureText(input.value).width + Math.max(0, input.value.length - 1) * (Number.parseFloat(style.letterSpacing) || 0);
          const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
          const bounds = input.getBoundingClientRect();
          return { textWidth, contentWidth: input.clientWidth - padding, left: bounds.left, right: bounds.right };
        });
        localeExpect(geometry.textWidth).toBeLessThanOrEqual(geometry.contentWidth);
        localeExpect(geometry.left).toBeGreaterThanOrEqual(0);
        localeExpect(geometry.right).toBeLessThanOrEqual(width);
      }
      localeExpect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    }
    await localeExpect(first).toHaveValue("04:00 PM");
    await localeExpect(last).toHaveValue("11:59 PM");
  });
});
