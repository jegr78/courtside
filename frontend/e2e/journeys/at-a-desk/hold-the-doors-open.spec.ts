import { expect, test } from "../../fixtures";
import { activate, openTheApplication, openTheSlot, reachAdministration, rewrite, signIn, signOut, walks } from "../../journey-walking";
import { TRAINING_CARD } from "../../shipped-rows";

test("given a board that lets training sessions keep their doors open, when a trainer checks in on today's session and checks out again, then the booking shows the doors held open and then no longer",
  walks("session-and-own-account", "facility-card-and-membership-configuration", "door-hold"), async ({ page, language }) => {
    // given — the training card may hold its doors open, from four hours before a session
    await openTheApplication(page, language);
    await signIn(page, "configuration-admin");
    await activate(page.getByTestId("administration-link"));
    await reachAdministration(page, "admin-booking-cards-link");
    await activate(page.getByTestId(`card-link-${TRAINING_CARD}`));
    await activate(page.getByTestId("card-holds-doors-open"));
    await activate(page.getByTestId("save-card"));
    await expect(page.getByTestId("admin-save-success")).toBeVisible();
    await reachAdministration(page, "admin-access-points-link");
    await rewrite(page.getByTestId("access-lead-minutes"), "240");
    await activate(page.getByTestId("save-access-settings"));
    await expect(page.getByTestId("admin-save-success")).toBeVisible();
    await signOut(page);
    await signIn(page, "trainer.doe");
    const stillFree = await openTheSlot(page, page.locator('[data-testid="free-slot"][data-state="free"]').first());
    await page.getByTestId("booking-card").selectOption(TRAINING_CARD);
    await activate(page.getByTestId("booking-submit"));
    await expect(stillFree).toHaveCount(0);

    // when
    await activate(page.getByTestId("my-bookings-link"));
    await activate(page.getByTestId("hold-doors-open").first());

    // then
    await expect(page.getByTestId("doors-held-open")).toHaveCount(1);
    await activate(page.getByTestId("end-door-hold"));
    await expect(page.getByTestId("doors-held-open")).toHaveCount(0);
  });
