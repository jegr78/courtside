import { expect, test } from "../../fixtures";
import { activate, bookingsHeld, openTheApplication, rewrite, signIn, walks, writeDate, writeTime } from "../../journey-walking";
import { TRAINING_CARD } from "../../shipped-rows";

test("given a trainer whose hall time moved, when they shift one appointment of the series and later call the whole series off, then the club's plan follows both decisions",
  walks("session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given — the appointments the trainer already looks after are not the ones this journey moves
    await openTheApplication(page, language);
    await signIn(page, "trainer.doe");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await activate(page.getByTestId("my-bookings-link"));
    await expect(page.getByTestId("managed-bookings")).toBeVisible();
    const standing = await bookingsHeld(page, "managed-cancel");

    // when — a term of three is arranged
    await activate(page.getByTestId("new-series"));
    await page.getByTestId("series-courts").selectOption({ index: 0 });
    await page.getByTestId("series-card").selectOption(TRAINING_CARD);
    await writeDate(page.getByTestId("series-starts-on"), "2026-05-18");
    await writeTime(page.getByTestId("series-start-time"), "18:00");
    await activate(page.getByTestId("series-weekday-MONDAY"));
    await rewrite(page.getByTestId("series-occurrence-count"), "3");
    await activate(page.getByTestId("preview-series"));
    await activate(page.getByTestId("confirm-series"));
    await expect(page.getByTestId("series-created")).toBeVisible();

    // then
    await expect(page.getByTestId("managed-cancel")).toHaveCount(standing.length + 3);
    const term = (await bookingsHeld(page, "managed-cancel")).filter((id) => !standing.includes(id));

    // when — one appointment moves an hour later
    await activate(page.getByTestId("managed-bookings")
      .locator(`[data-testid="move-booking"][data-booking-id="${term[0]}"]`));
    await expect(page.getByTestId("move-dialog")).toBeVisible();
    await writeTime(page.getByTestId("move-start-time"), "19:00");
    await activate(page.getByTestId("preview-move"));
    await activate(page.getByTestId("confirm-move"));

    // then
    await expect(page.getByTestId("move-dialog")).not.toBeVisible();

    // when — and the rest of the term is called off in one go
    await activate(page.locator(`[data-testid="managed-cancel"][data-booking-id="${term[1]}"]`));
    await activate(page.getByTestId("scope-WHOLE_SERIES"));
    await activate(page.getByTestId("confirm-cancellation"));

    // then — the appointment that moved belongs to the series and goes with it
    await expect(page.getByTestId("managed-cancel")).toHaveCount(standing.length);
  });
