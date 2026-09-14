import { expect, test } from "../../fixtures";
import { activate, openTheApplication, openTheSlot, signIn, walks } from "../../journey-walking";
import { LEAGUE_MATCH_CARD } from "../../shipped-rows";

test("given a sport director with the season's fixtures, when they put the home matches on the courts, then the club sees them as league matches and not as somebody's game",
  walks("session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "sport.major");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // when — two fixtures go onto two courts at the same hour
    for (const court of [1, 2]) {
      const stillFree = await openTheSlot(page,
        page.locator(`[data-testid="free-slot"][data-court-number="${court}"][data-state="free"]`).first());
      await page.getByTestId("booking-card").selectOption(LEAGUE_MATCH_CARD);
      await activate(page.getByTestId("booking-submit"));
      await expect(page.getByTestId("booking-dialog")).not.toBeVisible();
      await expect(stillFree).toHaveCount(0);
    }

    // then
    await activate(page.getByTestId("my-bookings-link"));
    await expect(page.getByTestId("managed-appointments-title")).toBeVisible();
    await expect(page.getByTestId("managed-bookings").getByTestId("managed-cancel")).not.toHaveCount(0);
  });
