import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import i18n from "../i18n";
import { MyBookingsView } from "./MyBookingsView";

const seriesId = "11111111-1111-1111-1111-111111111111";
const upcomingId = "22222222-2222-2222-2222-222222222222";

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
  vi.spyOn(api, "courts").mockResolvedValue([
    { id: "33333333-3333-3333-3333-333333333333", number: 1, name: "Centre Court" }
  ]);
  vi.spyOn(api, "bookingGrid").mockResolvedValue({
    timeZone: "Europe/Berlin", slotMinutes: 30, openingHours: []
  });
  vi.spyOn(api, "personalBookings").mockResolvedValue({ items: [
    {
      id: upcomingId,
      seriesId,
      courtIds: ["33333333-3333-3333-3333-333333333333"],
      startsAt: "2026-08-12T16:00:00Z",
      endsAt: "2026-08-12T17:00:00Z",
      cardLabel: "Member booking",
      cardColor: "#176b55",
      status: "CONFIRMED"
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      seriesId,
      courtIds: ["33333333-3333-3333-3333-333333333333"],
      startsAt: "2026-08-05T16:00:00Z",
      endsAt: "2026-08-05T17:00:00Z",
      cardLabel: "Member booking",
      cardColor: "#176b55",
      status: "CONFIRMED"
    }
  ] });
  vi.spyOn(api, "cancelSeries").mockResolvedValue(undefined);
  vi.spyOn(api, "previewSeriesMove").mockResolvedValue({
    executable: true,
    moves: [{
      bookingId: upcomingId,
      fromStartsAt: "2026-08-12T16:00:00Z",
      toStartsAt: "2026-08-12T17:00:00Z",
      blockedCourtIds: [], unbookableCourtIds: [], violations: [], executable: true
    }]
  });
  vi.spyOn(api, "moveSeries").mockResolvedValue({ moved: 1 });
});

it("given past and upcoming occurrences, when loaded, then the series is grouped in both sections", async () => {
  // when
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} />);

  // then
  expect(await screen.findByRole("heading", { name: "My bookings" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Upcoming" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Past" })).toBeInTheDocument();
  expect(screen.getAllByText("Series")).toHaveLength(2);
  expect(screen.getAllByText("Centre Court")).toHaveLength(2);
});

it("given another page exists, when loading more, then its bookings are appended", async () => {
  // given
  vi.mocked(api.personalBookings)
    .mockResolvedValueOnce({ items: [], nextCursor: upcomingId })
    .mockResolvedValueOnce({ items: [{
      id: upcomingId,
      courtIds: ["33333333-3333-3333-3333-333333333333"],
      startsAt: "2026-08-12T16:00:00Z",
      endsAt: "2026-08-12T17:00:00Z",
      cardLabel: "Member booking",
      cardColor: "#176b55",
      status: "CONFIRMED"
    }] });
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} />);

  // when
  await userEvent.click(await screen.findByRole("button", { name: "Load more bookings" }));

  // then
  expect(await screen.findByText("Member booking")).toBeInTheDocument();
  expect(api.personalBookings).toHaveBeenLastCalledWith(upcomingId);
});

it("given more bookings exist, when previewing a series cancellation, then the incomplete preview is disclosed", async () => {
  // given
  vi.mocked(api.personalBookings).mockResolvedValueOnce({
    items: [{
      id: upcomingId, seriesId, courtIds: ["33333333-3333-3333-3333-333333333333"],
      startsAt: "2026-08-12T16:00:00Z", endsAt: "2026-08-12T17:00:00Z",
      cardLabel: "Member booking", cardColor: "#176b55", status: "CONFIRMED"
    }],
    nextCursor: upcomingId
  });
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} />);
  await userEvent.click(await screen.findByRole("button", { name: "Cancel Member booking" }));

  // when
  await userEvent.click(screen.getByLabelText("Whole series"));

  // then
  expect(screen.getByText("Additional series occurrences that have not been loaded may also be affected.")).toBeInTheDocument();
});

it("given the browser and club use different zones, when loaded, then booking times use the club zone", async () => {
  // given
  vi.mocked(api.bookingGrid).mockResolvedValue({
    timeZone: "Pacific/Auckland", slotMinutes: 30, openingHours: []
  });

  // when
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} />);

  // then
  expect(await screen.findByText("Aug 13, 2026, 4:00 AM")).toBeInTheDocument();
});

it("given a series occurrence, when cancelling this and following, then the series endpoint receives that scope", async () => {
  // given
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} />);
  await userEvent.click(await screen.findByRole("button", { name: "Cancel Member booking" }));

  // when
  await userEvent.click(screen.getByLabelText("This and following"));
  await userEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));

  // then
  await waitFor(() => expect(api.cancelSeries).toHaveBeenCalledWith(seriesId, upcomingId, "THIS_AND_FOLLOWING"));
});

it("given a series occurrence, when previewing and confirming a move, then the same scoped request is executed", async () => {
  // given
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} />);
  await userEvent.click(await screen.findByRole("button", { name: "Move Member booking" }));
  await userEvent.click(screen.getByLabelText("Whole series"));
  await userEvent.clear(screen.getByLabelText("New start time"));
  await userEvent.type(screen.getByLabelText("New start time"), "19:00");

  // when
  await userEvent.click(screen.getByRole("button", { name: "Preview move" }));

  // then
  expect(await screen.findByText("1 occurrence can be moved.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Confirm move" }));
  await waitFor(() => expect(api.moveSeries).toHaveBeenCalledWith(seriesId, expect.objectContaining({
    fromBookingId: upcomingId, scope: "WHOLE_SERIES", newStartTime: "19:00"
  })));
});

it("given a move is blocked, when previewed, then every reason is translated and courts are named", async () => {
  // given
  vi.mocked(api.previewSeriesMove).mockResolvedValue({
    executable: false,
    moves: [{
      bookingId: upcomingId,
      fromStartsAt: "2026-08-12T16:00:00Z",
      toStartsAt: "2026-08-12T20:00:00Z",
      blockedCourtIds: ["33333333-3333-3333-3333-333333333333"],
      unbookableCourtIds: ["33333333-3333-3333-3333-333333333333"],
      violations: [{ code: "booking.rule.openingHours.closed", params: {} }],
      executable: false
    }]
  });
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} />);
  await userEvent.click(await screen.findByRole("button", { name: "Move Member booking" }));
  await userEvent.type(screen.getByLabelText("New start time"), "22:00");

  // when
  await userEvent.click(screen.getByRole("button", { name: "Preview move" }));

  // then
  expect(await screen.findByText("The facility is closed on this day.")).toBeInTheDocument();
  expect(screen.getByText("Occupied courts: Centre Court")).toBeInTheDocument();
  expect(screen.getByText("Unavailable courts: Centre Court")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm move" })).toBeDisabled();
});
