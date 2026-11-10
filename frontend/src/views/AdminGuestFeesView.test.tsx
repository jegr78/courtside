import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api, ApiError, type GuestFeeReport } from "../api/client";
import * as downloads from "../downloads/downloadJson";
import i18n from "../i18n";
import { AdminGuestFeesView } from "./AdminGuestFeesView";

const report: GuestFeeReport = {
  from: "2026-01-01",
  to: "2026-12-31",
  sources: [{ id: "55555555-0000-0000-0000-000000000001", displayName: "Main roster" }],
  members: [
    { personId: "66666666-0000-0000-0000-000000000001", firstName: "Jane", lastName: "Doe", email: "jane.doe@example.org",
      memberNumbers: [{ sourceId: "55555555-0000-0000-0000-000000000001", externalId: "A-17" }],
      currency: "EUR", guestPlaces: 5, sumMinor: 2500 }
  ],
  unassignedGuestPlaces: 2
};

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});

it("given guest fees in the current year, when the page opens, then each member's places and amount are listed with the year as period", async () => {
  // given
  const read = vi.spyOn(api, "guestFees").mockResolvedValue(report);

  // when
  render(<AdminGuestFeesView />);

  // then
  const row = await screen.findByTestId("guest-fees-row");
  expect(read, "the server chooses the current year").toHaveBeenCalledWith();
  expect(row).toHaveTextContent("Doe, Jane");
  expect(row).toHaveTextContent("A-17");
  expect(screen.getByTestId("guest-fees-places")).toHaveTextContent("5");
  expect(screen.getByTestId("guest-fees-amount")).toHaveTextContent("€25.00");
  expect(screen.getByTestId("guest-fees-period")).toHaveTextContent("2026");
  expect(screen.getByTestId("guest-fees-unassigned")).toHaveTextContent("2 guest places belong to bookings");
});

it("given a chosen period, when the treasurer downloads the file, then it covers that period with the chosen separator", async () => {
  // given
  vi.spyOn(api, "guestFees").mockResolvedValue(report);
  const exported = vi.spyOn(api, "exportGuestFees").mockResolvedValue({ fileName: "guest-fees.csv", content: new Blob(["x"]) });
  const saved = vi.spyOn(downloads, "downloadBlob").mockImplementation(() => undefined);
  render(<AdminGuestFeesView />);
  await screen.findByTestId("guest-fees-row");

  // when
  await userEvent.selectOptions(screen.getByTestId("guest-fees-separator"), ",");
  await userEvent.click(screen.getByTestId("guest-fees-download"));

  // then
  await waitFor(() => expect(saved).toHaveBeenCalledWith("guest-fees.csv", expect.any(Blob)));
  expect(exported).toHaveBeenCalledWith({ from: "2026-01-01", to: "2026-12-31", separator: "," });
});

it("given a period typed but not read, when the treasurer downloads the file, then it covers the period on screen", async () => {
  // given
  vi.spyOn(api, "guestFees").mockResolvedValue(report);
  const exported = vi.spyOn(api, "exportGuestFees").mockResolvedValue({ fileName: "guest-fees.csv", content: new Blob(["x"]) });
  vi.spyOn(downloads, "downloadBlob").mockImplementation(() => undefined);
  render(<AdminGuestFeesView />);
  await screen.findByTestId("guest-fees-row");
  const from = screen.getByTestId("guest-fees-from");
  await userEvent.clear(from);
  await userEvent.type(from, "2025-03-01");

  // when
  await userEvent.click(screen.getByTestId("guest-fees-download"));

  // then
  await waitFor(() => expect(exported).toHaveBeenCalledWith({ from: "2026-01-01", to: "2026-12-31", separator: ";" }));
});

it("given a period the server refuses, when it is read, then the refusal is shown", async () => {
  // given
  vi.spyOn(api, "guestFees").mockResolvedValueOnce(report).mockRejectedValueOnce(
    new ApiError(400, { type: "urn:courtside:error:facility-utilisation-period-invalid", title: "Period invalid", status: 400, violations: [{ code: "booking.facilityUtilisation.periodOrder", params: {} }] }));
  render(<AdminGuestFeesView />);
  await screen.findByTestId("guest-fees-row");

  // when
  await userEvent.click(screen.getByTestId("guest-fees-read"));

  // then
  expect(await screen.findByTestId("guest-fees-error")).toBeInTheDocument();
});

it("given no guest fees, when the page opens, then it says so instead of an empty table", async () => {
  // given
  vi.spyOn(api, "guestFees").mockResolvedValue({ ...report, members: [], unassignedGuestPlaces: 0 });

  // when
  render(<AdminGuestFeesView />);

  // then
  expect(await screen.findByTestId("guest-fees-empty")).toBeInTheDocument();
  expect(screen.queryByTestId("guest-fees-unassigned")).not.toBeInTheDocument();
});
