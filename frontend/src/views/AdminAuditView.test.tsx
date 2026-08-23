import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api, type AuditEntry, type ClubConfig } from "../api/client";
import i18n from "../i18n";
import { AdminAuditView } from "./AdminAuditView";

const courtAdded: AuditEntry = {
  id: "11111111-1111-1111-1111-111111111111",
  occurredAt: "2026-08-20T12:00:00Z",
  eventType: "facility.court.added",
  parameters: { number: 7 },
  subjectId: "22222222-2222-2222-2222-222222222222",
  subjectName: "Centre Court",
  actorAccountId: "33333333-3333-3333-3333-333333333333",
  actorUsername: "doe.jane"
};

const clubConfig: ClubConfig = {
  clubName: "Example Tennis Club", primaryColor: "#000000", accentColor: "#ffffff",
  logoUrl: null, imprintUrl: null, defaultLocale: "en", supportedLocales: ["de", "en"],
  slotMinutes: 60, timeZone: "Europe/Berlin"
};

function row(entryId: string): HTMLElement {
  const found = screen.getAllByTestId("audit-row")
    .find((element) => element.getAttribute("data-entry-id") === entryId);
  if (!found) throw new Error(`No audit row rendered for entry ${entryId}`);
  return found;
}

describe("AdminAuditView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "config").mockResolvedValue(clubConfig);
  });

  it("given an entry, when the log is shown, then its row names the change, the subject and the actor", async () => {
    // given
    vi.spyOn(api, "audit").mockResolvedValue({ entries: [courtAdded], nextCursor: null });

    // when
    render(<MemoryRouter><AdminAuditView /></MemoryRouter>);
    await screen.findByTestId("audit-row");

    // then
    const entryRow = row(courtAdded.id);
    expect(within(entryRow).getByTestId("audit-message")).toHaveTextContent("Court 7 added");
    expect(within(entryRow).getByTestId("audit-subject")).toHaveTextContent("Centre Court");
    expect(within(entryRow).getByTestId("audit-actor")).toHaveTextContent("doe.jane");
  });

  it("given an entry with no actor, when it is shown, then the actor names the system", async () => {
    // given
    const entry: AuditEntry = { ...courtAdded, actorAccountId: null, actorUsername: null };
    vi.spyOn(api, "audit").mockResolvedValue({ entries: [entry], nextCursor: null });

    // when
    render(<MemoryRouter><AdminAuditView /></MemoryRouter>);
    await screen.findByTestId("audit-row");

    // then
    expect(within(row(entry.id)).getByTestId("audit-actor")).toHaveTextContent("System");
  });

  it("given an actor whose account was erased, when it is shown, then the raw account id is used, not the system", async () => {
    // given
    const entry: AuditEntry = { ...courtAdded, actorUsername: null };
    vi.spyOn(api, "audit").mockResolvedValue({ entries: [entry], nextCursor: null });

    // when
    render(<MemoryRouter><AdminAuditView /></MemoryRouter>);
    await screen.findByTestId("audit-row");

    // then
    const actor = within(row(entry.id)).getByTestId("audit-actor");
    expect(actor).toHaveTextContent(entry.actorAccountId!);
    expect(actor).not.toHaveTextContent("System");
  });

  it("given a subject whose entity was removed, when it is shown, then the subject id stands in for it", async () => {
    // given
    const entry: AuditEntry = { ...courtAdded, subjectName: null };
    vi.spyOn(api, "audit").mockResolvedValue({ entries: [entry], nextCursor: null });

    // when
    render(<MemoryRouter><AdminAuditView /></MemoryRouter>);
    await screen.findByTestId("audit-row");

    // then
    expect(within(row(entry.id)).getByTestId("audit-subject")).toHaveTextContent(entry.subjectId);
  });

  it("given an opening-hours entry with no subject name, when it is shown, then the subject cell names the weekday, translated", async () => {
    // given
    const entry: AuditEntry = {
      ...courtAdded, eventType: "facility.openingHours.closed", parameters: { dayOfWeek: 6 }, subjectName: null
    };
    vi.spyOn(api, "audit").mockResolvedValue({ entries: [entry], nextCursor: null });

    // when
    render(<MemoryRouter><AdminAuditView /></MemoryRouter>);
    await screen.findByTestId("audit-row");

    // then
    expect(within(row(entry.id)).getByTestId("audit-subject")).toHaveTextContent("Saturday");
  });

  it("given an opening-hours entry whose weekday is out of range, when it is shown, then no message key reaches the subject cell", async () => {
    // given
    const entry: AuditEntry = {
      ...courtAdded, eventType: "facility.openingHours.closed", parameters: { dayOfWeek: 9 }, subjectName: null
    };
    vi.spyOn(api, "audit").mockResolvedValue({ entries: [entry], nextCursor: null });

    // when
    render(<MemoryRouter><AdminAuditView /></MemoryRouter>);
    await screen.findByTestId("audit-row");

    // then
    expect(within(row(entry.id)).getByTestId("audit-subject")).toHaveTextContent(entry.subjectId);
  });

  it("given the occurred-at cell, when the club has its own time zone and the browser has a language, then both are honoured, never the browser's own zone", async () => {
    // given
    vi.spyOn(api, "audit").mockResolvedValue({ entries: [courtAdded], nextCursor: null });
    vi.spyOn(api, "config").mockResolvedValue({ ...clubConfig, timeZone: "America/New_York" });
    await i18n.changeLanguage("de");

    // when
    render(<MemoryRouter><AdminAuditView /></MemoryRouter>);
    await screen.findByTestId("audit-row");

    // then
    const expected = new Intl.DateTimeFormat("de", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" })
      .format(new Date(courtAdded.occurredAt));
    expect(within(row(courtAdded.id)).getByTestId("audit-occurred-at")).toHaveTextContent(expected);
  });

  it.each([
    ["facility.openingHours.set", { dayOfWeek: 1, opensAt: "08:00:00", closesAt: "22:00:00" }, "Opening hours set: Monday, 08:00–22:00"],
    ["facility.openingHours.closed", { dayOfWeek: 7 }, "Sunday closed"],
    ["card.participantCard.added", { capacity: 4 }, "Participant card with capacity 4 added"],
    ["card.participantCard.added", { capacity: null }, "Participant card with no capacity limit added"],
    ["config.club.localeChanged", { defaultLocale: "de" }, "Default language changed to de"],
    ["config.club.slotDurationChanged", { slotMinutes: 30 }, "Slot duration changed to 30 minutes"],
    ["config.club.timeZoneChanged", { timeZone: "Europe/Berlin" }, "Time zone changed to Europe/Berlin"],
    ["rules.definition.set", { ruleType: "ADVANCE_WINDOW", params: { maxDays: 14 } }, "Rule Advance booking window set: Maximum days in advance: 14"],
    ["rules.definition.removed", { ruleType: "ADVANCE_WINDOW" }, "Rule Advance booking window removed"],
    ["roster.membership.written", { startedOn: "2026-01-01" }, "Membership recorded from 2026-01-01"],
    ["roster.membership.written", { startedOn: null }, "Membership recorded"]
  ])("given a %s event, when it is shown, then its interpolated values are resolved, not left as template text", async (eventType, parameters, expected) => {
    // given
    const entry: AuditEntry = { ...courtAdded, eventType, parameters };
    vi.spyOn(api, "audit").mockResolvedValue({ entries: [entry], nextCursor: null });

    // when
    render(<MemoryRouter><AdminAuditView /></MemoryRouter>);
    await screen.findByTestId("audit-row");

    // then
    expect(within(row(entry.id)).getByTestId("audit-message")).toHaveTextContent(expected);
    expect(within(row(entry.id)).getByTestId("audit-message")).not.toHaveTextContent("{{");
  });

  it.each([
    ["facility.court.availabilityChanged", { active: true }, "Court activated"],
    ["facility.court.availabilityChanged", { active: false }, "Court deactivated"],
    ["card.bookingCard.availabilityChanged", { active: true }, "Booking card activated"],
    ["card.bookingCard.availabilityChanged", { active: false }, "Booking card deactivated"],
    ["card.participantCard.availabilityChanged", { active: true }, "Participant card activated"],
    ["card.participantCard.availabilityChanged", { active: false }, "Participant card deactivated"],
    ["rules.ruleSet.availabilityChanged", { active: true }, "Rule set activated"],
    ["rules.ruleSet.availabilityChanged", { active: false }, "Rule set deactivated"],
    ["roster.membershipType.availabilityChanged", { active: true }, "Membership type activated"],
    ["roster.membershipType.availabilityChanged", { active: false }, "Membership type deactivated"],
    ["roster.account.availabilityChanged", { enabled: true }, "Account enabled"],
    ["roster.account.availabilityChanged", { enabled: false }, "Account disabled"]
  ])("given a %s event with %j, when it is shown, then it reads %j", async (eventType, parameters, expected) => {
    // given
    const entry: AuditEntry = { ...courtAdded, eventType, parameters };
    vi.spyOn(api, "audit").mockResolvedValue({ entries: [entry], nextCursor: null });

    // when
    render(<MemoryRouter><AdminAuditView /></MemoryRouter>);
    await screen.findByTestId("audit-row");

    // then
    expect(within(row(entry.id)).getByTestId("audit-message")).toHaveTextContent(expected);
  });

  it("given a further page, when reading it, then its entries are appended", async () => {
    // given
    const second: AuditEntry = { ...courtAdded, id: "44444444-4444-4444-4444-444444444444" };
    const audit = vi.spyOn(api, "audit")
      .mockResolvedValueOnce({ entries: [courtAdded], nextCursor: courtAdded.id })
      .mockResolvedValueOnce({ entries: [second], nextCursor: null });
    render(<MemoryRouter><AdminAuditView /></MemoryRouter>);
    const user = userEvent.setup();

    // when
    await user.click(await screen.findByTestId("audit-load-more"));

    // then
    expect(audit).toHaveBeenNthCalledWith(2, courtAdded.id, 50, undefined);
    expect(await screen.findAllByTestId("audit-row")).toHaveLength(2);
    expect(within(row(second.id)).getByTestId("audit-message")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-load-more")).not.toBeInTheDocument();
  });

  it("given a page already loaded through 'load more', when the language changes, then the collected pages are not thrown away", async () => {
    // given
    const second: AuditEntry = { ...courtAdded, id: "44444444-4444-4444-4444-444444444444" };
    const audit = vi.spyOn(api, "audit")
      .mockResolvedValueOnce({ entries: [courtAdded], nextCursor: courtAdded.id })
      .mockResolvedValueOnce({ entries: [second], nextCursor: null });
    render(<MemoryRouter><AdminAuditView /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("audit-load-more"));
    expect(await screen.findAllByTestId("audit-row")).toHaveLength(2);

    // when
    await i18n.changeLanguage("de");

    // then
    await waitFor(() => expect(screen.getAllByTestId("audit-row")).toHaveLength(2));
    expect(audit).toHaveBeenCalledTimes(2);
  });

  it("given nobody has changed anything yet, when the log is read, then the empty state says so", async () => {
    // given
    vi.spyOn(api, "audit").mockResolvedValue({ entries: [], nextCursor: null });

    // when
    render(<MemoryRouter><AdminAuditView /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("audit-empty")).toHaveTextContent("Nothing recorded yet.");
    expect(screen.queryByTestId("audit-load-more")).not.toBeInTheDocument();
  });

  it("given the log cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "audit").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><AdminAuditView /></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("given a subject in the address, when the log is opened, then only that subject is asked for", async () => {
    // given
    const audit = vi.spyOn(api, "audit").mockResolvedValue({ entries: [courtAdded], nextCursor: null });

    // when
    render(<MemoryRouter initialEntries={["/admin/audit?subjectId=subject-1"]}><AdminAuditView /></MemoryRouter>);

    // then
    await waitFor(() => expect(audit).toHaveBeenCalledWith(undefined, 50, "subject-1"));
  });

  it("given a subject in the address, when a further page is read, then it stays narrowed to that subject", async () => {
    // given
    const audit = vi.spyOn(api, "audit")
      .mockResolvedValueOnce({ entries: [courtAdded], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ entries: [], nextCursor: null });
    render(<MemoryRouter initialEntries={["/admin/audit?subjectId=subject-1"]}><AdminAuditView /></MemoryRouter>);
    await screen.findByTestId("audit-load-more");

    // when
    await userEvent.click(screen.getByTestId("audit-load-more"));

    // then
    await waitFor(() => expect(audit).toHaveBeenLastCalledWith("cursor-1", 50, "subject-1"));
  });
});
