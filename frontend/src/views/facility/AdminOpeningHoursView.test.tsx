import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "../../api/client";
import i18n from "../../i18n";
import { UnsavedChangesProvider } from "../../unsaved/UnsavedChangesProvider";
import { UnsavedCount } from "../../test/UnsavedCount";
import { WithClubConfiguration } from "../../test/ClubConfiguration";
import { AdminOpeningHoursView } from "./AdminOpeningHoursView";

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
    vi.spyOn(api, "adminOpeningHours").mockResolvedValue([
      { dayOfWeek: "MONDAY", opensAt: "08:00:00", closesAt: "22:00:00" }
    ]);
  });

  // The rule editor on the configuration page links straight here, which is what the route buys.
  it("given opening hours, when the view loads, then the week is shown under a heading of its own", async () => {
    // when
    show();

    // then
    expect(await screen.findByTestId("hours-open-MONDAY")).toHaveValue("08:00");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Opening hours");
  });

  it("given an edited day, when it is counted, then it is asked about on its own", async () => {
    // given
    show(true);
    await screen.findByTestId("hours-open-MONDAY");

    // when
    await userEvent.type(screen.getByTestId("hours-open-MONDAY"), "09:00");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));
  });

  it("given changed hours, when saving, then the admin API receives the values", async () => {
    // given
    const setHours = vi.spyOn(api, "setAdminOpeningHours").mockResolvedValue({
      dayOfWeek: "MONDAY", opensAt: "09:00:00", closesAt: "22:00:00"
    });
    show();
    const user = userEvent.setup();
    await screen.findByTestId("hours-open-MONDAY");

    // when
    await user.clear(screen.getByTestId("hours-open-MONDAY"));
    await user.type(screen.getByTestId("hours-open-MONDAY"), "09:00");
    await user.click(screen.getByTestId("save-hours-MONDAY"));

    // then
    expect(setHours).toHaveBeenCalledWith("MONDAY", { opensAt: "09:00", closesAt: "22:00" });
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
