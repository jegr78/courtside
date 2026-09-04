import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation } from "react-router-dom";
import { api, type MembershipType, type RosterEntry } from "../api/client";
import i18n from "../i18n";
import { UnsavedChangesProvider } from "../unsaved/UnsavedChangesProvider";
import { UnsavedChangesGuard } from "../unsaved/UnsavedChangesGuard";
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
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    expect(await screen.findByTestId("roster-row-person-1")).toBeInTheDocument();
    expect(within(row("person-1")).getByTestId("roster-account-person-1")).toHaveTextContent("Active");
    expect(within(row("person-2")).getByTestId("roster-account-person-2")).toHaveTextContent("No account");
    expect(api.roster).toHaveBeenCalledWith(undefined, undefined, 50, undefined);
  });

  it("given the roster cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "roster").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("given a person in the list, when reading their row, then their name links to their page", async () => {
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    expect(await screen.findByTestId("person-link-person-1"))
      .toHaveAttribute("href", "/admin/roster/person-1");
  });

  it("given an ended membership, when the list is read, then it is not shown as a current one", async () => {
    // given
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [withAccount, departed], nextCursor: null });

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("roster-membership-person-1")).toHaveTextContent("Adults");
    const ended = screen.getByTestId("roster-membership-person-3");
    expect(ended).not.toHaveTextContent("Adults");
    expect(ended).toHaveTextContent("2026-03-31");
  });

  it("given a membership type is chosen, when filtering, then the list asks the server for that type", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // when
    await userEvent.selectOptions(await screen.findByTestId("roster-filter"), "type-1");

    // then
    await waitFor(() => expect(api.roster).toHaveBeenLastCalledWith(undefined, undefined, 50, "type-1"));
  });

  it("given a name to look for, when searching, then the roster is read again for that name", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);
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
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);
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
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);
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
    render(<MemoryRouter initialEntries={["/admin/roster"]}><UnsavedChangesProvider>
      <Routes>
        <Route path="/admin/roster" element={<AdminRosterView />} />
        <Route path="/admin/roster/:personId" element={<OpenedPerson />} />
      </Routes>
    </UnsavedChangesProvider></MemoryRouter>);
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

  function rosterRouter() {
    return createMemoryRouter([{
      path: "*",
      element: <UnsavedChangesProvider>
        <UnsavedChangesGuard />
        <Routes>
          <Route path="/admin/roster" element={<AdminRosterView />} />
          <Route path="/admin/roster/:personId" element={<p data-testid="opened-person">opened</p>} />
        </Routes>
      </UnsavedChangesProvider>
    }], { initialEntries: ["/admin/roster"] });
  }

  it("given the create form is filled in, when the person is created, then their page opens without a question", async () => {
    // given
    vi.spyOn(api, "createPerson").mockResolvedValue({
      personId: "person-9", firstName: "Mary", lastName: "Major", email: null,
      accountId: null, username: null, enabled: false, roles: []
    });
    render(<RouterProvider router={rosterRouter()} />);
    await screen.findByTestId("roster-row-person-1");

    // when
    await userEvent.type(screen.getByTestId("new-person-first-name"), "Mary");
    await userEvent.type(screen.getByTestId("new-person-last-name"), "Major");
    await userEvent.click(screen.getByTestId("create-person"));

    // then
    expect(await screen.findByTestId("opened-person")).toBeInTheDocument();
    expect(screen.queryByTestId("unsaved-changes")).not.toBeInTheDocument();
  });

  it("given creating the person failed, when leaving the roster, then the filled form is still asked about", async () => {
    // given
    vi.spyOn(api, "createPerson").mockRejectedValue(new Error("unavailable"));
    render(<RouterProvider router={rosterRouter()} />);
    await screen.findByTestId("roster-row-person-1");
    await userEvent.type(screen.getByTestId("new-person-first-name"), "Mary");
    await userEvent.click(screen.getByTestId("create-person"));
    await screen.findByRole("alert");

    // when
    await userEvent.click(screen.getByTestId("person-link-person-1"));

    // then
    expect(await screen.findByTestId("unsaved-changes")).toBeInTheDocument();
    expect(screen.queryByTestId("opened-person")).not.toBeInTheDocument();
  });

  it("given a club with no address for somebody, when adding them, then no empty address is sent", async () => {
    // given
    const created: RosterEntry = {
      personId: "person-9", firstName: "Mary", lastName: "Major", email: null,
      accountId: null, username: null, enabled: false, roles: []
    };
    vi.spyOn(api, "createPerson").mockResolvedValue(created);
    render(<MemoryRouter initialEntries={["/admin/roster"]}><UnsavedChangesProvider>
      <Routes>
        <Route path="/admin/roster" element={<AdminRosterView />} />
        <Route path="/admin/roster/:personId" element={<div data-testid="opened-person">opened</div>} />
      </Routes>
    </UnsavedChangesProvider></MemoryRouter>);
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
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("roster-empty")).toHaveTextContent(
      "People matching the current filters appear here. Change the search or add a person below."
    );
  });
  it("given a failure on screen, when the language changes, then it is read out in the new language", async () => {
    // given
    vi.spyOn(api, "roster").mockRejectedValue(new Error("unavailable"));
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(screen.getByRole("alert")).toHaveTextContent("Das hat nicht funktioniert. Bitte versuche es erneut.");
  });

  it("given a filtered and paged roster, when the language changes, then the page is not fetched again", async () => {
    // given
    const reading = vi.spyOn(api, "roster")
      .mockResolvedValue({ entries: [withAccount], nextCursor: "cursor-2" });
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("roster-row-person-1");
    await userEvent.selectOptions(screen.getByTestId("roster-filter"), "type-1");
    await waitFor(() => expect(screen.getByTestId("roster-filter")).toHaveValue("type-1"));
    reading.mockResolvedValueOnce({ entries: [departed], nextCursor: null });
    await userEvent.click(screen.getByTestId("roster-load-more"));
    await waitFor(() => expect(reading).toHaveBeenCalledTimes(3));

    // when
    await act(() => i18n.changeLanguage("de"));

    // then — the text is translated, the roster is not asked again
    expect(screen.getByTestId("roster-search-submit")).toHaveTextContent("Suchen");
    expect(reading).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("roster-filter")).toHaveValue("type-1");
    expect(reading).toHaveBeenLastCalledWith(undefined, "cursor-2", 50, "type-1");
  });
});
