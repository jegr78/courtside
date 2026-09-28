import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, api, type DayOfWeek, type OpeningHours, type OpeningWeek } from "../../api/client";
import { addDays, dateInTimeZoneValue, formatDate, parseDate } from "../../time/clubZone";
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

const today = dateInTimeZoneValue(new Date(), "Pacific/Auckland")!;
const later = (days: number) => formatDate(addDays(parseDate(today), days));

function inForce(days: OpeningHours[]): OpeningWeek {
  return { id: "eeeeeeee-0000-0000-0000-000000000100", effectiveFrom: null, days };
}

function scheduled(effectiveFrom: string, days: OpeningHours[]): OpeningWeek {
  return { id: `eeeeeeee-0000-0000-0000-${effectiveFrom.replaceAll("-", "").padStart(12, "0")}`, effectiveFrom, days };
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
    vi.spyOn(api, "adminOpeningSchedule")
      .mockResolvedValue([inForce(week({ MONDAY: ["08:00:00", "22:00:00"] }))]);
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
    expect(saveWeek).toHaveBeenCalledWith(today, week({
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
    expect(saveWeek, "the week applies from today unless another day is chosen").toHaveBeenCalledWith(today, week({}));
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
    await user.clear(screen.getByTestId("hours-close-MONDAY"));
    await user.type(screen.getByTestId("hours-close-MONDAY"), "21:45");

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

  it("given a saved week, when the next save is refused by the form, then the page stops saying it saved", async () => {
    // given
    vi.spyOn(api, "setAdminWeeklyOpeningHours")
      .mockResolvedValue(week({ MONDAY: ["08:00:00", "22:00:00"] }));
    show();
    const user = userEvent.setup();
    await screen.findByTestId("hours-closed-FRIDAY");
    await user.clear(screen.getByTestId("hours-close-MONDAY"));
    await user.type(screen.getByTestId("hours-close-MONDAY"), "21:00");
    await user.click(screen.getByTestId("save-opening-hours"));
    await screen.findByRole("status");

    // when
    await user.click(screen.getByTestId("hours-closed-FRIDAY"));
    await user.type(screen.getByTestId("hours-open-FRIDAY"), "09:00");
    await user.click(screen.getByTestId("save-opening-hours"));

    // then
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Complete the marked day, or mark it closed");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("given a day the server rejected, when its time is corrected, then the message goes with it", async () => {
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
    await user.clear(screen.getByTestId("hours-close-MONDAY"));
    await user.type(screen.getByTestId("hours-close-MONDAY"), "21:45");
    await user.click(screen.getByTestId("save-opening-hours"));
    await screen.findByTestId("hours-error-MONDAY");

    // when
    await user.clear(screen.getByTestId("hours-open-MONDAY"));
    await user.type(screen.getByTestId("hours-open-MONDAY"), "09:00");

    // then
    await waitFor(() =>
      expect(screen.queryByTestId("hours-error-MONDAY")).not.toBeInTheDocument());
  });

  it("given several days the applied times reach, when applying them, then their messages go too", async () => {
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
    await user.clear(screen.getByTestId("hours-close-MONDAY"));
    await user.type(screen.getByTestId("hours-close-MONDAY"), "21:45");
    await user.click(screen.getByTestId("save-opening-hours"));
    await screen.findByTestId("hours-error-MONDAY");

    // when
    await user.type(screen.getByTestId("apply-opens-at"), "09:00");
    await user.type(screen.getByTestId("apply-closes-at"), "18:00");
    await user.click(screen.getByTestId("apply-day-MONDAY"));
    await user.click(screen.getByTestId("apply-hours"));

    // then
    await waitFor(() =>
      expect(screen.queryByTestId("hours-error-MONDAY")).not.toBeInTheDocument());
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

  it("given an untouched week, when the view loads, then no save is offered", async () => {
    // when
    show();
    await screen.findByTestId("hours-open-MONDAY");

    // then
    expect(screen.queryByTestId("save-opening-hours"), "a clean week offers nothing to save").toBeNull();
  });

  it("given an edited day, when the edit is discarded, then the stored week returns and nothing is left unsaved", async () => {
    // given
    show(true);
    const user = userEvent.setup();
    await screen.findByTestId("hours-closed-MONDAY");
    await user.click(screen.getByTestId("hours-closed-MONDAY"));
    expect(screen.getByTestId("unsaved-mark-opening-hours")).toHaveTextContent("Opening hours");

    // when
    await user.click(screen.getByTestId("discard-opening-hours"));

    // then
    expect(screen.getByTestId("hours-open-MONDAY")).toHaveValue("08:00");
    expect(screen.getByTestId("hours-closed-MONDAY")).not.toBeChecked();
    expect(screen.queryByTestId("save-bar")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given an edited week, when it is saved, then the bar leaves with the work it held", async () => {
    // given
    vi.spyOn(api, "setAdminWeeklyOpeningHours").mockResolvedValue(week({}));
    show(true);
    const user = userEvent.setup();
    await screen.findByTestId("hours-closed-MONDAY");
    await user.click(screen.getByTestId("hours-closed-MONDAY"));
    expect(screen.getByTestId("save-bar")).toBeVisible();

    // when
    await user.click(screen.getByTestId("save-opening-hours"));

    // then
    expect(await screen.findByTestId("admin-save-success")).toBeVisible();
    expect(screen.queryByTestId("save-bar")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
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
    expect(asking).toHaveBeenCalledWith("MONDAY", today, "08:00", "22:00");
  });

  it("given a later day, when the week is saved, then it is scheduled from that day and shown as upcoming", async () => {
    // given
    const current = inForce(week({ MONDAY: ["08:00:00", "22:00:00"] }));
    const winter = scheduled(later(7), week({ MONDAY: ["10:00:00", "18:00:00"] }));
    vi.mocked(api.adminOpeningSchedule).mockResolvedValueOnce([current]).mockResolvedValue([current, winter]);
    const saveWeek = vi.spyOn(api, "setAdminWeeklyOpeningHours").mockResolvedValue(winter.days);
    show();
    const user = userEvent.setup();
    await screen.findByTestId("hours-open-MONDAY");

    // when
    await user.clear(screen.getByTestId("opening-hours-effective-from"));
    await user.type(screen.getByTestId("opening-hours-effective-from"), later(7));
    await user.clear(screen.getByTestId("hours-open-MONDAY"));
    await user.type(screen.getByTestId("hours-open-MONDAY"), "10:00");
    await user.clear(screen.getByTestId("hours-close-MONDAY"));
    await user.type(screen.getByTestId("hours-close-MONDAY"), "18:00");
    await user.click(screen.getByTestId("save-opening-hours"));

    // then
    expect(saveWeek).toHaveBeenCalledWith(later(7), week({ MONDAY: ["10:00", "18:00"] }));
    expect(await screen.findByTestId(`opening-week-${later(7)}`)).toHaveTextContent("Scheduled from");
    expect(screen.getByTestId(`edit-opening-week-${later(7)}`), "the saved week stays in the editor").toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("opening-hours-effective-from")).toHaveValue(later(7));
  });

  it("given an upcoming week, when it is chosen, then the editor holds its days and its first day", async () => {
    // given
    vi.mocked(api.adminOpeningSchedule).mockResolvedValue([
      inForce(week({ MONDAY: ["08:00:00", "22:00:00"] })),
      scheduled(later(7), week({ MONDAY: ["10:00:00", "18:00:00"] }))
    ]);
    show();
    await screen.findByTestId("opening-week-beginning");
    expect(screen.queryByTestId("remove-opening-week-beginning"), "the week in force is replaced, not removed").toBeNull();

    // when
    await userEvent.click(screen.getByTestId(`edit-opening-week-${later(7)}`));

    // then
    expect(screen.getByTestId("hours-open-MONDAY")).toHaveValue("10:00");
    expect(screen.getByTestId("opening-hours-effective-from")).toHaveValue(later(7));
    expect(screen.getByTestId("opening-week-beginning")).toHaveTextContent("In force");
    expect(screen.getByTestId(`remove-opening-week-${later(7)}`), "each button names its week").toHaveAccessibleDescription(/^Scheduled from/);
  });

  it("given an upcoming week, when it is removed, then the week is asked to go and the list no longer holds it", async () => {
    // given
    const current = inForce(week({ MONDAY: ["08:00:00", "22:00:00"] }));
    vi.mocked(api.adminOpeningSchedule)
      .mockResolvedValueOnce([current, scheduled(later(7), week({}))]).mockResolvedValue([current]);
    const removing = vi.spyOn(api, "removeScheduledOpeningHours").mockResolvedValue(undefined);
    show();

    // when
    await userEvent.click(await screen.findByTestId(`remove-opening-week-${later(7)}`));

    // then
    expect(removing).toHaveBeenCalledWith(later(7));
    await waitFor(() => expect(screen.queryByTestId(`opening-week-${later(7)}`)).toBeNull());
  });

  it("given an upcoming week moved to another day, when saved, then it is stored there before the old day goes", async () => {
    // given
    const current = inForce(week({ MONDAY: ["08:00:00", "22:00:00"] }));
    vi.mocked(api.adminOpeningSchedule).mockResolvedValue([current, scheduled(later(7), week({}))]);
    const calls: string[] = [];
    vi.spyOn(api, "setAdminWeeklyOpeningHours").mockImplementation((effectiveFrom) => {
      calls.push(`store ${effectiveFrom}`);
      return Promise.resolve(week({}));
    });
    vi.spyOn(api, "removeScheduledOpeningHours").mockImplementation((effectiveFrom) => {
      calls.push(`remove ${effectiveFrom}`);
      return Promise.resolve();
    });
    show();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId(`edit-opening-week-${later(7)}`));

    // when
    await user.clear(screen.getByTestId("opening-hours-effective-from"));
    await user.type(screen.getByTestId("opening-hours-effective-from"), later(14));
    await user.click(screen.getByTestId("save-opening-hours"));

    // then
    await waitFor(() => expect(calls).toEqual([`store ${later(14)}`, `remove ${later(7)}`]));
  });

  it("given an upcoming week, when its impact is asked for, then only the days it governs are asked about", async () => {
    // given
    vi.mocked(api.adminOpeningSchedule).mockResolvedValue([
      inForce(week({ MONDAY: ["08:00:00", "22:00:00"] })),
      scheduled(later(7), week({ MONDAY: ["10:00:00", "18:00:00"] }))
    ]);
    const asking = vi.spyOn(api, "openingHoursImpact")
      .mockResolvedValue({ affectedCount: 0, truncated: false, nextCursor: null, bookings: [] });
    show();
    await userEvent.click(await screen.findByTestId(`edit-opening-week-${later(7)}`));

    // when
    await userEvent.click(screen.getByTestId("opening-hours-impact-MONDAY"));

    // then
    expect(asking).toHaveBeenCalledWith("MONDAY", later(7), "10:00", "18:00");
  });

  it("given no first day, when the week is saved, then the form says so without a request", async () => {
    // given
    const saveWeek = vi.spyOn(api, "setAdminWeeklyOpeningHours").mockResolvedValue(week({}));
    show();
    const user = userEvent.setup();
    await screen.findByTestId("hours-open-MONDAY");

    // when
    await user.clear(screen.getByTestId("opening-hours-effective-from"));
    await user.click(screen.getByTestId("save-opening-hours"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose the day the hours apply from.");
    expect(saveWeek).not.toHaveBeenCalled();
  });

  it("given unsaved changes, when another week is offered, then it cannot be chosen until they are saved or discarded", async () => {
    // given
    vi.mocked(api.adminOpeningSchedule).mockResolvedValue([
      inForce(week({ MONDAY: ["08:00:00", "22:00:00"] })),
      scheduled(later(7), week({}))
    ]);
    show();
    await screen.findByTestId("hours-closed-MONDAY");

    // when
    await userEvent.click(screen.getByTestId("hours-closed-MONDAY"));

    // then
    expect(screen.getByTestId(`edit-opening-week-${later(7)}`)).toBeDisabled();
    expect(screen.getByTestId(`remove-opening-week-${later(7)}`)).toBeDisabled();
  });

  it("given opening hours cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "adminOpeningSchedule").mockRejectedValue(new Error("unavailable"));

    // when
    show();

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
