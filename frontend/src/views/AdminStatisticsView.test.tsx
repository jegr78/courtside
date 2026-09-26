import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type BookingStatistics, type MemberStatistics, type MessageStatistics,
  type StatisticsRange, type UtilisationStatistics } from "../api/client";
import i18n from "../i18n";
import { AdminStatisticsView } from "./AdminStatisticsView";

const period = { from: "2026-02-01", to: "2026-02-28", timeZone: "Europe/Zurich" };
const before = { from: "2026-01-04", to: "2026-01-31", timeZone: "Europe/Zurich" };
const CENTRE = "11111111-0000-0000-0000-000000000001";
const OUTER = "11111111-0000-0000-0000-000000000002";
const MEMBER_CARD = "22222222-0000-0000-0000-000000000001";
const CLOSED_CARD = "22222222-0000-0000-0000-000000000002";
const FILLER = "33333333-0000-0000-0000-000000000001";
const ADULT = "44444444-0000-0000-0000-000000000001";

function totals(bookedMinutes: number, closedMinutes: number, occupancy: number | null) {
  return { openMinutes: 6000, courtCount: 2, capacityMinutes: 12000, closedMinutes, bookedMinutes, occupancy };
}

function hours(): UtilisationStatistics["hours"] {
  return Array.from({ length: 168 }, (_, index) => {
    const isoWeekday = Math.floor(index / 24) + 1;
    const hour = index % 24;
    const open = (hour >= 8 && hour < 20) || (isoWeekday === 6 && hour === 7);
    const occupancy = !open ? null : isoWeekday === 1 && hour === 8 ? 0.5 : isoWeekday === 1 && hour === 9 ? 0 : 0.1;
    return { isoWeekday, hour, openMinutes: open ? 240 : 0, closedMinutes: 0, bookedMinutes: 0, occupancy };
  });
}

const utilisation: UtilisationStatistics = {
  period,
  totals: totals(3000, 600, 0.25),
  previous: { period: before, totals: totals(2400, 600, 0.2) },
  courts: [
    { courtId: CENTRE, courtNumber: 1, courtName: "Centre court", active: true, bookings: 12, closedMinutes: 600,
      bookedMinutes: 810, occupancy: 0.25 },
    { courtId: OUTER, courtNumber: 2, courtName: null, active: false, bookings: 0, closedMinutes: 0,
      bookedMinutes: 0, occupancy: 0 }
  ],
  cards: [
    { cardId: MEMBER_CARD, label: "Member booking", color: "#af5030", closure: false, bookings: 12, minutes: 810 },
    { cardId: CLOSED_CARD, label: "Court closed", color: "#697970", closure: true, bookings: 2, minutes: 270 }
  ],
  hours: hours(),
  progression: {
    granularity: "WEEK",
    buckets: [
      { startsOn: "2026-02-01", endsOn: "2026-02-01", totals: totals(0, 0, 0) },
      { startsOn: "2026-02-02", endsOn: "2026-02-08", totals: totals(900, 0, 0.4) }
    ]
  }
};

const bookings: BookingStatistics = {
  period,
  figures: { confirmed: 12, cancelled: 3, cancellationRate: 0.2, series: 4, single: 8, withGuests: 2, guestEntries: 3 },
  previous: {
    period: before,
    figures: { confirmed: 10, cancelled: 3, cancellationRate: 0.23, series: 4, single: 6, withGuests: 0, guestEntries: 5 }
  },
  participantCards: [{ cardId: FILLER, label: "Ball machine", uses: 7 }]
};

const members: MemberStatistics = {
  period,
  figures: { members: 120, joins: 4, leavings: 1, activeMembers: 48, activeShare: 0.4 },
  previous: { period: before, figures: { members: 117, joins: 0, leavings: 2, activeMembers: 48, activeShare: 0.41 } },
  membershipTypes: [{ membershipTypeId: ADULT, name: "Adult", members: 90 }],
  accounts: { accounts: 100, passwordChosen: 80, withoutChosenPassword: 20, signedInWithin30Days: 60,
    signedInWithin90Days: 75, neverSignedIn: 10 }
};

const quiet = { queued: 0, handedOver: 0, refused: 0, failed: 0 };
const messages: MessageStatistics = {
  period,
  kinds: [
    { kind: "BOOKING_CONFIRMED", queued: 1, handedOver: 30, refused: 2, failed: 0 },
    { kind: "BOOKING_REMINDER", ...quiet }
  ],
  previous: null
};

const range: StatisticsRange = { firstBookingOn: "2024-04-12", today: "2026-03-31" };

function Address() {
  const location = useLocation();
  return <output data-testid="address">{location.search}</output>;
}

function Back() {
  const navigate = useNavigate();
  return <button type="button" data-testid="back" onClick={() => void navigate(-1)} />;
}

function show(entry = "/admin/utilisation") {
  render(<MemoryRouter initialEntries={[entry]}><AdminStatisticsView /><Address /></MemoryRouter>);
}

function reads() {
  return {
    range: vi.spyOn(api, "statisticsRange").mockResolvedValue(range),
    utilisation: vi.spyOn(api, "utilisationStatistics").mockResolvedValue(utilisation),
    bookings: vi.spyOn(api, "bookingStatistics").mockResolvedValue(bookings),
    members: vi.spyOn(api, "memberStatistics").mockResolvedValue(members),
    messages: vi.spyOn(api, "messageStatistics").mockResolvedValue(messages)
  };
}

const failure = () => new ApiError(500, { type: "urn:courtside:error:internal-error", title: "Internal error", status: 500 });

async function loaded() {
  await screen.findByTestId("utilisation-row-1");
  await screen.findByTestId("statistics-confirmed");
  await screen.findByTestId("statistics-members-total");
  await screen.findByTestId("statistics-message-BOOKING_CONFIRMED");
  await waitFor(() => expect(screen.getByTestId("statistics-choice-1m")).toBeEnabled());
}

describe("AdminStatisticsView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given no period in the address, when the page opens, then every section reads the default period and its dates fill the form", async () => {
    // given
    const read = reads();

    // when
    show();

    // then
    await loaded();
    for (const section of [read.utilisation, read.bookings, read.members, read.messages]) {
      expect(section).toHaveBeenCalledExactlyOnceWith(undefined);
    }
    expect(screen.getByTestId("utilisation-from")).toHaveValue("2026-02-01");
    expect(screen.getByTestId("utilisation-to")).toHaveValue("2026-02-28");
    expect(screen.getByTestId("utilisation-period")).toHaveTextContent(/Feb 1\s*–\s*28, 2026/);
    expect(screen.getByTestId("utilisation-period")).toHaveTextContent("Europe/Zurich");
    expect(screen.getByTestId("address")).toHaveTextContent(/^$/);
    for (const choice of ["7d", "1m", "3m", "6m", "12m", "all", "previousYear"]) {
      expect(screen.getByTestId(`statistics-choice-${choice}`)).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("given a period and the one before it, when the utilisation shows, then each key figure states its change in its own unit", async () => {
    // given
    reads();

    // when
    show();

    // then
    await loaded();
    expect(screen.getByTestId("statistics-occupancy-value")).toHaveTextContent("25%");
    expect(screen.getByTestId("statistics-occupancy-change")).toHaveAttribute("data-direction", "up");
    expect(screen.getByTestId("statistics-occupancy-change")).toHaveTextContent("+5 percentage points against the period before");
    expect(screen.getByTestId("statistics-booked-value")).toHaveTextContent("50:00");
    expect(screen.getByTestId("statistics-booked-change")).toHaveTextContent("+25% against the period before");
    expect(screen.getByTestId("statistics-closed-change")).toHaveAttribute("data-direction", "none");
    expect(screen.getByTestId("statistics-closed-change")).toHaveTextContent("Unchanged against the period before");
    expect(screen.getByTestId("statistics-allocations-value")).toHaveTextContent("12");
    expect(screen.getByTestId("statistics-open-note")).toHaveTextContent("opening hours as they are configured today");
  });

  it("given figures that fell, rose from nothing or stayed, when the other sections show, then the direction and the unit follow each figure", async () => {
    // given
    reads();

    // when
    show();

    // then
    await loaded();
    expect(screen.getByTestId("statistics-cancellation-rate-change")).toHaveAttribute("data-direction", "down");
    expect(screen.getByTestId("statistics-cancellation-rate-change")).toHaveTextContent("-3 percentage points");
    expect(screen.getByTestId("statistics-with-guests-change")).toHaveAttribute("data-direction", "up");
    expect(screen.getByTestId("statistics-with-guests-change")).toHaveTextContent("+2 against the period before");
    expect(screen.getByTestId("statistics-guest-entries-change")).toHaveTextContent("-40% against the period before");
    expect(screen.getByTestId("statistics-joins-change")).toHaveTextContent("+4 against the period before");
    expect(screen.getByTestId("statistics-active-change")).toHaveAttribute("data-direction", "none");
    expect(screen.getByTestId("statistics-active-share-change")).toHaveTextContent("-1 percentage points");
  });

  it("given no period before the chosen one, when the figures show, then no change is claimed", async () => {
    // given
    reads();
    vi.spyOn(api, "utilisationStatistics").mockResolvedValue({ ...utilisation, previous: null });
    vi.spyOn(api, "bookingStatistics").mockResolvedValue({ ...bookings, previous: null });
    vi.spyOn(api, "memberStatistics").mockResolvedValue({ ...members, previous: null });

    // when
    show();

    // then
    await loaded();
    expect(screen.getByTestId("statistics-occupancy-value")).toHaveTextContent("25%");
    for (const figure of ["occupancy", "booked", "closed", "confirmed", "cancellation-rate", "members-total", "active-share"]) {
      expect(screen.queryByTestId(`statistics-${figure}-change`), figure).toBeNull();
    }
  });

  it("given the hours of the week, when the table shows, then only hours open on some day are columns and every cell states its value", async () => {
    // given
    reads();

    // when
    show();

    // then
    await loaded();
    const table = within(screen.getByTestId("statistics-hours")).getByRole("table");
    const columns = within(table).getAllByRole("columnheader");
    expect(columns).toHaveLength(1 + 13);
    expect(columns[1]).toHaveTextContent("07");
    expect(columns[13]).toHaveTextContent("19");
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    expect(within(table).getAllByRole("rowheader")[0]).toHaveTextContent("Mon");
    expect(screen.getByTestId("statistics-hour-1-8")).toHaveTextContent("50%");
    expect(screen.getByTestId("statistics-hour-1-8")).toHaveAttribute("data-level", "3");
    expect(screen.getByTestId("statistics-hour-1-8")).toHaveClass("stat-heat-3");
    expect(screen.getByTestId("statistics-hour-1-9")).toHaveTextContent("0%");
    expect(screen.getByTestId("statistics-hour-1-9")).toHaveAttribute("data-level", "0");
    expect(screen.getByTestId("statistics-hour-6-7")).toHaveTextContent("10%");
    expect(screen.getByTestId("statistics-hour-1-7")).toHaveTextContent("closed");
    expect(screen.getByTestId("statistics-hour-1-7")).not.toHaveAttribute("data-level");
    expect(screen.queryByTestId("statistics-hour-1-20")).toBeNull();
  });

  it("given courts, cards and weeks, when the utilisation shows, then each is a bar of its own share and value", async () => {
    // given
    reads();

    // when
    show();

    // then
    await loaded();
    expect(screen.getByTestId("utilisation-row-1-label")).toHaveTextContent("1 · Centre court");
    expect(screen.getByTestId("utilisation-row-1-value")).toHaveTextContent("25%");
    expect(screen.getByTestId("utilisation-row-1-bar")).toHaveStyle({ width: "25%" });
    expect(screen.getByTestId("utilisation-row-1")).toHaveTextContent("13:30 booked, 12 bookings");
    expect(screen.getByTestId("utilisation-row-2-label")).toHaveTextContent("Court 2 (inactive)");
    expect(screen.getByTestId("utilisation-row-2-bar")).toHaveStyle({ width: "0%" });
    expect(screen.getByTestId(`statistics-card-${MEMBER_CARD}-label`)).toHaveTextContent("Member booking");
    expect(screen.getByTestId(`statistics-card-${MEMBER_CARD}-value`)).toHaveTextContent("75%");
    expect(screen.getByTestId(`statistics-card-${CLOSED_CARD}-label`)).toHaveTextContent("Court closed (closure)");
    expect(within(screen.getByTestId("statistics-progression")).getByRole("heading")).toHaveTextContent("Week by week");
    expect(screen.getByTestId("statistics-bucket-2026-02-02-value")).toHaveTextContent("40%");
    expect(screen.getByTestId("statistics-bucket-2026-02-02-bar")).toHaveStyle({ width: "40%" });
  });

  it("given bookings, members and messages, when their sections show, then every figure and stored name is there as text", async () => {
    // given
    reads();

    // when
    show();

    // then
    await loaded();
    expect(screen.getByTestId("statistics-confirmed-value")).toHaveTextContent("12");
    expect(screen.getByTestId("statistics-cancellation-rate-value")).toHaveTextContent("20%");
    expect(screen.getByTestId("statistics-series-value")).toHaveTextContent("4");
    expect(screen.getByTestId("statistics-single-bar")).toHaveStyle({ width: "67%" });
    expect(screen.getByTestId(`statistics-participant-card-${FILLER}-label`)).toHaveTextContent("Ball machine");
    expect(screen.getByTestId(`statistics-participant-card-${FILLER}-value`)).toHaveTextContent("7");
    expect(screen.getByTestId("statistics-members-total-value")).toHaveTextContent("120");
    expect(screen.getByTestId("statistics-active-share-value")).toHaveTextContent("40%");
    expect(screen.getByTestId("statistics-active-note")).toHaveTextContent("pseudonymised");
    expect(screen.getByTestId(`statistics-membership-type-${ADULT}-label`)).toHaveTextContent("Adult");
    expect(screen.getByTestId(`statistics-membership-type-${ADULT}-bar`)).toHaveStyle({ width: "100%" });
    expect(screen.getByTestId("statistics-signed-in-90-value")).toHaveTextContent("75");
    expect(screen.getByTestId("statistics-never-signed-in-value")).toHaveTextContent("10");
    expect(screen.getByTestId("statistics-message-BOOKING_CONFIRMED-handedOver")).toHaveTextContent("30");
    expect(screen.getByTestId("statistics-message-BOOKING_CONFIRMED-refused")).toHaveTextContent("2");
    expect(screen.queryByTestId("statistics-message-BOOKING_REMINDER")).toBeNull();
  });

  it("given a German reader, when large figures show, then they are grouped the German way", async () => {
    // given
    await i18n.changeLanguage("de");
    reads();
    vi.spyOn(api, "memberStatistics").mockResolvedValue({ ...members, figures: { ...members.figures, members: 1250 } });

    // when
    show();

    // then
    await waitFor(() => expect(screen.getByTestId("statistics-members-total-value")).toHaveTextContent("1.250"));
    await waitFor(() => expect(screen.getByTestId("statistics-occupancy-value")).toHaveTextContent("25 %"));
  });

  it("given no message queued in the period, when the messages show, then the section says so instead of an empty table", async () => {
    // given
    reads();
    vi.spyOn(api, "messageStatistics").mockResolvedValue({
      ...messages, kinds: messages.kinds.map((kind) => ({ ...kind, ...quiet }))
    });

    // when
    show();

    // then
    const section = await screen.findByTestId("statistics-messages");
    await waitFor(() => expect(within(section).getByTestId("statistics-messages-empty")).toBeInTheDocument());
    expect(within(section).queryByRole("table")).toBeNull();
  });

  it("given today at the end of March, when a board picks each quick choice, then the period ends today and the address carries it", async () => {
    // given
    const read = reads();
    show();
    await loaded();
    const expected: Record<string, [string, string]> = {
      "7d": ["2026-03-25", "2026-03-31"],
      "1m": ["2026-03-01", "2026-03-31"],
      "3m": ["2026-01-01", "2026-03-31"],
      "6m": ["2025-10-01", "2026-03-31"],
      "12m": ["2025-04-01", "2026-03-31"],
      all: ["2024-04-12", "2026-03-31"],
      previousYear: ["2025-01-01", "2025-12-31"]
    };

    for (const [choice, [from, to]] of Object.entries(expected)) {
      // when
      await userEvent.click(screen.getByTestId(`statistics-choice-${choice}`));

      // then
      await waitFor(() => expect(read.utilisation).toHaveBeenLastCalledWith({ from, to }));
      expect(read.messages).toHaveBeenLastCalledWith({ from, to });
      expect(screen.getByTestId("address")).toHaveTextContent(`?from=${from}&to=${to}`);
      await waitFor(() => expect(screen.getByTestId(`statistics-choice-${choice}`)).toHaveAttribute("aria-pressed", "true"));
      expect(screen.getByTestId("utilisation-from")).toHaveValue(from);
      expect(screen.getByTestId("utilisation-to")).toHaveValue(to);
    }
  });

  it("given a period in the address, when the page opens, then every section reads it and the matching quick choice is pressed", async () => {
    // given
    const read = reads();

    // when
    show("/admin/utilisation?from=2026-01-01&to=2026-03-31");

    // then
    await loaded();
    for (const section of [read.utilisation, read.bookings, read.members, read.messages]) {
      expect(section).toHaveBeenCalledExactlyOnceWith({ from: "2026-01-01", to: "2026-03-31" });
    }
    expect(screen.getByTestId("utilisation-from")).toHaveValue("2026-01-01");
    expect(screen.getByTestId("statistics-choice-3m")).toHaveAttribute("aria-pressed", "true");
  });

  it("given a chosen period, when the board goes back to the plain address, then the default period is read and fills the form again", async () => {
    // given
    const read = reads();
    render(<MemoryRouter initialEntries={["/admin/utilisation", "/admin/utilisation?from=2026-01-01&to=2026-03-31"]} initialIndex={1}>
      <AdminStatisticsView /><Address /><Back /></MemoryRouter>);
    await loaded();
    expect(screen.getByTestId("utilisation-from")).toHaveValue("2026-01-01");

    // when
    await userEvent.click(screen.getByTestId("back"));

    // then
    await waitFor(() => expect(read.utilisation).toHaveBeenLastCalledWith(undefined));
    await waitFor(() => expect(screen.getByTestId("utilisation-from")).toHaveValue("2026-02-01"));
    expect(screen.getByTestId("utilisation-to")).toHaveValue("2026-02-28");
  });

  it("given an address whose period ends before it starts, when the statistics open, then the default period is read instead", async () => {
    // given
    const read = reads();

    // when
    show("/admin/utilisation?from=2026-04-01&to=2026-03-31");

    // then
    await loaded();
    expect(read.utilisation).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(screen.getByTestId("utilisation-from")).toHaveValue("2026-02-01");
  });

  it("given a free range, when a board reads it, then the address carries it and the sections read it", async () => {
    // given
    const read = reads();
    show();
    await loaded();

    // when
    await userEvent.clear(screen.getByTestId("utilisation-from"));
    await userEvent.type(screen.getByTestId("utilisation-from"), "2025-11-03");
    await userEvent.clear(screen.getByTestId("utilisation-to"));
    await userEvent.type(screen.getByTestId("utilisation-to"), "2025-11-16");
    await userEvent.click(screen.getByTestId("utilisation-read"));

    // then
    await waitFor(() => expect(read.bookings).toHaveBeenLastCalledWith({ from: "2025-11-03", to: "2025-11-16" }));
    expect(screen.getByTestId("address")).toHaveTextContent("?from=2025-11-03&to=2025-11-16");
    expect(screen.queryByTestId("statistics-period-refused")).toBeNull();
  });

  it("given a free range that is half given or reversed, when a board reads it, then it is refused before anything is asked", async () => {
    // given
    const read = reads();
    show();
    await loaded();

    // when
    await userEvent.clear(screen.getByTestId("utilisation-to"));
    await userEvent.click(screen.getByTestId("utilisation-read"));

    // then
    expect(screen.getByTestId("statistics-period-refused")).toHaveTextContent("Give both a start and an end date.");

    // when
    await userEvent.type(screen.getByTestId("utilisation-to"), "2026-01-31");
    await userEvent.click(screen.getByTestId("utilisation-read"));

    // then
    expect(screen.getByTestId("statistics-period-refused")).toHaveTextContent("The end date must not precede the start date.");
    expect(read.utilisation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("address")).toHaveTextContent(/^$/);
  });

  it("given a club without any booking, when all time is chosen, then the page says so and asks nothing", async () => {
    // given
    const read = reads();
    read.range.mockResolvedValue({ firstBookingOn: null, today: "2026-03-31" });
    show();
    await loaded();

    // when
    await userEvent.click(screen.getByTestId("statistics-choice-all"));

    // then
    expect(screen.getByTestId("statistics-no-bookings")).toHaveTextContent("There is no booking yet");
    expect(screen.getByTestId("statistics-choice-all")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("statistics-utilisation")).toBeNull();
    for (const section of [read.utilisation, read.bookings, read.members, read.messages]) {
      expect(section).toHaveBeenCalledTimes(1);
    }
  });

  it("given one section that cannot be read, when the page opens, then the others still show and its retry repeats only its own read", async () => {
    // given
    const read = reads();
    read.bookings.mockRejectedValueOnce(failure());
    show();
    const section = await screen.findByTestId("statistics-bookings");
    await waitFor(() => expect(within(section).getByTestId("load-failure")).toBeInTheDocument());
    await screen.findByTestId("utilisation-row-1");
    await screen.findByTestId("statistics-members-total");
    await screen.findByTestId("statistics-message-BOOKING_CONFIRMED");

    // when
    await userEvent.click(within(section).getByTestId("retry-load"));

    // then
    await waitFor(() => expect(within(section).getByTestId("statistics-confirmed")).toBeInTheDocument());
    expect(read.bookings).toHaveBeenCalledTimes(2);
    for (const other of [read.utilisation, read.members, read.messages]) {
      expect(other).toHaveBeenCalledTimes(1);
    }
    expect(screen.queryByTestId("load-failure")).toBeNull();
  });

  it("given the range cannot be read, when the page opens, then the quick choices wait while the sections and the free range still work", async () => {
    // given
    const read = reads();
    read.range.mockRejectedValueOnce(failure());
    show();
    const rangeFailure = await screen.findByTestId("statistics-range-failure");
    await screen.findByTestId("utilisation-row-1");
    expect(screen.getByTestId("statistics-choice-1m")).toBeDisabled();

    // when
    await userEvent.click(within(rangeFailure).getByTestId("retry-load"));

    // then
    await waitFor(() => expect(screen.getByTestId("statistics-choice-1m")).toBeEnabled());
    expect(read.range).toHaveBeenCalledTimes(2);
    expect(read.utilisation).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("statistics-range-failure")).toBeNull();
  });

  it("given a period without bookable time, when the utilisation shows, then no occupancy is claimed and the reason is said", async () => {
    // given
    reads();
    vi.spyOn(api, "utilisationStatistics").mockResolvedValue({
      ...utilisation,
      totals: totals(0, 0, null),
      courts: utilisation.courts.map((court) => ({ ...court, occupancy: null })),
      hours: utilisation.hours.map((hour) => ({ ...hour, openMinutes: 0, occupancy: null }))
    });

    // when
    show();

    // then
    await waitFor(() => expect(screen.getByTestId("statistics-no-open-time")).toBeInTheDocument());
    expect(screen.getByTestId("statistics-occupancy-value")).toHaveTextContent("-");
    expect(screen.queryByTestId("statistics-occupancy-change")).toBeNull();
    expect(screen.getByTestId("utilisation-row-1-value")).toHaveTextContent("-");
    expect(screen.queryByTestId("utilisation-row-1-bar")).toBeNull();
    expect(screen.queryByTestId("statistics-hours")).toBeNull();
  });
});
