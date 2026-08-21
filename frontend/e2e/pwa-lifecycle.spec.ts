import { expect, test } from "./fixtures";

async function install(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
}

async function expectNoApiResponseInCache(page: import("@playwright/test").Page) {
  const cachedRequests = await page.evaluate(async () => {
    const names = await caches.keys();
    const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
    return requests.flat().map((request) => request.url);
  });
  expect(cachedRequests.filter((url) => new URL(url).pathname.startsWith("/api/"))).toEqual([]);
}

async function expectAnonymousSurface(page: import("@playwright/test").Page) {
  await expect(page.getByTestId("my-bookings-page")).not.toBeVisible();
  await expect(page.getByTestId("logout")).not.toBeVisible();
  await expect(page.getByTestId("sign-in-link").or(page.getByTestId("login-submit"))).toBeVisible();
}

for (const locale of ["de", "en"] as const) {
  test(`the installed ${locale} shell survives an offline launch without caching API data`, async ({ context, page }) => {
    // given
    await install(page);
    await page.locator("#locale-preference").selectOption(locale);
    await page.goto("/login");
    await page.getByTestId("username").fill("doe.jane");
    await page.getByTestId("password").fill("temporary-password");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await expectNoApiResponseInCache(page);

    // when
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });

    // then
    await expect(page.getByTestId("offline-status")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expectNoApiResponseInCache(page);

    // when
    await context.setOffline(false);
    await page.reload();

    // then
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
  });
}

test("logout and browser history cannot reveal a cached personal view", async ({ page }) => {
  // given
  await install(page);
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await page.getByTestId("my-bookings-link").click();
  await expect(page.getByTestId("my-bookings-page")).toBeVisible();

  // when
  const logoutResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/session/logout") && response.request().method() === "POST");
  await page.getByTestId("logout").click();
  expect((await logoutResponse).status()).toBe(204);
  await page.goBack();

  // then
  await expectAnonymousSurface(page);
  await page.goForward();
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
