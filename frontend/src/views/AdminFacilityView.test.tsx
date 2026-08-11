import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "../api/client";
import i18n from "../i18n";
import { AdminFacilityView } from "./AdminFacilityView";

describe("AdminFacilityView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminCourts").mockResolvedValue([
      { id: "court-1", number: 1, name: "Centre Court", active: true }
    ]);
    vi.spyOn(api, "adminOpeningHours").mockResolvedValue([
      { dayOfWeek: "MONDAY", opensAt: "08:00:00", closesAt: "22:00:00" }
    ]);
    vi.spyOn(api, "adminBookingCards").mockResolvedValue([
      {
        id: "card-1", label: "Member booking", color: "#b85c38", requiredRole: "MEMBER",
        allowedPlayerCounts: [2, 4], tracksPlayers: true, countsAgainstLimits: true,
        guestAllowed: true, active: true
      }
    ]);
  });

  it("given facility data, when the view loads, then courts, hours, and card access are visible", async () => {
    // when
    render(<MemoryRouter><AdminFacilityView /></MemoryRouter>);

    // then
    expect(await screen.findByDisplayValue("Centre Court")).toBeInTheDocument();
    expect(screen.getByDisplayValue("08:00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Member booking")).toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: "Required role" })[0]).toHaveValue("MEMBER");
  });

  it("given facility data cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "adminCourts").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><AdminFacilityView /></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByText("Courtside is loading …")).not.toBeInTheDocument();
  });

  it("given an active court, when toggling it twice, then it disappears and can be restored", async () => {
    // given
    const setCourtActive = vi.spyOn(api, "setAdminCourtActive")
      .mockResolvedValueOnce({ id: "court-1", number: 1, name: "Centre Court", active: false })
      .mockResolvedValueOnce({ id: "court-1", number: 1, name: "Centre Court", active: true });
    render(<MemoryRouter><AdminFacilityView /></MemoryRouter>);
    const user = userEvent.setup();

    // when
    await user.click(await screen.findByTestId("toggle-court-court-1"));
    await user.click(screen.getByTestId("toggle-court-court-1"));

    // then
    expect(setCourtActive).toHaveBeenNthCalledWith(1, "court-1", false);
    expect(setCourtActive).toHaveBeenNthCalledWith(2, "court-1", true);
  });

  it("given a court mutation is pending, when interacting again, then the stale state cannot be submitted", async () => {
    // given
    const response = deferred<Awaited<ReturnType<typeof api.setAdminCourtActive>>>();
    const setCourtActive = vi.spyOn(api, "setAdminCourtActive").mockReturnValue(response.promise);
    render(<MemoryRouter><AdminFacilityView /></MemoryRouter>);
    const user = userEvent.setup();
    const toggle = await screen.findByTestId("toggle-court-court-1");

    // when
    await user.click(toggle);

    // then
    expect(toggle).toBeDisabled();
    expect(screen.getByDisplayValue("Centre Court")).toBeDisabled();
    await user.click(toggle);
    expect(setCourtActive).toHaveBeenCalledTimes(1);

    // when
    response.resolve({ id: "court-1", number: 1, name: "Centre Court", active: false });

    // then
    expect(await screen.findByText("Activate")).toBeEnabled();
  });

  it("given changed card access and opening hours, when saving, then the admin API receives the values", async () => {
    // given
    const changeCard = vi.spyOn(api, "changeAdminBookingCard").mockResolvedValue({
      id: "card-1", label: "Training", color: "#34584a", requiredRole: "TRAINER",
      allowedPlayerCounts: [], tracksPlayers: false, countsAgainstLimits: false,
      guestAllowed: false, active: true
    });
    const setHours = vi.spyOn(api, "setAdminOpeningHours").mockResolvedValue({
      dayOfWeek: "MONDAY", opensAt: "09:00:00", closesAt: "21:00:00"
    });
    render(<MemoryRouter><AdminFacilityView /></MemoryRouter>);
    const user = userEvent.setup();
    await screen.findByDisplayValue("Centre Court");

    // when
    await user.clear(screen.getByTestId("card-label-card-1"));
    await user.type(screen.getByTestId("card-label-card-1"), "Training");
    await user.selectOptions(screen.getAllByRole("combobox", { name: "Required role" })[0], "TRAINER");
    await user.clear(screen.getByTestId("card-counts-card-1"));
    await user.type(screen.getByTestId("card-counts-card-1"), "1, 3");
    await user.click(screen.getByTestId("save-card-card-1"));
    await user.clear(screen.getByTestId("hours-open-MONDAY"));
    await user.type(screen.getByTestId("hours-open-MONDAY"), "09:00");
    await user.click(screen.getByTestId("save-hours-MONDAY"));

    // then
    expect(changeCard).toHaveBeenCalledWith("card-1", expect.objectContaining({
      label: "Training", requiredRole: "TRAINER", allowedPlayerCounts: [1, 3]
    }));
    expect(setHours).toHaveBeenCalledWith("MONDAY", { opensAt: "09:00", closesAt: "22:00" });
  });

  it("given new facility data, when creating it, then courts and cards are added through the admin API", async () => {
    // given
    const createCourt = vi.spyOn(api, "createAdminCourt").mockResolvedValue({
      id: "court-2", number: 2, name: "Garden Court", active: true
    });
    const createCard = vi.spyOn(api, "createAdminBookingCard").mockResolvedValue({
      id: "card-2", label: "Training", color: "#b85c38", requiredRole: "TRAINER",
      allowedPlayerCounts: [], tracksPlayers: false, countsAgainstLimits: false,
      guestAllowed: false, active: true
    });
    render(<MemoryRouter><AdminFacilityView /></MemoryRouter>);
    const user = userEvent.setup();
    await screen.findByDisplayValue("Centre Court");

    // when
    await user.type(screen.getByTestId("new-court-number"), "2");
    await user.type(screen.getByTestId("new-court-name"), "Garden Court");
    await user.click(screen.getByTestId("create-court"));
    await user.type(screen.getByTestId("new-card-label"), "Training");
    await user.selectOptions(screen.getAllByRole("combobox", { name: "Required role" })[1], "TRAINER");
    await user.click(screen.getByTestId("create-card"));

    // then
    expect(createCourt).toHaveBeenCalledWith({ number: 2, name: "Garden Court" });
    expect(createCard).toHaveBeenCalledWith(expect.objectContaining({ label: "Training", requiredRole: "TRAINER" }));
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
