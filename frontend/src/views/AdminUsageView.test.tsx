import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, type UsageReport } from "../api/client";
import i18n from "../i18n";
import { AdminUsageView } from "./AdminUsageView";
import { ruleLabel } from "./ruleLabel";

const MEMBER_CARD = "22222222-0000-0000-0000-000000000001";
const ADULT = "44444444-0000-0000-0000-000000000001";

const usage: UsageReport = {
  from: "2026-04-01",
  to: "2026-04-30",
  timeZone: "Europe/Berlin",
  capacity: {
    capacityMinutes: 12000,
    closedMinutes: 0,
    uses: [
      { other: false, cardId: MEMBER_CARD, cardLabel: "Member booking", membershipTypeId: ADULT,
        membershipTypeName: "Adult", bookings: 4, bookedMinutes: 270, share: 0.25 },
      { other: true, cardId: null, cardLabel: null, membershipTypeId: null, membershipTypeName: null,
        bookings: 2, bookedMinutes: 180, share: 0.15 }
    ]
  },
  cancellations: {
    cancelled: 4, byHolder: 1, byClub: 2, released: 1,
    reasons: [{ reason: "WEATHER", cancelled: 1 }, { cancelled: 1 }],
    cards: [
      { other: false, cardId: MEMBER_CARD, cardLabel: "Member booking", cancelled: 3, byHolder: 1, byClub: 1, released: 1 },
      { other: true, cardId: null, cardLabel: null, cancelled: 1, byHolder: 0, byClub: 1, released: 0 }
    ]
  },
  attendance: { tracked: true, attended: 5, noShows: 2, liftedNoShows: 1 },
  ruleRejections: {
    attempts: 3,
    rules: [{ code: "booking.rule.bookingHours.outside", attempts: 2 }, { code: "booking.rule.startsInPast", attempts: 1 }]
  }
};

function Address() {
  const location = useLocation();
  return <output data-testid="address">{location.search}</output>;
}

function show(entry = "/admin/usage") {
  render(<MemoryRouter initialEntries={[entry]}><AdminUsageView /><Address /></MemoryRouter>);
}

describe("AdminUsageView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given no period in the address, when the page opens, then it reads the default period and fills the form with it", async () => {
    // given
    const read = vi.spyOn(api, "usageReport").mockResolvedValue(usage);

    // when
    show();

    // then
    await screen.findByTestId("usage-period");
    expect(read).toHaveBeenCalledWith(undefined);
    await waitFor(() => expect(screen.getByTestId("usage-from")).toHaveValue("2026-04-01"));
    expect(screen.getByTestId("usage-to")).toHaveValue("2026-04-30");
  });

  it("given an address whose period ends before it starts, when the page opens, then the default period is read instead", async () => {
    // given
    const read = vi.spyOn(api, "usageReport").mockResolvedValue(usage);

    // when
    show("/admin/usage?from=2026-04-01&to=2026-03-31");

    // then
    await screen.findByTestId("usage-period");
    expect(read).toHaveBeenCalledExactlyOnceWith(undefined);
    await waitFor(() => expect(screen.getByTestId("usage-from")).toHaveValue("2026-04-01"));
  });

  it("given a report, when it is shown, then each of the four parts carries its figures and small groups read as Other", async () => {
    // given
    vi.spyOn(api, "usageReport").mockResolvedValue(usage);

    // when
    show("/admin/usage?from=2026-04-01&to=2026-04-30");

    // then
    const capacity = await screen.findByTestId("usage-capacity");
    expect(within(capacity).getByTestId("usage-capacity-row")).toHaveTextContent("Member booking · Adult");
    expect(within(capacity).getByTestId("usage-capacity-other")).toHaveTextContent("Other");
    expect(screen.getByTestId("usage-by-club-value")).toHaveTextContent("2");
    expect(screen.getByTestId("usage-released-value")).toHaveTextContent("1");
    expect(screen.getByTestId("usage-reason-WEATHER")).toHaveTextContent("Weather");
    expect(screen.getByTestId("usage-reason-none")).toHaveTextContent("No reason given");
    expect(screen.getByTestId("usage-cancelled-other")).toHaveTextContent("Other");
    expect(screen.getByTestId("usage-no-shows-value")).toHaveTextContent("2");
    expect(screen.getByTestId("usage-lifted-value")).toHaveTextContent("1");
    expect(screen.queryByTestId("usage-attendance-off")).not.toBeInTheDocument();
    const rules = screen.getAllByTestId("usage-rule");
    expect(rules[0]).toHaveTextContent("Booking hours");
    expect(rules[1]).toHaveTextContent("A booking cannot start in the past.");
  });

  it("given a period, when the board reads another one, then the address carries it and the report is read for it", async () => {
    // given
    const read = vi.spyOn(api, "usageReport").mockResolvedValue(usage);
    show();
    await screen.findByTestId("usage-period");
    await waitFor(() => expect(screen.getByTestId("usage-to")).toHaveValue("2026-04-30"));

    // when
    await userEvent.clear(screen.getByTestId("usage-from"));
    await userEvent.type(screen.getByTestId("usage-from"), "2026-03-01");
    await userEvent.clear(screen.getByTestId("usage-to"));
    await userEvent.type(screen.getByTestId("usage-to"), "2026-03-31");
    await userEvent.click(screen.getByTestId("usage-read"));

    // then
    expect(screen.getByTestId("address")).toHaveTextContent("?from=2026-03-01&to=2026-03-31");
    expect(read).toHaveBeenLastCalledWith({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("given an end before the start, when the board reads it, then the period is refused before any request", async () => {
    // given
    const read = vi.spyOn(api, "usageReport").mockResolvedValue(usage);
    show();
    await screen.findByTestId("usage-period");
    await waitFor(() => expect(screen.getByTestId("usage-to")).toHaveValue("2026-04-30"));
    read.mockClear();

    // when
    await userEvent.clear(screen.getByTestId("usage-from"));
    await userEvent.type(screen.getByTestId("usage-from"), "2026-03-31");
    await userEvent.clear(screen.getByTestId("usage-to"));
    await userEvent.type(screen.getByTestId("usage-to"), "2026-03-01");
    await userEvent.click(screen.getByTestId("usage-read"));

    // then
    expect(screen.getByTestId("usage-period-refused")).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });

  it("given the report cannot be read, when the page opens, then it says so and offers a retry", async () => {
    // given
    vi.spyOn(api, "usageReport").mockRejectedValue(
      new ApiError(500, { type: "urn:courtside:error:internal-error", title: "Internal error", status: 500 }));

    // when
    show();

    // then
    const section = await screen.findByTestId("usage-report");
    expect(await within(section).findByRole("button")).toBeInTheDocument();
    expect(screen.queryByTestId("usage-capacity")).not.toBeInTheDocument();
  });

  it("given a club that does not record attendance, when the report is shown, then it says so", async () => {
    // given
    vi.spyOn(api, "usageReport").mockResolvedValue({ ...usage, attendance: { tracked: false, attended: 0, noShows: 0, liftedNoShows: 0 } });

    // when
    show();

    // then
    expect(await screen.findByTestId("usage-attendance-off")).toBeInTheDocument();
  });

  it("given an unknown violation code, when it is labelled, then the code itself is shown rather than nothing", () => {
    // when
    const label = ruleLabel("booking.rule.unheardOf.reached", i18n.t.bind(i18n));

    // then
    expect(label).toBe("booking.rule.unheardOf.reached");
  });
});
