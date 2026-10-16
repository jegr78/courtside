import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, api, type DayOfWeek, type OpeningPeriod } from "../../api/client";
import i18n from "../../i18n";
import { UnsavedChangesProvider } from "../../unsaved/UnsavedChangesProvider";
import { WithClubConfiguration } from "../../test/ClubConfiguration";
import { AdminAvailabilityView } from "./AdminAvailabilityView";

const weekdays: DayOfWeek[] = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
const closedDays = weekdays.map((dayOfWeek) => ({ dayOfWeek, opensAt: null, closesAt: null }));

const future: OpeningPeriod = {
  id: "period-future", kind: "HOLIDAY", name: "Founding day", startsOn: "2099-07-07", endsOn: "2099-07-07", days: closedDays
};
const running: OpeningPeriod = {
  id: "period-running", kind: "SEASON", name: "Long season", startsOn: "2000-01-01", endsOn: "2099-12-31",
  days: weekdays.map((dayOfWeek) => ({ dayOfWeek, opensAt: "09:00:00", closesAt: "20:00:00" }))
};
const ended: OpeningPeriod = { ...future, id: "period-ended", startsOn: "2000-01-01", endsOn: "2000-01-02" };
const courts = [
  { id: "court-1", number: 1, name: "Centre Court", active: true },
  { id: "court-2", number: 2, name: null, active: true }
];

const noImpact = { affectedCount: 0, truncated: false, bookings: [] };
const impactOf = (affectedCount: number) => ({ ...noImpact, affectedCount });

function show() {
  render(<MemoryRouter><WithClubConfiguration><UnsavedChangesProvider>
    <AdminAvailabilityView />
  </UnsavedChangesProvider></WithClubConfiguration></MemoryRouter>);
}

describe("AdminAvailabilityView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminOpeningPeriods").mockResolvedValue([ended, running, future]);
    vi.spyOn(api, "adminCourtClosures").mockResolvedValue([
      { id: "closure-1", courtId: "court-2", name: "Resurfacing", startsOn: "2099-06-01", endsOn: "2099-06-30" }
    ]);
    vi.spyOn(api, "adminCourts").mockResolvedValue(courts);
    vi.spyOn(api, "openingPeriodImpact").mockResolvedValue(noImpact);
    vi.spyOn(api, "courtClosureImpact").mockResolvedValue(noImpact);
  });

  it("given entries in the past, running and ahead, when the view loads, then only what may still change offers it", async () => {
    // when
    show();

    // then
    expect(await screen.findByTestId("opening-period-period-future")).toHaveTextContent("Holiday: Founding day");
    expect(screen.queryByTestId("edit-opening-period-period-ended"), "an ended entry is history").not.toBeInTheDocument();
    expect(screen.queryByTestId("remove-opening-period-period-ended")).not.toBeInTheDocument();
    expect(screen.getByTestId("edit-opening-period-period-running"), "a running entry can still end earlier").toBeInTheDocument();
    expect(screen.queryByTestId("remove-opening-period-period-running"), "a running entry cannot vanish").not.toBeInTheDocument();
    expect(screen.getByTestId("remove-opening-period-period-future")).toBeInTheDocument();
    expect(screen.getByTestId("court-closure-closure-1")).toHaveTextContent("Court 2: Resurfacing");
  });

  it("given a new closed holiday, when it is saved, then every weekday is sent closed and the list reloads", async () => {
    // given
    const create = vi.spyOn(api, "createAdminOpeningPeriod").mockResolvedValue(future);
    show();
    await screen.findByTestId("opening-period-form");
    fireEvent.change(screen.getByTestId("opening-period-name"), { target: { value: "Founding day" } });
    fireEvent.change(screen.getByTestId("opening-period-starts-on"), { target: { value: "2099-07-07" } });
    fireEvent.change(screen.getByTestId("opening-period-ends-on"), { target: { value: "2099-07-07" } });

    // when
    await userEvent.click(screen.getByTestId("save-opening-period"));

    // then
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      kind: "HOLIDAY", name: "Founding day", startsOn: "2099-07-07", endsOn: "2099-07-07", days: closedDays
    }));
    expect(api.adminOpeningPeriods).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId("admin-save-success")).toBeInTheDocument();
  });

  it("given a holiday with hours, when it is saved, then the one window applies to every weekday", async () => {
    // given
    const create = vi.spyOn(api, "createAdminOpeningPeriod").mockResolvedValue(future);
    show();
    await screen.findByTestId("opening-period-form");
    fireEvent.change(screen.getByTestId("opening-period-name"), { target: { value: "Short day" } });
    fireEvent.change(screen.getByTestId("opening-period-starts-on"), { target: { value: "2099-12-24" } });
    fireEvent.change(screen.getByTestId("opening-period-ends-on"), { target: { value: "2099-12-24" } });
    await userEvent.click(screen.getByTestId("opening-period-closed-MONDAY"));
    fireEvent.change(screen.getByTestId("opening-period-opens-MONDAY"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByTestId("opening-period-closes-MONDAY"), { target: { value: "14:00" } });

    // when
    await userEvent.click(screen.getByTestId("save-opening-period"));

    // then
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({
      days: weekdays.map((dayOfWeek) => ({ dayOfWeek, opensAt: "10:00", closesAt: "14:00" }))
    })));
  });

  it("given a form without its days, when it is saved, then nothing is sent and the board is told what is missing", async () => {
    // given
    const create = vi.spyOn(api, "createAdminCourtClosure");
    show();
    await screen.findByTestId("court-closure-form");
    fireEvent.change(screen.getByTestId("court-closure-name"), { target: { value: "Resurfacing" } });

    // when
    await userEvent.click(screen.getByTestId("save-court-closure"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("Fill in the name, both days");
    expect(create).not.toHaveBeenCalled();
  });

  it("given a closure the instance refuses as overlapping, when it is saved, then the refusal is translated", async () => {
    // given
    vi.spyOn(api, "createAdminCourtClosure").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:availability-rejected", status: 400, title: "rejected", detail: "rejected",
      violations: [{ code: "facility.availability.overlap", params: {} }]
    }));
    show();
    await screen.findByTestId("court-closure-form");
    fireEvent.change(screen.getByTestId("court-closure-court"), { target: { value: "court-2" } });
    fireEvent.change(screen.getByTestId("court-closure-name"), { target: { value: "Lights" } });
    fireEvent.change(screen.getByTestId("court-closure-starts-on"), { target: { value: "2099-06-30" } });
    fireEvent.change(screen.getByTestId("court-closure-ends-on"), { target: { value: "2099-07-02" } });

    // when
    await userEvent.click(screen.getByTestId("save-court-closure"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("Another entry of the same kind already covers one of these days.");
    expect(screen.getByTestId("court-closure-name")).toHaveValue("Lights");
  });

  it("given a closure, when it is corrected and then removed, then each call names it", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminCourtClosure").mockResolvedValue(
      { id: "closure-1", courtId: "court-2", name: "Lights", startsOn: "2099-06-01", endsOn: "2099-06-30" });
    const remove = vi.spyOn(api, "removeAdminCourtClosure").mockResolvedValue(undefined);
    show();
    await userEvent.click(await screen.findByTestId("edit-court-closure-closure-1"));
    expect(screen.getByTestId("court-closure-court"), "a closure ahead can move to another court").toBeEnabled();
    fireEvent.change(screen.getByTestId("court-closure-name"), { target: { value: "Lights" } });

    // when
    await userEvent.click(screen.getByTestId("save-court-closure"));
    await userEvent.click(within(screen.getByTestId("court-closures")).getByTestId("remove-court-closure-closure-1"));

    // then
    await waitFor(() => expect(remove).toHaveBeenCalledWith("closure-1"));
    expect(change).toHaveBeenCalledWith("closure-1", { courtId: "court-2", name: "Lights", startsOn: "2099-06-01", endsOn: "2099-06-30" });
  });

  it("given a running season, when it is edited, then its first day and hours are fixed", async () => {
    // given
    show();

    // when
    await userEvent.click(await screen.findByTestId("edit-opening-period-period-running"));

    // then
    expect(screen.getByTestId("opening-period-starts-on")).toBeDisabled();
    expect(screen.getByTestId("opening-period-kind"), "a running season stays a season").toBeDisabled();
    expect(screen.getByTestId("opening-period-opens-MONDAY")).toBeDisabled();
    expect(screen.getByTestId("opening-period-ends-on")).toBeEnabled();
    expect(screen.getByTestId("opening-period-started")).toBeInTheDocument();
  });
  it("given a new holiday over two bookings, when its days are entered, then the form says how many it affects before saving", async () => {
    // given
    const ask = vi.spyOn(api, "openingPeriodImpact").mockResolvedValue(impactOf(2));
    show();
    await screen.findByTestId("opening-period-form");

    // when
    fireEvent.change(screen.getByTestId("opening-period-starts-on"), { target: { value: "2099-07-07" } });
    fireEvent.change(screen.getByTestId("opening-period-ends-on"), { target: { value: "2099-07-07" } });

    // then
    expect(await screen.findByTestId("opening-period-affected")).toHaveTextContent("affects 2 existing bookings");
    expect(ask).toHaveBeenLastCalledWith({
      periodId: null, kind: "HOLIDAY", startsOn: "2099-07-07", endsOn: "2099-07-07", days: closedDays
    });
  });

  it("given a closure that affects nothing, when its days are entered, then no notice is shown", async () => {
    // given
    const ask = vi.spyOn(api, "courtClosureImpact").mockResolvedValue(noImpact);
    show();
    await screen.findByTestId("court-closure-form");

    // when
    fireEvent.change(screen.getByTestId("court-closure-court"), { target: { value: "court-1" } });
    fireEvent.change(screen.getByTestId("court-closure-starts-on"), { target: { value: "2099-08-01" } });
    fireEvent.change(screen.getByTestId("court-closure-ends-on"), { target: { value: "2099-08-02" } });

    // then
    await waitFor(() => expect(ask).toHaveBeenCalledWith({
      closureId: null, courtId: "court-1", startsOn: "2099-08-01", endsOn: "2099-08-02"
    }));
    expect(screen.queryByTestId("court-closure-affected"), "a change that touches nothing needs no warning")
      .not.toBeInTheDocument();
  });

  it("given a stored closure being widened over one booking, when the new last day is entered, then the notice names its own closure", async () => {
    // given
    const ask = vi.spyOn(api, "courtClosureImpact").mockResolvedValue(impactOf(1));
    show();
    await userEvent.click(await screen.findByTestId("edit-court-closure-closure-1"));
    expect(screen.queryByTestId("court-closure-affected"), "an unchanged entry is not asked about").not.toBeInTheDocument();

    // when
    fireEvent.change(screen.getByTestId("court-closure-ends-on"), { target: { value: "2099-07-05" } });

    // then
    expect(await screen.findByTestId("court-closure-affected")).toHaveTextContent("affects 1 existing booking.");
    expect(ask).toHaveBeenLastCalledWith({
      closureId: "closure-1", courtId: "court-2", startsOn: "2099-06-01", endsOn: "2099-07-05"
    });
  });

  it("given a closure whose last day comes before its first, when it is entered, then nothing is asked", async () => {
    // given
    const ask = vi.spyOn(api, "courtClosureImpact").mockResolvedValue(impactOf(3));
    show();
    await screen.findByTestId("court-closure-form");

    // when
    fireEvent.change(screen.getByTestId("court-closure-court"), { target: { value: "court-1" } });
    fireEvent.change(screen.getByTestId("court-closure-starts-on"), { target: { value: "2099-08-02" } });
    fireEvent.change(screen.getByTestId("court-closure-ends-on"), { target: { value: "2099-08-01" } });
    await new Promise((resolve) => setTimeout(resolve, 600));

    // then
    expect(ask, "an impossible range has no bookings to count").not.toHaveBeenCalled();
    expect(screen.queryByTestId("court-closure-affected")).not.toBeInTheDocument();
  });
});
