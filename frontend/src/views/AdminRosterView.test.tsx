import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { api, type MembershipType, type RosterEntry } from "../api/client";
import i18n from "../i18n";
import { AdminRosterView } from "./AdminRosterView";

const withAccount: RosterEntry = {
  personId: "person-1", firstName: "Jane", lastName: "Doe", email: "jane.doe@example.org",
  accountId: "account-1", username: "doe.jane", enabled: true, roles: ["MEMBER"],
  membershipTypeId: "type-1", membershipStartedOn: "2026-01-01", membershipEndedOn: null
};

const withoutAccount: RosterEntry = {
  personId: "person-2", firstName: "John", lastName: "Roe", email: "john.roe@example.org",
  accountId: null, username: null, enabled: false, roles: []
};

const departed: RosterEntry = {
  personId: "person-3", firstName: "Mary", lastName: "Major", email: "mary.major@example.org",
  accountId: "account-3", username: "major.mary", enabled: true, roles: ["MEMBER"],
  membershipTypeId: "type-1", membershipStartedOn: "2025-01-01", membershipEndedOn: "2026-03-31"
};

const adults: MembershipType = { id: "type-1", name: "Adults", ruleSetId: null, active: true, grantsAccount: false };

function row(personId: string): HTMLElement {
  return screen.getByTestId(`roster-row-${personId}`);
}

function OpenedPerson() {
  const location = useLocation();
  const state = location.state as unknown;
  const created = typeof state === "object" && state !== null && "personCreated" in state
    && state.personCreated === true;
  return <div data-testid="opened-person" data-created={created}>opened</div>;
}

describe("AdminRosterView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [withAccount, withoutAccount], nextCursor: null });
    vi.spyOn(api, "membershipTypes").mockResolvedValue([adults]);
  });

  it("given people with and without an account, when the view loads, then the list says which is which", async () => {
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);

    expect(await screen.findByTestId("roster-row-person-1")).toBeInTheDocument();
    expect(within(row("person-1")).getByTestId("roster-account-person-1")).toHaveTextContent("Active");
    expect(within(row("person-2")).getByTestId("roster-account-person-2")).toHaveTextContent("No account");
  });

  it("given the roster cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "roster").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("given a person in the list, when reading their row, then their name links to their page", async () => {
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);

    expect(await screen.findByTestId("person-link-person-1"))
      .toHaveAttribute("href", "/admin/roster/person-1");
  });

  it("given an ended membership, when the list is read, then it is not shown as a current one", async () => {
    // given
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [withAccount, departed], nextCursor: null });

    // when
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("roster-membership-person-1")).toHaveTextContent("Adults");
    const ended = screen.getByTestId("roster-membership-person-3");
    expect(ended).not.toHaveTextContent("Adults");
    expect(ended).toHaveTextContent("2026-03-31");
  });

  it("given a membership type is chosen, when filtering, then the list asks the server for that type", async () => {
    // given
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);

    // when
    await userEvent.selectOptions(await screen.findByTestId("roster-filter"), "type-1");

    // then
    await waitFor(() => expect(api.roster).toHaveBeenLastCalledWith(undefined, undefined, 50, "type-1"));
  });

  it("given a name to look for, when searching, then the roster is read again for that name", async () => {
    // given
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    await screen.findByTestId("roster-row-person-1");

    // when
    await userEvent.type(screen.getByTestId("roster-search"), "Roe");
    await userEvent.click(screen.getByTestId("roster-search-submit"));

    // then
    await waitFor(() => expect(api.roster).toHaveBeenLastCalledWith("Roe", undefined, 50, undefined));
  });

  it("given a further page, when reading it, then its people are appended", async () => {
    // given
    vi.spyOn(api, "roster")
      .mockResolvedValueOnce({ entries: [withAccount], nextCursor: "person-1" })
      .mockResolvedValueOnce({ entries: [withoutAccount], nextCursor: null });
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    await screen.findByTestId("roster-row-person-1");

    // when
    await userEvent.click(screen.getByTestId("roster-load-more"));

    // then
    expect(await screen.findByTestId("roster-row-person-2")).toBeInTheDocument();
    expect(screen.getByTestId("roster-row-person-1")).toBeInTheDocument();
  });

  it("given a search and a filter with a further page, when reading it, then both are asked for again", async () => {
    // given
    vi.spyOn(api, "roster")
      .mockResolvedValueOnce({ entries: [withAccount, withoutAccount], nextCursor: null })
      .mockResolvedValueOnce({ entries: [withAccount], nextCursor: "person-1" })
      .mockResolvedValueOnce({ entries: [withoutAccount], nextCursor: null });
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    await screen.findByTestId("roster-row-person-1");
    await userEvent.type(screen.getByTestId("roster-search"), "Doe");
    await userEvent.click(screen.getByTestId("roster-search-submit"));
    await screen.findByTestId("roster-load-more");

    // when
    await userEvent.click(screen.getByTestId("roster-load-more"));

    // then
    await waitFor(() => expect(api.roster).toHaveBeenLastCalledWith("Doe", "person-1", 50, undefined));
  });

  it("when adding a person, then they join the roster and their page opens", async () => {
    // given
    const created: RosterEntry = {
      personId: "person-9", firstName: "Mary", lastName: "Major", email: "mary.major@example.org",
      accountId: null, username: null, enabled: false, roles: []
    };
    vi.spyOn(api, "createPerson").mockResolvedValue(created);
    render(<MemoryRouter initialEntries={["/admin/roster"]}>
      <Routes>
        <Route path="/admin/roster" element={<AdminRosterView />} />
        <Route path="/admin/roster/:personId" element={<OpenedPerson />} />
      </Routes>
    </MemoryRouter>);
    await screen.findByTestId("roster-row-person-1");

    // when
    await userEvent.type(screen.getByTestId("new-person-first-name"), "Mary");
    await userEvent.type(screen.getByTestId("new-person-last-name"), "Major");
    await userEvent.type(screen.getByTestId("new-person-email"), "mary.major@example.org");
    await userEvent.click(screen.getByTestId("create-person"));

    // then
    expect(api.createPerson).toHaveBeenCalledWith({
      firstName: "Mary", lastName: "Major", email: "mary.major@example.org"
    });
    expect(await screen.findByTestId("opened-person")).toHaveAttribute("data-created", "true");
  });

  it("given a club with no address for somebody, when adding them, then no empty address is sent", async () => {
    // given
    const created: RosterEntry = {
      personId: "person-9", firstName: "Mary", lastName: "Major", email: null,
      accountId: null, username: null, enabled: false, roles: []
    };
    vi.spyOn(api, "createPerson").mockResolvedValue(created);
    render(<MemoryRouter initialEntries={["/admin/roster"]}>
      <Routes>
        <Route path="/admin/roster" element={<AdminRosterView />} />
        <Route path="/admin/roster/:personId" element={<div data-testid="opened-person">opened</div>} />
      </Routes>
    </MemoryRouter>);
    await screen.findByTestId("roster-row-person-1");

    // when
    await userEvent.type(screen.getByTestId("new-person-first-name"), "Mary");
    await userEvent.type(screen.getByTestId("new-person-last-name"), "Major");
    await userEvent.click(screen.getByTestId("create-person"));

    // then
    expect(api.createPerson).toHaveBeenCalledWith({
      firstName: "Mary", lastName: "Major", email: null
    });
  });

  it("given nobody matches the search, when the roster is read, then the empty list says so", async () => {
    // given
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [], nextCursor: null });

    // when
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("roster-empty")).toHaveTextContent(
      "People matching the current filters appear here. Change the search or add a person below."
    );
  });
});
