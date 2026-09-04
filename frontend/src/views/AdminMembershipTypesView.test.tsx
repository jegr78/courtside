import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError, api, type MembershipType, type RosterEntry, type RuleSet } from "../api/client";
import i18n from "../i18n";
import { UnsavedCount } from "../test/UnsavedCount";
import { UnsavedChangesProvider } from "../unsaved/UnsavedChangesProvider";
import { AdminMembershipTypesView } from "./AdminMembershipTypesView";
import { AdminRosterView } from "./AdminRosterView";

const adults: MembershipType = { id: "type-1", name: "Adults", ruleSetId: "rules-1", active: true, grantsAccount: false };
const juniors: MembershipType = { id: "type-2", name: "Juniors", ruleSetId: null, active: false, grantsAccount: true };
const summer: RuleSet = { id: "rules-1", name: "Summer rules", active: true };

const holder = (personId: string): RosterEntry => ({
  personId, firstName: "Jane", lastName: "Doe", email: "jane.doe@example.org",
  accountId: null, username: null, enabled: false, roles: []
});

function card(id: string): HTMLElement {
  return screen.getByTestId(`membership-type-${id}`);
}

describe("AdminMembershipTypesView", () => {
  it("when the page is shown, then its content keeps a readable line length", () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(screen.getByTestId("admin-membership-types-view")).toHaveClass("[&>*]:max-w-5xl");
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "membershipTypes").mockResolvedValue([adults, juniors]);
    vi.spyOn(api, "ruleSets").mockResolvedValue([summer]);
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [], nextCursor: null });
  });

  it("given the create form is filled in, when it is read, then it holds work", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider>
      <UnsavedCount />
      <AdminMembershipTypesView />
    </UnsavedChangesProvider></MemoryRouter>);

    // when
    await userEvent.type(await screen.findByTestId("new-membership-type-name"), "Students");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));
  });

  it("given a type is renamed, when the name is typed back, then nothing is left to lose", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider>
      <UnsavedCount />
      <AdminMembershipTypesView />
    </UnsavedChangesProvider></MemoryRouter>);
    const name = await screen.findByTestId("membership-type-name-type-1");
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");

    // when
    await userEvent.type(name, "!");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));

    // when
    await userEvent.clear(name);
    await userEvent.type(name, "Adults");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given no membership type, when the view opens, then the empty state names the creation step", async () => {
    // given
    vi.spyOn(api, "membershipTypes").mockResolvedValue([]);

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("membership-types-empty")).toHaveTextContent(
      "Membership types created for the club appear here. Use the form below to add the first one."
    );
  });

  it("given the types cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "membershipTypes").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("given a membership type, when following its holders link, then the roster shows only those holders", async () => {
    // given
    vi.spyOn(api, "roster").mockImplementation((_query, _cursor, _limit, membershipTypeId) =>
      Promise.resolve({
        entries: membershipTypeId === "type-1" ? [holder("p1"), holder("p2")] : [],
        nextCursor: null
      }));

    // when
    render(<MemoryRouter initialEntries={["/admin/membership-types"]}><UnsavedChangesProvider>
      <Routes>
        <Route path="/admin/membership-types" element={<AdminMembershipTypesView />} />
        <Route path="/admin/roster" element={<AdminRosterView />} />
      </Routes>
    </UnsavedChangesProvider></MemoryRouter>);

    // when
    const holders = await screen.findByTestId("membership-type-holders-type-1");
    expect(holders).toHaveTextContent("2");
    await userEvent.click(holders);

    // then
    expect(await screen.findByTestId("roster-filter")).toHaveValue("type-1");
    expect(await screen.findByTestId("roster-row-p1")).toBeInTheDocument();
    expect(screen.getByTestId("roster-row-p2")).toBeInTheDocument();
    expect(api.roster).toHaveBeenLastCalledWith(undefined, undefined, 50, "type-1");
  });

  it("given more holders than one page carries, when counting them, then the count says it is a floor", async () => {
    // given
    const many = Array.from({ length: 200 }, (_, index) => holder(`p${index}`));
    vi.spyOn(api, "roster").mockImplementation((_query, _cursor, _limit, membershipTypeId) =>
      Promise.resolve({ entries: membershipTypeId === "type-1" ? many : [], nextCursor: "p199" }));

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("membership-type-holders-type-1")).toHaveTextContent("200+");
  });

  it("given an active type, when the board is about to retire it, then the surface says what stays in force", async () => {
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);
    expect(await screen.findByTestId("membership-type-retire-note-type-1")).toBeInTheDocument();
  });

  it("given a mistyped name, when correcting it, then the correction is sent with the rule set", async () => {
    // given
    vi.spyOn(api, "changeMembershipType").mockResolvedValue({ ...adults, name: "Adult" });
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("membership-type-name-type-1");

    // when
    await userEvent.clear(screen.getByTestId("membership-type-name-type-1"));
    await userEvent.type(screen.getByTestId("membership-type-name-type-1"), "Adult");
    await userEvent.click(screen.getByTestId("save-membership-type-type-1"));

    // then
    expect(api.changeMembershipType).toHaveBeenCalledWith("type-1", { name: "Adult", ruleSetId: "rules-1", grantsAccount: false });
  });

  it("given a type on a rule set, when it is taken off that rule set, then no rule set is sent", async () => {
    // given
    vi.spyOn(api, "changeMembershipType").mockResolvedValue({ ...adults, ruleSetId: null });
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("membership-type-rule-set-type-1");

    // when
    await userEvent.selectOptions(screen.getByTestId("membership-type-rule-set-type-1"), "");
    await userEvent.click(screen.getByTestId("save-membership-type-type-1"));

    // then
    expect(api.changeMembershipType).toHaveBeenCalledWith("type-1", { name: "Adults", ruleSetId: null, grantsAccount: false });
  });

  it("given an active type, when retiring it, then the control offers to offer it again", async () => {
    // given
    const toggling = vi.spyOn(api, "setMembershipTypeActive").mockResolvedValue({ ...adults, active: false });
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);
    const toggle = await screen.findByTestId("toggle-membership-type-type-1");
    expect(toggle).toHaveClass("button-destructive");

    // when
    await userEvent.click(toggle);

    // then
    await waitFor(() => expect(toggle).toHaveTextContent("Activate"));
    expect(toggle).toHaveClass("button-primary");
    expect(toggling).toHaveBeenCalledWith("type-1", false);
  });

  it("given a retired type, when the view is read, then it is still listed and says so", async () => {
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);
    expect(await screen.findByTestId("membership-type-type-2")).toBeInTheDocument();
    expect(within(card("type-2")).getByTestId("membership-type-state-type-2")).toHaveTextContent("Retired");
  });

  it("when adding a type, then it joins the list", async () => {
    // given
    const created: MembershipType = { id: "type-9", name: "Seniors", ruleSetId: null, active: true, grantsAccount: true };
    vi.spyOn(api, "createMembershipType").mockResolvedValue(created);
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("membership-type-type-1");

    // when
    await userEvent.type(screen.getByTestId("new-membership-type-name"), "Seniors");
    await userEvent.click(screen.getByTestId("new-membership-type-grants-account"));
    await userEvent.click(screen.getByTestId("create-membership-type"));

    // then
    expect(api.createMembershipType).toHaveBeenCalledWith({ name: "Seniors", ruleSetId: null, grantsAccount: true });
    expect(await screen.findByTestId("membership-type-type-9")).toBeInTheDocument();
  });

  it("when the language changes, then the types are not fetched again", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("membership-type-type-1");
    await userEvent.type(screen.getByTestId("membership-type-name-type-1"), " and seniors");

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(screen.getByTestId("create-membership-type")).toHaveTextContent("Anlegen");
    expect(api.membershipTypes).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("membership-type-name-type-1")).toHaveValue("Adults and seniors");
  });

  it("given a refused creation, when the answer arrives, then the form still holds what was typed", async () => {
    // given
    vi.spyOn(api, "createMembershipType").mockRejectedValue(new ApiError(409));
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("membership-type-type-1");

    // when
    await userEvent.type(screen.getByTestId("new-membership-type-name"), "Seniors");
    await userEvent.click(screen.getByTestId("new-membership-type-grants-account"));
    await userEvent.click(screen.getByTestId("create-membership-type"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.getByTestId("new-membership-type-name")).toHaveValue("Seniors");
    expect(screen.getByTestId("new-membership-type-grants-account")).toBeChecked();
  });

  it("given a type that grants no account, when switching that on and saving, then the change is sent", async () => {
    // given
    vi.spyOn(api, "changeMembershipType").mockResolvedValue({ ...adults, grantsAccount: true });
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("membership-type-type-1");

    // when
    await userEvent.click(screen.getByTestId("membership-type-grants-account-type-1"));
    await userEvent.click(screen.getByTestId("save-membership-type-type-1"));

    // then
    expect(api.changeMembershipType).toHaveBeenCalledWith("type-1",
      { name: "Adults", ruleSetId: "rules-1", grantsAccount: true });
  });

  it("given a type that grants an account, when reading it, then the box is already ticked", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminMembershipTypesView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("membership-type-grants-account-type-2")).toBeChecked();
    expect(screen.getByTestId("membership-type-grants-account-type-1")).not.toBeChecked();
  });
});
