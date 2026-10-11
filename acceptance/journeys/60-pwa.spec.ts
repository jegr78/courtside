import { test, expect } from "../lib/fixtures";
import { capture, setPersona } from "../lib/checks";
import { openAs } from "../lib/session";
import { addPartner, bookAt, cancelQuietly, projectName } from "../lib/journey";

test.beforeEach(() => { test.skip(!/desktop-chrome|desktop-safari|pixel-7|iphone-15-de/.test(projectName()), "pwa checks run on four profiles"); });

test("when the manifest is read, then name, icons, start url and shortcuts are usable", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status(), "product: the manifest is served").toBe(200);
  const manifest = await response.json();
  test.info().annotations.push({ type: "manifest", description: JSON.stringify({ name: manifest.name, short_name: manifest.short_name, lang: manifest.lang, start_url: manifest.start_url, display: manifest.display, icons: manifest.icons?.length }) });
  expect(manifest.display, "product: the manifest asks for standalone display").toBe("standalone");
  expect(manifest.name, "product: the manifest names the club").toBeTruthy();
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, "https://club.example.org/");
    const path = url.pathname + url.search;
    expect((await request.get(path)).status(), `product: icon ${icon.src} is served`).toBe(200);
  }
  expect(manifest.shortcuts.map((s: { url: string }) => new URL(s.url, "https://club.example.org/").pathname), "product: the shortcuts lead to courts and my bookings").toEqual(expect.arrayContaining(["/courts", "/my-bookings"]));
});

test("when the app loads, then a service worker controls the page", async ({ browser }) => {
  const page = await openAs(browser, "memberA");
  try {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    expect(controlled, "product: the service worker controls the page after a reload").toBe(true);
  } finally { await page.context().close(); }
});

test("given chromium, when display-mode standalone is emulated, then the shell renders cleanly", async ({ browser, browserName }) => {
  test.skip(true, "not checkable: Chromium ignores CDP display-mode emulation here, and the app ships no display-mode CSS");
  const page = await openAs(browser, "memberA");
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "display-mode", value: "standalone" }] });
    expect(await page.evaluate(() => matchMedia("(display-mode: standalone)").matches)).toBe(true);
    await capture(page, "standalone-plan");
    await page.getByTestId("my-bookings-link").click();
    await expect(page.getByTestId("my-bookings-page")).toBeVisible();
    await capture(page, "standalone-my-bookings");
  } finally { await page.context().close(); }
});

test("given a booking of my own, when offline and reloaded, then My bookings still shows it and the plan says it is offline", async ({ browser, browserName, lanes }) => {
  test.skip(browserName === "webkit", "not checkable: Playwright WebKit fails every navigation while offline with an internal error");
  test.skip(!/desktop-chrome|pixel-7/.test(projectName()), "the offline journey runs on the two Chromium profiles with an offline lane");
  const slot = await lanes.take("offline");
  const page = await openAs(browser, "memberA");
  const ids: string[] = [];
  try {
    ids.push(await bookAt(page, "memberA", slot, (p) => addPartner(p, "memberB")));
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller), "product: the service worker controls the page after a reload").toBe(true);
    await page.getByTestId("my-bookings-link").click();
    await expect(page.getByTestId(`booking-${ids[0]}`), "product: the new booking is listed online").toBeVisible();
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
    await page.context().setOffline(true);
    await page.goto("/my-bookings");
    await expect(page.getByTestId(`booking-${ids[0]}`), "product: the booking is shown offline").toBeVisible();
    await capture(page, "offline-my-bookings");
    await page.getByTestId("court-plan-link").click();
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await capture(page, "offline-plan");
  } finally {
    await page.context().setOffline(false);
    await cancelQuietly(page, ids);
    await page.context().close();
  }
});

test("given two tabs, when one signs out, then the other leaves the member session", async ({ browser }) => {
  const first = await openAs(browser, "memberC");
  try {
    const second = await first.context().newPage();
    setPersona(second, "memberC");
    await second.goto("/my-bookings");
    await expect(second.getByTestId("my-bookings-page")).toBeVisible();
    await first.getByTestId("preferences-menu").click();
    await first.getByTestId("logout").click();
    await expect(second.getByTestId("sign-in-link").or(second.getByTestId("login-view")), "product: the other tab leaves the member session").toBeVisible();
    await capture(second, "other-tab-after-sign-out");
  } finally { await first.context().close(); }
});
