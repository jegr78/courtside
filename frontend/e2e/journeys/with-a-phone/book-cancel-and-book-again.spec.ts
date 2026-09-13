import { expect, test } from "../../fixtures";
import { activate, bookingsHeld, openTheApplication, signIn, walks, writeInto } from "../../journey-walking";

test("given a member whose plans changed, when they cancel the court they booked and book another, then only the second one is left in their bookings",
  walks("session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given — what the club already holds for this member is not what this journey is about
    await openTheApplication(page, language);
    await signIn(page, "doe.jane");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await activate(page.getByTestId("my-bookings-link"));
    await expect(page.getByTestId("upcoming-bookings")).toBeVisible();
    const standing = await bookingsHeld(page, "personal-cancel");

    // when — a court is taken
    await activate(page.getByTestId("court-plan-link"));
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await activate(page.locator('[data-testid="free-slot"][data-state="free"]').first());
    await writeInto(page.getByTestId("member-search"), "Major");
    await activate(page.getByTestId("member-match").first());
    await activate(page.getByTestId("booking-submit"));
    await expect(page.getByTestId("own-allocation").first()).toBeVisible();

    // then
    await activate(page.getByTestId("my-bookings-link"));
    await expect(page.getByTestId("personal-cancel")).toHaveCount(standing.length + 1);
    const first = (await bookingsHeld(page, "personal-cancel")).find((id) => !standing.includes(id));

    // when — and given back again
    await activate(page.locator(`[data-testid="personal-cancel"][data-booking-id="${first}"]`));
    await activate(page.getByTestId("confirm-cancellation"));

    // then
    await expect(page.locator(`[data-testid="personal-cancel"][data-booking-id="${first}"]`)).toHaveCount(0);
    await expect(page.getByTestId("personal-cancel")).toHaveCount(standing.length);

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
    await expect(page.getByTestId("personal-cancel")).toHaveCount(standing.length + 1);
  });
