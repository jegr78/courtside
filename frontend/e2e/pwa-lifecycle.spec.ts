import { expect, selectPreference, test } from "./fixtures";

async function install(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
}

async function cachedApiPaths(page: import("@playwright/test").Page) {
  const cachedRequests = await page.evaluate(async () => {
    const names = await caches.keys();
    const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
    return requests.flat().map((request) => request.url);
  });
  return cachedRequests.filter((url) => new URL(url).pathname.startsWith("/api/"))
    .map((url) => new URL(url).pathname);
}

async function cachedPersonalBookingContract(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const cache = await caches.open("courtside-personal-bookings");
    const control = await caches.open("courtside-personal-bookings-control");
    const requests = await cache.keys();
    const response = requests[0] ? await cache.match(requests[0]) : undefined;
    const marker = await control.match("/.courtside/personal-bookings-generation");
    const body: unknown = await response?.json();
    if (requests.length !== 1 || typeof body !== "object" || body === null
      || !("items" in body) || !Array.isArray(body.items)) return undefined;
    return {
      requestPath: `${new URL(requests[0].url).pathname}${new URL(requests[0].url).search}`,
      pageKeys: Object.keys(body).sort(),
      cachedAt: Number(response?.headers.get("x-courtside-cached-at")),
      cachedGeneration: response?.headers.get("x-courtside-cache-generation"),
      currentGeneration: await marker?.text(),
      itemKeys: body.items.map((booking: unknown) =>
        typeof booking === "object" && booking !== null ? Object.keys(booking).sort() : [])
    };
  });
}

async function expectNoApiResponseInCache(page: import("@playwright/test").Page) {
  expect(await cachedApiPaths(page)).toEqual([]);
}

async function expectAnonymousSurface(page: import("@playwright/test").Page) {
  await expect(page.getByTestId("my-bookings-page")).not.toBeVisible();
  // Signing out lives in the account menu, so the menu has to be open for its absence to mean anything.
  await page.getByTestId("preferences-menu").click();
  await expect(page.getByTestId("logout")).toHaveCount(0);
  await page.getByTestId("preferences-menu").click();
  await expect(page.getByTestId("sign-in-link").or(page.getByTestId("login-submit"))).toBeVisible();
}

for (const locale of ["de", "en"] as const) {
  test(`the installed ${locale} shell keeps personal bookings readable during an offline launch`, async ({ context, page }) => {
    // given
    await install(page);
    await selectPreference(page, "#locale-preference", locale);
    await page.goto("/login");
    await page.getByTestId("username").fill("doe.jane");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await page.getByTestId("my-bookings-link").click();
    await expect(page.getByTestId("my-bookings-page")).toBeVisible();
    await expect(page.locator('[data-testid^="booking-"]').first()).toBeVisible();
    await expect.poll(() => cachedApiPaths(page)).toEqual(["/api/my/bookings"]);
    const cachedContract = await cachedPersonalBookingContract(page);
    expect(cachedContract?.requestPath).toBe("/api/my/bookings?limit=50");
    expect(cachedContract?.cachedGeneration).toBe(cachedContract?.currentGeneration);

    // when
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });

    // then
    const offlineContract = await cachedPersonalBookingContract(page);
    expect(offlineContract?.requestPath).toBe("/api/my/bookings?limit=50");
    expect(offlineContract?.cachedAt).toBeGreaterThan(0);
    expect(offlineContract?.cachedGeneration).toBe(offlineContract?.currentGeneration);
    await expect(page.getByTestId("offline-status")).toBeVisible();
    await expect(page.getByTestId("my-bookings-page")).toBeVisible();
    await expect(page.locator('[data-testid^="booking-"]').first()).toBeVisible();
    await expect(page.getByTestId("bookings-offline-as-of")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    expect(await cachedApiPaths(page)).toEqual(["/api/my/bookings"]);

    // when
    await page.getByTestId("court-plan-link").click();

    // then
    await expect(page.getByTestId("court-plan-offline")).toBeVisible();
    await expect(page.getByTestId("week-grid")).toHaveCount(0);

    // when
    await context.setOffline(false);
    await page.reload();

    // then
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
  });
}

test("logout, another tab and browser history cannot reveal a cached personal view", async ({ context, page }) => {
  // given
  await install(page);
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("my-bookings-link").click();
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();
  const otherPage = await context.newPage();
  await otherPage.goto("/");
  await expect(otherPage.getByTestId("court-plan-view")).toBeVisible();
  await otherPage.getByTestId("my-bookings-link").click();
  await expect(otherPage.getByTestId("my-bookings-page")).toBeVisible();

  // when
  const logoutResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/logout") && response.request().method() === "POST");
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("logout").click();
  expect((await logoutResponse).status()).toBe(204);
  await page.goBack();

  // then
  await expectAnonymousSurface(page);
  await expectAnonymousSurface(otherPage);
  await page.goForward();
  await expectAnonymousSurface(page);
  await expectNoApiResponseInCache(page);
});

test("ending the current session removes a personal view from every open tab", async ({ context, page }) => {
  // given
  await install(page);
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  const otherPage = await context.newPage();
  await otherPage.goto("/");
  await expect(otherPage.getByTestId("court-plan-view")).toBeVisible();
  await otherPage.getByTestId("my-bookings-link").click();
  await expect(otherPage.getByTestId("my-bookings-page")).toBeVisible();
  await page.getByTestId("preferences-menu").click();
  await page.getByTestId("account-security-link").click();
  await expect(page.getByTestId("end-current-session")).toHaveCount(1);

  // when
  await page.getByTestId("end-current-session").click();

  // then
  await expectAnonymousSurface(page);
  await expectAnonymousSurface(otherPage);
  await expectNoApiResponseInCache(page);
});

test("logout outranks a delayed personal-booking revalidation and the cache contains only display data", async ({ context, page }) => {
  // given
  await install(page);
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("my-bookings-link").click();
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();
  await expect.poll(() => cachedApiPaths(page)).toEqual(["/api/my/bookings"]);
  const cachedContract = await cachedPersonalBookingContract(page);
  expect(cachedContract?.pageKeys).toEqual(["courts", "items", "refreshedAt", "timeZone"]);
  const allowedItemKeys = new Set([
    "cardColor", "cardLabel", "courtIds", "endsAt", "id", "seriesId", "startsAt", "status"
  ]);
  expect(cachedContract?.itemKeys.length).toBeGreaterThan(0);
  expect(cachedContract?.itemKeys.every((keys) => keys.every((key) => allowedItemKeys.has(key)))).toBe(true);
  let releaseRevalidation: () => void = () => undefined;
  const revalidationReleased = new Promise<void>((resolve) => { releaseRevalidation = resolve; });
  let observeRevalidation: () => void = () => undefined;
  const revalidationObserved = new Promise<void>((resolve) => { observeRevalidation = resolve; });
  let delayNextPage = true;
  await context.route("**/api/my/bookings?limit=50", async (route) => {
    if (!delayNextPage) {
      await route.continue();
      return;
    }
    delayNextPage = false;
    observeRevalidation();
    await revalidationReleased;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [{ note: "private revalidation note" }], refreshedAt: new Date().toISOString() })
    });
  });
  await page.evaluate(() => fetch("/api/my/bookings?limit=50").then((response) => response.json()));
  await revalidationObserved;

  // when
  const logoutResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/logout") && response.request().method() === "POST");
  await page.getByTestId("preferences-menu").click();
  const logout = page.getByTestId("logout").click();
  expect((await logoutResponse).status()).toBe(204);
  releaseRevalidation();
  await logout;

  // then
  await expectAnonymousSurface(page);
  await expectNoApiResponseInCache(page);
});

test("a waiting service-worker update activates once and reloads one coherent application version", async ({ journeyService, page }) => {
  // given
  await install(page);
  await expect(page.getByTestId("build-identity")).toBeEnabled();
  const buildIdentity = await page.getByTestId("build-identity").textContent();
  await journeyService.publishServiceWorkerUpdate();

  // when
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((registration) => registration?.update()));

  // then
  await expect(page.getByTestId("pwa-update-prompt")).toBeVisible();

  // when
  const [, updatedShell] = await Promise.all([
    page.waitForEvent("load"),
    page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/" && response.request().resourceType() === "document"),
    page.getByTestId("pwa-update").click()
  ]);

  // then
  await expect(page.getByTestId("build-identity")).toHaveText(buildIdentity ?? "");
  await expect(page.getByTestId("pwa-update-prompt")).not.toBeVisible();
  const workerVersion = await page.evaluate(() => new Promise<number>((resolveVersion, rejectVersion) => {
    const timeout = window.setTimeout(() => rejectVersion(new Error("Updated service worker did not identify itself")), 2_000);
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data: unknown = event.data;
      if (typeof data === "object" && data !== null && "courtsideVersion" in data && data.courtsideVersion === 2) {
        window.clearTimeout(timeout);
        resolveVersion(data.courtsideVersion);
      }
    }, { once: true });
    navigator.serviceWorker.controller?.postMessage("COURTSIDE_TEST_VERSION");
  }));
  expect(workerVersion).toBe(2);
  expect(updatedShell.headers()["content-security-policy"]).toContain("script-src 'self'");
  await expectNoApiResponseInCache(page);
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((registration) => registration?.update()));
  await expect(page.getByTestId("pwa-update-prompt")).not.toBeVisible();
});
