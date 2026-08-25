import { expect, selectJourneyDate, test } from "./fixtures";
import { messageTo } from "./mailbox";

const withdrawalBooking = "70000000-0000-0000-0000-000000000007";
const janeRoe = "00000000-0000-0000-0000-000000000115";

test("a member takes themselves out of a booking somebody else recorded them in", async ({ page }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await page.getByTestId("my-bookings-link").click();
  const participation = page.getByTestId(`participation-${withdrawalBooking}`);
  await expect(participation).toBeVisible();

  // when
  await participation.getByTestId("withdraw-participation").click();

  // then
  await expect(participation).toHaveCount(0);
});

test("being recorded as a player is told, and so is leaving one", async ({ page, journeyService }) => {
  // given
  await page.goto("/login");
  await page.getByTestId("username").fill("doe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await selectJourneyDate(page, journeyService.visualDate);

  // when — somebody is recorded without being asked
  await page.locator('[data-testid="free-slot"][data-court-number="3"][data-slot="13:00"][data-state="free"]').click();
  await page.getByTestId("member-search").fill("Roe");
  await page.locator(`[data-testid="member-match"][data-person-id="${janeRoe}"]`).click();
  await page.getByTestId("booking-submit").click();
  await expect(page.locator('tr[data-slot="13:00"] [data-testid="own-allocation"]')).toBeVisible();

  // then — the notice names the booking and not who made it, as the participation list does not
  const notice = await messageTo(journeyService.mailboxURL, "jane.roe@example.org");
  expect(notice.Text).toContain("13:00");
  expect(notice.Text).not.toContain("Doe");

  // when — the member takes themselves out again
  await page.getByTestId("logout").click();
  await expect(page.getByTestId("login-view")).toBeVisible();
  await page.getByTestId("username").fill("roe.jane");
  await page.getByTestId("password").fill("temporary-password");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("court-plan-view")).toBeVisible();
  await page.getByTestId("my-bookings-link").click();
  // The one booking this member is recorded in, and the seeded ones record somebody else.
  await page.getByTestId("withdraw-participation").click();
  await expect(page.getByTestId("withdraw-participation")).toHaveCount(0);

  // then — the booker chose the name, so the message may carry it
  await expect
    .poll(async () => (await messageTo(journeyService.mailboxURL, "jane.doe@example.org")).Text)
    .toContain("Jane Roe");
});
