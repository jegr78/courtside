import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api, type AuditEntry } from "../api/client";
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
    expect(within(row(entry.id)).getByTestId("audit-subject")).toHaveTextContent(entry.subjectId!);
  });

  it.each([
    ["facility.court.availabilityChanged", { active: true }, "Court activated"],
    ["facility.court.availabilityChanged", { active: false }, "Court deactivated"],
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
    expect(audit).toHaveBeenNthCalledWith(2, courtAdded.id);
    expect(await screen.findAllByTestId("audit-row")).toHaveLength(2);
    expect(within(row(second.id)).getByTestId("audit-message")).toBeInTheDocument();
    expect(screen.queryByTestId("audit-load-more")).not.toBeInTheDocument();
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
  });
});
