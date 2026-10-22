import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { ApiError, api } from "../api/client";
import i18n from "../i18n";
import { withFinePointer } from "../test/pointer";
import { BookingDialog } from "./BookingDialog";

const court = { id: "11111111-1111-1111-1111-111111111111", number: 1, name: "Centre Court" };
const grid = {
  timeZone: "Europe/Berlin", slotMinutes: 30, openingWeeks: [], openingPeriods: [], courtClosures: [],
  openingHours: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
    .map((dayOfWeek) => ({ dayOfWeek, opensAt: "08:00:00", closesAt: "22:00:00" }))
};

function show() {
  render(<BookingDialog selection={{ date: "2026-08-10", slot: "10:00", courtId: court.id }} grid={grid as never}
    courts={[court]} allocations={[]} canChooseSeveralCourts={false}
    closed={() => undefined} created={() => Promise.resolve()} conflicted={() => Promise.resolve()} />);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("de");
  vi.spyOn(api, "bookingCards").mockResolvedValue([]);
  vi.spyOn(api, "participantCards").mockResolvedValue([]);
  vi.spyOn(api, "participantMembers").mockResolvedValue([]);
});

it("given a mouse, when the dialog opens, then it says the plan can be dragged across", async () => {
  // given
  withFinePointer(true);

  // when
  show();

  // then
  expect(await screen.findByTestId("booking-duration-hint")).toHaveTextContent(i18n.t("booking.durationHint"));
  expect(screen.getByTestId("booking-duration").getAttribute("aria-describedby")?.split(" "))
    .toContain("booking-duration-hint");
});

it("given only touch, when the dialog opens, then it says nothing about dragging", async () => {
  // given
  withFinePointer(false);

  // when
  show();

  // then
  await screen.findByTestId("booking-duration");
  expect(screen.queryByTestId("booking-duration-hint"), "a device without a mouse cannot drag across slots").not.toBeInTheDocument();
  expect(screen.getByTestId("booking-duration").getAttribute("aria-describedby") ?? "").not.toContain("booking-duration-hint");
});

it("given a mouse is plugged in, when the dialog is open, then the drag hint appears", async () => {
  // given
  withFinePointer(false);
  show();
  await screen.findByTestId("booking-duration");
  await act(() => new Promise((settled) => setTimeout(settled, 50)));
  expect(screen.queryByTestId("booking-duration-hint")).not.toBeInTheDocument();

  // when
  act(() => withFinePointer(true));

  // then
  expect(screen.getByTestId("booking-duration-hint"), "the dialog follows the pointer change itself").toBeInTheDocument();
});

it("given the German copy, when the duration is bounded, then it speaks of the club as Verein", () => {
  // when
  const bound = i18n.t("booking.durationBound", { duration: "1 Stunde" });

  // then
  expect(bound).toMatch(/^Der Verein /);
});

it("given a booking the club refuses, when the refusal arrives, then the duration comes back into view beside it", async () => {
  // given
  vi.spyOn(api, "bookingCards").mockResolvedValue([{
    id: "55555555-5555-5555-5555-555555555555", label: "Member booking", color: "#b85c38", allowedPlayerCounts: [1, 2, 4], guestAllowed: true
  }]);
  vi.spyOn(api, "createBooking").mockRejectedValue(new ApiError(409, {
    type: "urn:courtside:error:court-unavailable", title: "Court unavailable", status: 409
  }));
  const scrolled = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrolled });
  onTestFinished(() => { delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; });
  show();
  const duration = await screen.findByTestId("booking-duration");
  await act(() => new Promise((settled) => setTimeout(settled, 50)));

  // when
  fireEvent.click(screen.getByTestId("booking-submit"));

  // then
  await screen.findByTestId("booking-refusal");
  expect(scrolled.mock.contexts, "the duration is the element brought into view").toContain(duration);
  expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
});
