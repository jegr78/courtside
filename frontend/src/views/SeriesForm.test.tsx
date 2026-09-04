import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type PublicCourt, type SeriesPreview } from "../api/client";
import i18n from "../i18n";
import { SeriesForm } from "./SeriesForm";

const courts: PublicCourt[] = [
  { id: "court-1", number: 1, name: "Centre Court" },
  { id: "court-2", number: 2, name: null }
];

const preview: SeriesPreview = {
  creatableCount: 2, truncatedByHorizon: false, horizonLimit: null,
  occurrences: [
    { startsAt: "2026-09-07T16:00:00Z", endsAt: "2026-09-07T17:00:00Z", blockedCourtIds: [], violations: [], creatable: true },
    { startsAt: "2026-09-14T16:00:00Z", endsAt: "2026-09-14T17:00:00Z", blockedCourtIds: [], violations: [], creatable: true }
  ]
};

function show(created = vi.fn().mockResolvedValue(undefined)) {
  render(<SeriesForm timeZone="Europe/Berlin" courts={courts} created={created} reportError={vi.fn()} />);
  return created;
}

async function describeRule(): Promise<void> {
  await userEvent.click(await screen.findByTestId("new-series"));
  await userEvent.selectOptions(await screen.findByTestId("series-courts"), ["court-1"]);
  await userEvent.selectOptions(await screen.findByTestId("series-card"), ["card-1"]);
  await userEvent.type(screen.getByTestId("series-starts-on"), "2026-09-07");
  await userEvent.type(screen.getByTestId("series-start-time"), "18:00");
  await userEvent.click(screen.getByTestId("series-weekday-MONDAY"));
}

describe("SeriesForm", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "bookingCards").mockResolvedValue([
      { id: "card-1", label: "Training", color: "#b85c38", allowedPlayerCounts: [], guestAllowed: false }
    ]);
  });

  it("given a court without a name, when the form opens, then its number uses the product vocabulary", async () => {
    // given
    show();

    // when
    await userEvent.click(await screen.findByTestId("new-series"));

    // then
    const unnamed = screen.getByTestId("series-courts")
      .querySelector<HTMLOptionElement>('option[value="court-2"]');
    expect(unnamed).toHaveTextContent("Court 2");
    expect(unnamed).not.toHaveTextContent(/^2$/);
  });

  it("given focus inside the series form, when the form is cancelled, then focus returns to its opener", async () => {
    // given
    show();
    const opener = await screen.findByTestId("new-series");
    await userEvent.click(opener);
    const cancel = screen.getByTestId("cancel-series");
    cancel.focus();

    // when
    await userEvent.click(cancel);

    // then
    expect(screen.getByTestId("new-series")).toHaveFocus();
  });

  it("given a rule set bounds the booking duration, when the form opens, then the duration field carries that ceiling", async () => {
    // given
    vi.spyOn(api, "bookingEligibility").mockResolvedValue({ violations: [], maxBookingMinutes: 90 });

    // when
    show();
    await userEvent.click(await screen.findByTestId("new-series"));

    // then
    await waitFor(() => expect(screen.getByTestId("series-duration")).toHaveAttribute("max", "90"));
  });

  it("given no bound is reported, when the form opens, then the duration field keeps the day-long ceiling", async () => {
    // given — absence must leave the form exactly as it was
    vi.spyOn(api, "bookingEligibility").mockResolvedValue({ violations: [] });

    // when
    show();
    await userEvent.click(await screen.findByTestId("new-series"));

    // then
    await waitFor(() => expect(screen.getByTestId("series-duration")).toHaveAttribute("max", "1440"));
  });

  it("given a rule nobody has previewed, when the form is read, then there is nothing to confirm", async () => {
    // given / when
    show();
    await describeRule();

    // then — previewing is mandatory, so the create control does not exist before one was read
    expect(screen.queryByTestId("confirm-series")).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-series")).toBeEnabled();
  });

  it("given previewed occurrences, when one is dropped, then only the confirmed starts are created", async () => {
    // given
    vi.spyOn(api, "previewSeries").mockResolvedValue(preview);
    const creating = vi.spyOn(api, "createSeries")
      .mockResolvedValue({ seriesId: "series-1", bookingIds: ["booking-1"], skipped: [] });
    show();
    await describeRule();
    await userEvent.click(screen.getByTestId("preview-series"));

    // when
    await userEvent.click(await screen.findByTestId("series-occurrence-chosen-1"));
    await userEvent.click(screen.getByTestId("confirm-series"));

    // then — the rule travels again, but what is written is exactly what was offered and kept
    expect(creating).toHaveBeenCalledWith(expect.objectContaining({
      cardId: "card-1", courtIds: ["court-1"], confirmedStarts: ["2026-09-07T16:00:00Z"]
    }));
  });

  it("given an occurrence a rule blocks, when the preview is read, then it names the rule and cannot be confirmed", async () => {
    // given
    vi.spyOn(api, "previewSeries").mockResolvedValue({
      creatableCount: 1, truncatedByHorizon: false, horizonLimit: null,
      occurrences: [
        preview.occurrences[0],
        {
          startsAt: "2026-09-14T16:00:00Z", endsAt: "2026-09-14T17:00:00Z", blockedCourtIds: ["court-1"],
          violations: [{ code: "booking.rule.advanceWindow.exceeded", params: { maxDays: 14 } }], creatable: false
        }
      ]
    });
    show();
    await describeRule();

    // when
    await userEvent.click(screen.getByTestId("preview-series"));

    // then
    expect(await screen.findByTestId("series-occurrence-chosen-1")).toBeDisabled();
    expect(screen.getByTestId("series-occurrence-1")).toHaveTextContent("14");
  });

  it("given an unknown rule violation, when the preview is read, then a generic failure replaces its translation key", async () => {
    // given
    vi.spyOn(api, "previewSeries").mockResolvedValue({
      creatableCount: 0, truncatedByHorizon: false, horizonLimit: null,
      occurrences: [{
        startsAt: "2026-09-14T16:00:00Z", endsAt: "2026-09-14T17:00:00Z", blockedCourtIds: ["court-1"],
        violations: [{ code: "booking.rule.unknown", params: {} }], creatable: false
      }]
    });
    show();
    await describeRule();

    // when
    await userEvent.click(screen.getByTestId("preview-series"));

    // then
    const occurrence = await screen.findByTestId("series-occurrence-0");
    expect(occurrence).toHaveTextContent("That did not work. Please try again.");
    expect(occurrence).not.toHaveTextContent("booking.rule.unknown");
  });

  it("given a date the court is already taken on, when the preview is read, then it says so rather than staying blank", async () => {
    // given — the common case carries no rule violation at all, only a court that is not free
    vi.spyOn(api, "previewSeries").mockResolvedValue({
      creatableCount: 1, truncatedByHorizon: false, horizonLimit: null,
      occurrences: [
        preview.occurrences[0],
        {
          startsAt: "2026-09-14T16:00:00Z", endsAt: "2026-09-14T17:00:00Z",
          blockedCourtIds: ["court-1"], violations: [], creatable: false
        }
      ]
    });
    show();
    await describeRule();

    // when
    await userEvent.click(screen.getByTestId("preview-series"));

    // then
    const blocked = await screen.findByTestId("series-occurrence-1");
    expect(blocked).toHaveTextContent("taken");
    expect(screen.getByTestId("series-occurrence-chosen-1")).toBeDisabled();
  });

  it("given a recurrence that runs past the horizon, when it is previewed, then the limit is named", async () => {
    // given
    vi.spyOn(api, "previewSeries").mockResolvedValue({
      ...preview, truncatedByHorizon: true, horizonLimit: "2026-12-31"
    });
    show();
    await describeRule();

    // when
    await userEvent.click(screen.getByTestId("preview-series"));

    // then — a list quietly cut short is what this refuses
    expect(await screen.findByTestId("series-truncated")).toHaveTextContent("2026-12-31");
  });

  it("given occurrences a conflict kept out, when the series is created, then each skipped date is named", async () => {
    // given
    vi.spyOn(api, "previewSeries").mockResolvedValue(preview);
    vi.spyOn(api, "createSeries").mockResolvedValue({
      seriesId: "series-1", bookingIds: ["booking-1"], skipped: ["2026-09-14T16:00:00Z"]
    });
    show();
    await describeRule();
    await userEvent.click(screen.getByTestId("preview-series"));

    // when
    await userEvent.click(await screen.findByTestId("confirm-series"));

    // then — one blocked date does not undo the rest, and the caller has to see which one it was
    expect(await screen.findByTestId("series-created")).toHaveRole("status");
    expect(screen.getByTestId("series-skipped")).toHaveTextContent("14");
  });

  it("given a preview already read, when the rule is changed afterwards, then it must be previewed again", async () => {
    // given
    vi.spyOn(api, "previewSeries").mockResolvedValue(preview);
    show();
    await describeRule();
    await userEvent.click(screen.getByTestId("preview-series"));
    await screen.findByTestId("confirm-series");

    // when
    await userEvent.click(screen.getByTestId("series-weekday-WEDNESDAY"));

    // then — a confirmation belongs to the rule it answered, not to the one that replaced it
    expect(screen.queryByTestId("confirm-series")).not.toBeInTheDocument();
  });

  it("given a created series, when it is done, then the list that holds it is read again", async () => {
    // given
    vi.spyOn(api, "previewSeries").mockResolvedValue(preview);
    vi.spyOn(api, "createSeries").mockResolvedValue({ seriesId: "series-1", bookingIds: ["booking-1", "booking-2"], skipped: [] });
    const created = show();
    await describeRule();
    await userEvent.click(screen.getByTestId("preview-series"));

    // when
    await userEvent.click(await screen.findByTestId("confirm-series"));

    // then
    expect(created).toHaveBeenCalled();
    expect(screen.queryByTestId("series-skipped")).not.toBeInTheDocument();
  });
});
