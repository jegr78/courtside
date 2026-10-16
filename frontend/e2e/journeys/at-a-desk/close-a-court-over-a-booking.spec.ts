import { expect, test } from "../../fixtures";
import {
  activate, openTheApplication, reachAdministration, signIn, signOut, walks, writeDate, writeInto
} from "../../journey-walking";

const COURT_TWO = "dddddddd-0000-0000-0000-000000000002";

function daysAfter(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("given a member's booking on a court the club must close for a day, when the board closes it, then the board sees the booking it affects before saving and the member is told",
  walks("session-and-own-account", "facility-card-and-membership-configuration",
    "administrative-impact-reporting-and-records"),
  async ({ page, language, journeyService }) => {
    // given — Jane Doe plays on court 2 two days after the plan's day
    const closedDay = daysAfter(journeyService.visualDate, 2);
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await reachAdministration(page, "admin-opening-hours-link");
    await activate(page.getByTestId("opening-hours-exceptions-link"));
    await expect(page.getByTestId("court-closure-form")).toBeVisible();

    // when — the board describes the closure
    await page.getByTestId("court-closure-court").selectOption(COURT_TWO);
    await writeInto(page.getByTestId("court-closure-name"), "Net replacement");
    await writeDate(page.getByTestId("court-closure-starts-on"), closedDay);
    await writeDate(page.getByTestId("court-closure-ends-on"), closedDay);

    // then — before anything is stored, it says the booking stays and its people are told
    await expect(page.getByTestId("court-closure-affected")).toContainText("1");

    // when
    await activate(page.getByTestId("save-court-closure"));

    // then
    await expect(page.getByTestId("admin-save-success")).toBeVisible();
    await expect(page.getByTestId("court-closures")).toBeVisible();
    await expect(page.getByTestId("court-closure-affected")).toHaveCount(0);

    // when — the member opens their messages
    await signOut(page);
    await signIn(page, "doe.jane");
    await activate(page.getByTestId("my-messages-link"));

    // then
    const notice = page.locator('[data-testid^="notification-"][data-closure="COURT_CLOSED"]');
    await expect(notice).toHaveCount(1);
    await expect(notice.getByTestId("notification-summary"), "the board's own reason stays with the board")
      .not.toContainText("Net replacement");
  });
