import { expect, test } from "../../fixtures";
import { activate, openTheApplication, openTheSlot, signIn, walks } from "../../journey-walking";

test("given a groundskeeper standing on a waterlogged court, when they close it on the card the club keeps for that, then the slot is no longer one a member can take",
  walks("session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "keeper.roe");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // when
    const stillFree = await openTheSlot(page, page.locator('[data-testid="free-slot"][data-state="free"]').first());
    await page.getByTestId("booking-card").selectOption({ label: "Court closed" });
    await activate(page.getByTestId("booking-submit"));

    // then
    await expect(page.getByTestId("booking-dialog")).not.toBeVisible();
    await expect(stillFree).toHaveCount(0);
    await activate(page.getByTestId("my-bookings-link"));
    await expect(page.getByTestId("managed-appointments-title")).toBeVisible();
  });
