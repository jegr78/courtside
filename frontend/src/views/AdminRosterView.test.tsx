import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation } from "react-router-dom";
import { api, ApiError, type MembershipType, type RosterEntry } from "../api/client";
import i18n from "../i18n";
import { UnsavedChangesProvider } from "../unsaved/UnsavedChangesProvider";
import { UnsavedChangesGuard } from "../unsaved/UnsavedChangesGuard";
import { AdminRosterView } from "./AdminRosterView";

const withAccount: RosterEntry = {
  personId: "person-1", firstName: "Jane", lastName: "Doe", email: "jane.doe@example.org",
  accountId: "account-1", username: "doe.jane", enabled: true, roles: ["MEMBER"],
  credentialState: "PASSWORD_CHOSEN",
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

const trainer: RosterEntry = {
  personId: "person-4", firstName: "Tara", lastName: "Trainer", email: "tara@example.org",
  accountId: "account-4", username: "trainer.tara", enabled: true, roles: ["MEMBER", "TRAINER"],
  credentialState: "AWAITING_CREDENTIAL"
};

const blocked: RosterEntry = {
  personId: "person-5", firstName: "Richard", lastName: "Miles", email: "richard.miles@example.org",
  accountId: "account-5", username: "miles.richard", enabled: false, roles: ["MEMBER"],
  credentialState: "CREDENTIAL_EXPIRED"
};

const adults: MembershipType = { id: "type-1", name: "Adults", ruleSetId: null, active: true, grantsAccount: false };

function resizeTo(width: number) {
  window.innerWidth = width;
  window.dispatchEvent(new Event("resize"));
}

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
    resizeTo(1024);
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [withAccount, withoutAccount], nextCursor: null, matching: 2 });
    vi.spyOn(api, "membershipTypes").mockResolvedValue([adults]);
  });

  it("given people with and without an account, when the view loads, then the list says which is which", async () => {
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    expect(await screen.findByTestId("roster-row-person-1")).toBeInTheDocument();
    expect(within(row("person-1")).getByTestId("roster-account-person-1")).toHaveTextContent("Active");
    expect(within(row("person-2")).getByTestId("roster-account-person-2")).toHaveTextContent("No account");
    expect(api.roster).toHaveBeenCalledWith({ limit: 20 });
  });

  it("given account roles, when the roster loads, then translated roles are visible in their column", async () => {
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [trainer, withoutAccount], nextCursor: null, matching: 2 });

    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    expect(await screen.findByTestId("roster-roles-person-4")).toHaveTextContent("Member, Trainer");
    expect(screen.getByTestId("roster-roles-person-2")).toHaveTextContent("—");
    expect(within(row("person-4")).getByTestId("roster-label-roles")).toHaveTextContent("Roles");
  });

  it("given a role is selected, when filtering, then the first page asks the server for that role", async () => {
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    await userEvent.selectOptions(await screen.findByTestId("roster-role-filter"), "TRAINER");

    await waitFor(() => expect(api.roster).toHaveBeenLastCalledWith({
      limit: 20, role: "TRAINER", sortBy: "NAME", sortDirection: "ASC"
    }));
  });

  it("given the name column is ascending, when selecting it, then it becomes descending and starts at page one", async () => {
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("roster-row-person-1");

    const [heading] = screen.getAllByRole("columnheader");
    expect(heading).toHaveAttribute("aria-sort", "ascending");
    await userEvent.click(within(heading).getByRole("button"));

    await waitFor(() => expect(api.roster).toHaveBeenLastCalledWith({
      limit: 20, sortBy: "NAME", sortDirection: "DESC"
    }));
    expect(heading).toHaveAttribute("aria-sort", "descending");
  });

  it("given two pages, when navigating forward and back, then one page is shown at a time", async () => {
    vi.spyOn(api, "roster")
      .mockResolvedValueOnce({ entries: [withAccount], nextCursor: "person-1", matching: 2 })
      .mockResolvedValueOnce({ entries: [withoutAccount], nextCursor: null, matching: 2 })
      .mockResolvedValueOnce({ entries: [withAccount], nextCursor: "person-1", matching: 2 });
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("roster-row-person-1");

    await userEvent.click(screen.getByTestId("roster-next-page"));
    expect(await screen.findByTestId("roster-row-person-2")).toBeInTheDocument();
    expect(screen.queryByTestId("roster-row-person-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("roster-page-number")).toHaveTextContent("Page 2");

    await userEvent.click(screen.getByTestId("roster-previous-page"));
    expect(await screen.findByTestId("roster-row-person-1")).toBeInTheDocument();
    expect(screen.queryByTestId("roster-row-person-2")).not.toBeInTheDocument();
    expect(screen.getByTestId("roster-page-number")).toHaveTextContent("Page 1");
  });

  it("given a person on a phone, when their card is read, then every roster field carries its label", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // when
    const person = await screen.findByTestId("roster-row-person-1");

    // then
    expect(person).toHaveClass("grid");
    for (const [testId, label] of [
      ["roster-label-name", "Name"],
      ["roster-label-username", "Username"],
      ["roster-label-account", "Account"],
      ["roster-label-credential", "Access"],
      ["roster-label-membership", "Membership type"],
      ["roster-label-roles", "Roles"]
    ]) {
      expect(within(person).getByTestId(testId)).toHaveTextContent(label);
      expect(within(person).getByTestId(testId)).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("given a membership type the address names but the instance refuses, when the roster is opened, then the refusal is shown instead of an unfiltered roster", async () => {
    // given
    const refused = vi.spyOn(api, "roster").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:parameter-type-mismatch", title: "Bad Request", status: 400,
      detail: "The parameter membershipTypeId is not of the expected type"
    }));

    // when
    render(<MemoryRouter initialEntries={["/admin/roster?membershipTypeId=not-a-type"]}>
      <UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(refused).toHaveBeenCalledWith({ limit: 20, membershipTypeId: "not-a-type" });
    expect(screen.queryByTestId("roster-row-person-1")).toBeNull();
  });

  it("given the address asks for everybody without a password of their own, when the roster is opened, then it reads and shows that filter", async () => {
    // given
    vi.mocked(api.roster).mockResolvedValue({ entries: [trainer, blocked], nextCursor: null, matching: 2 });

    // when
    render(<MemoryRouter initialEntries={["/admin/roster?access=NOT_CHOSEN"]}>
      <UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("roster-row-person-4")).toBeInTheDocument();
    expect(api.roster).toHaveBeenCalledWith({
      limit: 20, credentialStates: ["AWAITING_CREDENTIAL", "CREDENTIAL_ISSUED", "CREDENTIAL_EXPIRED"]
    });
    expect(screen.getByTestId("roster-credential-filter"), "the filter shows what the list was narrowed by").toHaveValue("NOT_CHOSEN");
  });

  it("given an access filter the address names but the roster does not offer, when the roster is opened, then it reads everybody", async () => {
    // when
    render(<MemoryRouter initialEntries={["/admin/roster?access=EVERYTHING"]}>
      <UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("roster-row-person-1")).toBeInTheDocument();
    expect(api.roster).toHaveBeenCalledWith({ limit: 20 });
    expect(screen.getByTestId("roster-credential-filter")).toHaveValue("");
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
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [withAccount, departed], nextCursor: null, matching: 2 });

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
    await waitFor(() => expect(api.roster).toHaveBeenLastCalledWith({
      limit: 20, membershipTypeId: "type-1", sortBy: "NAME", sortDirection: "ASC"
    }));
  });

  it("given the URL filter changes while its roster is loading, when the old answer arrives last, then it is discarded", async () => {
    // given
    let resolveFiltered!: (page: { entries: RosterEntry[]; nextCursor: null; matching: number }) => void;
    const filtered = new Promise<{ entries: RosterEntry[]; nextCursor: null; matching: number }>((resolve) => {
      resolveFiltered = resolve;
    });
    vi.spyOn(api, "roster").mockImplementation((criteria) =>
      criteria?.membershipTypeId === "type-1"
        ? filtered
        : Promise.resolve({ entries: [withoutAccount], nextCursor: null, matching: 2 }));
    const router = createMemoryRouter([{
      path: "/admin/roster",
      element: <UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider>
    }], { initialEntries: ["/admin/roster?membershipTypeId=type-1"] });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(api.roster).toHaveBeenCalledWith({ limit: 20, membershipTypeId: "type-1" }));

    // when
    await act(() => router.navigate("/admin/roster"));
    expect(await screen.findByTestId("roster-row-person-2")).toBeInTheDocument();
    await act(async () => {
      resolveFiltered({ entries: [withAccount], nextCursor: null, matching: 2 });
      await filtered;
    });

    // then
    expect(screen.getByTestId("roster-filter")).toHaveValue("");
    expect(screen.getByTestId("roster-row-person-2")).toBeInTheDocument();
    expect(screen.queryByTestId("roster-row-person-1")).not.toBeInTheDocument();
  });

  it("given a name to look for, when searching, then the roster is read again for that name", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("roster-row-person-1");

    // when
    await userEvent.type(screen.getByTestId("roster-search"), "Roe");
    await userEvent.click(screen.getByTestId("roster-search-submit"));

    // then
    await waitFor(() => expect(api.roster).toHaveBeenLastCalledWith({
      query: "Roe", limit: 20, sortBy: "NAME", sortDirection: "ASC"
    }));
  });

  it("given a further page, when reading it, then it replaces the current page", async () => {
    // given
    vi.spyOn(api, "roster")
      .mockResolvedValueOnce({ entries: [withAccount], nextCursor: "person-1", matching: 2 })
      .mockResolvedValueOnce({ entries: [withoutAccount], nextCursor: null, matching: 2 });
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("roster-row-person-1");

    // when
    await userEvent.click(screen.getByTestId("roster-next-page"));

    // then
    expect(await screen.findByTestId("roster-row-person-2")).toBeInTheDocument();
    expect(screen.queryByTestId("roster-row-person-1")).not.toBeInTheDocument();
  });

  it("given a search and a filter with a further page, when reading it, then both are asked for again", async () => {
    // given
    vi.spyOn(api, "roster")
      .mockResolvedValueOnce({ entries: [withAccount, withoutAccount], nextCursor: null, matching: 2 })
      .mockResolvedValueOnce({ entries: [withAccount], nextCursor: "person-1", matching: 2 })
      .mockResolvedValueOnce({ entries: [withoutAccount], nextCursor: null, matching: 2 });
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("roster-row-person-1");
    await userEvent.type(screen.getByTestId("roster-search"), "Doe");
    await userEvent.click(screen.getByTestId("roster-search-submit"));
    expect(await screen.findByTestId("roster-next-page")).toBeEnabled();

    // when
    await userEvent.click(screen.getByTestId("roster-next-page"));

    // then
    await waitFor(() => expect(api.roster).toHaveBeenLastCalledWith({
      query: "Doe", cursor: "person-1", limit: 20, sortBy: "NAME", sortDirection: "ASC"
    }));
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
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [], nextCursor: null, matching: 2 });

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("roster-empty")).toHaveTextContent(
      "People matching the current filters appear here. Change the search or add a person above."
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
      .mockResolvedValue({ entries: [withAccount], nextCursor: "cursor-2", matching: 2 });
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("roster-row-person-1");
    await userEvent.selectOptions(screen.getByTestId("roster-filter"), "type-1");
    await waitFor(() => expect(screen.getByTestId("roster-filter")).toHaveValue("type-1"));
    reading.mockResolvedValueOnce({ entries: [departed], nextCursor: null, matching: 2 });
    await userEvent.click(screen.getByTestId("roster-next-page"));
    await waitFor(() => expect(reading).toHaveBeenCalledTimes(3));

    // when
    await act(() => i18n.changeLanguage("de"));

    // then — the text is translated, the roster is not asked again
    expect(screen.getByTestId("roster-search-submit")).toHaveTextContent("Suchen");
    expect(reading).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("roster-filter")).toHaveValue("type-1");
    expect(reading).toHaveBeenLastCalledWith({
      cursor: "cursor-2", limit: 20, membershipTypeId: "type-1", sortBy: "NAME", sortDirection: "ASC"
    });
  });

  it("given accounts at every step of getting in, when the roster loads, then each row carries its access state", async () => {
    // given
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [withAccount, trainer, blocked, withoutAccount],
      nextCursor: null, matching: 4 });

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("roster-credential-person-1")).toHaveAttribute("data-state", "PASSWORD_CHOSEN");
    expect(screen.getByTestId("roster-credential-person-1")).toHaveTextContent("Password chosen");
    expect(screen.getByTestId("roster-credential-person-4")).toHaveAttribute("data-state", "AWAITING_CREDENTIAL");
    expect(screen.getByTestId("roster-credential-person-5")).toHaveAttribute("data-state", "CREDENTIAL_EXPIRED");
    expect(screen.getByTestId("roster-credential-person-2")).toHaveAttribute("data-state", "NONE");
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
  });

  it("given a blocked and an active account, when the roster loads, then the account state carries a mark besides its word", async () => {
    // given
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [withAccount, blocked, withoutAccount],
      nextCursor: null, matching: 3 });

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    const disabled = await screen.findByTestId("roster-account-person-5");
    expect(disabled).toHaveAttribute("data-state", "disabled");
    expect(disabled).toHaveTextContent("Disabled");
    expect(within(disabled).getByTestId("roster-account-mark")).toHaveAttribute("aria-hidden", "true");
    expect(disabled.className).not.toBe(screen.getByTestId("roster-account-person-1").className);
    expect(screen.getByTestId("roster-account-person-1")).toHaveAttribute("data-state", "active");
    expect(screen.getByTestId("roster-account-person-2")).toHaveAttribute("data-state", "none");
  });

  it("given a board looking for who has not got in yet, when choosing that access filter, then the three states before a chosen password are asked for", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // when
    await userEvent.selectOptions(await screen.findByTestId("roster-credential-filter"), "NOT_CHOSEN");

    // then
    await waitFor(() => expect(api.roster).toHaveBeenLastCalledWith({
      limit: 20, credentialStates: ["AWAITING_CREDENTIAL", "CREDENTIAL_ISSUED", "CREDENTIAL_EXPIRED"],
      sortBy: "NAME", sortDirection: "ASC"
    }));
    expect(screen.getByTestId("roster-credential-filter")).toHaveValue("NOT_CHOSEN");
  });

  it("given one access state is chosen, when paging on, then the state is asked for again", async () => {
    // given
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [trainer], nextCursor: "person-4", matching: 30 });
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);
    await userEvent.selectOptions(await screen.findByTestId("roster-credential-filter"), "AWAITING_CREDENTIAL");
    await waitFor(() => expect(screen.getByTestId("roster-credential-filter")).toHaveValue("AWAITING_CREDENTIAL"));

    // when
    await userEvent.click(screen.getByTestId("roster-next-page"));

    // then
    await waitFor(() => expect(api.roster).toHaveBeenLastCalledWith({
      limit: 20, cursor: "person-4", credentialStates: ["AWAITING_CREDENTIAL"], sortBy: "NAME", sortDirection: "ASC"
    }));
  });

  it("given the server counts the matches, when the roster loads, then the count is shown rather than the page size", async () => {
    // given
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [withAccount, withoutAccount], nextCursor: "person-2", matching: 212 });

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("roster-matching")).toHaveTextContent("212 people");
  });

  it("given one person matches, when the roster loads, then the count speaks of one person", async () => {
    // given
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [withAccount], nextCursor: null, matching: 1 });

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("roster-matching")).toHaveTextContent("1 person");
  });

  it("given the roster, when it is laid out, then the form for a new person comes before the list", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    const table = await screen.findByRole("table");
    const create = screen.getByTestId("create-person");
    expect(create.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("given a phone, when the roster loads, then the hidden column sort buttons leave the tab order", async () => {
    // given
    resizeTo(375);

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    await screen.findByTestId("roster-row-person-1");
    for (const heading of screen.getAllByRole("columnheader")) {
      const button = within(heading).queryByRole("button");
      if (button) expect(button).toHaveAttribute("tabindex", "-1");
    }
    act(() => resizeTo(1024));
    for (const heading of screen.getAllByRole("columnheader")) {
      const button = within(heading).queryByRole("button");
      if (button) expect(button).not.toHaveAttribute("tabindex");
    }
  });

  it("given a phone, when choosing a sort field and direction, then the roster is read in that order", async () => {
    // given
    resizeTo(375);
    render(<MemoryRouter><UnsavedChangesProvider><AdminRosterView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("roster-row-person-1");

    // when
    await userEvent.selectOptions(screen.getByTestId("roster-sort-field"), "USERNAME");
    await waitFor(() => expect(screen.getByTestId("roster-sort-field")).toHaveValue("USERNAME"));
    await userEvent.selectOptions(screen.getByTestId("roster-sort-direction"), "DESC");

    // then
    await waitFor(() => expect(api.roster).toHaveBeenLastCalledWith({
      limit: 20, sortBy: "USERNAME", sortDirection: "DESC"
    }));
    expect(screen.getAllByRole("columnheader")[1]).toHaveAttribute("aria-sort", "descending");
  });
});
