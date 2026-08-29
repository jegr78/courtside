import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api, ApiError, type ClubConfig, type MembershipType, type MessageEntry, type RosterEntry } from "../api/client";
import i18n from "../i18n";
import { downloadJson } from "../downloads/downloadJson";
import { AdminPersonView } from "./AdminPersonView";

vi.mock("../downloads/downloadJson", () => ({ downloadJson: vi.fn() }));

const jane: RosterEntry = {
  personId: "person-1", firstName: "Jane", lastName: "Doe", email: "jane.doe@example.org",
  accountId: "account-1", username: "doe.jane", locale: "de", enabled: true, roles: ["MEMBER"],
  credentialState: "CREDENTIAL_ISSUED", addressSharedBy: 1,
  membershipTypeId: "type-1", membershipStartedOn: "2026-01-01", membershipEndedOn: null
};

const withoutAccount: RosterEntry = {
  personId: "person-1", firstName: "John", lastName: "Roe", email: "john.roe@example.org",
  accountId: null, username: null, enabled: false, roles: []
};

const club: ClubConfig = {
  clubName: "Example Tennis Club", primaryColor: "#004f2d", accentColor: "#c8a415",
  logoUrl: null, imprintUrl: null, defaultLocale: "de", supportedLocales: ["de", "en"],
  slotMinutes: 30, timeZone: "Europe/Berlin"
};

const handedOver: MessageEntry = {
  id: "message-1", queuedAt: "2026-08-20T12:00:00Z", settledAt: "2026-08-20T12:00:01Z",
  kind: "CREDENTIALS_NEW_ACCOUNT", state: "HANDED_OVER", messageId: "<a-message-id@example.org>",
  reason: null, statusCode: null, personId: "person-1", personName: "Jane Doe"
};

const adults: MembershipType = { id: "type-1", name: "Adults", ruleSetId: null, active: true, grantsAccount: false };
const juniors: MembershipType = { id: "type-2", name: "Juniors", ruleSetId: null, active: true, grantsAccount: false };

function showPerson(entry: RosterEntry = jane) {
  vi.spyOn(api, "person").mockResolvedValue(entry);
  render(<MemoryRouter initialEntries={["/admin/roster/person-1"]}>
    <Routes>
      <Route path="/admin/roster/:personId" element={<AdminPersonView />} />
    </Routes>
  </MemoryRouter>);
}

describe("AdminPersonView", () => {
  it("when the page is shown, then it uses the full administration frame", () => {
    // when
    render(<MemoryRouter initialEntries={["/admin/roster/person-1"]}>
      <Routes><Route path="/admin/roster/:personId" element={<AdminPersonView />} /></Routes>
    </MemoryRouter>);

    // then
    expect(screen.getByTestId("admin-person-view")).toHaveClass("max-w-7xl", "[&>*]:max-w-5xl");
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(downloadJson).mockClear();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "membershipTypes").mockResolvedValue([adults, juniors]);
    vi.spyOn(api, "config").mockResolvedValue(club);
    vi.spyOn(api, "messages").mockResolvedValue({ entries: [], nextCursor: null });
  });

  it("given navigation from person creation, when the new page loads, then creation is confirmed consistently", async () => {
    // given
    vi.spyOn(api, "person").mockResolvedValue(jane);

    // when
    render(<MemoryRouter initialEntries={[{ pathname: "/admin/roster/person-1", state: { personCreated: true } }]}>
      <Routes><Route path="/admin/roster/:personId" element={<AdminPersonView />} /></Routes>
    </MemoryRouter>);

    // then
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Person created."));
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
    await userEvent.click(screen.getByTestId("new-account-role-MEMBER"));
    await userEvent.click(screen.getByTestId("new-account-role-TRAINER"));
    await userEvent.click(screen.getByTestId("create-account"));

    // then
    expect(api.createAccount).toHaveBeenCalledWith("person-1", {
      username: "roe.john", roles: ["MEMBER", "TRAINER"]
    });
  });

  it("given a person without an account, when giving them one, then nothing asks for a password", async () => {
    // given
    showPerson(withoutAccount);

    // when / then — the instance generates it and sends it, so there is nothing for a board to type
    await screen.findByTestId("new-account-username");
    expect(screen.queryByTestId("new-account-password")).not.toBeInTheDocument();
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

  it("given an account written to in the wrong language, when correcting it, then the account is told", async () => {
    // given
    vi.spyOn(api, "changeAccountLocale").mockResolvedValue({ ...jane, locale: "en" });
    showPerson();
    await screen.findByTestId("account-locale");

    // when
    await userEvent.selectOptions(screen.getByTestId("account-locale"), "en");
    await userEvent.click(screen.getByTestId("save-locale"));

    // then
    expect(api.changeAccountLocale).toHaveBeenCalledWith("person-1", "en");
  });

  it("given an instance that ships one language, when opening an account, then only that one is offered", async () => {
    // given
    vi.spyOn(api, "config").mockResolvedValue({ ...club, supportedLocales: ["de"] });

    // when
    showPerson();

    // then
    const offered = await screen.findByTestId("account-locale");
    expect(Array.from(offered.children).map((option) => option.getAttribute("value"))).toEqual(["de"]);
  });

  it("given a member who never received their credentials, when sending them, then no confirmation stands in the way", async () => {
    // given
    vi.spyOn(api, "requestAccountCredentials").mockResolvedValue(jane);
    showPerson({ ...jane, credentialState: "CREDENTIAL_ISSUED" });
    await screen.findByTestId("send-credentials");

    // when
    await userEvent.click(screen.getByTestId("send-credentials"));

    // then — nothing usable is lost here, so asking would be friction where the press is the remedy
    expect(api.requestAccountCredentials).toHaveBeenCalledWith("person-1");
    expect(screen.queryByTestId("confirm-send-credentials")).not.toBeInTheDocument();
  });

  it("given a member with a password of their own, when sending credentials, then it asks before destroying it", async () => {
    // given
    const sent = vi.spyOn(api, "requestAccountCredentials").mockResolvedValue(jane);
    showPerson({ ...jane, credentialState: "PASSWORD_CHOSEN" });
    await screen.findByTestId("send-credentials");

    // when
    await userEvent.click(screen.getByTestId("send-credentials"));

    // then
    expect(sent).not.toHaveBeenCalled();
    const confirm = screen.getByTestId("confirm-send-credentials");
    expect(confirm).toHaveClass("button-destructive");
    await userEvent.click(confirm);
    expect(sent).toHaveBeenCalledWith("person-1");
  });

  it("given the confirmation is dismissed, when it closes, then nothing was sent", async () => {
    // given
    const sent = vi.spyOn(api, "requestAccountCredentials").mockResolvedValue(jane);
    showPerson({ ...jane, credentialState: "PASSWORD_CHOSEN" });
    await screen.findByTestId("send-credentials");

    // when
    await userEvent.click(screen.getByTestId("send-credentials"));
    await userEvent.click(screen.getByTestId("cancel-send-credentials"));

    // then
    expect(sent).not.toHaveBeenCalled();
  });

  it("given a deactivated account, when reading the section, then credentials cannot be sent", async () => {
    // given
    showPerson({ ...jane, enabled: false });

    // when / then — a message telling somebody their access is ready when it is not is worse than none
    expect(await screen.findByTestId("send-credentials")).toBeDisabled();
  });

  it("given an address nobody else has, when about to send, then no count is shown", async () => {
    // given
    showPerson({ ...jane, addressSharedBy: 1 });

    // when / then
    expect(await screen.findByTestId("credential-destination"))
      .not.toHaveTextContent("belongs to");
  });

  it.each([
    ["AWAITING_CREDENTIAL", "Nothing has been issued yet."],
    ["CREDENTIAL_ISSUED", "Credentials are out and have not been replaced."],
    ["CREDENTIAL_EXPIRED", "The issued credentials have expired. Send new ones."],
    ["PASSWORD_CHOSEN", "The member has chosen a password of their own."]
  ] as const)("given an account in %s, when reading the section, then the board is told where it stands",
    async (credentialState, told) => {
      // given
      showPerson({ ...jane, credentialState });

      // when / then
      const state = await screen.findByTestId("credential-state");
      expect(state).toHaveTextContent(told);
      expect(state).toHaveAttribute("data-state", credentialState);
    });

  it("given an address several people share, when about to send, then only a count says so", async () => {
    // given
    showPerson({ ...jane, addressSharedBy: 3 });

    // when / then — a count answers the question without telling one member about another
    const destination = await screen.findByTestId("credential-destination");
    expect(destination).toHaveTextContent("This address belongs to 3 people.");
    expect(destination.textContent).toContain(jane.email);
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

  it.each(["QUEUED", "HANDED_OVER", "REFUSED", "FAILED"] as const)(
    "given the last message to this account is %s, when the person is opened, then it stands beside the credential state",
    async (state) => {
      // given
      vi.spyOn(api, "messages").mockResolvedValue({
        entries: [{ ...handedOver, state }], nextCursor: null
      });

      // when
      showPerson();

      // then
      const line = await screen.findByTestId("last-message");
      expect(line).toHaveAttribute("data-state", state);
      expect(line).toHaveTextContent(i18n.t(`messages.state.${state}`));
    });

  it("given the message log cannot be reached, when the person is opened, then it says so instead of nothing", async () => {
    // given — silence here is indistinguishable from "nothing was ever sent", a different answer
    vi.spyOn(api, "messages").mockRejectedValue(new Error("unavailable"));

    // when
    showPerson();

    // then
    expect(await screen.findByTestId("last-message-unreadable")).toBeInTheDocument();
    expect(screen.queryByTestId("last-message")).not.toBeInTheDocument();
  });

  it("given an account nothing was ever sent to, when the person is opened, then no line pretends otherwise", async () => {
    // given — an empty row beside the credential state reads like a failure, and nothing failed
    vi.spyOn(api, "messages").mockResolvedValue({ entries: [], nextCursor: null });

    // when
    showPerson();
    await screen.findByTestId("credential-state");

    // then
    expect(screen.queryByTestId("last-message")).not.toBeInTheDocument();
  });

  it("given a person who holds no account, when they are opened, then nothing is asked about messages to them", async () => {
    // given
    const messages = vi.spyOn(api, "messages").mockResolvedValue({ entries: [], nextCursor: null });

    // when
    showPerson(withoutAccount);
    await screen.findByTestId("create-account");

    // then
    expect(screen.queryByTestId("last-message")).not.toBeInTheDocument();
    expect(messages).not.toHaveBeenCalled();
  });
  it("given a member asks what the club holds about them, when the board produces the answer, then it is saved as a file", async () => {
    // given
    showPerson();
    const answer = { producedAt: "2026-08-27T10:00:00Z", personId: "person-1" };
    const produce = vi.spyOn(api, "exportPersonData")
      .mockResolvedValue(answer as never);
    await screen.findByTestId("person-first-name");

    // when
    await userEvent.click(screen.getByTestId("export-person-data"));

    // then
    await waitFor(() => expect(produce).toHaveBeenCalledWith("person-1"));
    expect(downloadJson).toHaveBeenCalledWith("courtside-subject-access-person-1.json", answer);
  });

  it("given the answer cannot be produced, when the board asks for it, then nothing is saved and the failure is shown", async () => {
    // given
    showPerson();
    vi.spyOn(api, "exportPersonData").mockRejectedValue(new ApiError(404));
    await screen.findByTestId("person-first-name");

    // when
    await userEvent.click(screen.getByTestId("export-person-data"));

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(downloadJson).not.toHaveBeenCalled();
  });
});
