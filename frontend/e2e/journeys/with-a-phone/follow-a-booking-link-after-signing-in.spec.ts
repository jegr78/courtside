import { expect, test } from "../../fixtures";
import { activate, openTheApplication, openTheLink, signIn, signOut, walks } from "../../journey-walking";

test("given a signed-out member who opens a link to one of their bookings, when they sign in, then that booking is in view",
  walks("session-and-own-account"), async ({ page, language }) => {
    // given — the member knows a booking of theirs that sits below the first screen
    await openTheApplication(page, language);
    await signIn(page, "doe.jane");
    await expect(page.getByTestId("court-plan-view")).toBeVisible({ timeout: 10_000 });
    await activate(page.getByTestId("my-bookings-link"));
    await expect(page.getByTestId("participations-title")).toBeVisible({ timeout: 10_000 });
    const anchor = await page.locator('li[id^="booking-"]').last().getAttribute("id");
    expect(anchor, "the member holds at least one booking to link to").not.toBeNull();
    await signOut(page);

    // when
    await openTheLink(page, language, `/my-bookings#${anchor}`);

    // then — the club asks who they are first
    await expect(page.getByTestId("login-view")).toBeVisible({ timeout: 10_000 });

    // when
    await signIn(page, "doe.jane");

    // then
    await expect(page, "sign-in returns to the address the link named")
      .toHaveURL(new RegExp(`/my-bookings#${anchor}$`), { timeout: 10_000 });
    const booking = page.locator(`[id="${anchor}"]`);
    await expect(booking, "the linked booking is scrolled into view").toBeInViewport({ timeout: 10_000 });
    await expect(booking).toBeFocused({ timeout: 10_000 });
  });
