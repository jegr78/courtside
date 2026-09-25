import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type FacilityUtilisation } from "../api/client";
import i18n from "../i18n";
import { AdminFacilityUtilisationView } from "./AdminFacilityUtilisationView";

const lastMonth: FacilityUtilisation = {
  from: "2026-04-01", to: "2026-04-30", timeZone: "Europe/Zurich", openMinutes: 3000,
  courts: [
    { courtId: "court-1", courtNumber: 1, courtName: "Centre court", bookingCount: 12,
      occupiedMinutes: 810, occupiedOpenMinutes: 750, occupancy: 0.25 },
    { courtId: "court-2", courtNumber: 2, courtName: null, bookingCount: 0,
      occupiedMinutes: 0, occupiedOpenMinutes: 0, occupancy: 0 }
  ]
};

const chosen: FacilityUtilisation = { ...lastMonth, from: "2026-01-01", to: "2026-03-31" };

async function ask(): Promise<void> {
  await userEvent.clear(screen.getByTestId("utilisation-from"));
  await userEvent.type(screen.getByTestId("utilisation-from"), "2026-01-01");
  await userEvent.clear(screen.getByTestId("utilisation-to"));
  await userEvent.type(screen.getByTestId("utilisation-to"), "2026-03-31");
  await userEvent.click(screen.getByTestId("utilisation-read"));
}

describe("AdminFacilityUtilisationView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given nothing entered, when the page opens, then last month is read and its dates fill the form", async () => {
    // given
    const facilityUtilisation = vi.spyOn(api, "facilityUtilisation").mockResolvedValue(lastMonth);

    // when
    render(<AdminFacilityUtilisationView />);

    // then
    await waitFor(() => expect(screen.getByTestId("utilisation-row-1")).toBeInTheDocument());
    expect(facilityUtilisation).toHaveBeenCalledExactlyOnceWith();
    expect(screen.getByTestId("utilisation-from")).toHaveValue("2026-04-01");
    expect(screen.getByTestId("utilisation-to")).toHaveValue("2026-04-30");
  });

  it("given a report, when its period is shown, then the dates are formatted for the reader rather than printed as ISO", async () => {
    // given
    vi.spyOn(api, "facilityUtilisation").mockResolvedValue(lastMonth);

    // when
    render(<AdminFacilityUtilisationView />);

    // then
    const period = await screen.findByTestId("utilisation-period");
    await waitFor(() => expect(period).toHaveTextContent(/Apr 1\s*–\s*30, 2026/));
    expect(period).not.toHaveTextContent("2026-04-01");
    expect(period).toHaveTextContent("Europe/Zurich");
  });

  it("given a court held for a quarter of the open hours, when the report shows, then it reads a quarter with a bar a quarter long", async () => {
    // given
    vi.spyOn(api, "facilityUtilisation").mockResolvedValue(lastMonth);

    // when
    render(<AdminFacilityUtilisationView />);

    // then
    await waitFor(() => expect(screen.getByTestId("utilisation-occupancy-1")).toHaveTextContent("25 %"));
    expect(screen.getByTestId("utilisation-bar-1")).toHaveStyle({ width: "25%" });
    expect(screen.getByTestId("utilisation-open")).toHaveTextContent("50:00");
    expect(screen.getByTestId("utilisation-occupied-1")).toHaveTextContent("13:30");
  });

  it("given a period a board chose, when it asks, then that period is read and every court is a row", async () => {
    // given
    const facilityUtilisation = vi.spyOn(api, "facilityUtilisation").mockResolvedValue(lastMonth);
    render(<AdminFacilityUtilisationView />);
    await waitFor(() => expect(screen.getByTestId("utilisation-row-1")).toBeInTheDocument());
    facilityUtilisation.mockResolvedValue(chosen);

    // when
    await ask();

    // then
    await waitFor(() => expect(facilityUtilisation).toHaveBeenLastCalledWith({ from: "2026-01-01", to: "2026-03-31" }));
    await waitFor(() => expect(screen.getByTestId("utilisation-period")).toHaveTextContent(/Jan 1\s*–\s*Mar 31, 2026/));
    expect(screen.getByTestId("utilisation-bookings-1")).toHaveTextContent("12");
  });

  it("given a court nobody booked, when the period is read, then it is a row with an empty bar rather than an omission", async () => {
    // given
    vi.spyOn(api, "facilityUtilisation").mockResolvedValue(lastMonth);

    // when
    render(<AdminFacilityUtilisationView />);

    // then
    await waitFor(() => expect(screen.getByTestId("utilisation-row-2")).toBeInTheDocument());
    expect(screen.getByTestId("utilisation-occupied-2")).toHaveTextContent("0:00");
    expect(screen.getByTestId("utilisation-occupancy-2")).toHaveTextContent("0 %");
    expect(screen.getByTestId("utilisation-bar-2")).toHaveStyle({ width: "0%" });
  });

  it("given a period without opening hours, when it is read, then no share is claimed and the reason is said", async () => {
    // given
    vi.spyOn(api, "facilityUtilisation").mockResolvedValue({
      ...lastMonth, openMinutes: 0,
      courts: lastMonth.courts.map((court) => ({ ...court, occupiedOpenMinutes: 0, occupancy: null }))
    });

    // when
    render(<AdminFacilityUtilisationView />);

    // then
    await waitFor(() => expect(screen.getByTestId("utilisation-closed"))
      .toHaveTextContent("The facility had no opening hours in this period"));
    expect(screen.getByTestId("utilisation-occupancy-1")).toHaveTextContent("–");
    expect(screen.queryByTestId("utilisation-bar-1")).toBeNull();
  });

  it("given last month cannot be read, when the page opens, then the failure offers a retry that reads it again", async () => {
    // given
    const facilityUtilisation = vi.spyOn(api, "facilityUtilisation")
      .mockRejectedValueOnce(new ApiError(500, { type: "urn:courtside:error:internal-error", title: "Internal error", status: 500 }))
      .mockResolvedValue(lastMonth);
    render(<AdminFacilityUtilisationView />);
    await waitFor(() => expect(screen.getByTestId("load-failure")).toBeInTheDocument());

    // when
    await userEvent.click(screen.getByTestId("retry-load"));

    // then
    await waitFor(() => expect(screen.getByTestId("utilisation-row-1")).toBeInTheDocument());
    expect(facilityUtilisation).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("load-failure")).toBeNull();
  });

  it("given a board that asks before last month arrives, when last month then answers, then it replaces neither the dates nor the report", async () => {
    // given
    let answerLastMonth: (report: FacilityUtilisation) => void = () => undefined;
    vi.spyOn(api, "facilityUtilisation")
      .mockImplementationOnce(() => new Promise((resolve) => { answerLastMonth = resolve; }))
      .mockResolvedValue(chosen);
    render(<AdminFacilityUtilisationView />);
    await ask();
    await waitFor(() => expect(screen.getByTestId("utilisation-period")).toHaveTextContent(/Jan 1\s*–\s*Mar 31, 2026/));

    // when
    await act(async () => { answerLastMonth(lastMonth); await Promise.resolve(); });

    // then
    expect(screen.getByTestId("utilisation-period")).toHaveTextContent(/Jan 1\s*–\s*Mar 31, 2026/);
    expect(screen.getByTestId("utilisation-from")).toHaveValue("2026-01-01");
  });

  it("given a period the instance refuses, when it is asked for, then the reason is shown and no table is", async () => {
    // given
    const facilityUtilisation = vi.spyOn(api, "facilityUtilisation").mockResolvedValue(lastMonth);
    render(<AdminFacilityUtilisationView />);
    await waitFor(() => expect(screen.getByTestId("utilisation-row-1")).toBeInTheDocument());
    facilityUtilisation.mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:facility-utilisation-period-invalid",
      title: "Period invalid", status: 400,
      violations: [{ code: "booking.facilityUtilisation.periodTooLong", params: { maxDays: 366 } }]
    }));

    // when
    await ask();

    // then
    await waitFor(() => expect(screen.getByRole("alert"))
      .toHaveTextContent("The period may span at most 366 days."));
    expect(screen.queryByTestId("utilisation-row-1")).toBeNull();
  });
});
