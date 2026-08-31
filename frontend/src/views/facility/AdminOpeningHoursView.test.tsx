import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, api, type DayOfWeek, type OpeningHours } from "../../api/client";
import i18n from "../../i18n";
import { UnsavedChangesProvider } from "../../unsaved/UnsavedChangesProvider";
import { UnsavedCount } from "../../test/UnsavedCount";
import { WithClubConfiguration } from "../../test/ClubConfiguration";
import { AdminOpeningHoursView } from "./AdminOpeningHoursView";

const weekdays: DayOfWeek[] = [
  "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"
];

function week(open: Partial<Record<DayOfWeek, [string, string]>>): OpeningHours[] {
  return weekdays.map((dayOfWeek) => {
    const window = open[dayOfWeek];
    return { dayOfWeek, opensAt: window?.[0] ?? null, closesAt: window?.[1] ?? null };
  });
}

function show(counted = false) {
  render(<MemoryRouter><WithClubConfiguration><UnsavedChangesProvider>
    {counted && <UnsavedCount />}
    <AdminOpeningHoursView />
  </UnsavedChangesProvider></WithClubConfiguration></MemoryRouter>);
}

describe("AdminOpeningHoursView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminOpeningHours")
      .mockResolvedValue(week({ MONDAY: ["08:00:00", "22:00:00"] }));
  });

  // The rule editor on the configuration page links straight here, which is what the route buys.
  it("given opening hours, when the view loads, then the whole week is shown under a heading of its own", async () => {
    // when
    show();

    // then
    expect(await screen.findByTestId("hours-open-MONDAY")).toHaveValue("08:00");
    expect(screen.getByTestId("hours-closed-SUNDAY")).toBeChecked();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Opening hours");
  });

  it("given two edited days, when saving once, then one request carries both of them", async () => {
    // given
    const saveWeek = vi.spyOn(api, "setAdminWeeklyOpeningHours")
      .mockResolvedValue(week({ MONDAY: ["09:00:00", "22:00:00"], TUESDAY: ["10:00:00", "20:00:00"] }));
    show();
    const user = userEvent.setup();
    await screen.findByTestId("hours-open-MONDAY");

    // when
    await user.clear(screen.getByTestId("hours-open-MONDAY"));
    await user.type(screen.getByTestId("hours-open-MONDAY"), "09:00");
    await user.click(screen.getByTestId("hours-closed-TUESDAY"));
    await user.type(screen.getByTestId("hours-open-TUESDAY"), "10:00");
    await user.type(screen.getByTestId("hours-close-TUESDAY"), "20:00");
    await user.click(screen.getByTestId("save-opening-hours"));

    // then
    expect(saveWeek).toHaveBeenCalledTimes(1);
    expect(saveWeek).toHaveBeenCalledWith(week({
      MONDAY: ["09:00", "22:00"], TUESDAY: ["10:00", "20:00"]
    }));
  });

  it("given times and several days, when applying them, then every picked day carries them", async () => {
    // given
    show();
    const user = userEvent.setup();
    await screen.findByTestId("hours-open-MONDAY");

    // when
    await user.type(screen.getByTestId("apply-opens-at"), "09:00");
    await user.type(screen.getByTestId("apply-closes-at"), "18:00");
    await user.click(screen.getByTestId("apply-day-SATURDAY"));
    await user.click(screen.getByTestId("apply-day-SUNDAY"));
    await user.click(screen.getByTestId("apply-hours"));

    // then
    expect(screen.getByTestId("hours-open-SATURDAY")).toHaveValue("09:00");
    expect(screen.getByTestId("hours-close-SUNDAY")).toHaveValue("18:00");
    expect(screen.getByTestId("hours-closed-SATURDAY")).not.toBeChecked();
    expect(screen.getByTestId("hours-open-MONDAY")).toHaveValue("08:00");
  });

  it("given no day is picked, when the times are entered, then applying them is not offered", async () => {
    // given
    show();
    const user = userEvent.setup();
    await screen.findByTestId("hours-open-MONDAY");

    // when
    await user.type(screen.getByTestId("apply-opens-at"), "09:00");
    await user.type(screen.getByTestId("apply-closes-at"), "18:00");

    // then
    expect(screen.getByTestId("apply-hours")).toBeDisabled();
  });

  it("given an open day, when it is closed and the week is saved, then that day travels without a window", async () => {
    // given
    const saveWeek = vi.spyOn(api, "setAdminWeeklyOpeningHours").mockResolvedValue(week({}));
    show();
    const user = userEvent.setup();
    await screen.findByTestId("hours-closed-MONDAY");

    // when
    await user.click(screen.getByTestId("hours-closed-MONDAY"));
    await user.click(screen.getByTestId("save-opening-hours"));

    // then
    expect(saveWeek).toHaveBeenCalledWith(week({}));
  });

  it("given a day the server rejects, when the week is saved, then the message lands on that day", async () => {
    // given
    vi.spyOn(api, "setAdminWeeklyOpeningHours").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:weekly-opening-hours-rejected",
      title: "The week cannot be stored as given",
      status: 400,
      violations: [{
        code: "facility.openingHours.slotGridMismatch",
        params: { slotMinutes: 30, day: "MONDAY" }
      }]
    }));
    show();
    const user = userEvent.setup();
    await screen.findByTestId("hours-open-MONDAY");

    // when
    await user.click(screen.getByTestId("save-opening-hours"));

    // then
    expect(await screen.findByTestId("hours-error-MONDAY"))
      .toHaveTextContent("align with the 30-minute grid");
    expect(screen.getByTestId("hours-open-MONDAY"))
      .toHaveAccessibleDescription(/30-minute grid/);
    expect(screen.queryByTestId("hours-error-TUESDAY")).not.toBeInTheDocument();
  });

  it("given a day with only an opening time, when the week is saved, then it is marked without a request", async () => {
    // given
    const saveWeek = vi.spyOn(api, "setAdminWeeklyOpeningHours").mockResolvedValue(week({}));
    show();
    const user = userEvent.setup();
    await screen.findByTestId("hours-closed-FRIDAY");

    // when
    await user.click(screen.getByTestId("hours-closed-FRIDAY"));
    await user.type(screen.getByTestId("hours-open-FRIDAY"), "09:00");
    await user.click(screen.getByTestId("save-opening-hours"));

    // then
    expect(await screen.findByTestId("hours-error-FRIDAY"))
      .toHaveTextContent("needs both an opening and a closing time");
    expect(saveWeek).not.toHaveBeenCalled();
  });

  it("given an edited day, when it is counted, then the week is asked about once", async () => {
    // given
    show(true);
    await screen.findByTestId("hours-open-MONDAY");

    // when
    await userEvent.type(screen.getByTestId("hours-open-MONDAY"), "09:00");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));
  });

  it("given hours a board is about to shorten, when the impact is asked for, then it is asked for the new hours", async () => {
    // given
    const asking = vi.spyOn(api, "openingHoursImpact")
      .mockResolvedValue({ affectedCount: 0, truncated: false, nextCursor: null, bookings: [] });
    show();
    await screen.findByTestId("opening-hours-impact-MONDAY");

    // when
    await userEvent.click(screen.getByTestId("opening-hours-impact-MONDAY"));

    // then — the question is about what the form holds now, not about what is stored
    expect(asking).toHaveBeenCalledWith("MONDAY", "08:00", "22:00");
  });

  it("given opening hours cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "adminOpeningHours").mockRejectedValue(new Error("unavailable"));

    // when
    show();

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
