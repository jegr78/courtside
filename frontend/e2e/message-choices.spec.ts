import { expect, selectJourneyDate, test } from "./fixtures";
import { messageTo, messagesTo } from "./mailbox";

const janeRoe = "00000000-0000-0000-0000-000000000115";

test("a member switches confirmations off, and the booking they make no longer writes to them", async ({ page, journeyService }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  const beforeTheChoice = (await messagesTo(journeyService.mailboxURL, "jane.doe@example.org")).length;

  // when — the confirmation is switched off, and what the club must send stays out of reach
  await page.getByTestId("my-messages-link").click();
  await expect(page.getByTestId("my-messages-view")).toBeVisible();
  await expect(page.getByTestId("message-choice-CREDENTIALS_NEW_ACCOUNT")).toBeDisabled();
  await expect(page.getByTestId("message-choice-BOOKING_PLAYER_RECORDED")).toBeDisabled();
  await page.getByTestId("message-choice-BOOKING_CONFIRMED").uncheck();
  await page.getByTestId("my-messages-save").click();
  await expect(page.getByTestId("my-messages-saved")).toBeVisible();

  // then — the choice is what the next visit reads, not what this page happens to hold
  await page.reload();
  await expect(page.getByTestId("message-choice-BOOKING_CONFIRMED")).not.toBeChecked();
  await expect(page.getByTestId("message-choice-BOOKING_REMINDER")).toBeChecked();

  // when — the player's message is the signal that the booking's mail has been worked through. It
  // does not order the two: they are separate listeners on a two-to-four thread pool.
  await page.getByTestId("court-plan-link").click();
  await selectJourneyDate(page, journeyService.visualDate);
  await page.locator('[data-testid="free-slot"][data-court-number="3"][data-slot="15:00"][data-state="free"]').click();
  await page.getByTestId("member-search").fill("Roe");
  await page.locator(`[data-testid="member-match"][data-person-id="${janeRoe}"]`).click();
  await page.getByTestId("booking-submit").click();
  await expect(page.locator('tr[data-slot="15:00"] [data-testid="own-allocation"]')).toBeVisible();

  // then — that a declined kind is dropped is DeclinedMessageTest's claim; what this proves is the
  // path a member walks to make the choice stick.
  await messageTo(journeyService.mailboxURL, "jane.roe@example.org");
  expect(await messagesTo(journeyService.mailboxURL, "jane.doe@example.org"))
    .toHaveLength(beforeTheChoice);
});
