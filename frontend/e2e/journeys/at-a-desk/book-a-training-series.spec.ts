import { expect, test } from "../../fixtures";
import { activate, openTheApplication, rewrite, signIn, walks, writeDate, writeTime } from "../../journey-walking";
import { TRAINING_CARD } from "../../shipped-rows";

test("given a sport director arranging the term, when they describe a weekly session once and look at what it would create before confirming it, then every appointment is in the list they manage",
  walks("session-and-own-account", "booking-participation-and-series"), async ({ page, language }) => {
    // given
    await openTheApplication(page, language);
    await signIn(page, "sport.major");
    await expect(page.getByTestId("court-plan-view")).toBeVisible();
    await activate(page.getByTestId("administration-link"));
    await expect(page.getByTestId("managed-appointments-page")).toBeVisible();

    // when — the term is described once
    await activate(page.getByTestId("new-series"));
    await page.getByTestId("series-courts").selectOption({ index: 0 });
    await page.getByTestId("series-card").selectOption(TRAINING_CARD);
    await writeDate(page.getByTestId("series-starts-on"), "2026-05-18");
    await writeTime(page.getByTestId("series-start-time"), "18:00");
    await activate(page.getByTestId("series-weekday-MONDAY"));
    await rewrite(page.getByTestId("series-occurrence-count"), "3");

    // then — and what it would create is shown before anything is
    await activate(page.getByTestId("preview-series"));
    await expect(page.getByTestId("series-occurrence-2")).toBeVisible();

    // when
    const created = page.waitForResponse((response) =>
      response.url().endsWith("/api/booking-series") && response.request().method() === "POST");
    await activate(page.getByTestId("confirm-series"));
    const { bookingIds } = await (await created).json() as { bookingIds: string[] };

    // then
    expect(bookingIds).toHaveLength(3);
    await expect(page.getByTestId("series-created")).toBeVisible();
    const series = page.locator("details").filter({ has: page.getByTestId(`booking-${bookingIds[0]}`) });
    await activate(series.getByTestId("managed-series-summary"));
    for (const bookingId of bookingIds) {
      await expect(page.getByTestId(`booking-${bookingId}`).getByTestId("series-marker")).toBeVisible();
    }
  });
