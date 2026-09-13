import { expect, test } from "../../fixtures";
import { activate, openTheApplication, signIn, walks, writeInto } from "../../journey-walking";

test("given a member whose plans changed, when they cancel the court they booked and book another, then only the second one is left in their bookings",
  walks("session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "doe.jane");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await activate(page.locator('[data-testid="free-slot"][data-state="free"]').first());
    await writeInto(page.getByTestId("member-search"), "Major");
    await activate(page.getByTestId("member-match").first());
    await activate(page.getByTestId("booking-submit"));
    await expect(page.getByTestId("own-allocation").first()).toBeVisible();

    // when — the booking is given back
    await activate(page.getByTestId("my-bookings-link"));
    await expect(page.getByTestId("my-bookings-page")).toBeVisible();
    const booked = page.getByTestId("personal-cancel").first();
    await expect(booked).toBeVisible();
    await activate(booked);
    await activate(page.getByTestId("confirm-cancellation"));

    // then
    await expect(page.getByTestId("personal-cancel")).toHaveCount(0);

    // when — and a different slot is taken instead
    await activate(page.getByTestId("court-plan-link"));
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await activate(page.locator('[data-testid="free-slot"][data-state="free"]').first());
    await writeInto(page.getByTestId("member-search"), "Major");
    await activate(page.getByTestId("member-match").first());
    await activate(page.getByTestId("booking-submit"));

    // then
    await expect(page.getByTestId("own-allocation").first()).toBeVisible();
    await activate(page.getByTestId("my-bookings-link"));
    await expect(page.getByTestId("personal-cancel")).toHaveCount(1);
  });
