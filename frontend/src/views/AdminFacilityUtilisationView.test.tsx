import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type FacilityUtilisation } from "../api/client";
import i18n from "../i18n";
import { AdminFacilityUtilisationView } from "./AdminFacilityUtilisationView";

const report: FacilityUtilisation = {
  from: "2026-01-01", to: "2026-03-31", timeZone: "Europe/Zurich",
  courts: [
    { courtId: "court-1", courtNumber: 1, courtName: "Centre court", bookingCount: 12, occupiedMinutes: 750 },
    { courtId: "court-2", courtNumber: 2, courtName: null, bookingCount: 0, occupiedMinutes: 0 }
  ]
};

async function ask(): Promise<void> {
  await userEvent.type(screen.getByTestId("utilisation-from"), "2026-01-01");
  await userEvent.type(screen.getByTestId("utilisation-to"), "2026-03-31");
  await userEvent.click(screen.getByTestId("utilisation-read"));
}

describe("AdminFacilityUtilisationView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given a period a board chose, when it asks, then every court is a row with its occupancy", async () => {
    // given
    const facilityUtilisation = vi.spyOn(api, "facilityUtilisation").mockResolvedValue(report);
    render(<AdminFacilityUtilisationView />);

    // when
    await ask();

    // then
    await waitFor(() => expect(facilityUtilisation).toHaveBeenCalledWith("2026-01-01", "2026-03-31"));
    expect(screen.getByTestId("utilisation-bookings-1")).toHaveTextContent("12");
    expect(screen.getByTestId("utilisation-occupied-1")).toHaveTextContent("12:30");
    expect(screen.getByTestId("utilisation-share-1")).toHaveTextContent("100");
  });

  // A court that held nothing answers the question as much as a busy one does, and a board weighing
  // a second court is asking exactly about the quiet one.
  it("given a court nobody booked, when the period is read, then it is a row rather than an omission", async () => {
    // given
    vi.spyOn(api, "facilityUtilisation").mockResolvedValue(report);
    render(<AdminFacilityUtilisationView />);

    // when
    await ask();

    // then
    await waitFor(() => expect(screen.getByTestId("utilisation-row-2")).toBeInTheDocument());
    expect(screen.getByTestId("utilisation-occupied-2")).toHaveTextContent("0:00");
    expect(screen.getByTestId("utilisation-share-2")).toHaveTextContent("0");
  });

  it("given a period the instance refuses, when it is asked for, then the reason is shown and no table is", async () => {
    // given
    vi.spyOn(api, "facilityUtilisation").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:facility-utilisation-period-invalid",
      title: "Period invalid", status: 400,
      violations: [{ code: "booking.facilityUtilisation.periodTooLong", params: { maxDays: 366 } }]
    }));
    render(<AdminFacilityUtilisationView />);

    // when
    await ask();

    // then
    await waitFor(() => expect(screen.getByRole("alert"))
      .toHaveTextContent("The period may span at most 366 days."));
    expect(screen.queryByTestId("utilisation-row-1")).toBeNull();
  });

  it("given a period read once, when a later one is refused, then the table it answered is gone", async () => {
    // given
    const facilityUtilisation = vi.spyOn(api, "facilityUtilisation").mockResolvedValue(report);
    render(<AdminFacilityUtilisationView />);
    await ask();
    await waitFor(() => expect(screen.getByTestId("utilisation-row-1")).toBeInTheDocument());

    // when
    facilityUtilisation.mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:facility-utilisation-period-invalid",
      title: "Period invalid", status: 400,
      violations: [{ code: "booking.facilityUtilisation.periodOrder", params: {} }]
    }));
    await userEvent.click(screen.getByTestId("utilisation-read"));

    // then
    await waitFor(() => expect(screen.queryByTestId("utilisation-row-1")).toBeNull());
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
