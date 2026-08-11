import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError, api } from "../api/client";
import i18n from "../i18n";
import { WeekView } from "./WeekView";

const courts = [
  { id: "11111111-1111-1111-1111-111111111111", number: 1, name: "Centre Court" },
  { id: "22222222-2222-2222-2222-222222222222", number: 2, name: null }
];

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
  vi.spyOn(api, "bookingGrid").mockResolvedValue({
    timeZone: "Europe/Berlin",
    slotMinutes: 30,
    openingHours: [
      { dayOfWeek: "MONDAY", opensAt: "08:00:00", closesAt: "22:00:00" },
      { dayOfWeek: "TUESDAY", opensAt: "08:00:00", closesAt: "22:00:00" },
      { dayOfWeek: "WEDNESDAY", opensAt: "08:00:00", closesAt: "22:00:00" },
      { dayOfWeek: "THURSDAY", opensAt: "08:00:00", closesAt: "22:00:00" },
      { dayOfWeek: "FRIDAY", opensAt: "08:00:00", closesAt: "22:00:00" },
      { dayOfWeek: "SATURDAY", opensAt: "08:00:00", closesAt: "22:00:00" },
      { dayOfWeek: "SUNDAY", opensAt: "08:00:00", closesAt: "22:00:00" }
    ]
  });
  vi.spyOn(api, "courts").mockResolvedValue(courts);
  vi.spyOn(api, "bookingCards").mockResolvedValue([{
    id: "55555555-5555-5555-5555-555555555555",
    label: "Member booking",
    color: "#b85c38",
    allowedPlayerCounts: [2, 4],
    guestAllowed: true
  }]);
  vi.spyOn(api, "participantCards").mockResolvedValue([{
    id: "66666666-6666-6666-6666-666666666666", label: "Ball machine", capacity: 1
  }]);
  vi.spyOn(api, "participantMembers").mockResolvedValue([]);
  vi.spyOn(api, "createBooking").mockResolvedValue({ id: "77777777-7777-7777-7777-777777777777" });
  vi.spyOn(api, "cancelBooking").mockResolvedValue(undefined);
  vi.spyOn(api, "allocations").mockImplementation((date) => Promise.resolve(date === "2026-08-10" ? [{
    bookingId: "33333333-3333-3333-3333-333333333333",
    courtId: courts[0].id,
    startsAt: "2026-08-10T18:00:00+02:00",
    endsAt: "2026-08-10T19:00:00+02:00",
    cardLabel: "Singles",
    cardColor: "#176b55"
  }] : []));
});

it("given the current week, when it loads, then every day and active court is available", async () => {
  // when
  render(<WeekView today={new Date(2026, 7, 10, 12)} />);

  // then
  expect(await screen.findByRole("heading", { name: "Court occupancy" })).toBeInTheDocument();
  expect(api.allocations).toHaveBeenCalledTimes(7);
  expect(api.allocations).toHaveBeenCalledWith("2026-08-10");
  expect(api.allocations).toHaveBeenCalledWith("2026-08-16");
  expect(screen.getByRole("columnheader", { name: "Centre Court" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Court 2" })).toBeInTheDocument();
  expect(screen.getByRole("rowheader", { name: "08:00" })).toBeInTheDocument();
  expect(screen.getByRole("rowheader", { name: "21:30" })).toBeInTheDocument();
  expect(screen.getByText("Singles")).toHaveStyle({ backgroundColor: "rgb(23, 107, 85)" });
  expect(screen.getAllByText("Singles")).toHaveLength(1);
});

it("given the current week, when opening the next week, then its seven days are loaded", async () => {
  // given
  render(<WeekView today={new Date(2026, 7, 10, 12)} />);
  await screen.findByText("Singles");

  // when
  await userEvent.click(screen.getByTestId("week-next"));

  // then
  await waitFor(() => expect(api.allocations).toHaveBeenCalledWith("2026-08-17"));
  expect(api.allocations).toHaveBeenCalledWith("2026-08-23");
  expect(screen.getByTestId("week-grid")).toHaveAttribute("data-week-offset", "1");
  expect(screen.getByRole("button", { name: /Monday, August 17/ })).toBeInTheDocument();
  expect(screen.getByTestId("week-previous")).toBeInTheDocument();
});

it("given another day is selected, when viewing it, then its occupancy table is shown", async () => {
  // given
  render(<WeekView today={new Date(2026, 7, 10, 12)} />);
  await screen.findByText("Singles");

  // when
  await userEvent.click(screen.getByRole("button", { name: /Tuesday, August 11/ }));

  // then
  expect(screen.queryByText("Singles")).not.toBeInTheDocument();
  expect(screen.getByRole("rowheader", { name: "08:00" })).toBeInTheDocument();
});

it("given the browser and club have different dates, when loading, then the club date is selected", async () => {
  // given
  vi.mocked(api.bookingGrid).mockResolvedValue({
    timeZone: "Pacific/Auckland",
    slotMinutes: 30,
    openingHours: [{ dayOfWeek: "TUESDAY", opensAt: "08:00:00", closesAt: "22:00:00" }]
  });

  // when
  render(<WeekView today={new Date("2026-08-10T22:30:00Z")} />);

  // then
  expect(await screen.findByRole("button", { name: /Tuesday, August 11/ })).toHaveAttribute("aria-pressed", "true");
});

it("given a red booking card, when it is shown, then its label uses the higher-contrast text color", async () => {
  // given
  vi.mocked(api.allocations).mockImplementation((date) => Promise.resolve(date === "2026-08-10" ? [{
    bookingId: "44444444-4444-4444-4444-444444444444",
    courtId: courts[0].id,
    startsAt: "2026-08-10T18:00:00+02:00",
    endsAt: "2026-08-10T18:30:00+02:00",
    cardLabel: "Training",
    cardColor: "#ff0000"
  }] : []));

  // when
  render(<WeekView today={new Date(2026, 7, 10, 12)} />);

  // then
  expect(await screen.findByText("Training")).toHaveStyle({ color: "rgb(15, 23, 42)" });
});

it("given a free slot, when booking it with a guest, then the refreshed allocation is visible", async () => {
  // given
  let created = false;
  vi.mocked(api.createBooking).mockImplementation(() => {
    created = true;
    return Promise.resolve({ id: "77777777-7777-7777-7777-777777777777" });
  });
  vi.mocked(api.allocations).mockImplementation((date) => Promise.resolve(created && date === "2026-08-10" ? [{
    bookingId: "77777777-7777-7777-7777-777777777777",
    courtId: courts[0].id,
    startsAt: "2026-08-10T06:00:00Z",
    endsAt: "2026-08-10T06:30:00Z",
    cardLabel: "Member booking",
    cardColor: "#b85c38"
  }] : []));
  render(<WeekView today={new Date(2026, 7, 10, 12)} />);
  await screen.findByRole("button", { name: "Book Centre Court at 08:00" });

  // when
  await userEvent.click(screen.getByRole("button", { name: "Book Centre Court at 08:00" }));
  await userEvent.type(screen.getByLabelText("Guest name"), "John Roe");
  await userEvent.click(screen.getByRole("button", { name: "Book now" }));

  // then
  await waitFor(() => expect(api.createBooking).toHaveBeenCalledWith(expect.objectContaining({
    courtIds: [courts[0].id],
    cardId: "55555555-5555-5555-5555-555555555555",
    participants: [{ guestName: "John Roe" }]
  }), expect.any(String)));
  expect(await screen.findByText("Member booking")).toBeInTheDocument();
});

it("given booking rules reject a slot, when submitting it, then every violation is translated by its field", async () => {
  // given
  vi.mocked(api.createBooking).mockRejectedValue(new ApiError(422, {
    type: "urn:courtside:error:booking-rules-violated",
    title: "Booking rules violated",
    status: 422,
    violations: [
      { code: "booking.rule.advanceWindow.exceeded", params: { maxDays: 14 } },
      { code: "booking.participants.slotCount", params: { cardLabel: "Member booking", allowed: "2 or 4", actual: 1 } }
    ]
  }));
  render(<WeekView today={new Date(2026, 7, 10, 12)} />);
  await userEvent.click(await screen.findByRole("button", { name: "Book Centre Court at 08:00" }));

  // when
  await userEvent.click(screen.getByRole("button", { name: "Book now" }));

  // then
  const timeViolation = await screen.findByText("You can book at most 14 days in advance.");
  const participantViolation = screen.getByText("The card Member booking allows 2 or 4 players; this booking has 1.");
  expect(timeViolation.parentElement).toHaveAttribute("id", "booking-startsAt-errors");
  expect(participantViolation.parentElement).toHaveAttribute("id", "booking-participants-errors");
  expect(screen.getByRole("group", { name: "Guests" })).toHaveAttribute("aria-describedby", "booking-participants-errors");
  expect(screen.queryByText("booking.rule.advanceWindow.exceeded")).not.toBeInTheDocument();
});

it("given a matching club member, when selecting them, then their person id is submitted", async () => {
  // given
  vi.mocked(api.participantMembers).mockResolvedValue([{
    personId: "88888888-8888-8888-8888-888888888888", displayName: "Mary Major"
  }]);
  render(<WeekView today={new Date(2026, 7, 10, 12)} />);
  await userEvent.click(await screen.findByRole("button", { name: "Book Centre Court at 08:00" }));

  // when
  await userEvent.type(screen.getByLabelText("Search members"), "Mary");
  await userEvent.click(await screen.findByRole("button", { name: "Add Mary Major" }));
  await userEvent.click(screen.getByRole("button", { name: "Book now" }));

  // then
  await waitFor(() => expect(api.createBooking).toHaveBeenCalledWith(expect.objectContaining({
    participants: [{ personId: "88888888-8888-8888-8888-888888888888" }]
  }), expect.any(String)));
});

it("given the booking dialog is open, when pressing escape, then focus returns to the selected slot", async () => {
  // given
  render(<WeekView today={new Date(2026, 7, 10, 12)} />);
  const slot = await screen.findByRole("button", { name: "Book Centre Court at 08:00" });
  await userEvent.click(slot);
  expect(await screen.findByRole("dialog", { name: "Booking on 2026-08-10 at 08:00" })).toBeInTheDocument();

  // when
  await userEvent.keyboard("{Escape}");

  // then
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(slot).toHaveFocus();
});

it("given an occupied slot, when cancelling it, then the API decides and the day is refreshed", async () => {
  // given
  let cancelled = false;
  vi.mocked(api.cancelBooking).mockImplementation(() => {
    cancelled = true;
    return Promise.resolve();
  });
  vi.mocked(api.allocations).mockImplementation((date) => Promise.resolve(!cancelled && date === "2026-08-10" ? [{
    bookingId: "33333333-3333-3333-3333-333333333333",
    courtId: courts[0].id,
    startsAt: "2026-08-10T18:00:00+02:00",
    endsAt: "2026-08-10T19:00:00+02:00",
    cardLabel: "Singles",
    cardColor: "#176b55"
  }] : []));
  render(<WeekView today={new Date(2026, 7, 10, 12)} />);
  await userEvent.click(await screen.findByRole("button", { name: "Singles, cancel booking" }));

  // when
  await userEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));

  // then
  await waitFor(() => expect(api.cancelBooking).toHaveBeenCalledWith("33333333-3333-3333-3333-333333333333"));
  await waitFor(() => expect(screen.queryByText("Singles")).not.toBeInTheDocument());
});
