import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api, ApiError, type RosterEntry } from "../api/client";
import i18n from "../i18n";
import { AdminRosterView } from "./AdminRosterView";

const withAccount: RosterEntry = {
  personId: "person-1", firstName: "Jane", lastName: "Doe", email: "jane.doe@example.org",
  accountId: "account-1", username: "doe.jane", enabled: true, roles: ["MEMBER"]
};

const withoutAccount: RosterEntry = {
  personId: "person-2", firstName: "John", lastName: "Roe", email: "john.roe@example.org",
  accountId: null, username: null, enabled: false, roles: []
};

describe("AdminRosterView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [withAccount, withoutAccount], nextCursor: null });
  });

  it("given people with and without an account, when the view loads, then both are editable", async () => {
    // when
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("person-first-name-person-1")).toHaveValue("Jane");
    expect(screen.getByTestId("person-email-person-1")).toHaveValue("jane.doe@example.org");
    expect(screen.getByTestId("account-username-person-1")).toHaveValue("doe.jane");
    expect(screen.getByTestId("account-roles-person-1-MEMBER")).toBeChecked();
    expect(screen.getByTestId("account-roles-person-1-ADMIN")).not.toBeChecked();
    expect(screen.getByTestId("new-account-username-person-2")).toHaveValue("");
    expect(screen.queryByTestId("account-username-person-2")).not.toBeInTheDocument();
  });

  it("given the roster cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "roster").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("given a mistyped name, when correcting it, then the correction is sent", async () => {
    // given
    const changePerson = vi.spyOn(api, "changePerson").mockResolvedValue({ ...withAccount, firstName: "Mary" });
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    const user = userEvent.setup();

    // when
    await user.clear(await screen.findByTestId("person-first-name-person-1"));
    await user.type(screen.getByTestId("person-first-name-person-1"), "Mary");
    await user.click(screen.getByTestId("save-person-person-1"));

    // then
    expect(changePerson).toHaveBeenCalledWith("person-1", {
      firstName: "Mary", lastName: "Doe", email: "jane.doe@example.org"
    });
    expect(screen.getByTestId("person-first-name-person-1")).toHaveValue("Mary");
  });

  it("given a name to look for, when searching, then the roster is read again for that name", async () => {
    // given
    const roster = vi.spyOn(api, "roster").mockResolvedValue({ entries: [withAccount], nextCursor: null });
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    const user = userEvent.setup();

    // when
    await user.type(await screen.findByTestId("roster-search"), "Roe");
    await user.click(screen.getByTestId("roster-search-submit"));

    // then
    expect(roster).toHaveBeenNthCalledWith(2, "Roe", undefined);
  });

  it("given a further page, when reading it, then its people are appended", async () => {
    // given
    const roster = vi.spyOn(api, "roster")
      .mockResolvedValueOnce({ entries: [withAccount], nextCursor: "person-1" })
      .mockResolvedValueOnce({ entries: [withoutAccount], nextCursor: null });
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    const user = userEvent.setup();

    // when
    await user.click(await screen.findByTestId("roster-load-more"));

    // then
    expect(roster).toHaveBeenNthCalledWith(2, undefined, "person-1");
    expect(await screen.findByTestId("person-first-name-person-2")).toHaveValue("John");
    expect(screen.queryByTestId("roster-load-more")).not.toBeInTheDocument();
  });

  it("given a search with a further page, when reading it, then the same name is asked for again", async () => {
    // given
    const roster = vi.spyOn(api, "roster")
      .mockResolvedValueOnce({ entries: [withAccount], nextCursor: null })
      .mockResolvedValueOnce({ entries: [withoutAccount], nextCursor: "person-2" })
      .mockResolvedValueOnce({ entries: [], nextCursor: null });
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    const user = userEvent.setup();

    // when
    await user.type(await screen.findByTestId("roster-search"), "Roe");
    await user.click(screen.getByTestId("roster-search-submit"));
    await user.click(await screen.findByTestId("roster-load-more"));

    // then
    expect(roster).toHaveBeenNthCalledWith(3, "Roe", "person-2");
  });

  it("when adding a person, then they join the roster", async () => {
    // given
    const created: RosterEntry = {
      personId: "person-3", firstName: "Richard", lastName: "Miles", email: "richard.miles@example.org",
      accountId: null, username: null, enabled: false, roles: []
    };
    const createPerson = vi.spyOn(api, "createPerson").mockResolvedValue(created);
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    const user = userEvent.setup();

    // when
    await user.type(await screen.findByTestId("new-person-first-name"), "Richard");
    await user.type(screen.getByTestId("new-person-last-name"), "Miles");
    await user.type(screen.getByTestId("new-person-email"), "richard.miles@example.org");
    await user.click(screen.getByTestId("create-person"));

    // then
    expect(createPerson).toHaveBeenCalledWith({
      firstName: "Richard", lastName: "Miles", email: "richard.miles@example.org"
    });
    expect(await screen.findByTestId("person-first-name-person-3")).toHaveValue("Richard");
  });

  it("given a person without an account, when giving them one, then it carries the chosen roles", async () => {
    // given
    const createAccount = vi.spyOn(api, "createAccount").mockResolvedValue({
      ...withoutAccount, accountId: "account-2", username: "roe.john", enabled: true, roles: ["MEMBER", "TRAINER"]
    });
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    const user = userEvent.setup();

    // when
    await user.type(await screen.findByTestId("new-account-username-person-2"), "roe.john");
    await user.type(screen.getByTestId("new-account-password-person-2"), "one-time-secret");
    await user.click(screen.getByTestId("new-account-role-person-2-MEMBER"));
    await user.click(screen.getByTestId("new-account-role-person-2-TRAINER"));
    await user.click(screen.getByTestId("create-account-person-2"));

    // then
    expect(createAccount).toHaveBeenCalledWith("person-2", {
      username: "roe.john", oneTimePassword: "one-time-secret", roles: ["MEMBER", "TRAINER"]
    });
    expect(await screen.findByTestId("account-username-person-2")).toHaveValue("roe.john");
  });

  it("given an account, when appointing it to a further role, then the whole role set is sent", async () => {
    // given
    const changeAccountRoles = vi.spyOn(api, "changeAccountRoles")
      .mockResolvedValue({ ...withAccount, roles: ["MEMBER", "ADMIN"] });
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    const user = userEvent.setup();

    // when
    await user.click(await screen.findByTestId("account-roles-person-1-ADMIN"));
    await user.click(screen.getByTestId("save-roles-person-1"));

    // then
    expect(changeAccountRoles).toHaveBeenCalledWith("person-1", ["MEMBER", "ADMIN"]);
  });

  it("given a mistyped username, when correcting it, then the account keeps the corrected one", async () => {
    // given
    const changeAccountUsername = vi.spyOn(api, "changeAccountUsername")
      .mockResolvedValue({ ...withAccount, username: "doe.mary" });
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    const user = userEvent.setup();

    // when
    await user.clear(await screen.findByTestId("account-username-person-1"));
    await user.type(screen.getByTestId("account-username-person-1"), "doe.mary");
    await user.click(screen.getByTestId("save-username-person-1"));

    // then
    expect(changeAccountUsername).toHaveBeenCalledWith("person-1", "doe.mary");
    expect(screen.getByTestId("account-username-person-1")).toHaveValue("doe.mary");
  });

  it("given a member who forgot their password, when resetting it, then the new one-time password is sent", async () => {
    // given
    const resetAccountPassword = vi.spyOn(api, "resetAccountPassword").mockResolvedValue(withAccount);
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    const user = userEvent.setup();

    // when
    await user.type(await screen.findByTestId("account-password-person-1"), "another-secret");
    await user.click(screen.getByTestId("reset-password-person-1"));

    // then
    expect(resetAccountPassword).toHaveBeenCalledWith("person-1", "another-secret");
    expect(screen.getByTestId("account-password-person-1")).toHaveValue("");
  });

  it("given an enabled account, when disabling it, then the button offers to enable it again", async () => {
    // given
    const setAccountActive = vi.spyOn(api, "setAccountActive")
      .mockResolvedValue({ ...withAccount, enabled: false });
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    const user = userEvent.setup();

    // when
    await user.click(await screen.findByTestId("toggle-account-person-1"));

    // then
    expect(setAccountActive).toHaveBeenCalledWith("person-1", false);
    expect(screen.getByTestId("toggle-account-person-1")).toHaveAccessibleName("Activate");
  });

  it("given the last administrator, when their account is disabled, then the refusal is shown", async () => {
    // given
    vi.spyOn(api, "setAccountActive").mockRejectedValue(new ApiError(409, {
      type: "urn:courtside:error:last-administrator", title: "Conflict", status: 409,
      violations: [{ code: "roster.lastAdministrator", params: {} }]
    }));
    render(<MemoryRouter><AdminRosterView /></MemoryRouter>);
    const user = userEvent.setup();

    // when
    await user.click(await screen.findByTestId("toggle-account-person-1"));

    // then
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("The instance must keep one enabled administrator, so this account can neither be disabled nor lose the role.");
  });
});
