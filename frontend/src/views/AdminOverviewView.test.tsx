import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  api, type AdminClubConfig, type Allocation, type AuditEntry, type ClubConfig, type MessageEntry, type RosterEntry
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

const middayInBerlin = () => new Date("2026-09-25T10:30:00Z");

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
