import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  api, type AdminClubConfig, type Allocation, type AuditEntry, type BookingStatistics, type ClubConfig, type MemberStatistics,
  type MessageEntry, type RosterEntry, type StatisticsPeriodQuery, type UtilisationStatistics
} from "../api/client";
import i18n from "../i18n";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { AdminOverviewView } from "./AdminOverviewView";

const club: ClubConfig = {
  clubName: "Example Tennis Club", primaryColor: "#000000", accentColor: "#ffffff",
  logoUrl: null, imprintUrl: null, defaultLocale: "en", supportedLocales: ["de", "en"],
  slotMinutes: 60, timeZone: "Europe/Berlin"
};

const configured: AdminClubConfig = {
  clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b", logoUrl: null,
  imprintUrl: null, privacyUrl: null, documentationUrl: null, shortName: null, defaultLocale: "en",
  supportedLocales: ["de", "en"], slotMinutes: 30, timeZone: "Europe/Berlin", newAccountCredentialHours: 168,
  passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60, bookingReminderHours: 24,
  logoUploaded: false, logoFallbackUrl: null, noMembershipTypeRuleSetId: null
};

const currentMember: RosterEntry = {
  personId: "11111111-1111-1111-1111-111111111111", firstName: "Jane", lastName: "Doe",
  email: "jane.doe@example.org", accountId: "22222222-2222-2222-2222-222222222222", username: "jane.doe",
  enabled: true, roles: ["MEMBER"], membershipTypeId: "type-1", membershipStartedOn: "2026-01-01",
  membershipEndedOn: null, credentialState: "CREDENTIAL_ISSUED"
};

function allocation(bookingId: string, courtId: string, startsAt: string, endsAt: string, cardLabel: string): Allocation {
  return { bookingId, courtId, startsAt, endsAt, cardLabel, cardColor: "#b85c38", ownBooking: false, showGenericOccupancy: false };
}

const failedMessage: MessageEntry = {
  id: "33333333-3333-3333-3333-333333333333", queuedAt: "2026-09-24T08:00:00Z", settledAt: "2026-09-24T08:00:01Z",
  kind: "CREDENTIALS_NEW_ACCOUNT", state: "REFUSED", messageId: "<a-message-id@example.org>",
  reason: "SendFailedException", statusCode: "550",
  personId: "44444444-4444-4444-4444-444444444444", personName: "John Roe"
};

const courtAdded: AuditEntry = {
  id: "55555555-5555-5555-5555-555555555555", occurredAt: "2026-09-24T09:00:00Z", eventType: "facility.court.added",
  parameters: { number: 3, name: "Court 3" }, subjectId: "66666666-6666-6666-6666-666666666666",
  subjectName: "Court 3", actorAccountId: "77777777-7777-7777-7777-777777777777", actorUsername: "mary.major"
};

function utilisationOf(occupancy: number | null, previousOccupancy: number | null | undefined, period: StatisticsPeriodQuery): UtilisationStatistics {
  const totals = (value: number | null) => ({
    openMinutes: 6000, courtCount: 2, capacityMinutes: 12000, closedMinutes: 0, bookedMinutes: 0, occupancy: value
  });
  return {
    period: { ...period, timeZone: "Europe/Berlin" }, totals: totals(occupancy),
    previous: previousOccupancy === undefined ? null
      : { period: { from: "2026-09-12", to: "2026-09-18", timeZone: "Europe/Berlin" }, totals: totals(previousOccupancy) },
    courts: [], cards: [], hours: [], progression: { granularity: "WEEK", buckets: [] }
  };
}

function bookingsOf(confirmed: number, previousConfirmed: number | undefined, period: StatisticsPeriodQuery): BookingStatistics {
  const figures = (value: number) => ({
    confirmed: value, cancelled: 0, cancellationRate: null, series: 0, single: value, withGuests: 0, guestEntries: 0
  });
  return {
    period: { ...period, timeZone: "Europe/Berlin" }, figures: figures(confirmed),
    previous: previousConfirmed === undefined ? null
      : { period: { from: "2026-09-14", to: "2026-09-20", timeZone: "Europe/Berlin" }, figures: figures(previousConfirmed) },
    participantCards: []
  };
}

type Members = { members: number; joins: number; activeMembers: number; activeShare: number | null };

function membersOf(current: Members, previous: Members | undefined, period: StatisticsPeriodQuery): MemberStatistics {
  return {
    period: { ...period, timeZone: "Europe/Berlin" }, figures: { ...current, leavings: 0 },
    previous: previous === undefined ? null
      : { period: { from: "2026-07-28", to: "2026-08-26", timeZone: "Europe/Berlin" }, figures: { ...previous, leavings: 0 } },
    membershipTypes: [],
    accounts: { accounts: 0, passwordChosen: 0, withoutChosenPassword: 0, signedInWithin30Days: 0, signedInWithin90Days: 0, neverSignedIn: 0 }
  };
}

const unchangedMembers: Members = { members: 90, joins: 0, activeMembers: 30, activeShare: 1 / 3 };

const middayInBerlin = () => new Date("2026-09-25T10:30:00Z");

async function loadedFigure(name: string) {
  await screen.findByTestId(`overview-figure-${name}-value`);
  return screen.getByTestId(`overview-figure-${name}`);
}

function show(clock = middayInBerlin) {
  render(<MemoryRouter><WithClubConfiguration club={club}><AdminOverviewView clock={clock} /></WithClubConfiguration></MemoryRouter>);
}

describe("AdminOverviewView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminConfig").mockResolvedValue(configured);
    vi.spyOn(api, "adminCourts").mockResolvedValue([{ id: "court-1", number: 1, name: "Centre Court", active: true }]);
    vi.spyOn(api, "adminOpeningHours").mockResolvedValue([{ dayOfWeek: "MONDAY", opensAt: "08:00:00", closesAt: "22:00:00" }]);
    vi.spyOn(api, "membershipTypes").mockResolvedValue([{ id: "type-1", name: "Adults", ruleSetId: null, active: true, grantsAccount: true }]);
    vi.spyOn(api, "importSources").mockResolvedValue([]);
    vi.spyOn(api, "roster").mockImplementation((criteria) => Promise.resolve(criteria?.credentialStates
      ? { entries: [], nextCursor: null, matching: 0 }
      : { entries: [currentMember], nextCursor: null, matching: 1 }));
    vi.spyOn(api, "courts").mockResolvedValue([
      { id: "court-1", number: 1, name: "Centre Court" },
      { id: "court-2", number: 2, name: "Garden Court" }
    ]);
    vi.spyOn(api, "allocations").mockResolvedValue([]);
    vi.spyOn(api, "messages").mockResolvedValue({ entries: [], nextCursor: null });
    vi.spyOn(api, "audit").mockResolvedValue({ entries: [] });
    vi.spyOn(api, "utilisationStatistics").mockImplementation((period) => Promise.resolve(utilisationOf(0.5, 0.5, period!)));
    vi.spyOn(api, "bookingStatistics").mockImplementation((period) => Promise.resolve(bookingsOf(10, 10, period!)));
    vi.spyOn(api, "memberStatistics").mockImplementation((period) => Promise.resolve(membersOf(unchangedMembers, unchangedMembers, period!)));
  });

  it("given the club's figures and the periods before, when the overview opens, then each shows its value and which way it moved", async () => {
    // given
    vi.mocked(api.utilisationStatistics).mockImplementation((period) => Promise.resolve(utilisationOf(0.624, 0.576, period!)));
    vi.mocked(api.bookingStatistics).mockImplementation((period) => Promise.resolve(bookingsOf(41, 45, period!)));
    vi.mocked(api.memberStatistics).mockImplementation((period) => Promise.resolve(membersOf(
      { members: 95, joins: 3, activeMembers: 38, activeShare: 0.4 },
      { members: 92, joins: 1, activeMembers: 38, activeShare: 38 / 92 }, period!)));

    // when
    show();

    // then
    const utilisation = await loadedFigure("utilisation");
    expect(within(utilisation).getByTestId("overview-figure-utilisation-value")).toHaveTextContent("62%");
    const utilisationChange = within(utilisation).getByTestId("overview-figure-utilisation-change");
    expect(utilisationChange, "the change is taken between the two percentages the board reads").toHaveAttribute("data-trend", "up");
    expect(utilisationChange).toHaveTextContent("4 points more than the 7 days before");

    const bookings = await loadedFigure("bookings");
    expect(within(bookings).getByTestId("overview-figure-bookings-value")).toHaveTextContent("41");
    expect(within(bookings).getByTestId("overview-figure-bookings-change")).toHaveAttribute("data-trend", "down");
    expect(within(bookings).getByTestId("overview-figure-bookings-change")).toHaveTextContent("4 fewer than last week");

    const active = await loadedFigure("active");
    expect(within(active).getByTestId("overview-figure-active-value")).toHaveTextContent("38");
    expect(within(active).getByTestId("overview-figure-active-detail")).toHaveTextContent("40% of members");
    expect(within(active).getByTestId("overview-figure-active-change")).toHaveAttribute("data-trend", "unchanged");

    const members = screen.getByTestId("overview-figure-members");
    expect(within(members).getByTestId("overview-figure-members-value")).toHaveTextContent("95");
    expect(within(members).getByTestId("overview-figure-members-detail")).toHaveTextContent("3 joined in 30 days");
    expect(within(members).getByTestId("overview-figure-members-change")).toHaveAttribute("data-trend", "up");
    expect(within(members).getByTestId("overview-figure-members-change")).toHaveTextContent("3 more than 30 days ago");
    expect(api.memberStatistics, "both member figures share one read").toHaveBeenCalledTimes(1);
  });

  it("given no period before or no bookable court time, when the overview opens, then no figure claims a change", async () => {
    // given
    vi.mocked(api.utilisationStatistics).mockImplementation((period) => Promise.resolve(utilisationOf(null, 0.5, period!)));
    vi.mocked(api.bookingStatistics).mockImplementation((period) => Promise.resolve(bookingsOf(7, undefined, period!)));
    vi.mocked(api.memberStatistics).mockImplementation((period) => Promise.resolve(membersOf(
      { members: 0, joins: 0, activeMembers: 0, activeShare: null }, undefined, period!)));

    // when
    show();

    // then
    const utilisation = await loadedFigure("utilisation");
    expect(within(utilisation).getByTestId("overview-figure-utilisation-value")).toHaveTextContent("–");
    expect(within(await loadedFigure("bookings")).getByTestId("overview-figure-bookings-value")).toHaveTextContent("7");
    const active = await loadedFigure("active");
    expect(within(active).getByTestId("overview-figure-active-value")).toHaveTextContent("0");
    expect(within(active).queryByTestId("overview-figure-active-detail"), "a share of no members is not a figure").not.toBeInTheDocument();
    for (const figure of ["utilisation", "bookings", "active", "members"]) {
      expect(screen.queryByTestId(`overview-figure-${figure}-change`), `${figure} has nothing to compare with`).not.toBeInTheDocument();
    }
  });

  it("given a Friday, when the overview opens, then each figure reads its period and links to the statistics for it", async () => {
    // when
    show();

    // then
    expect(await loadedFigure("utilisation")).toHaveAttribute("href", "/admin/utilisation?from=2026-09-19&to=2026-09-25");
    expect(await loadedFigure("bookings"), "this week is the whole ISO week, so the week before is its equal")
      .toHaveAttribute("href", "/admin/utilisation?from=2026-09-21&to=2026-09-27");
    expect(await loadedFigure("active")).toHaveAttribute("href", "/admin/utilisation?from=2026-08-27&to=2026-09-25");
    expect(screen.getByTestId("overview-figure-members")).toHaveAttribute("href", "/admin/utilisation?from=2026-08-27&to=2026-09-25");
    expect(api.utilisationStatistics).toHaveBeenCalledWith({ from: "2026-09-19", to: "2026-09-25" });
    expect(api.bookingStatistics).toHaveBeenCalledWith({ from: "2026-09-21", to: "2026-09-27" });
    expect(api.memberStatistics).toHaveBeenCalledWith({ from: "2026-08-27", to: "2026-09-25" });
  });

  it("given the first days of a month, when the overview opens, then the periods reach back into the month before", async () => {
    // when
    show(() => new Date("2026-10-02T10:00:00Z"));

    // then
    expect(await loadedFigure("utilisation")).toHaveAttribute("href", "/admin/utilisation?from=2026-09-26&to=2026-10-02");
    expect(api.utilisationStatistics).toHaveBeenCalledWith({ from: "2026-09-26", to: "2026-10-02" });
    expect(api.bookingStatistics).toHaveBeenCalledWith({ from: "2026-09-28", to: "2026-10-04" });
    expect(api.memberStatistics).toHaveBeenCalledWith({ from: "2026-09-03", to: "2026-10-02" });
  });

  it("given the club's Monday has begun while UTC's Sunday has not ended, when the overview opens, then the figures read the club's new week", async () => {
    // when
    show(() => new Date("2026-09-27T22:30:00Z"));

    // then
    expect(await loadedFigure("bookings")).toHaveAttribute("href", "/admin/utilisation?from=2026-09-28&to=2026-10-04");
    expect(api.bookingStatistics).toHaveBeenCalledWith({ from: "2026-09-28", to: "2026-10-04" });
    expect(api.utilisationStatistics).toHaveBeenCalledWith({ from: "2026-09-22", to: "2026-09-28" });
    expect(api.memberStatistics).toHaveBeenCalledWith({ from: "2026-08-30", to: "2026-09-28" });
  });

  it("given the member figures cannot be read, when the overview opens, then only they report it and a retry repeats only their read", async () => {
    // given
    vi.mocked(api.memberStatistics).mockRejectedValueOnce(new Error("offline for a moment"));
    vi.mocked(api.audit).mockResolvedValue({ entries: [courtAdded] });
    show();
    const active = await screen.findByTestId("overview-figure-active");
    expect(await within(active).findByTestId("load-failure")).toHaveTextContent(i18n.t("error.generic"));
    expect(within(screen.getByTestId("overview-figure-members")).getByTestId("load-failure")).toBeInTheDocument();
    expect(within(await loadedFigure("utilisation")).getByTestId("overview-figure-utilisation-value")).toHaveTextContent("50%");
    expect(within(await loadedFigure("bookings")).getByTestId("overview-figure-bookings-value")).toHaveTextContent("10");
    expect(await within(screen.getByTestId("overview-changes")).findByTestId("overview-changes-entry"),
      "a failed figure leaves the cards readable").toBeInTheDocument();

    // when
    await userEvent.click(within(active).getByTestId("retry-load"));

    // then
    expect(await screen.findByTestId("overview-figure-active-value")).toHaveTextContent("30");
    expect(screen.queryByTestId("load-failure")).not.toBeInTheDocument();
    expect(api.memberStatistics).toHaveBeenCalledTimes(2);
    expect(api.utilisationStatistics, "the retry reads only what failed").toHaveBeenCalledTimes(1);
    expect(api.bookingStatistics).toHaveBeenCalledTimes(1);
    expect(api.audit).toHaveBeenCalledTimes(1);
  });

  it("given German, when the overview opens, then the figures and their change read in German", async () => {
    // given
    await i18n.changeLanguage("de");
    vi.mocked(api.bookingStatistics).mockImplementation((period) => Promise.resolve(bookingsOf(12, 11, period!)));

    // when
    show();

    // then
    const bookings = await loadedFigure("bookings");
    expect(bookings).toHaveTextContent("Buchungen diese Woche");
    expect(within(bookings).getByTestId("overview-figure-bookings-change")).toHaveTextContent("1 mehr als letzte Woche");
    expect(within(await loadedFigure("utilisation")).getByTestId("overview-figure-utilisation-change"))
      .toHaveTextContent("Wie in den 7 Tagen davor");
  });

  it("given bookings today, when the overview opens, then it counts them and names the ones still to come", async () => {
    // given
    vi.mocked(api.allocations).mockResolvedValue([
      allocation("booking-early", "court-1", "2026-09-25T06:00:00Z", "2026-09-25T07:00:00Z", "Member booking"),
      allocation("booking-late", "court-2", "2026-09-25T16:00:00Z", "2026-09-25T17:00:00Z", "Training"),
      allocation("booking-doubles", "court-1", "2026-09-25T14:00:00Z", "2026-09-25T15:00:00Z", "League match"),
      allocation("booking-doubles", "court-2", "2026-09-25T14:00:00Z", "2026-09-25T15:00:00Z", "League match")
    ]);

    // when
    show();

    // then
    const today = screen.getByTestId("overview-today");
    expect(await within(today).findByTestId("overview-today-count"), "a booking over two courts is one booking")
      .toHaveTextContent("3 bookings today");
    const upcoming = within(today).getAllByTestId("overview-today-entry");
    expect(upcoming.map((entry) => entry.textContent), "the ended booking is left out and the rest are in order").toEqual([
      expect.stringContaining("League match"), expect.stringContaining("League match"), expect.stringContaining("Training")
    ]);
    expect(upcoming[0]).toHaveTextContent("Centre Court");
    expect(upcoming[0]).toHaveTextContent("4:00 PM");
    expect(upcoming[2]).toHaveTextContent("Garden Court");
    expect(api.allocations).toHaveBeenCalledWith("2026-09-25");
    expect(within(today).getByRole("link")).toHaveAttribute("href", "/");
  });

  it("given a court without a name, when its booking is still to come today, then the court is named by its number", async () => {
    // given
    vi.mocked(api.courts).mockResolvedValue([{ id: "court-3", number: 3, name: null }]);
    vi.mocked(api.allocations).mockResolvedValue([
      allocation("booking-late", "court-3", "2026-09-25T16:00:00Z", "2026-09-25T17:00:00Z", "Training")
    ]);

    // when
    show();

    // then
    const entry = await within(screen.getByTestId("overview-today")).findByTestId("overview-today-entry");
    expect(entry).toHaveTextContent(i18n.t("court.number", { number: 3 }));
    expect(entry, "an identifier is never shown in place of a name").not.toHaveTextContent("court-3");
  });

  it("given a booking whose card generic occupancy hides, when it is still to come today, then it reads as booked", async () => {
    // given
    vi.mocked(api.courts).mockResolvedValue([{ id: "court-1", number: 1, name: "Court 1" }]);
    vi.mocked(api.allocations).mockResolvedValue([{
      ...allocation("booking-member", "court-1", "2026-09-25T16:00:00Z", "2026-09-25T17:00:00Z", "?"),
      showGenericOccupancy: true
    }]);

    // when
    show();

    // then
    const entry = await within(screen.getByTestId("overview-today")).findByTestId("overview-today-entry");
    expect(entry).toHaveTextContent(i18n.t("booking.occupied"));
    expect(entry, "the placeholder the server sends is not a label").not.toHaveTextContent("?");
  });

  it("given the club's day has already turned while UTC's has not, when the overview opens, then it reads the club's date", async () => {
    // when
    show(() => new Date("2026-09-25T22:30:00Z"));

    // then
    expect(await within(screen.getByTestId("overview-today")).findByTestId("overview-today-empty"))
      .toHaveTextContent("No court is booked today.");
    expect(api.allocations).toHaveBeenCalledWith("2026-09-26");
  });

  it("given every booking today has ended, when the overview opens, then it says nothing else is booked", async () => {
    // given
    vi.mocked(api.allocations).mockResolvedValue([
      allocation("booking-early", "court-1", "2026-09-25T06:00:00Z", "2026-09-25T07:00:00Z", "Member booking")
    ]);

    // when
    show();

    // then
    const today = screen.getByTestId("overview-today");
    expect(await within(today).findByTestId("overview-today-count")).toHaveTextContent("1 booking today");
    expect(within(today).getByTestId("overview-today-over")).toHaveTextContent("Nothing else is booked for the rest of the day.");
    expect(within(today).queryByTestId("overview-today-entry")).not.toBeInTheDocument();
  });

  it("given accounts without a password of their own, when the overview opens, then it counts all of them and names the first", async () => {
    // given
    vi.mocked(api.roster).mockImplementation((criteria) => Promise.resolve(criteria?.credentialStates
      ? { entries: [currentMember, { ...currentMember, personId: "88888888-8888-8888-8888-888888888888", firstName: "John", lastName: "Roe", credentialState: "AWAITING_CREDENTIAL" as const }], nextCursor: "next", matching: 7 }
      : { entries: [currentMember], nextCursor: null, matching: 1 }));

    // when
    show();

    // then
    const credentials = screen.getByTestId("overview-credentials");
    expect(await within(credentials).findByTestId("overview-credentials-count"), "the count covers every page, not the first")
      .toHaveTextContent("7 people have not chosen a password yet.");
    const entries = within(credentials).getAllByTestId("overview-credentials-entry");
    expect(entries[0]).toHaveTextContent("Jane Doe");
    expect(entries[0]).toHaveTextContent(i18n.t("admin.roster.credential.CREDENTIAL_ISSUED"));
    expect(within(entries[1]).getByRole("link")).toHaveAttribute("href", "/admin/roster/88888888-8888-8888-8888-888888888888");
    expect(api.roster).toHaveBeenCalledWith(expect.objectContaining({
      credentialStates: ["AWAITING_CREDENTIAL", "CREDENTIAL_ISSUED", "CREDENTIAL_EXPIRED"]
    }));
    expect(within(credentials).getByTestId("overview-credentials-link")).toHaveAttribute("href", "/admin/roster?access=NOT_CHOSEN");
  });

  it("given everybody chose a password, when the overview opens, then the card says so", async () => {
    // when
    show();

    // then
    expect(await within(screen.getByTestId("overview-credentials")).findByTestId("overview-credentials-empty"))
      .toHaveTextContent("Everybody with an account has chosen a password.");
  });

  it("given more refused or failed messages than the card holds, when the overview opens, then it says there are more", async () => {
    // given
    vi.mocked(api.messages).mockResolvedValue({
      entries: Array.from({ length: 5 }, (_, index) => ({ ...failedMessage, id: `3333333${index}-3333-3333-3333-333333333333` })),
      nextCursor: "33333334-3333-3333-3333-333333333333"
    });

    // when
    show();

    // then
    const messages = screen.getByTestId("overview-messages");
    expect(await within(messages).findByTestId("overview-messages-count")).toHaveTextContent("More than 5 messages were refused or failed.");
    expect(api.messages).toHaveBeenCalledWith(undefined, 5, { unsettled: true });
    expect(within(messages).getAllByTestId("overview-messages-entry")[0]).toHaveTextContent("John Roe");
    expect(within(messages).getAllByTestId("overview-messages-entry")[0]).toHaveTextContent(i18n.t("messages.state.REFUSED"));
    expect(within(messages).getByTestId("overview-messages-link")).toHaveAttribute("href", "/admin/messages?unsettled=true");
  });

  it("given one refused message, when the overview opens, then it counts exactly that one", async () => {
    // given
    vi.mocked(api.messages).mockResolvedValue({ entries: [failedMessage], nextCursor: null });

    // when
    show();

    // then
    expect(await within(screen.getByTestId("overview-messages")).findByTestId("overview-messages-count"))
      .toHaveTextContent("1 message was refused or failed.");
  });

  it("given nothing was refused or failed, when the overview opens, then the card says nothing failed", async () => {
    // when
    show();

    // then
    expect(await within(screen.getByTestId("overview-messages")).findByTestId("overview-messages-empty"))
      .toHaveTextContent("No message failed to go out.");
  });

  it("given recorded changes, when the overview opens, then the latest are worded as the change log words them", async () => {
    // given
    vi.mocked(api.audit).mockResolvedValue({ entries: [courtAdded] });

    // when
    show();

    // then
    const changes = screen.getByTestId("overview-changes");
    const entry = await within(changes).findByTestId("overview-changes-entry");
    expect(entry).toHaveTextContent(i18n.t("audit.event.facility.court.added", courtAdded.parameters));
    expect(entry).toHaveTextContent("mary.major");
    expect(api.audit).toHaveBeenCalledWith(undefined, 5);
    expect(within(changes).getByTestId("overview-changes-link")).toHaveAttribute("href", "/admin/audit");
  });

  it("given no recorded change, when the overview opens, then the card says so", async () => {
    // when
    show();

    // then
    expect(await within(screen.getByTestId("overview-changes")).findByTestId("overview-changes-empty"))
      .toHaveTextContent("No change has been recorded yet.");
  });

  it("given one read fails, when the overview opens, then only its card reports it and a retry repeats only that read", async () => {
    // given
    vi.mocked(api.messages).mockRejectedValueOnce(new Error("offline for a moment"));
    vi.mocked(api.audit).mockResolvedValue({ entries: [courtAdded] });
    show();
    const messages = screen.getByTestId("overview-messages");
    expect(await within(messages).findByTestId("load-failure")).toHaveTextContent(i18n.t("error.generic"));
    expect(await within(screen.getByTestId("overview-changes")).findByTestId("overview-changes-entry"),
      "a failed card leaves the others readable").toBeInTheDocument();
    expect(screen.getAllByTestId("load-failure")).toHaveLength(1);

    // when
    await userEvent.click(within(messages).getByTestId("retry-load"));

    // then
    expect(await within(messages).findByTestId("overview-messages-empty")).toBeInTheDocument();
    expect(within(messages).queryByTestId("load-failure")).not.toBeInTheDocument();
    expect(api.messages).toHaveBeenCalledTimes(2);
    expect(api.audit, "the retry reads only what failed").toHaveBeenCalledTimes(1);
  });

  it("given setup is complete, when the overview opens, then setup is one folded line that still opens to its steps", async () => {
    // when
    show();

    // then
    const setup = await screen.findByTestId("overview-setup");
    const summary = await within(setup).findByTestId("overview-setup-summary");
    expect(summary).toHaveTextContent("Setup complete, all 4 required steps are done");
    expect(setup).not.toHaveAttribute("open");

    // when
    await userEvent.click(summary);

    // then
    expect(setup).toHaveAttribute("open");
    expect(within(setup).getByTestId("setup-step-configuration")).toHaveAttribute("data-state", "complete");
    expect(within(setup).getByTestId("overview-setup-link")).toHaveAttribute("href", "/admin/setup");
  });

  it("given a board unfolded a finished setup, when the language changes, then the steps stay unfolded", async () => {
    // given
    show();
    const setup = await screen.findByTestId("overview-setup");
    await userEvent.click(within(setup).getByTestId("overview-setup-summary"));
    expect(setup).toHaveAttribute("open");

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(within(setup).getByTestId("overview-setup-summary")).toHaveTextContent("Einrichtung abgeschlossen");
    expect(setup, "a render does not fold back what the board opened").toHaveAttribute("open");
  });

  it("given setup is incomplete, when the overview opens, then the steps lead the page unfolded", async () => {
    // given
    vi.mocked(api.courts).mockResolvedValue([]);
    vi.mocked(api.adminCourts).mockResolvedValue([]);

    // when
    show();

    // then
    const setup = await screen.findByTestId("overview-setup");
    await waitFor(() => expect(setup).toHaveAttribute("open"));
    expect(within(setup).getByTestId("setup-progress")).toHaveTextContent("3 of 4 required steps complete");
    expect(within(setup).getByTestId("setup-step-facility")).toHaveAttribute("data-state", "next");
    expect(within(setup).queryByTestId("overview-setup-summary"), "an unfinished setup is not presented as done")
      .not.toHaveTextContent("Setup complete");
  });

  it("given the setup state cannot be read, when the overview opens, then the setup section reports it and the cards still load", async () => {
    // given
    vi.mocked(api.adminConfig).mockRejectedValueOnce(new Error("offline for a moment"));

    // when
    show();

    // then
    const setup = await screen.findByTestId("overview-setup-failure");
    expect(within(setup).getByTestId("load-failure")).toBeInTheDocument();
    expect(await within(screen.getByTestId("overview-changes")).findByTestId("overview-changes-empty")).toBeInTheDocument();

    // when
    await userEvent.click(within(setup).getByTestId("retry-load"));

    // then
    expect(await within(await screen.findByTestId("overview-setup")).findByTestId("overview-setup-summary")).toBeInTheDocument();
  });
});
