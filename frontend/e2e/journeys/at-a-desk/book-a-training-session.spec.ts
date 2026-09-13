import { expect, test } from "../../fixtures";
import { activate, openTheApplication, openTheSlot, signIn, walks } from "../../journey-walking";

test("given a trainer with one session to arrange, when they take a free slot on the training card, then the court is held for the session and not for a member's game",
  walks("session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "trainer.doe");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // when
    const stillFree = await openTheSlot(page, page.locator('[data-testid="free-slot"][data-state="free"]').first());
    await page.getByTestId("booking-card").selectOption({ label: "Training" });
    await activate(page.getByTestId("booking-submit"));

    // then
    await expect(page.getByTestId("booking-dialog")).not.toBeVisible();
    await expect(stillFree).toHaveCount(0);
    await activate(page.getByTestId("my-bookings-link"));
    await expect(page.getByTestId("managed-appointments-title")).toBeVisible();
  });
