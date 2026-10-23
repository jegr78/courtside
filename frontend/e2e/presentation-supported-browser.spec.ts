import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

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
