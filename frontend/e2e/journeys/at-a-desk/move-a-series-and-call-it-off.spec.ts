import { expect, test } from "../../fixtures";
import { activate, openTheApplication, signIn, walks, writeDate, writeInto, writeTime } from "../../journey-walking";

test("given a trainer whose hall time moved, when they shift one appointment of the series and later call the whole series off, then the club's plan follows both decisions",
  walks("session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given — a series to change
    await openTheApplication(page, language);
    await signIn(page, "trainer.doe");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await activate(page.getByTestId("my-bookings-link"));
    await activate(page.getByTestId("new-series"));
    await page.getByTestId("series-courts").selectOption({ index: 0 });
    await page.getByTestId("series-card").selectOption({ label: "Training" });
    await writeDate(page.getByTestId("series-starts-on"), "2026-05-18");
    await writeTime(page.getByTestId("series-start-time"), "18:00");
    await activate(page.getByTestId("series-weekday-MONDAY"));
    await writeInto(page.getByTestId("series-occurrence-count"), "3");
    await activate(page.getByTestId("preview-series"));
    await activate(page.getByTestId("confirm-series"));
    await expect(page.getByTestId("series-created")).toBeVisible();

    // when — one appointment moves an hour later
    await activate(page.getByTestId("move-booking").first());
    await expect(page.getByTestId("move-dialog")).toBeVisible();
    await writeTime(page.getByTestId("move-start-time"), "19:00");
    await activate(page.getByTestId("preview-move"));
    await activate(page.getByTestId("confirm-move"));

    // then
    await expect(page.getByTestId("move-dialog")).not.toBeVisible();

    // when — and the rest of the term is called off in one go
    await activate(page.getByTestId("managed-cancel").first());
    await activate(page.getByTestId("scope-SERIES"));
    await activate(page.getByTestId("confirm-cancellation"));

    // then
    await expect(page.getByTestId("managed-cancel")).toHaveCount(0);
  });
