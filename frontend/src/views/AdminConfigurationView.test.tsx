import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, api } from "../api/client";
import i18n from "../i18n";
import { AdminConfigurationView } from "./AdminConfigurationView";

describe("AdminConfigurationView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminConfig").mockResolvedValue({
      clubName: "Example Tennis Club",
      primaryColor: "#b85c38",
      accentColor: "#d7e24b",
      defaultLocale: "en",
      supportedLocales: ["de", "en"],
      slotMinutes: 30,
      timeZone: "Europe/Berlin",
      newAccountCredentialHours: 168,
      passwordResetCredentialHours: 24
    });
    vi.spyOn(api, "ruleSets").mockResolvedValue([{ id: "rule-set", name: "Standard", active: true }]);
    vi.spyOn(api, "ruleTypes").mockResolvedValue([
      { ruleType: "OPENING_HOURS", configurable: false, parameters: [] },
      { ruleType: "SLOT_GRID", configurable: false, parameters: [] },
      { ruleType: "ADVANCE_WINDOW", configurable: true, parameters: [{ name: "maxDays", minimum: 1, maximum: 365 }] },
      { ruleType: "NO_COURT_BOOKING", configurable: true, parameters: [] }
    ]);
    vi.spyOn(api, "rules").mockResolvedValue([
      { ruleType: "ADVANCE_WINDOW", params: { maxDays: 7 } }
    ]);
    vi.spyOn(api, "membershipTypes").mockResolvedValue([
      { id: "type-1", name: "Adults", ruleSetId: "rule-set", active: true, grantsAccount: false },
      { id: "type-2", name: "Juniors", ruleSetId: null, active: true, grantsAccount: false }
    ]);
  });

  it("when the configuration is loaded, then the rule set for people without a membership type is offered", async () => {
    // given
    vi.spyOn(api, "ruleSets").mockResolvedValue([
      { id: "rule-set", name: "Standard", active: true },
      { id: "retired", name: "Retired", active: false }
    ]);
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);

    // when
    const select = await screen.findByTestId("no-membership-type-rule-set");

    // then — an inactive set is not offered, because assigning one is refused
    expect(within(select).getAllByRole("option").map((option) => option.getAttribute("value")))
      .toEqual(["", "rule-set"]);
  });

  it("given a chosen rule set for people without a membership type, when saving, then it is written", async () => {
    // given
    const changing = vi.spyOn(api, "changeAdminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24,
      noMembershipTypeRuleSetId: "rule-set"
    });
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);
    await screen.findByTestId("no-membership-type-rule-set");

    // when
    fireEvent.change(screen.getByTestId("no-membership-type-rule-set"), { target: { value: "rule-set" } });
    await userEvent.click(screen.getByTestId("save-club-config"));

    // then
    await waitFor(() => expect(changing).toHaveBeenCalledWith(
      expect.objectContaining({ noMembershipTypeRuleSetId: "rule-set" })));
  });

  it("given an assigned rule set that has since been deactivated, when the configuration is loaded, then it is still the selected one", async () => {
    // given
    vi.spyOn(api, "ruleSets").mockResolvedValue([
      { id: "rule-set", name: "Standard", active: true },
      { id: "retired", name: "Retired", active: false }
    ]);
    vi.spyOn(api, "adminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24,
      noMembershipTypeRuleSetId: "retired"
    });
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);

    // when
    const select = await screen.findByTestId("no-membership-type-rule-set");

    // then — dropping it from the list would clear the club's choice on the next save
    expect((select as HTMLSelectElement).value).toEqual("retired");
    expect(within(select).getAllByRole("option").map((option) => option.getAttribute("value")))
      .toContain("retired");
  });

  it("given a mistyped rule set name, when it is corrected, then the correction is written", async () => {
    // given
    const changing = vi.spyOn(api, "changeRuleSet")
      .mockResolvedValue({ id: "rule-set", name: "Standard rules", active: true });
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);
    await screen.findByTestId("rule-set-name");

    // when
    fireEvent.change(screen.getByTestId("rule-set-name"), { target: { value: "Standard rules" } });
    await userEvent.click(screen.getByTestId("save-rule-set"));

    // then
    expect(changing).toHaveBeenCalledWith("rule-set", { name: "Standard rules" });
  });

  it("when a rule set is added, then it is created and becomes the one being edited", async () => {
    // given
    const creating = vi.spyOn(api, "createRuleSet")
      .mockResolvedValue({ id: "rule-set-2", name: "Juniors", active: true });
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);
    await screen.findByTestId("new-rule-set-name");

    // when
    await userEvent.type(screen.getByTestId("new-rule-set-name"), "Juniors");
    await userEvent.click(screen.getByTestId("create-rule-set"));

    // then
    expect(creating).toHaveBeenCalledWith({ name: "Juniors" });
    expect(await screen.findByTestId("rule-set")).toHaveValue("rule-set-2");
  });

  it("given membership types pointing at a rule set, when it is read, then retiring it says what that does not change", async () => {
    // given / when
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);

    // then — a retired set still binds whoever already points at it, which is the whole surprise
    const note = await screen.findByTestId("rule-set-retire-note");
    expect(note).toHaveTextContent("Adults");
  });

  it("given a rule set nothing points at, when it is read, then the note says nothing is affected", async () => {
    // given
    vi.spyOn(api, "membershipTypes").mockResolvedValue([
      { id: "type-2", name: "Juniors", ruleSetId: null, active: true, grantsAccount: false }
    ]);

    // when
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("rule-set-retire-note")).toBeInTheDocument();
  });

  it("given a rule set in use, when it is retired, then no dialog stands in the way", async () => {
    // given
    const toggling = vi.spyOn(api, "setRuleSetActive")
      .mockResolvedValue({ id: "rule-set", name: "Standard", active: false });
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);
    await screen.findByTestId("toggle-rule-set");

    // when — activating it again restores it, so by this project's rule it is not confirmed
    await userEvent.click(screen.getByTestId("toggle-rule-set"));

    // then
    expect(toggling).toHaveBeenCalledWith("rule-set", false);
  });

  it("given a rule the club no longer wants, when it is removed, then the set stops carrying it", async () => {
    // given
    const removing = vi.spyOn(api, "removeRule").mockResolvedValue(undefined);
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);
    await screen.findByTestId("remove-rule-ADVANCE_WINDOW");

    // when
    await userEvent.click(screen.getByTestId("remove-rule-ADVANCE_WINDOW"));

    // then
    expect(removing).toHaveBeenCalledWith("rule-set", "ADVANCE_WINDOW");
    await vi.waitFor(() =>
      expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays")).toHaveValue(null));
  });

  it("given a rule type the set does not carry, when it is read, then there is nothing to remove", async () => {
    // given
    vi.spyOn(api, "rules").mockResolvedValue([]);

    // when
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);
    await screen.findByTestId("rule-ADVANCE_WINDOW-maxDays");

    // then
    expect(screen.queryByTestId("remove-rule-ADVANCE_WINDOW")).not.toBeInTheDocument();
  });

  it("given an admin, when configuration loads, then club settings and every rule type are visible", async () => {
    // when
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("club-name")).toHaveValue("Example Tennis Club");
    expect(screen.getByTestId("slot-minutes")).toHaveValue(30);
    expect(screen.getByTestId("time-zone")).toHaveValue("Europe/Berlin");
    expect(screen.getByTestId("rule-OPENING_HOURS-title")).toHaveRole("heading");
    expect(screen.getByTestId("rule-OPENING_HOURS-title")).toHaveTextContent("Opening hours");
    expect(screen.getByTestId("rule-OPENING_HOURS-global")).toHaveAttribute("href", "/admin/facility#opening-hours");
    expect(screen.getByTestId("rule-SLOT_GRID-global")).toHaveAttribute("href", "/admin/configuration#slot-minutes");
    expect(screen.getByTestId("slot-minutes")).toHaveAttribute("id", "slot-minutes");
    await waitFor(() => expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays")).toHaveValue(7));
    expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays-range")).toHaveTextContent("Allowed range: 1 to 365");
  });

  it("given the time-grid fragment, when configuration loads, then the owned setting receives focus", async () => {
    // given
    render(<MemoryRouter initialEntries={["/admin/configuration#slot-minutes"]}><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);

    // when
    const slotMinutes = await screen.findByTestId("slot-minutes");

    // then
    await waitFor(() => expect(slotMinutes).toHaveFocus());
  });

  it("given configuration cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "adminConfig").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("given changed settings, when saving, then both writes use the admin API", async () => {
    // given
    const changeConfig = vi.spyOn(api, "changeAdminConfig").mockResolvedValue({
      clubName: "Example Racquet Club",
      primaryColor: "#b85c38",
      accentColor: "#d7e24b",
      defaultLocale: "en",
      supportedLocales: ["de", "en"],
      slotMinutes: 15,
      timeZone: "Pacific/Auckland",
      newAccountCredentialHours: 168,
      passwordResetCredentialHours: 24
    });
    const setRule = vi.spyOn(api, "setRule").mockResolvedValue({
      ruleType: "ADVANCE_WINDOW", params: { maxDays: 14 }
    });
    const loadedRules = deferred<Awaited<ReturnType<typeof api.rules>>>();
    vi.mocked(api.rules).mockReturnValueOnce(loadedRules.promise);
    const configurationChanged = vi.fn();
    render(<MemoryRouter><AdminConfigurationView configurationChanged={configurationChanged} /></MemoryRouter>);
    await screen.findByTestId("club-name");
    const saveRuleButton = screen.getByTestId("save-rule-ADVANCE_WINDOW");
    expect(saveRuleButton).toBeDisabled();
    loadedRules.resolve([{ ruleType: "ADVANCE_WINDOW", params: { maxDays: 7 } }]);
    await waitFor(() => expect(saveRuleButton).toBeEnabled());

    // when
    fireEvent.change(screen.getByTestId("club-name"), { target: { value: "Example Racquet Club" } });
    fireEvent.change(screen.getByTestId("slot-minutes"), { target: { value: "15" } });
    fireEvent.change(screen.getByTestId("new-account-credential-hours"), { target: { value: "72" } });
    fireEvent.change(screen.getByTestId("time-zone"), { target: { value: "Pacific/Auckland" } });
    fireEvent.click(screen.getByTestId("save-club-config"));
    fireEvent.change(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays"), { target: { value: "14" } });
    fireEvent.click(saveRuleButton);

    // then
    await waitFor(() => {
      expect(changeConfig).toHaveBeenCalledWith(expect.objectContaining({
        clubName: "Example Racquet Club", slotMinutes: 15, timeZone: "Pacific/Auckland",
        newAccountCredentialHours: 72
      }));
      expect(configurationChanged).toHaveBeenCalled();
      expect(setRule).toHaveBeenCalledWith("rule-set", "ADVANCE_WINDOW", { maxDays: 14 });
    });
    // What the instance ships is read from the response and never sent back: the request refuses it
    expect(changeConfig.mock.calls[0][0]).not.toHaveProperty("supportedLocales");
  });

  it("given an edited setting, when a locale change finishes an older reload, then the edit is retained", async () => {
    // given
    const reload = deferred<Awaited<ReturnType<typeof api.adminConfig>>>();
    const adminConfig = vi.mocked(api.adminConfig);
    adminConfig.mockReturnValueOnce(Promise.resolve({
      clubName: "Example Tennis Club",
      primaryColor: "#b85c38",
      accentColor: "#d7e24b",
      defaultLocale: "en",
      supportedLocales: ["de", "en"],
      slotMinutes: 30,
      timeZone: "Europe/Berlin",
      newAccountCredentialHours: 168,
      passwordResetCredentialHours: 24
    })).mockReturnValueOnce(reload.promise);
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);
    const clubName = await screen.findByTestId("club-name");
    fireEvent.change(clubName, { target: { value: "Example Racquet Club" } });

    // when
    await i18n.changeLanguage("de");
    await waitFor(() => expect(adminConfig).toHaveBeenCalledTimes(2));
    await act(() => {
      reload.resolve({
        clubName: "Example Tennis Club",
        primaryColor: "#b85c38",
        accentColor: "#d7e24b",
        defaultLocale: "en",
        supportedLocales: ["de", "en"],
        slotMinutes: 30,
        timeZone: "Europe/Berlin",
        newAccountCredentialHours: 168,
        passwordResetCredentialHours: 24
      });
      return reload.promise;
    });

    // then
    await waitFor(() => expect(clubName).toHaveValue("Example Racquet Club"));
  });

  it("given the API rejects a club setting, when saving, then its validation code is reported", async () => {
    // given
    vi.spyOn(api, "changeAdminConfig").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:validation",
      title: "Validation failed",
      status: 400,
      fieldErrors: [{ field: "primaryColor", code: "validation.Pattern", params: {} }]
    }));
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);
    await screen.findByTestId("club-name");

    // when
    await userEvent.click(screen.getByTestId("save-club-config"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("The input does not have the permitted format.");
  });

  it("given a rule set the instance refuses, when saving, then the board is told why in its own language", async () => {
    // given
    vi.spyOn(api, "changeAdminConfig").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:no-membership-type-rule-set-inactive",
      title: "Rule set inactive",
      status: 400,
      violations: [{ code: "config.noMembershipTypeRuleSet.inactive", params: { field: "noMembershipTypeRuleSetId" } }]
    }));
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);
    await screen.findByTestId("club-name");

    // when
    await userEvent.click(screen.getByTestId("save-club-config"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("The chosen rule set is not active.");
  });

  it("given a rule with no parameters, when it is offered, then it says what switching it on does", async () => {
    // given
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);

    // when
    const description = await screen.findByTestId("rule-NO_COURT_BOOKING-description");

    // then — a Save button beside no field says nothing on its own
    expect(description).toHaveTextContent("nobody measured by that set may book a court or move a booking");
    expect(screen.getByTestId("save-rule-NO_COURT_BOOKING")).toBeInTheDocument();
  });

  it("given a rule with no parameters, when it is saved, then it is written without any parameter", async () => {
    // given
    const saving = vi.spyOn(api, "setRule")
      .mockResolvedValue({ ruleType: "NO_COURT_BOOKING", params: {} });
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);
    await screen.findByTestId("save-rule-NO_COURT_BOOKING");

    // when
    await userEvent.click(screen.getByTestId("save-rule-NO_COURT_BOOKING"));

    // then
    expect(saving).toHaveBeenCalledWith("rule-set", "NO_COURT_BOOKING", {});
  });

  it("offers the club time zone as a list of known zones", async () => {
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);

    const field = await screen.findByTestId("time-zone");

    expect(field.tagName).toBe("SELECT");
    const optionValues = within(field).getAllByRole("option").map((option) => (option as HTMLOptionElement).value);
    expect(optionValues).toContain("Europe/Berlin");
  });

  it("given a stored time zone the browser does not list, when configuration loads, then the control still shows it", async () => {
    // given
    vi.spyOn(api, "adminConfig").mockResolvedValue({
      clubName: "Example Tennis Club",
      primaryColor: "#b85c38",
      accentColor: "#d7e24b",
      defaultLocale: "en",
      supportedLocales: ["de", "en"],
      slotMinutes: 30,
      timeZone: "US/Eastern",
      newAccountCredentialHours: 168,
      passwordResetCredentialHours: 24
    });

    // when
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("time-zone")).toHaveValue("US/Eastern");
  });

  it("given rule-set responses finish out of order, when switching sets, then only the selected set is editable", async () => {
    // given
    const first = deferred<Awaited<ReturnType<typeof api.rules>>>();
    const second = deferred<Awaited<ReturnType<typeof api.rules>>>();
    vi.spyOn(api, "ruleSets").mockResolvedValue([
      { id: "first", name: "First", active: true },
      { id: "second", name: "Second", active: true }
    ]);
    vi.spyOn(api, "rules")
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const setRule = vi.spyOn(api, "setRule").mockResolvedValue({
      ruleType: "ADVANCE_WINDOW", params: { maxDays: 14 }
    });
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);
    await screen.findByTestId("club-name");

    // when
    const ruleSet = screen.getByTestId("rule-set");
    expect(ruleSet).toHaveRole("combobox");
    expect(ruleSet).toHaveAccessibleName("Rule set");
    await userEvent.selectOptions(ruleSet, "second");
    second.resolve([{ ruleType: "ADVANCE_WINDOW", params: { maxDays: 14 } }]);
    await waitFor(() => expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays")).toHaveValue(14));
    first.resolve([{ ruleType: "ADVANCE_WINDOW", params: { maxDays: 7 } }]);

    // then
    expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays")).not.toHaveValue(7);
    await userEvent.click(screen.getByTestId("save-rule-ADVANCE_WINDOW"));
    expect(setRule).toHaveBeenCalledWith("second", "ADVANCE_WINDOW", { maxDays: 14 });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
