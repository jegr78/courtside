import { expect, selectJourneyDate, test } from "./fixtures";
import { STANDARD_RULE_SET } from "./shipped-rows";

const BOOKING_HOURS_RULE = "bbbbbbbb-0000-0000-0000-000000000098";

function freeSlot(page: import("@playwright/test").Page, court: number, slot: string) {
  return page.locator(`[data-testid="free-slot"][data-court-number="${court}"][data-slot="${slot}"][data-state="free"]`);
}

test("a member whose rule set limits the booking hours sees the window before booking and books inside it",
  async ({ page, journeyService }) => {
    // given
    await journeyService.executeSql(`
      INSERT INTO rule_definition (id, rule_set_id, rule_type, params)
      VALUES ('${BOOKING_HOURS_RULE}', '${STANDARD_RULE_SET}', 'BOOKING_HOURS',
        '{"earliestStart": 540, "latestEnd": 780}'::jsonb)
    `);
    try {
      await page.goto("/login");
      await page.getByTestId("username").fill("doe.jane");
      await page.getByTestId("password").fill("temporary-password");
      await page.getByTestId("login-submit").click();
      await expect(page.getByTestId("court-plan-view")).toBeVisible({ timeout: 10_000 });
      await selectJourneyDate(page, journeyService.visualDate);
      const outside = freeSlot(page, 3, "16:00");
      await expect(outside).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId("slot-heading-16:00"), "the English time axis reads twelve-hour times").toHaveText("4:00 PM");
      const overflowing = await page.locator('[data-testid^="slot-heading-"]').evaluateAll((headings) => headings
        .filter((heading) => {
          const range = document.createRange();
          range.selectNodeContents(heading);
          return range.getBoundingClientRect().right > heading.getBoundingClientRect().right;
        })
        .map((heading) => heading.getAttribute("data-testid")));
      expect(overflowing, "every twelve-hour time fits the desktop time column").toEqual([]);

      // when
      await outside.click();

      // then
      await expect(page.getByTestId("booking-outside-hours"), "the refusal names the window before any submit")
        .toHaveText("Your membership type may book only between 9:00 AM and 1:00 PM.", { timeout: 10_000 });
      await expect(page.getByTestId("booking-submit")).toBeDisabled({ timeout: 10_000 });

      // when
      await page.getByTestId("booking-close").click();
      const inside = freeSlot(page, 2, "12:00");
      await expect(inside).toBeVisible({ timeout: 10_000 });
      await inside.click();

      // then
      await expect(page.getByTestId("booking-hours-bound"))
        .toHaveText("Your membership type books between 9:00 AM and 1:00 PM.", { timeout: 10_000 });
      await expect(page.getByTestId("booking-outside-hours")).toHaveCount(0, { timeout: 10_000 });

      // when
      await page.getByTestId("member-search").fill("Mary");
      await page.getByTestId("member-match").click();
      await page.getByTestId("booking-submit").click();

      // then
      await expect(page.getByTestId("own-allocation"), "a slot inside the window is still booked")
        .toBeVisible({ timeout: 10_000 });
    } finally {
      await journeyService.executeSql(`DELETE FROM rule_definition WHERE id = '${BOOKING_HOURS_RULE}'`);
    }
  });
