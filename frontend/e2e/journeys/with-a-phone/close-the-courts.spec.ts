import { expect, test } from "../../fixtures";
import { activate, openTheApplication, openTheSlot, reachAdministration, signIn, walks } from "../../journey-walking";
import { COURT_CLOSED_CARD } from "../../shipped-rows";

test("given a groundskeeper standing on a waterlogged court, when they close it on the card the club keeps for that, then the slot is no longer one a member can take and the door codes are at hand",
  walks("session-and-own-account", "booking-participation-and-series", "grounds-door-codes"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "keeper.roe");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // when
    const stillFree = await openTheSlot(page, page.locator('[data-testid="free-slot"][data-state="free"]').first());
    await page.getByTestId("booking-card").selectOption(COURT_CLOSED_CARD);
    await activate(page.getByTestId("booking-submit"));

    // then
    await expect(page.getByTestId("booking-dialog")).not.toBeVisible();
    await expect(stillFree).toHaveCount(0);
    await activate(page.getByTestId("administration-link"));
    await expect(page.getByTestId("managed-appointments-title")).toBeVisible();
    await reachAdministration(page, "admin-door-codes-link");
    await expect(page.getByTestId("admin-door-codes-view")).toBeVisible();
    await expect(page.getByTestId("door-codes-empty"), "the read is allowed and the club keeps no door yet").toBeVisible();
    await expect(page.getByTestId("door-codes-error")).toHaveCount(0);
    await expect(page.getByTestId("admin-access-points-link"), "a groundskeeper changes no door").toHaveCount(0);
  });
