import { expect, test } from "../../fixtures";
import { activate, openTheApplication, rewrite, signIn, walks, writeDate, writeTime } from "../../journey-walking";

test("given a trainer arranging the term, when they describe a weekly session once and look at what it would create before confirming it, then every appointment is in the list they manage",
  walks("session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "trainer.doe");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await activate(page.getByTestId("my-bookings-link"));

    // when — the term is described once
    await activate(page.getByTestId("new-series"));
    await page.getByTestId("series-courts").selectOption({ index: 0 });
    await page.getByTestId("series-card").selectOption({ label: "Training" });
    await writeDate(page.getByTestId("series-starts-on"), "2026-05-18");
    await writeTime(page.getByTestId("series-start-time"), "18:00");
    await activate(page.getByTestId("series-weekday-MONDAY"));
    await rewrite(page.getByTestId("series-occurrence-count"), "3");

    // then — and what it would create is shown before anything is
    await activate(page.getByTestId("preview-series"));
    await expect(page.getByTestId("series-occurrence-2")).toBeVisible();

    // when
    await activate(page.getByTestId("confirm-series"));

    // then
    await expect(page.getByTestId("series-created")).toBeVisible();
    await expect(page.getByTestId("managed-bookings").getByTestId("series-marker").first()).toBeVisible();
  });
