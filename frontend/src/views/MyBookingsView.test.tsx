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
  vi.spyOn(api, "participations").mockResolvedValue({ items: [] });
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
  const title = await screen.findByTestId("my-bookings-title");
  expect(title).toHaveRole("heading");
  expect(title).toHaveTextContent("My bookings");
  expect(screen.getByTestId("upcoming-bookings")).toHaveTextContent("Upcoming");
  expect(screen.getByTestId("past-bookings")).toHaveTextContent("Past");
  expect(screen.getAllByTestId("series-marker")).toHaveLength(2);
  expect(screen.getByTestId(`booking-${upcomingId}`)).toHaveTextContent("Centre Court");
  expect(screen.getByTestId("booking-44444444-4444-4444-4444-444444444444")).toHaveTextContent("Centre Court");
});

it("given loaded bookings, when translations rebind, then the data remains mounted without another load", async () => {
  // given
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} />);
  const cancel = await screen.findByTestId("personal-cancel");
  cancel.focus();
  const loadsBeforeTranslationChange = vi.mocked(api.personalBookings).mock.calls.length;

  // when
  await i18n.changeLanguage("de");

  // then
  expect(cancel).toHaveFocus();
  expect(screen.getByTestId("personal-cancel")).toBe(cancel);
  expect(api.personalBookings).toHaveBeenCalledTimes(loadsBeforeTranslationChange);
});

it("given an officer, when managed appointments load, then they are separated from personal bookings", async () => {
  // given
  vi.spyOn(api, "managedAppointments").mockResolvedValue({ items: [{
    id: "55555555-5555-5555-5555-555555555555",
    courtIds: ["33333333-3333-3333-3333-333333333333"],
    startsAt: "2026-08-12T18:00:00Z",
    endsAt: "2026-08-12T19:00:00Z",
    cardLabel: "League match",
    cardColor: "#3A4A5C",
    status: "CONFIRMED",
    participantCount: 0
  }] });

  // when
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} showManaged />);

  // then
  const title = await screen.findByTestId("managed-appointments-title");
  expect(title).toHaveRole("heading");
  expect(title).toHaveTextContent("Managed appointments");
  expect(screen.getByTestId("booking-55555555-5555-5555-5555-555555555555")).toHaveTextContent("League match");
  expect(screen.getByTestId("booking-55555555-5555-5555-5555-555555555555")).toHaveTextContent("0 participants");
});

it("given a managed appointment, when opening details, then its internal data is loaded on demand", async () => {
  // given
  const bookingId = "55555555-5555-5555-5555-555555555555";
  vi.spyOn(api, "managedAppointments").mockResolvedValue({ items: [{
    id: bookingId,
    courtIds: ["33333333-3333-3333-3333-333333333333"],
    startsAt: "2026-08-12T18:00:00Z",
    endsAt: "2026-08-12T19:00:00Z",
    cardLabel: "League match",
    cardColor: "#3A4A5C",
    status: "CONFIRMED",
    participantCount: 1
  }] });
  vi.spyOn(api, "managedAppointment").mockResolvedValue({
    id: bookingId,
    courtIds: ["33333333-3333-3333-3333-333333333333"],
    startsAt: "2026-08-12T18:00:00Z",
    endsAt: "2026-08-12T19:00:00Z",
    cardLabel: "League match",
    cardColor: "#3A4A5C",
    status: "CONFIRMED",
    participantCount: 1,
    note: "Prepare score sheets",
    participants: [{ kind: "MEMBER", displayName: "Jane Doe" }]
  });
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} showManaged />);

  // when
  await userEvent.click(await screen.findByTestId("managed-details"));

  // then
  expect(await screen.findByTestId("managed-note")).toHaveTextContent("Prepare score sheets");
  expect(screen.getByTestId("managed-participants")).toHaveTextContent("Jane Doe · Member");
  expect(api.managedAppointment).toHaveBeenCalledWith(bookingId);
});

it("given a cancelled managed appointment, when listed, then its details remain available", async () => {
  // given
  const bookingId = "55555555-5555-5555-5555-555555555555";
  vi.spyOn(api, "managedAppointments").mockResolvedValue({ items: [{
    id: bookingId,
    courtIds: ["33333333-3333-3333-3333-333333333333"],
    startsAt: "2026-08-12T18:00:00Z",
    endsAt: "2026-08-12T19:00:00Z",
    cardLabel: "League match",
    cardColor: "#3A4A5C",
    status: "CANCELLED",
    participantCount: 0
  }] });
  vi.spyOn(api, "managedAppointment").mockResolvedValue({
    id: bookingId,
    courtIds: ["33333333-3333-3333-3333-333333333333"],
    startsAt: "2026-08-12T18:00:00Z",
    endsAt: "2026-08-12T19:00:00Z",
    cardLabel: "League match",
    cardColor: "#3A4A5C",
    status: "CANCELLED",
    participantCount: 0,
    note: "Retain for the audit trail",
    participants: []
  });
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} showManaged />);

  // when
  await userEvent.click(await screen.findByTestId("managed-details"));

  // then
  expect(await screen.findByTestId("managed-note")).toHaveTextContent("Retain for the audit trail");
  expect(screen.queryByTestId("managed-cancel")).not.toBeInTheDocument();
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
  await userEvent.click(await screen.findByTestId("load-more-bookings"));

  // then
  expect(await screen.findByTestId(`booking-${upcomingId}`)).toHaveTextContent("Member booking");
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
  await userEvent.click(await screen.findByTestId("personal-cancel"));

  // when
  await userEvent.click(screen.getByTestId("scope-WHOLE_SERIES"));

  // then
  expect(screen.getByTestId("incomplete-series-warning")).toHaveTextContent("Additional series occurrences that have not been loaded may also be affected.");
});

it("given the browser and club use different zones, when loaded, then booking times use the club zone", async () => {
  // given
  vi.mocked(api.bookingGrid).mockResolvedValue({
    timeZone: "Pacific/Auckland", slotMinutes: 30, openingHours: []
  });

  // when
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} />);

  // then
  expect(await screen.findByTestId(`booking-${upcomingId}`)).toHaveTextContent("Aug 13, 2026, 4:00 AM");
});

it("given a series occurrence, when cancelling this and following, then the series endpoint receives that scope", async () => {
  // given
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} />);
  await userEvent.click(await screen.findByTestId("personal-cancel"));

  // when
  await userEvent.click(screen.getByTestId("scope-THIS_AND_FOLLOWING"));
  await userEvent.click(screen.getByTestId("confirm-cancellation"));

  // then
  await waitFor(() => expect(api.cancelSeries).toHaveBeenCalledWith(seriesId, upcomingId, "THIS_AND_FOLLOWING"));
});

it("given a series occurrence, when previewing and confirming a move, then the same scoped request is executed", async () => {
  // given
  render(<MyBookingsView now={new Date("2026-08-11T12:00:00Z")} />);
  await userEvent.click(await screen.findByTestId("move-booking"));
  await userEvent.click(screen.getByTestId("scope-WHOLE_SERIES"));
  await userEvent.clear(screen.getByTestId("move-start-time"));
  await userEvent.type(screen.getByTestId("move-start-time"), "19:00");

  // when
  await userEvent.click(screen.getByTestId("preview-move"));

  // then
  expect(await screen.findByTestId("move-preview")).toHaveTextContent("1 occurrence can be moved.");
  await userEvent.click(screen.getByTestId("confirm-move"));
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
  await userEvent.click(await screen.findByTestId("move-booking"));
  await userEvent.type(screen.getByTestId("move-start-time"), "22:00");

  // when
  await userEvent.click(screen.getByTestId("preview-move"));

  // then
  expect(await screen.findByTestId("move-preview")).toHaveTextContent("The facility is closed on this day.");
  expect(screen.getByTestId("occupied-courts")).toHaveTextContent("Occupied courts: Centre Court");
  expect(screen.getByTestId("unavailable-courts")).toHaveTextContent("Unavailable courts: Centre Court");
  expect(screen.getByTestId("confirm-move")).toBeDisabled();
});

const participationId = "55555555-5555-5555-5555-555555555555";

function recordedAsCoPlayer() {
  vi.spyOn(api, "participations").mockResolvedValue({ items: [
    {
      id: participationId,
      courtIds: ["33333333-3333-3333-3333-333333333333"],
      startsAt: "2026-08-19T16:00:00Z",
      endsAt: "2026-08-19T17:00:00Z",
      cardLabel: "Member booking",
      cardColor: "#176b55",
      status: "CONFIRMED"
    }
  ] });
}

it("given somebody named this member, when the page loads, then the participation is listed", async () => {
  recordedAsCoPlayer();

  render(<MyBookingsView now={new Date("2026-08-12T12:00:00Z")} />);

  expect(await screen.findByTestId(`participation-${participationId}`)).toBeInTheDocument();
});

it("given a listed participation, when the member withdraws, then it is sent and the page reloads", async () => {
  recordedAsCoPlayer();
  const withdraw = vi.spyOn(api, "withdrawParticipation").mockResolvedValue(undefined);

  render(<MyBookingsView now={new Date("2026-08-12T12:00:00Z")} />);
  await userEvent.click(await screen.findByTestId("withdraw-participation"));

  await waitFor(() => expect(withdraw).toHaveBeenCalledWith(participationId));
  await waitFor(() => expect(api.participations).toHaveBeenCalledTimes(2));
});

it("given the withdrawal fails, when the member tries, then the reason is shown rather than swallowed", async () => {
  recordedAsCoPlayer();
  vi.spyOn(api, "withdrawParticipation").mockRejectedValue(
    { status: 404, problem: { type: "urn:courtside:error:participation-not-found" } });

  render(<MyBookingsView now={new Date("2026-08-12T12:00:00Z")} />);
  await userEvent.click(await screen.findByTestId("withdraw-participation"));

  expect(await screen.findByRole("alert")).toBeInTheDocument();
});
