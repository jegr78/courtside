import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { expect, selectJourneyDate, test } from "./fixtures";

const payload = `<img src=x onerror="globalThis.__courtsideXss='executed'">cross-role`;
const evidenceDirectory = join(process.cwd(), "test-results", "browser-security");

test.use({ trace: "off", screenshot: "off", video: "off" });

async function writeEvidence(name: string, evidence: unknown) {
  const schema = JSON.parse(await readFile(
    join(process.cwd(), "..", "security", "browser-security-evidence.schema.json"), "utf8")) as object;
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  if (!validate(evidence)) throw new Error(`Browser security evidence violates its schema: ${JSON.stringify(validate.errors)}`);
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(join(evidenceDirectory, name), JSON.stringify(evidence));
}

async function expectRenderingContexts(journey: string, observed: string[]) {
  const inventory = JSON.parse(await readFile(
    join(process.cwd(), "..", "security", "browser-rendering-contexts.json"), "utf8")) as {
      contexts: Array<{ id: string; journey: string }>;
    };
  expect(observed.toSorted()).toEqual(inventory.contexts
    .filter((context) => context.journey === journey)
    .map((context) => context.id)
    .toSorted());
}

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

test("stored values remain data across roles without entering browser storage or console evidence", async ({ page, journeyService }) => {
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
  await expect(page).toHaveTitle(payload);
  await expect(page.getByTestId("court-plan-view")).toContainText(payload);
  expect(await page.evaluate(() => globalThis.__courtsideXss)).toBe("not-executed");
  await expectRenderingContexts("stored-member", ["club-name-text", "club-name-title", "court-name-text"]);
  expect(consoleEvents.some(({ containsSensitiveData }) => containsSensitiveData)).toBe(false);
  const authenticated = await browserInventory(page);
  expect(authenticated.cacheRequests.filter((path) => path.startsWith("/api/"))).toEqual([]);
  expect(authenticated.localStorageKeys.every((key) => key === "courtside.locale")).toBe(true);
  expect(authenticated.sessionStorageKeys).toEqual([]);
  expect(authenticated.storageContainsSensitiveData).toBe(false);
  expect(authenticated.cookies).toContainEqual({
    name: "SESSION", httpOnly: true, secure: false, sameSite: "Lax", path: "/"
  });
  expect(authenticated.cookies).toContainEqual({
    name: "XSRF-TOKEN", httpOnly: false, secure: false, sameSite: "Lax", path: "/"
  });

  // when
  await page.getByTestId("logout").click();
  await page.goBack();
  await page.goForward();

  // then
  await expect(page.getByTestId("sign-in-link").or(page.getByTestId("login-submit"))).toBeVisible();
  const postLogout = await browserInventory(page);
  expect(postLogout.cacheRequests.filter((path) => path.startsWith("/api/"))).toEqual([]);
  expect(postLogout.storageContainsSensitiveData).toBe(false);
  expect(consoleEvents.some(({ containsSensitiveData }) => containsSensitiveData)).toBe(false);
  await writeEvidence("browser-storage-evidence.json", {
    kind: "browser-storage", authenticated, postLogout,
    consoleEventTypes: consoleEvents.map(({ type }) => type)
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
  await expectRenderingContexts("location-input", ["location-input"]);
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
    UPDATE membership_type SET name = $payload$${payload}$payload$
      WHERE id = 'cccccccc-0000-0000-0000-000000000001';
    INSERT INTO import_source (id, source_key, display_name, separator, encoding,
      default_membership_type_id, removal_warning_percent, created_at)
      VALUES ('99000000-0000-0000-0000-000000000001', 'projection',
        $payload$${payload}$payload$, ';', 'UTF-8', 'cccccccc-0000-0000-0000-000000000001', 10,
        '2026-05-01T00:00:00Z');
    INSERT INTO import_external_reference (id, source_id, external_id, person_id, linked_at)
      VALUES ('99000000-0000-0000-0000-000000000002', '99000000-0000-0000-0000-000000000001',
        $payload$${payload}$payload$, '00000000-0000-0000-0000-000000000103',
        '2026-05-01T00:00:00Z');
    INSERT INTO domain_event (id, event_type, subject_id, actor_account_id, occurred_at, payload)
      VALUES ('72000000-0000-0000-0000-000000000099', 'facility.court.added',
        'dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000110',
        '2026-08-10T16:25:00Z', jsonb_build_object('number', $payload$${payload}$payload$));
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
  await expect(page.getByTestId("roster-filter").locator(
    'option[value="cccccccc-0000-0000-0000-000000000001"]')).toHaveText(payload);
  await page.goto("/admin/roster/00000000-0000-0000-0000-000000000103");
  await expect(page.getByTestId("person-first-name")).toHaveValue(payload);
  await expect(page.getByTestId("person-last-name")).toHaveAttribute("value", "Projection");
  await expect(page.getByTestId("person-email")).toHaveValue(payload);
  await page.goto("/admin/roster/00000000-0000-0000-0000-000000000108");
  await expect(page.getByTestId("account-username")).toHaveValue(payload);
  await page.goto("/admin/membership-types");
  await expect(page.getByTestId("membership-type-name-cccccccc-0000-0000-0000-000000000001")).toHaveValue(payload);
  await page.goto("/admin/import");
  await expect(page.getByTestId("source-choice-99000000-0000-0000-0000-000000000001")).toHaveText(payload);
  await page.getByTestId("source-choice-99000000-0000-0000-0000-000000000001").click();
  await expect(page.getByTestId(`reference-${payload}`)).toContainText("Projection");
  await page.goto("/my-bookings");
  const appointment = page.getByTestId("booking-70000000-0000-0000-0000-000000000004");
  await appointment.getByTestId("managed-details").click();
  await expect(page.getByTestId("managed-card-label")).toHaveText(payload);
  await expect(page.getByTestId("managed-note")).toContainText(payload);
  await expect(page.getByTestId("managed-participants")).toContainText(payload);
  await page.goto("/admin/audit");
  const auditRow = page.locator('[data-testid="audit-row"][data-entry-id="72000000-0000-0000-0000-000000000099"]');
  await expect(auditRow.getByTestId("audit-subject")).toHaveText("1");
  await expect(auditRow.getByTestId("audit-actor")).toHaveText(payload);
  await expect(auditRow.getByTestId("audit-message")).toContainText(payload);
  expect(await page.evaluate(() => globalThis.__courtsideXss)).toBe("not-executed");
  expect(consoleDisclosures.some(Boolean)).toBe(false);
  await expectRenderingContexts("stored-admin", [
    "booking-card-label", "participant-card-label", "rule-set-name", "person-fields",
    "account-username", "membership-type-name", "import-source-name", "external-reference-id",
    "booking-note", "guest-name", "audit-projection"
  ]);
});

test("URL configuration rejects active schemes and renders accepted relative targets", async ({ page }) => {
  // given
  await login(page, "configuration-admin");
  await page.goto("/admin/configuration");
  await page.getByTestId("logo-url").fill("javascript:globalThis.__courtsideXss='executed'");
  await page.getByTestId("imprint-url").fill("data:text/html,cross-role");

  // when
  const rejectedResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/config") && response.request().method() === "PUT");
  await page.getByTestId("save-club-config").click();

  // then
  const rejection = await rejectedResponse;
  expect(rejection.status()).toBe(400);
  const problem = await rejection.json() as { type?: string; fieldErrors?: Array<{ field?: string; code?: string }> };
  expect(problem.type).toBe("urn:courtside:error:validation-failed");
  expect(problem.fieldErrors).toEqual(expect.arrayContaining([
    expect.objectContaining({ field: "logoUrl", code: "validation.Pattern" }),
    expect.objectContaining({ field: "imprintUrl", code: "validation.Pattern" })
  ]));
  await expect(page.locator('img[src^="javascript:"]')).toHaveCount(0);
  await expect(page.locator('a[href^="data:"]')).toHaveCount(0);

  // when
  await page.getByTestId("logo-url").fill("/icon.svg");
  await page.getByTestId("imprint-url").fill("/imprint");
  const acceptedResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/admin/config") && response.request().method() === "PUT");
  await page.getByTestId("save-club-config").click();

  // then
  expect((await acceptedResponse).status()).toBe(200);
  await expect(page.getByTestId("club-logo")).toHaveAttribute("src", "/icon.svg");
  await expect(page.locator('a[href="/imprint"]')).toHaveCount(1);
  await expectRenderingContexts("url-attributes", ["logo-url", "imprint-url"]);
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
  const events = await page.evaluate(() => globalThis.__courtsideCspEvents);
  expect(events).toContainEqual({
    directive: "script-src-elem", blocked: "inline"
  });
  await writeEvidence("browser-csp-evidence.json", {
    kind: "browser-csp", executed: false,
    events: events.filter(({ directive, blocked }) => directive === "script-src-elem" && blocked === "inline")
      .map(({ directive }) => ({ directive, blockedReason: "inline" }))
  });
});

declare global {
  var __courtsideXss: string;
  var __courtsideCspExecuted: boolean;
  var __courtsideCspEvents: Array<{ directive: string; blocked: string }>;
}
