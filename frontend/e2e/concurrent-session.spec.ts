import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures";
import type { JourneyService } from "./global-setup";

const memberCard = "11111111-1111-1111-1111-111111111111";
const ballMachine = "55555555-5555-5555-5555-555555555555";
const courtTwo = "dddddddd-0000-0000-0000-000000000002";
const courtThree = "dddddddd-0000-0000-0000-000000000003";

async function login(page: Page, baseURL: string, username: string): Promise<void> {
  await page.goto(`${baseURL}/login`);
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
}

async function prepareBooking(page: Page, baseURL: string, username: string): Promise<void> {
  await login(page, baseURL, username);
  await page.getByTestId("week-next").click();
  const slot = page.locator('[data-testid="free-slot"][data-court-number="2"][data-slot="12:00"][data-state="free"]');
  await expect(slot).toBeVisible();
  await slot.click();
  await page.getByTestId("booking-card").selectOption(memberCard);
  await page.getByTestId("member-search").fill("Mary");
  await page.getByTestId("member-match").click();
  await expect(page.getByTestId("booking-submit")).toBeEnabled();
}

async function memberContext(browser: Browser, service: JourneyService, username: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  await login(await context.newPage(), service.baseURL, username);
  return context;
}

async function slot(service: JourneyService): Promise<{ startsAt: string; endsAt: string }> {
  const [startsAt, endsAt] = (await service.executeSql(`
    WITH target AS (
      SELECT DATE '${service.visualDate}' + ((8 - extract(isodow FROM DATE '${service.visualDate}'))::integer % 7) AS day
    )
    SELECT to_char((day + TIME '12:00') AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD"T"HH24:MI:SSOF'),
           to_char((day + TIME '13:00') AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD"T"HH24:MI:SSOF')
    FROM target
  `)).split("|");
  return { startsAt, endsAt };
}

async function createBooking(page: Page, body: object, key: string) {
  return page.evaluate(async ({ booking, idempotencyKey }) => {
    const token = document.cookie.split("; ").find((cookie) => cookie.startsWith("XSRF-TOKEN="))?.split("=")[1];
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "X-XSRF-TOKEN": decodeURIComponent(token ?? "")
      },
      body: JSON.stringify(booking)
    });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }, { booking: body, idempotencyKey: key });
}

async function mutation(page: Page, path: string, method: "DELETE" | "POST", body?: object) {
  return page.evaluate(async ({ requestPath, requestMethod, requestBody }) => {
    const token = document.cookie.split("; ").find((cookie) => cookie.startsWith("XSRF-TOKEN="))?.split("=")[1];
    const response = await fetch(requestPath, {
      method: requestMethod,
      headers: {
        ...(requestBody ? { "Content-Type": "application/json" } : {}),
        "X-XSRF-TOKEN": decodeURIComponent(token ?? "")
      },
      body: requestBody ? JSON.stringify(requestBody) : undefined
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : undefined };
  }, { requestPath: path, requestMethod: method, requestBody: body });
}

async function attach(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: "application/json" });
}

test("two members receive one booking and one actionable conflict for the same slot", async ({ browser, journeyService }, testInfo) => {
  // given
  const first = await browser.newContext();
  const second = await browser.newContext();
  const firstPage = await first.newPage();
  const secondPage = await second.newPage();
  await Promise.all([
    prepareBooking(firstPage, journeyService.baseURL, "roe.jane"),
    prepareBooking(secondPage, journeyService.baseURL, "keeper.roe")
  ]);
  let arrivals = 0;
  let release!: () => void;
  const bothReady = new Promise<void>((resolve) => { release = resolve; });
  const barrier = async (route: import("@playwright/test").Route) => {
    arrivals += 1;
    if (arrivals === 2) release();
    await bothReady;
    await route.continue();
  };
  await firstPage.route("**/api/bookings", barrier);
  await secondPage.route("**/api/bookings", barrier);
  const firstResponse = firstPage.waitForResponse((response) => response.url().endsWith("/api/bookings"));
  const secondResponse = secondPage.waitForResponse((response) => response.url().endsWith("/api/bookings"));

  // when
  await Promise.all([
    firstPage.getByTestId("booking-submit").click(),
    secondPage.getByTestId("booking-submit").click()
  ]);
  const responses = await Promise.all([firstResponse, secondResponse]);
  const evidence = await Promise.all(responses.map(async (response) => ({
    status: response.status(), body: await response.json() as Record<string, unknown>
  })));

  // then
  await attach(testInfo, "competing-bookings", evidence);
  expect(evidence.map((entry) => entry.status).sort(), JSON.stringify(evidence)).toEqual([201, 409]);
  const loser = evidence[0].status === 409 ? firstPage : secondPage;
  await expect(loser.getByRole("alert")).toContainText("Someone else just booked this court. Choose another time.");
  const bookingId = String(evidence.find((entry) => entry.status === 201)?.body.id);
  expect(await journeyService.executeSql(`SELECT count(*) FROM court_allocation WHERE booking_id = '${bookingId}' AND status = 'CONFIRMED'`)).toBe("1");
  await attach(testInfo, "database-state", await journeyService.executeSql(`SELECT id, booking_id, court_id, starts_at, ends_at, status FROM court_allocation WHERE booking_id = '${bookingId}'`));
  await Promise.all([first.close(), second.close()]);
});

test("duplicate browser delivery with one idempotency key creates one logical booking", async ({ browser, journeyService }, testInfo) => {
  // given
  const context = await memberContext(browser, journeyService, "roe.jane");
  const pages = context.pages();
  const page = pages[0];
  const time = await slot(journeyService);
  const body = {
    courtIds: [courtTwo], cardId: memberCard, ...time,
    participants: [{ guestName: "John Roe" }]
  };
  const key = crypto.randomUUID();

  // when
  const deliveries = await Promise.all([
    createBooking(page, body, key),
    createBooking(page, body, key)
  ]);

  // then
  expect(deliveries.map((delivery) => delivery.status)).toEqual([201, 201]);
  expect(deliveries[0].body.id).toBe(deliveries[1].body.id);
  expect(await journeyService.executeSql(`SELECT count(*) FROM booking WHERE booked_by = '00000000-0000-0000-0000-000000000116' AND idempotency_key = '${key}'`)).toBe("1");
  await attach(testInfo, "duplicate-delivery", deliveries);
  await context.close();
});

test("a court and a member role changed behind an open dialog fail closed", async ({ page, journeyService }) => {
  // given
  await prepareBooking(page, journeyService.baseURL, "doe.jane");
  await journeyService.executeSql(`UPDATE court SET active = false WHERE id = '${courtTwo}'`);

  // when
  await page.getByTestId("booking-submit").click();

  // then
  await expect(page.locator('[data-code="court.inactive"]')).toBeVisible();
  expect(await journeyService.executeSql("SELECT count(*) FROM booking WHERE idempotency_key IS NOT NULL")).toBe("0");

  // given
  await journeyService.executeSql(`UPDATE court SET active = true WHERE id = '${courtTwo}'`);
  await journeyService.executeSql(`UPDATE booking_card SET active = false WHERE id = '${memberCard}'`);

  // when
  await page.getByTestId("booking-submit").click();

  // then
  await expect(page.locator('[data-code="card.inactive"]')).toBeVisible();
  expect(await journeyService.executeSql("SELECT count(*) FROM booking WHERE idempotency_key IS NOT NULL")).toBe("0");

  // given
  await journeyService.executeSql(`UPDATE booking_card SET active = true WHERE id = '${memberCard}'`);
  await journeyService.executeSql("DELETE FROM user_account_role WHERE user_account_id = '00000000-0000-0000-0000-000000000102' AND role = 'MEMBER'; DELETE FROM spring_session");
  expect(await journeyService.executeSql("SELECT count(*) FROM user_account_role WHERE user_account_id = '00000000-0000-0000-0000-000000000102' AND role = 'MEMBER'"))
    .toBe("0");
  const staleResponse = page.waitForResponse((response) => response.url().endsWith("/api/bookings"));

  // when
  await page.getByTestId("booking-submit").click();

  // then
  const staleProblem = await staleResponse;
  expect(staleProblem.status()).toBe(401);
  expect((await staleProblem.json() as { type: string }).type).toBe("urn:courtside:error:unauthenticated");
  await expect(page.getByTestId("login-view")).toBeVisible();
  expect(await journeyService.executeSql("SELECT count(*) FROM booking WHERE idempotency_key IS NOT NULL")).toBe("0");
});

test("concurrent participant-card claims leave exactly one capacity owner", async ({ browser, journeyService }, testInfo) => {
  // given
  const first = await memberContext(browser, journeyService, "roe.jane");
  const second = await memberContext(browser, journeyService, "keeper.roe");
  const firstPage = first.pages()[0];
  const secondPage = second.pages()[0];
  const time = await slot(journeyService);
  const key = [crypto.randomUUID(), crypto.randomUUID()];
  let arrivals = 0;
  let release!: () => void;
  const bothReady = new Promise<void>((resolve) => { release = resolve; });
  const barrier = async (route: import("@playwright/test").Route) => {
    arrivals += 1;
    if (arrivals === 2) release();
    await bothReady;
    await route.continue();
  };
  await firstPage.route("**/api/bookings", barrier);
  await secondPage.route("**/api/bookings", barrier);
  const booking = (courtId: string) => ({
    courtIds: [courtId], cardId: memberCard, ...time,
    participants: [{ cardId: ballMachine }]
  });

  // when
  const claims = await Promise.all([
    createBooking(firstPage, booking(courtTwo), key[0]),
    createBooking(secondPage, booking(courtThree), key[1])
  ]);

  // then
  await attach(testInfo, "participant-card-claims", claims);
  expect(claims.map((claim) => claim.status).sort(), JSON.stringify(claims)).toEqual([201, 400]);
  const rejection = claims.find((claim) => claim.status === 400);
  expect(rejection?.body.type).toBe("urn:courtside:error:participants-invalid");
  expect((rejection?.body.violations as Array<{ code: string }>)[0].code).toBe("booking.participants.cardUnavailable");
  expect(await journeyService.executeSql(`
    SELECT count(*) FROM booking_participant participant
    JOIN booking ON booking.id = participant.booking_id
    WHERE participant.card_id = '${ballMachine}' AND booking.idempotency_key IN ('${key[0]}', '${key[1]}')
  `)).toBe("1");
  await Promise.all([first.close(), second.close()]);
});

test("a series move and scoped cancellation serialize without a partial occurrence", async ({ browser, journeyService }, testInfo) => {
  // given
  const first = await memberContext(browser, journeyService, "doe.jane");
  const second = await memberContext(browser, journeyService, "doe.jane");
  const movePage = first.pages()[0];
  const cancelPage = second.pages()[0];
  let arrivals = 0;
  let release!: () => void;
  const bothReady = new Promise<void>((resolve) => { release = resolve; });
  const barrier = async (route: import("@playwright/test").Route) => {
    arrivals += 1;
    if (arrivals === 2) release();
    await bothReady;
    await route.continue();
  };
  await movePage.route("**/api/booking-series/**", barrier);
  await cancelPage.route("**/api/booking-series/**", barrier);
  const seriesId = "73000000-0000-0000-0000-000000000001";
  const bookingId = "70000000-0000-0000-0000-000000000001";

  // when
  const [move, cancellation] = await Promise.all([
    mutation(movePage, `/api/booking-series/${seriesId}/move`, "POST", {
      fromBookingId: bookingId, scope: "WHOLE_SERIES", newStartTime: "13:00:00"
    }),
    mutation(cancelPage, `/api/booking-series/${seriesId}?fromBookingId=${bookingId}&scope=THIS`, "DELETE")
  ]);

  // then
  await attach(testInfo, "series-race", { move, cancellation });
  expect(cancellation.status).toBe(204);
  expect(move.status).toBe(200);
  expect(await journeyService.executeSql(`SELECT status FROM booking WHERE id = '${bookingId}'`)).toBe("CANCELLED");
  expect(await journeyService.executeSql(`SELECT status FROM court_allocation WHERE booking_id = '${bookingId}'`)).toBe("CANCELLED");
  expect(await journeyService.executeSql(`SELECT count(*) FROM court_allocation WHERE booking_id = '${bookingId}'`)).toBe("1");
  await Promise.all([first.close(), second.close()]);
});

test("logout invalidates every tab and browser history reveals no personal view", async ({ browser, journeyService }) => {
  // given
  const context = await browser.newContext();
  const first = await context.newPage();
  await context.addCookies([{
    name: "SESSION", value: "attacker-fixed-session", url: journeyService.baseURL
  }]);
  await first.goto(`${journeyService.baseURL}/login`);
  await first.getByTestId("username").fill("doe.jane");
  await first.getByTestId("password").fill("temporary-password");
  await first.getByTestId("login-submit").click();
  await expect(first.getByTestId("court-plan-view")).toBeVisible();
  const authenticatedSession = (await context.cookies()).find((cookie) => cookie.name === "SESSION")?.value;
  const authenticatedCsrf = (await context.cookies()).find((cookie) => cookie.name === "XSRF-TOKEN")?.value;
  const second = await context.newPage();
  await second.goto(`${journeyService.baseURL}/my-bookings`);
  await expect(second.getByTestId("my-bookings-page")).toBeVisible();

  // when
  await first.getByTestId("logout").click();
  await second.goto(`${journeyService.baseURL}/courts`);
  await second.goBack();

  // then
  expect(authenticatedSession).toBeTruthy();
  expect(authenticatedSession).not.toBe("attacker-fixed-session");
  const anonymousCsrf = (await context.cookies()).find((cookie) => cookie.name === "XSRF-TOKEN")?.value;
  expect(anonymousCsrf).toBeTruthy();
  expect(anonymousCsrf).not.toBe(authenticatedCsrf);
  await expect(second.getByTestId("login-view")).toBeVisible();
  await expect(second.getByTestId("my-bookings-page")).not.toBeVisible();
  expect((await context.cookies()).some((cookie) => cookie.name === "SESSION")).toBe(false);
  await context.close();
});

test("an expired session rejects a mutation from an open dialog", async ({ page, journeyService }) => {
  // given
  await prepareBooking(page, journeyService.baseURL, "doe.jane");
  await journeyService.executeSql("UPDATE spring_session SET last_access_time = 0, max_inactive_interval = 1, expiry_time = 1");

  // when
  await page.getByTestId("booking-submit").click();

  // then
  await expect(page.getByTestId("login-view")).toBeVisible();
  await expect(page.getByTestId("booking-dialog")).not.toBeVisible();
  expect(await journeyService.executeSql("SELECT count(*) FROM booking WHERE idempotency_key IS NOT NULL")).toBe("0");
});

test("an initial password change ends every active session for the account", async ({ browser, journeyService }) => {
  // given
  await journeyService.executeSql("UPDATE user_account SET password_change_required = true WHERE username = 'roe.jane'");
  const first = await browser.newContext();
  const second = await browser.newContext();
  const firstPage = await first.newPage();
  const secondPage = await second.newPage();
  const restrictedLogin = async (page: Page) => {
    await page.goto(`${journeyService.baseURL}/login`);
    await page.getByTestId("username").fill("roe.jane");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("initial-password-view")).toBeVisible();
  };
  await Promise.all([restrictedLogin(firstPage), restrictedLogin(secondPage)]);

  // when
  await firstPage.getByTestId("new-password").fill("permanent-password");
  await firstPage.getByTestId("confirm-password").fill("permanent-password");
  const changed = firstPage.waitForResponse((response) => response.url().endsWith("/api/account/initial-password"));
  await firstPage.getByTestId("password-submit").click();
  expect((await changed).status()).toBe(204);
  await Promise.all([
    firstPage.goto(`${journeyService.baseURL}/login`),
    secondPage.goto(`${journeyService.baseURL}/login`)
  ]);

  // then
  await expect(firstPage.getByTestId("login-view")).toBeVisible();
  await expect(secondPage.getByTestId("login-view")).toBeVisible();
  expect(await journeyService.executeSql("SELECT count(*) FROM spring_session")).toBe("0");
  await secondPage.getByTestId("username").fill("roe.jane");
  await secondPage.getByTestId("password").fill("permanent-password");
  await secondPage.getByTestId("login-submit").click();
  await expect(secondPage.getByTestId("court-plan-view")).toBeVisible();
  await Promise.all([first.close(), second.close()]);
});

test("an application restart preserves the browser session and booking data", async ({ page, journeyService }, testInfo) => {
  // given
  await login(page, journeyService.baseURL, "doe.jane");
  const before = {
    sessions: await journeyService.executeSql("SELECT count(*) FROM spring_session"),
    bookings: await journeyService.executeSql("SELECT count(*) FROM booking")
  };

  // when
  await journeyService.restart();
  await page.reload();

  // then
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  const after = {
    sessions: await journeyService.executeSql("SELECT count(*) FROM spring_session"),
    bookings: await journeyService.executeSql("SELECT count(*) FROM booking")
  };
  expect(after).toEqual(before);
  await attach(testInfo, "restart-state", { before, after });
});
