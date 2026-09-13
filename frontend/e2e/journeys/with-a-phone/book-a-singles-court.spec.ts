import { expect, test } from "../../fixtures";
import { activate, openTheApplication, signIn, walks, writeInto } from "../../journey-walking";

test("given two members who want a singles match, when one of them picks a free slot and records the other, then the court is theirs in the plan",
  walks("public-club-and-availability", "session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // when
    await signIn(page, "doe.jane");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await activate(page.locator('[data-testid="free-slot"][data-state="free"]').first());
    await expect(page.getByTestId("booking-dialog")).toBeVisible();
    await writeInto(page.getByTestId("member-search"), "Major");
    await activate(page.getByTestId("member-match").first());
    await activate(page.getByTestId("booking-submit"));

    // then
    await expect(page.getByTestId("booking-dialog")).not.toBeVisible();
    await expect(page.getByTestId("own-allocation").first()).toBeVisible();
  });
