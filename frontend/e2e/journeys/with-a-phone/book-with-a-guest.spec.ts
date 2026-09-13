import { expect, test } from "../../fixtures";
import { activate, openTheApplication, signIn, walks, writeInto } from "../../journey-walking";

test("given a member bringing somebody who is not in the club, when they name that guest on the booking, then the court is theirs and the club knows who was on it",
  walks("session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "doe.jane");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // when
    await activate(page.locator('[data-testid="free-slot"][data-state="free"]').first());
    await expect(page.getByTestId("booking-dialog")).toBeVisible();
    await activate(page.getByTestId("booking-more-summary"));
    await writeInto(page.getByTestId("guest-name"), "Richard Roe");
    await activate(page.getByTestId("booking-submit"));

    // then
    await expect(page.getByTestId("booking-dialog")).not.toBeVisible();
    await expect(page.getByTestId("own-allocation").first()).toBeVisible();
  });
