import { expect, test } from "../../fixtures";
import { activate, openTheApplication, signIn, walks } from "../../journey-walking";

test("given a member somebody else recorded as a player, when they read their own bookings and participations, then they can take themselves out of that booking",
  walks("session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "doe.jane");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();

    // when
    await activate(page.getByTestId("my-bookings-link"));

    // then — the page shows what this member booked and what they were recorded in
    await expect(page.getByTestId("my-bookings-page")).toBeVisible();
    await expect(page.getByTestId("my-bookings-title")).toBeVisible();
    await expect(page.getByTestId("participations-title")).toBeVisible();
    const recorded = page.getByTestId("withdraw-participation");
    await expect(recorded.first()).toBeVisible();
    const before = await recorded.count();

    // when
    await activate(recorded.first());

    // then — the one they left is gone, and the others they agreed to are untouched
    await expect(recorded).toHaveCount(before - 1);
  });
