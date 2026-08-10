import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
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
