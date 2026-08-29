import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api, type MembershipType, type RosterEntry, type RuleSet } from "../api/client";
import i18n from "../i18n";
import { AdminMembershipTypesView } from "./AdminMembershipTypesView";

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
  it("when the page is shown, then it uses the full administration frame", () => {
    // when
    render(<MemoryRouter><AdminMembershipTypesView /></MemoryRouter>);

    // then
    expect(screen.getByTestId("admin-membership-types-view")).toHaveClass("max-w-7xl", "[&>*]:max-w-5xl");
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "membershipTypes").mockResolvedValue([adults, juniors]);
    vi.spyOn(api, "ruleSets").mockResolvedValue([summer]);
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [], nextCursor: null });
  });

  it("given no membership type, when the view opens, then the empty state names the creation step", async () => {
    // given
    vi.spyOn(api, "membershipTypes").mockResolvedValue([]);

    // when
    render(<MemoryRouter><AdminMembershipTypesView /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("membership-types-empty")).toHaveTextContent(
      "Membership types created for the club appear here. Use the form below to add the first one."
    );
  });

  it("given the types cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "membershipTypes").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><AdminMembershipTypesView /></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("given a membership type, when reading it, then its holder count links to those holders", async () => {
    // given
    vi.spyOn(api, "roster").mockImplementation((_query, _cursor, _limit, membershipTypeId) =>
      Promise.resolve({
        entries: membershipTypeId === "type-1" ? [holder("p1"), holder("p2")] : [],
        nextCursor: null
      }));

    // when
    render(<MemoryRouter><AdminMembershipTypesView /></MemoryRouter>);

    // then
    const holders = await screen.findByTestId("membership-type-holders-type-1");
    expect(holders).toHaveTextContent("2");
    expect(holders).toHaveAttribute("href", "/admin/roster?membershipTypeId=type-1");
  });

  it("given more holders than one page carries, when counting them, then the count says it is a floor", async () => {
    // given
    const many = Array.from({ length: 200 }, (_, index) => holder(`p${index}`));
    vi.spyOn(api, "roster").mockImplementation((_query, _cursor, _limit, membershipTypeId) =>
      Promise.resolve({ entries: membershipTypeId === "type-1" ? many : [], nextCursor: "p199" }));

    // when
    render(<MemoryRouter><AdminMembershipTypesView /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("membership-type-holders-type-1")).toHaveTextContent("200+");
  });

  it("given an active type, when the board is about to retire it, then the surface says what stays in force", async () => {
    render(<MemoryRouter><AdminMembershipTypesView /></MemoryRouter>);
    expect(await screen.findByTestId("membership-type-retire-note-type-1")).toBeInTheDocument();
  });

  it("given a mistyped name, when correcting it, then the correction is sent with the rule set", async () => {
    // given
    vi.spyOn(api, "changeMembershipType").mockResolvedValue({ ...adults, name: "Adult" });
    render(<MemoryRouter><AdminMembershipTypesView /></MemoryRouter>);
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
    render(<MemoryRouter><AdminMembershipTypesView /></MemoryRouter>);
    await screen.findByTestId("membership-type-rule-set-type-1");

    // when
    await userEvent.selectOptions(screen.getByTestId("membership-type-rule-set-type-1"), "");
    await userEvent.click(screen.getByTestId("save-membership-type-type-1"));

    // then
    expect(api.changeMembershipType).toHaveBeenCalledWith("type-1", { name: "Adults", ruleSetId: null, grantsAccount: false });
  });

  it("given an active type, when retiring it, then the control offers to offer it again", async () => {
    // given
    vi.spyOn(api, "setMembershipTypeActive").mockResolvedValue({ ...adults, active: false });
    render(<MemoryRouter><AdminMembershipTypesView /></MemoryRouter>);
    await screen.findByTestId("toggle-membership-type-type-1");

    // when
    await userEvent.click(screen.getByTestId("toggle-membership-type-type-1"));

    // then
    await waitFor(() => expect(screen.getByTestId("toggle-membership-type-type-1")).toHaveTextContent("Activate"));
  });

  it("given a retired type, when the view is read, then it is still listed and says so", async () => {
    render(<MemoryRouter><AdminMembershipTypesView /></MemoryRouter>);
    expect(await screen.findByTestId("membership-type-type-2")).toBeInTheDocument();
    expect(within(card("type-2")).getByTestId("membership-type-state-type-2")).toHaveTextContent("Retired");
  });

  it("when adding a type, then it joins the list", async () => {
    // given
    const created: MembershipType = { id: "type-9", name: "Seniors", ruleSetId: null, active: true, grantsAccount: true };
    vi.spyOn(api, "createMembershipType").mockResolvedValue(created);
    render(<MemoryRouter><AdminMembershipTypesView /></MemoryRouter>);
    await screen.findByTestId("membership-type-type-1");

    // when
    await userEvent.type(screen.getByTestId("new-membership-type-name"), "Seniors");
    await userEvent.click(screen.getByTestId("new-membership-type-grants-account"));
    await userEvent.click(screen.getByTestId("create-membership-type"));

    // then
    expect(api.createMembershipType).toHaveBeenCalledWith({ name: "Seniors", ruleSetId: null, grantsAccount: true });
    expect(await screen.findByTestId("membership-type-type-9")).toBeInTheDocument();
  });

  it("given a type that grants no account, when switching that on and saving, then the change is sent", async () => {
    // given
    vi.spyOn(api, "changeMembershipType").mockResolvedValue({ ...adults, grantsAccount: true });
    render(<MemoryRouter><AdminMembershipTypesView /></MemoryRouter>);
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
    render(<MemoryRouter><AdminMembershipTypesView /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("membership-type-grants-account-type-2")).toBeChecked();
    expect(screen.getByTestId("membership-type-grants-account-type-1")).not.toBeChecked();
  });
});
