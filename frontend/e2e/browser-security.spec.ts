import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, selectJourneyDate, test } from "./fixtures";

const payload = `<img src=x onerror="globalThis.__courtsideXss='executed'">cross-role`;

async function login(page: import("@playwright/test").Page, username: string) {
  await page.goto("/login");
  await page.getByTestId("username").fill(username);
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
}

async function browserInventory(page: import("@playwright/test").Page) {
  const storage = await page.evaluate(async (sensitiveMarkers: string[]) => {
    const cacheNames = await caches.keys();
    const cachedRequests: ReadonlyArray<readonly Request[]> = await Promise.all(cacheNames.map(async (name) =>
      (await caches.open(name)).keys()));
    const cacheRequests = cachedRequests.flat().map((request) => new URL(request.url).pathname);
    const storageValues = [localStorage, sessionStorage].flatMap((storageArea) =>
      Array.from({ length: storageArea.length }, (_, index) => storageArea.getItem(storageArea.key(index) ?? "") ?? ""));
    return {
      localStorageKeys: Object.keys(localStorage).toSorted(),
      sessionStorageKeys: Object.keys(sessionStorage).toSorted(),
      cacheRequests: cacheRequests.toSorted(),
      storageContainsSensitiveData: storageValues.some((value) =>
        sensitiveMarkers.some((marker) => value.includes(marker)))
    };
  }, ["cross-role", "Jane", "Doe", "SESSION", "temporary-password"]);
  const cookies = (await page.context().cookies()).map(({ name, httpOnly, secure, sameSite, path }) => ({
    name, httpOnly, secure, sameSite, path
  })).toSorted((left, right) => left.name.localeCompare(right.name));
  return { ...storage, cookies };
}

test("stored values remain data across roles without entering browser storage or console evidence", async ({ page, journeyService }, testInfo) => {
  // given
  await journeyService.executeSql(`
    UPDATE club_config SET club_name = $payload$${payload}$payload$;
    UPDATE court SET name = $payload$${payload}$payload$ WHERE number = 1;
  `);
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "__courtsideXss", { value: "not-executed", writable: true });
  });
  const consoleEvents: Array<{ type: string; containsSensitiveData: boolean }> = [];
  page.on("console", (message) => consoleEvents.push({
    type: message.type(), containsSensitiveData: ["cross-role", "Jane", "Doe", "SESSION", "temporary-password"]
      .some((marker) => message.text().includes(marker))
  }));

  // when
  await login(page, "doe.jane");

  // then
  await expect(page.getByTestId("club-brand-name")).toHaveText(payload);
  await expect(page.getByTestId("court-plan-view")).toContainText(payload);
  expect(await page.evaluate(() => globalThis.__courtsideXss)).toBe("not-executed");
  expect(consoleEvents.some(({ containsSensitiveData }) => containsSensitiveData)).toBe(false);
  const inventory = await browserInventory(page);
  expect(inventory.cacheRequests.filter((path) => path.startsWith("/api/"))).toEqual([]);
  expect(inventory.localStorageKeys.every((key) => key === "courtside.locale")).toBe(true);
  expect(inventory.sessionStorageKeys).toEqual([]);
  expect(inventory.storageContainsSensitiveData).toBe(false);
  expect(inventory.cookies).toContainEqual({
    name: "SESSION", httpOnly: true, secure: false, sameSite: "Lax", path: "/"
  });
  expect(inventory.cookies).toContainEqual({
    name: "XSRF-TOKEN", httpOnly: false, secure: false, sameSite: "Lax", path: "/"
  });
  const retainedEvidence = { ...inventory, consoleEventTypes: consoleEvents.map(({ type }) => type) };
  const evidenceDirectory = join(process.cwd(), "test-results", "browser-security");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, "browser-security-inventory.json"), JSON.stringify(retainedEvidence));
  await testInfo.attach("browser-security-inventory", {
    body: Buffer.from(JSON.stringify(retainedEvidence)),
    contentType: "application/json"
  });
});

test("URL and fragment payloads are neither reflected nor executed by the DOM", async ({ page }) => {
  // given
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "__courtsideXss", { value: "not-executed", writable: true });
  });

  // when
  await page.goto(`/?query=${encodeURIComponent(payload)}#${encodeURIComponent(payload)}`);

  // then
  await expect(page.locator("body")).not.toContainText("cross-role");
  expect(await page.evaluate(() => globalThis.__courtsideXss)).toBe("not-executed");
  expect(await page.locator("script").allTextContents()).not.toContain(expect.stringContaining("cross-role"));
});

test("stored text projections remain inert on administrative and managed views", async ({ page, journeyService }) => {
  // given
  await journeyService.executeSql(`
    UPDATE booking_card SET label = $payload$${payload}$payload$
      WHERE id = '33333333-3333-3333-3333-333333333333';
    UPDATE participant_card SET label = $payload$${payload}$payload$
      WHERE id = '55555555-5555-5555-5555-555555555555';
    UPDATE rule_set SET name = $payload$${payload}$payload$
      WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
    UPDATE person SET first_name = $payload$${payload}$payload$, last_name = 'Projection',
      email = $payload$${payload}$payload$
      WHERE id = '00000000-0000-0000-0000-000000000103';
    UPDATE user_account SET username = $payload$${payload}$payload$
      WHERE id = '00000000-0000-0000-0000-000000000110';
    UPDATE booking SET note = $payload$${payload}$payload$
      WHERE id = '70000000-0000-0000-0000-000000000004';
    INSERT INTO booking_participant (id, booking_id, kind, guest_name, position)
      VALUES ('71000000-0000-0000-0000-000000000099',
        '70000000-0000-0000-0000-000000000004', 'GUEST', $payload$${payload}$payload$, 0);
  `);
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "__courtsideXss", { value: "not-executed", writable: true });
  });
  const consoleDisclosures: boolean[] = [];
  page.on("console", (message) => consoleDisclosures.push(
    ["cross-role", "Jane", "Doe", "SESSION", "temporary-password"]
      .some((marker) => message.text().includes(marker))
  ));
  await login(page, "configuration-admin");

  // when / then
  await selectJourneyDate(page, journeyService.visualDate);
  await page.locator('[data-testid="free-slot"][data-court-number="2"][data-slot="12:00"][data-state="free"]').click();
  await expect(page.getByTestId("booking-card").locator('option[value="33333333-3333-3333-3333-333333333333"]')).toHaveText(payload);
  await expect(page.locator('option[value="55555555-5555-5555-5555-555555555555"]')).toHaveText(payload);
  await page.getByTestId("booking-close").click();
  await page.goto("/admin/configuration");
  await expect(page.getByTestId("rule-set").locator('option[value="aaaaaaaa-0000-0000-0000-000000000001"]')).toHaveText(payload);
  await page.goto("/admin/facility");
  await expect(page.getByTestId("card-label-33333333-3333-3333-3333-333333333333")).toHaveValue(payload);
  await page.goto("/admin/roster");
  await expect(page.getByTestId("person-first-name-00000000-0000-0000-0000-000000000103")).toHaveValue(payload);
  await expect(page.getByTestId("person-email-00000000-0000-0000-0000-000000000103")).toHaveValue(payload);
  await expect(page.getByTestId("account-username-00000000-0000-0000-0000-000000000108")).toHaveValue(payload);
  await page.goto("/my-bookings");
  const appointment = page.getByTestId("booking-70000000-0000-0000-0000-000000000004");
  await appointment.getByTestId("managed-details").click();
  await expect(page.getByTestId("managed-card-label")).toHaveText(payload);
  await expect(page.getByTestId("managed-note")).toContainText(payload);
  await expect(page.getByTestId("managed-participants")).toContainText(payload);
  expect(await page.evaluate(() => globalThis.__courtsideXss)).toBe("not-executed");
  expect(consoleDisclosures.some(Boolean)).toBe(false);
});

test("a blocked inline script produces an attributable CSP violation", async ({ page }) => {
  // given
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, "__courtsideCspExecuted", { value: false, writable: true });
    Object.defineProperty(globalThis, "__courtsideCspEvents", { value: [], writable: false });
    document.addEventListener("securitypolicyviolation", (event) => {
      globalThis.__courtsideCspEvents.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
  });
  const response = await page.goto("/");

  // when
  await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "globalThis.__courtsideCspExecuted = true";
    document.head.append(script);
  });

  // then
  expect(response?.headers()["content-security-policy"]).toContain("script-src 'self'");
  await expect.poll(() => page.evaluate(() => globalThis.__courtsideCspEvents.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => globalThis.__courtsideCspExecuted)).toBe(false);
  expect(await page.evaluate(() => globalThis.__courtsideCspEvents)).toContainEqual({
    directive: "script-src-elem", blocked: "inline"
  });
});

declare global {
  var __courtsideXss: string;
  var __courtsideCspExecuted: boolean;
  var __courtsideCspEvents: Array<{ directive: string; blocked: string }>;
}
