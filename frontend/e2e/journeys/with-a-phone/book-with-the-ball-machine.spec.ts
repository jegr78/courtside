import { expect, test } from "../../fixtures";
import { activate, openTheApplication, openTheSlot, signIn, walks } from "../../journey-walking";

test("given a member who wants to practise against the ball machine, when they record it as what else is on the court, then the booking stands with a player the club does not have to name",
  walks("session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "doe.jane");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // when
    const stillFree = await openTheSlot(page, page.locator('[data-testid="free-slot"][data-state="free"]').first());
    // The member booking card allows two or four players and the machine is one of them, so the
    // member practising against it is the whole booking.
    await activate(page.getByTestId("booking-more-summary"));
    await page.getByTestId("participant-card").selectOption({ label: "Ball machine" });
    await activate(page.getByTestId("booking-submit"));

    // then
    await expect(page.getByTestId("booking-dialog")).not.toBeVisible();
    await expect(stillFree).toHaveCount(0);
    await expect(page.getByTestId("own-allocation").first()).toBeVisible();
  });
