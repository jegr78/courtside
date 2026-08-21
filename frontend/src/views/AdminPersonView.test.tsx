import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api, ApiError, type MembershipType, type RosterEntry } from "../api/client";
import i18n from "../i18n";
import { AdminPersonView } from "./AdminPersonView";

const jane: RosterEntry = {
  personId: "person-1", firstName: "Jane", lastName: "Doe", email: "jane.doe@example.org",
  accountId: "account-1", username: "doe.jane", enabled: true, roles: ["MEMBER"],
  membershipTypeId: "type-1", membershipStartedOn: "2026-01-01", membershipEndedOn: null
};

const withoutAccount: RosterEntry = {
  personId: "person-1", firstName: "John", lastName: "Roe", email: "john.roe@example.org",
  accountId: null, username: null, enabled: false, roles: []
};

const adults: MembershipType = { id: "type-1", name: "Adults", ruleSetId: null, active: true };
const juniors: MembershipType = { id: "type-2", name: "Juniors", ruleSetId: null, active: true };

function showPerson(entry: RosterEntry = jane) {
  vi.spyOn(api, "person").mockResolvedValue(entry);
  render(<MemoryRouter initialEntries={["/admin/roster/person-1"]}>
    <Routes>
      <Route path="/admin/roster/:personId" element={<AdminPersonView />} />
    </Routes>
  </MemoryRouter>);
}

describe("AdminPersonView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "membershipTypes").mockResolvedValue([adults, juniors]);
  });

  it("given the person cannot load, when opening the page, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "person").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter initialEntries={["/admin/roster/person-1"]}>
      <Routes><Route path="/admin/roster/:personId" element={<AdminPersonView />} /></Routes>
    </MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("given a mistyped name, when correcting it, then the correction is sent", async () => {
    // given
    vi.spyOn(api, "changePerson").mockResolvedValue({ ...jane, firstName: "Mary" });
    showPerson();
    await screen.findByTestId("person-first-name");

    // when
    await userEvent.clear(screen.getByTestId("person-first-name"));
    await userEvent.type(screen.getByTestId("person-first-name"), "Mary");
    await userEvent.click(screen.getByTestId("save-person"));

    // then
    expect(api.changePerson).toHaveBeenCalledWith("person-1", {
      firstName: "Mary", lastName: "Doe", email: "jane.doe@example.org"
    });
  });

  it("given an address entered by mistake, when it is cleared and saved, then no empty address is sent", async () => {
    // given
    vi.spyOn(api, "changePerson").mockResolvedValue({ ...jane, email: null });
    showPerson();
    await screen.findByTestId("person-email");

    // when
    await userEvent.clear(screen.getByTestId("person-email"));
    await userEvent.click(screen.getByTestId("save-person"));

    // then
    expect(api.changePerson).toHaveBeenCalledWith("person-1", {
      firstName: "Jane", lastName: "Doe", email: null
    });
  });

  it("given a person the club has no address for, when their page opens, then the field is empty rather than broken", async () => {
    // when
    showPerson({ ...jane, email: null });

    // then
    expect(await screen.findByTestId("person-email")).toHaveValue("");
  });

  it("given a person with no address, when their page opens, then the account form explains itself instead of failing later", async () => {
    // when
    showPerson({ ...withoutAccount, email: null });

    // then
    expect(await screen.findByTestId("account-needs-address")).toBeInTheDocument();
    expect(screen.queryByTestId("create-account")).not.toBeInTheDocument();
  });

  it("given a person with an address but no account, when their page opens, then an account can be created", async () => {
    // when
    showPerson(withoutAccount);

    // then
    expect(await screen.findByTestId("create-account")).toBeInTheDocument();
    expect(screen.queryByTestId("account-needs-address")).not.toBeInTheDocument();
  });

  it("given a person, when their membership is saved, then it is written with its dates", async () => {
    // given
    vi.spyOn(api, "assignMembership").mockResolvedValue(jane);
    showPerson();
    await screen.findByTestId("membership-type");

    // when
    await userEvent.selectOptions(screen.getByTestId("membership-type"), "type-2");
    await userEvent.click(screen.getByTestId("save-membership"));

    // then
    expect(api.assignMembership).toHaveBeenCalledWith("person-1", {
      membershipTypeId: "type-2", startedOn: "2026-01-01", endedOn: null
    });
  });

  it("given a running membership, when ending it, then nothing is written before the confirmation", async () => {
    // given
    vi.spyOn(api, "assignMembership").mockResolvedValue(jane);
    showPerson();
    await screen.findByTestId("end-membership");

    // when
    await userEvent.click(screen.getByTestId("end-membership"));

    // then
    expect(api.assignMembership).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("given the end is confirmed, when it is written, then the end date is the one the board chose", async () => {
    // given
    vi.spyOn(api, "assignMembership").mockResolvedValue({ ...jane, membershipEndedOn: "2026-03-31" });
    showPerson();
    await screen.findByTestId("end-membership");

    // when
    await userEvent.click(screen.getByTestId("end-membership"));
    await userEvent.clear(screen.getByTestId("end-membership-date"));
    await userEvent.type(screen.getByTestId("end-membership-date"), "2026-03-31");
    await userEvent.click(screen.getByTestId("confirm-end-membership"));

    // then
    expect(api.assignMembership).toHaveBeenCalledWith("person-1", {
      membershipTypeId: "type-1", startedOn: "2026-01-01", endedOn: "2026-03-31"
    });
  });

  it("given an ended membership, when correcting its end date, then it is written and not re-ended", async () => {
    // given
    const ended = { ...jane, membershipEndedOn: "2026-03-31" };
    vi.spyOn(api, "assignMembership").mockResolvedValue(ended);
    showPerson(ended);
    await screen.findByTestId("membership-ended-on");

    // when
    await userEvent.clear(screen.getByTestId("membership-ended-on"));
    await userEvent.type(screen.getByTestId("membership-ended-on"), "2026-04-30");
    await userEvent.click(screen.getByTestId("save-membership"));

    // then
    expect(api.assignMembership).toHaveBeenCalledWith("person-1", {
      membershipTypeId: "type-1", startedOn: "2026-01-01", endedOn: "2026-04-30"
    });
  });

  it("given a person, when looking for who changed them, then the log link carries them", async () => {
    showPerson();
    expect(await screen.findByTestId("person-audit-link"))
      .toHaveAttribute("href", "/admin/audit?subjectId=person-1");
  });

  it("given a person without an account, when giving them one, then it carries the chosen roles", async () => {
    // given
    vi.spyOn(api, "createAccount").mockResolvedValue({ ...withoutAccount, accountId: "a9", username: "roe.john", roles: ["MEMBER", "TRAINER"] });
    showPerson(withoutAccount);
    await screen.findByTestId("new-account-username");

    // when
    await userEvent.type(screen.getByTestId("new-account-username"), "roe.john");
    await userEvent.type(screen.getByTestId("new-account-password"), "handover-password");
    await userEvent.click(screen.getByTestId("new-account-role-MEMBER"));
    await userEvent.click(screen.getByTestId("new-account-role-TRAINER"));
    await userEvent.click(screen.getByTestId("create-account"));

    // then
    expect(api.createAccount).toHaveBeenCalledWith("person-1", {
      username: "roe.john", oneTimePassword: "handover-password", roles: ["MEMBER", "TRAINER"]
    });
  });

  it("given a person without an account, when the page loads, then nothing offers to enable one", async () => {
    showPerson(withoutAccount);
    expect(await screen.findByTestId("create-account")).toBeInTheDocument();
    expect(screen.queryByTestId("toggle-account")).not.toBeInTheDocument();
  });

  it("given an account, when appointing it to a further role, then the whole role set is sent", async () => {
    // given
    vi.spyOn(api, "changeAccountRoles").mockResolvedValue({ ...jane, roles: ["MEMBER", "TREASURER"] });
    showPerson();
    await screen.findByTestId("account-roles-TREASURER");

    // when
    await userEvent.click(screen.getByTestId("account-roles-TREASURER"));
    await userEvent.click(screen.getByTestId("save-roles"));

    // then
    expect(api.changeAccountRoles).toHaveBeenCalledWith("person-1", ["MEMBER", "TREASURER"]);
  });

  it("given a mistyped username, when correcting it, then the account keeps the corrected one", async () => {
    // given
    vi.spyOn(api, "changeAccountUsername").mockResolvedValue({ ...jane, username: "doe.j" });
    showPerson();
    await screen.findByTestId("account-username");

    // when
    await userEvent.clear(screen.getByTestId("account-username"));
    await userEvent.type(screen.getByTestId("account-username"), "doe.j");
    await userEvent.click(screen.getByTestId("save-username"));

    // then
    expect(api.changeAccountUsername).toHaveBeenCalledWith("person-1", "doe.j");
  });

  it("given a member who forgot their password, when resetting it, then the new one-time password is sent", async () => {
    // given
    vi.spyOn(api, "resetAccountPassword").mockResolvedValue(jane);
    showPerson();
    await screen.findByTestId("account-password");

    // when
    await userEvent.type(screen.getByTestId("account-password"), "fresh-password");
    await userEvent.click(screen.getByTestId("reset-password"));

    // then
    expect(api.resetAccountPassword).toHaveBeenCalledWith("person-1", "fresh-password");
  });

  it("given an enabled account, when disabling it, then the button offers to enable it again", async () => {
    // given
    vi.spyOn(api, "setAccountActive").mockResolvedValue({ ...jane, enabled: false });
    showPerson();
    await screen.findByTestId("toggle-account");

    // when
    await userEvent.click(screen.getByTestId("toggle-account"));

    // then
    await waitFor(() => expect(screen.getByTestId("toggle-account")).toHaveTextContent("Activate"));
  });

  it("given the last administrator, when their account is disabled, then the refusal is shown", async () => {
    // given
    vi.spyOn(api, "setAccountActive").mockRejectedValue(new ApiError(409, {
      type: "urn:courtside:error:last-administrator",
      title: "Conflict",
      status: 409,
      violations: [{ code: "account.lastAdministrator", params: {} }]
    }));
    showPerson();
    await screen.findByTestId("toggle-account");

    // when
    await userEvent.click(screen.getByTestId("toggle-account"));

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
