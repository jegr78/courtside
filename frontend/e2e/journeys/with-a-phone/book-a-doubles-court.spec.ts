import { expect, test } from "../../fixtures";
import { activate, openTheApplication, walks, writeInto } from "../../journey-walking";

test("given four members who want to play doubles, when they open the application and record the three others they are playing with, then the doubles stands in the plan",
  walks("public-club-and-availability", "session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await expect(page.getByTestId("public-club-name")).toBeVisible();

    // when
    await activate(page.getByTestId("sign-in-link"));
    await expect(page.getByTestId("login-view")).toBeVisible();
    await writeInto(page.getByTestId("username"), "doe.jane");
    await writeInto(page.getByTestId("password"), "temporary-password");
    await activate(page.getByTestId("login-submit"));

    // then
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // when
    const slot = page.locator('[data-testid="free-slot"][data-state="free"]').first();
    await activate(slot);

    // then
    await expect(page.getByTestId("booking-dialog")).toBeVisible();

    // when
    // Two members share the name Roe, so the second search finds the one the first did not take.
    for (const coPlayer of ["Major", "Roe", "Roe"]) {
      await writeInto(page.getByTestId("member-search"), coPlayer);
      const match = page.getByTestId("member-match").first();
      await expect(match).toBeVisible();
      await activate(match);
    }
    await activate(page.getByTestId("booking-submit"));

    // then
    await expect(page.getByTestId("booking-dialog")).not.toBeVisible();
    await expect(page.getByTestId("own-allocation").first()).toBeVisible();
  });
