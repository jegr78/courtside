import type { Locator, Page } from "@playwright/test";
import { expect, expectWholeValue, test } from "./fixtures";

test.use({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByTestId("username").fill("configuration-admin");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("administration-link")).toBeVisible({ timeout: 10_000 });
}

async function wordLines(value: Locator) {
  return value.evaluate((element) => {
    const node = element.firstChild!;
    return [...(node.textContent ?? "").matchAll(/\S+/g)].map((word) => {
      const range = document.createRange();
      range.setStart(node, word.index);
      range.setEnd(node, word.index + word[0].length);
      return { word: word[0], lines: new Set([...range.getClientRects()].map((rect) => rect.top)).size };
    });
  });
}

test("given a narrow desktop message log, when findings and long identifiers render, then findings keep whole words while identifiers wrap", async ({ page }) => {
  test.setTimeout(60_000);
  // given
  await page.addInitScript(() => window.localStorage.setItem("courtside.locale", "de"));
  let detailed = false;
  await page.route("**/api/admin/messages?**", (route) => route.fulfill({ json: {
    entries: [0, 1, 2].map((index) => ({
      id: `message-${index}`, queuedAt: "2026-10-23T16:53:00Z", settledAt: "2026-10-23T16:53:01Z",
      kind: "CREDENTIALS_NEW_ACCOUNT", state: detailed ? "REFUSED" : "HANDED_OVER",
      reason: detailed ? "The remote mail server refused this address because the recipient mailbox could not be found" : null, statusCode: null, messageId: `<${"identifier".repeat(24)}@example.org>`,
      personId: "22222222-2222-2222-2222-222222222222", personName: "Richard Miles"
    })), nextCursor: null
  } }));
  await signIn(page);

  // when
  await page.goto("/admin/messages");
  await expect(page.getByTestId("message-row")).toHaveCount(3, { timeout: 10_000 });

  // then
  for (const width of [1280, 1024, 900, 800]) {
    await page.setViewportSize({ width, height: 900 });
    for (const outcome of await page.getByTestId("message-outcome").all()) {
      for (const word of await wordLines(outcome)) expect(word.lines, `${width}px keeps ${word.word} whole`).toBe(1);
    }
    const identifier = page.getByTestId("message-id").first();
    const lines = await wordLines(identifier);
    expect(lines[0].lines, "the long identifier wraps instead of widening the table").toBeGreaterThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  detailed = true;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(page.getByTestId("message-row")).toHaveCount(3, { timeout: 10_000 });
  const finding = page.getByTestId("message-outcome").first();
  const words = await wordLines(finding);
  words.forEach((word) => expect(word.lines, `the detailed finding keeps ${word.word} whole`).toBe(1));
  expect(await finding.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].map((rect) => rect.top)).size;
  }), "detailed findings can still wrap at spaces").toBeGreaterThan(1);
});

test("given a phone message log, when a finding is a chain of exception types, then it wraps inside its card without widening the page", async ({ page }) => {
  test.setTimeout(60_000);
  // given
  await page.addInitScript(() => window.localStorage.setItem("courtside.locale", "de"));
  await page.route("**/api/admin/messages?**", (route) => route.fulfill({ json: {
    entries: [{
      id: "message-0", queuedAt: "2026-10-23T16:53:00Z", settledAt: "2026-10-23T16:53:01Z",
      kind: "CREDENTIALS_NEW_ACCOUNT", state: "REFUSED",
      reason: "MailSendException <- SMTPAddressFailedException", statusCode: 550, messageId: "<message-0@example.org>",
      personId: "22222222-2222-2222-2222-222222222222", personName: "Richard Miles"
    }], nextCursor: null
  } }));
  await signIn(page);

  // when
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/admin/messages");
  await expect(page.getByTestId("message-row")).toHaveCount(1, { timeout: 10_000 });

  // then
  const outcome = page.getByTestId("message-outcome");
  const row = await page.getByTestId("message-row").boundingBox();
  const box = await outcome.boundingBox();
  expect(box!.x + box!.width, "the finding stays inside its card").toBeLessThanOrEqual(row!.x + row!.width + 0.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "the page does not scroll sideways at 375px").toBeLessThanOrEqual(375);
});

async function fieldOffsets(page: Page) {
  return Promise.all(["open", "close", "closed"].map((field) => page.getByTestId(`hours-${field}-FRIDAY`).evaluate((element) => {
    const card = element.closest("article")!.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return { top: rect.top - card.top, left: rect.left - card.left };
  })));
}

for (const effectiveFrom of [null, "2099-07-01"]) {
  test(`given ${effectiveFrom ? "scheduled" : "current"} opening hours, when Saturday impact expands, then Friday fields keep their positions`, async ({ page }) => {
    test.setTimeout(60_000);
    // given
    await page.route("**/api/admin/opening-hours/schedule", (route) => route.fulfill({ json: [{
      id: "week-current", effectiveFrom: null,
      days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
        .map((dayOfWeek) => ({ dayOfWeek, opensAt: "08:00:00", closesAt: "22:00:00" }))
    }, ...(effectiveFrom ? [{
      id: "week-scheduled", effectiveFrom,
      days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
        .map((dayOfWeek) => ({ dayOfWeek, opensAt: "09:00:00", closesAt: "21:00:00" }))
    }] : [])] }));
    await page.route("**/api/admin/impact/opening-hours/SATURDAY?**", (route) => route.fulfill({ json: {
      affectedCount: 8, truncated: false, nextCursor: null,
      bookings: Array.from({ length: 8 }, (_, index) => ({ bookingId: `booking-${index}`,
        startsAt: "2099-07-04T10:00:00Z", endsAt: "2099-07-04T11:00:00Z" }))
    } }));
    await signIn(page);
    await page.goto("/admin/facility/opening-hours");
    await expect(page.getByTestId("hours-open-FRIDAY")).toBeVisible({ timeout: 10_000 });
    if (effectiveFrom) await page.getByTestId(`edit-opening-week-${effectiveFrom}`).click();
    const before = await fieldOffsets(page);

    // when
    await page.getByTestId("opening-hours-impact-SATURDAY").click();
    await expect(page.getByTestId("impact-SATURDAY")).toBeVisible({ timeout: 10_000 });

    // then
    const after = await fieldOffsets(page);
    after.forEach((position, index) => {
      expect(position.top).toBeCloseTo(before[index].top, 0);
      expect(position.left).toBeCloseTo(before[index].left, 0);
    });
  });
}

const LANGUAGES = { de: "German", en: "English" } as const;

for (const { viewport, language, typeName, ruleSetName } of [
  { viewport: { width: 1440, height: 900 }, language: "de", typeName: "Acceptance training members", ruleSetName: "Acceptance training rule set" },
  { viewport: { width: 1440, height: 900 }, language: "en", typeName: "Acceptance training members", ruleSetName: "Acceptance training rule set" },
  { viewport: { width: 1280, height: 800 }, language: "de", typeName: "Acceptance training members", ruleSetName: "Acceptance training rule set" },
  { viewport: { width: 1280, height: 800 }, language: "en", typeName: "Acceptance training members", ruleSetName: "Acceptance training rule set" },
  { viewport: { width: 820, height: 1180 }, language: "de", typeName: "Acceptance members", ruleSetName: "Acceptance youth" },
  { viewport: { width: 412, height: 915 }, language: "de", typeName: "Acceptance members", ruleSetName: "Acceptance youth" }
] as const) {
  test(`given ${LANGUAGES[language]} membership types at ${viewport.width}px, when the table renders, then every name and rule set shows its whole value`, async ({ page }) => {
    test.setTimeout(60_000);
    // given
    const typeId = "44444444-4444-4444-4444-444444444441";
    const ruleSet = { id: "33333333-3333-3333-3333-333333333331", name: ruleSetName, active: true };
    await page.route("**/api/admin/membership-types", (route) => route.fulfill({ json: [
      { id: typeId, name: typeName, active: true, grantsAccount: true, ruleSetId: ruleSet.id }
    ] }));
    await page.route("**/api/admin/rule-sets", (route) => route.fulfill({ json: [ruleSet] }));
    await page.route("**/api/admin/roster?**", (route) => route.fulfill({ json: { entries: [], matching: 0 } }));
    await page.addInitScript((locale) => window.localStorage.setItem("courtside.locale", locale), language);
    await page.setViewportSize(viewport);
    await signIn(page);

    // when
    await page.goto("/admin/membership-types");
    await expect(page.getByTestId(`membership-type-holders-${typeId}`)).toHaveText("0", { timeout: 10_000 });

    // then
    await expectWholeValue(page.getByTestId(`membership-type-name-${typeId}`), "the type name");
    await expectWholeValue(page.getByTestId(`membership-type-rule-set-${typeId}`), "the bound rule set");
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "the page does not scroll sideways").toBeLessThanOrEqual(viewport.width);
  });
}

for (const { width, language } of [{ width: 1440, language: "de" }, { width: 1440, language: "en" }, { width: 1280, language: "de" }, { width: 1280, language: "en" }] as const) {
  test(`given ${LANGUAGES[language]} booking rules at ${width}px, when a long rule set governs people without a membership type, then its select shows the whole name`, async ({ page }) => {
    test.setTimeout(60_000);
    // given
    await page.addInitScript((locale) => window.localStorage.setItem("courtside.locale", locale), language);
    await page.setViewportSize({ width, height: 1000 });
    await signIn(page);
    const sets = await page.evaluate(() => fetch("/api/admin/rule-sets").then((answer) => answer.json())) as { id: string; active: boolean }[];
    const renamed = sets.find((set) => set.active)!.id;
    await page.route("**/api/admin/rule-sets", (route) => route.request().method() === "GET"
      ? route.fulfill({ json: sets.map((set) => set.id === renamed ? { ...set, name: "Acceptance without a membership type" } : set) })
      : route.continue());
    await page.goto("/admin/rule-sets");
    await expect(page.getByTestId("rule-ADVANCE_WINDOW-maxDays")).toBeEnabled({ timeout: 10_000 });

    // when
    await page.getByTestId("no-membership-type-rule-set").selectOption(renamed);

    // then
    await expectWholeValue(page.getByTestId("no-membership-type-rule-set"), "the rule set for people without a membership type");
    expect(await page.evaluate(() => document.documentElement.scrollWidth), "the page does not scroll sideways").toBeLessThanOrEqual(width);
  });
}

test("given a tablet change log, when an entry names its actor by a dotted username, then the username stays on one line", async ({ page }) => {
  test.setTimeout(60_000);
  // given
  await page.route("**/api/admin/audit?**", (route) => route.fulfill({ json: { entries: [{
    id: "audit-0", occurredAt: "2026-10-25T07:16:44Z", eventType: "booking.booking.cancelled", parameters: {},
    subjectId: "55555555-5555-5555-5555-555555555555", subjectName: "Centre Court, Back Court",
    actorAccountId: "66666666-6666-6666-6666-666666666666", actorUsername: "richard.miles"
  }], nextCursor: null } }));
  await page.setViewportSize({ width: 820, height: 1180 });
  await signIn(page);

  // when
  await page.goto("/admin/audit");
  await expect(page.getByTestId("audit-row")).toHaveCount(1, { timeout: 10_000 });

  // then
  const actor = page.getByTestId("audit-actor");
  await expect(actor).toHaveText("richard.miles");
  expect(await actor.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  }), "the username is not broken inside").toBe(1);
});
