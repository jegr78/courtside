import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, api } from "../../api/client";
import i18n from "../../i18n";
import { UnsavedCount } from "../../test/UnsavedCount";
import { UnsavedCounts } from "../../test/UnsavedCounts";
import { UnsavedChangesProvider } from "../../unsaved/UnsavedChangesProvider";
import { AdminRuleSetsView } from "./AdminRuleSetsView";

describe("AdminRuleSetsView", () => {
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
      passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24,
      logoUploaded: false
    });
    vi.spyOn(api, "ruleSets").mockResolvedValue([{ id: "rule-set", name: "Standard", active: true }]);
    vi.spyOn(api, "ruleTypes").mockResolvedValue([
      { ruleType: "OPENING_HOURS", configurable: false, parameters: [] },
      { ruleType: "SLOT_GRID", configurable: false, parameters: [] },
      { ruleType: "ADVANCE_WINDOW", configurable: true, parameters: [{ name: "maxDays", minimum: 1, maximum: 365 }] },
      { ruleType: "CANCELLATION_DEADLINE", configurable: true, parameters: [{ name: "minMinutes", minimum: 0, maximum: 525600 }] },
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

  it("given sets with membership types pointing at them, when the page loads, then the overview says who each set applies to", async () => {
    // given
    vi.spyOn(api, "ruleSets").mockResolvedValue([
      { id: "rule-set", name: "Standard", active: true },
      { id: "juniors", name: "Junior rules", active: true },
      { id: "retired", name: "Old rules", active: false }
    ]);
    vi.spyOn(api, "membershipTypes").mockResolvedValue([
      { id: "type-1", name: "Adults", ruleSetId: "rule-set", active: true, grantsAccount: false },
      { id: "type-2", name: "Seniors", ruleSetId: "rule-set", active: true, grantsAccount: false },
      { id: "type-3", name: "Juniors", ruleSetId: "juniors", active: true, grantsAccount: false }
    ]);
    vi.spyOn(api, "adminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, logoUploaded: false, noMembershipTypeRuleSetId: "juniors"
    });

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    // then
    const overview = await screen.findByTestId("rule-set-overview");
    expect(within(overview).getByTestId("rule-set-choose-rule-set")).toHaveTextContent("Standard");
    expect(screen.getByTestId("rule-set-applies-rule-set")).toHaveTextContent("Adults, Seniors");
    expect(screen.getByTestId("rule-set-applies-juniors")).toHaveTextContent("Juniors");
    expect(screen.getByTestId("rule-set-applies-juniors"), "the fallback is one more pointer at the set")
      .toHaveTextContent("People without a membership type");
    expect(screen.getByTestId("rule-set-applies-rule-set")).not.toHaveTextContent("People without a membership type");
    expect(screen.getByTestId("rule-set-applies-retired")).toHaveTextContent("Nobody");
    expect(screen.getByTestId("rule-set-state-retired")).toHaveTextContent("Retired");
    expect(screen.getByTestId("rule-set-state-rule-set")).toHaveTextContent("Active");
  });

  it("given the rule sets page, when it loads, then the club's identity and deadlines are not on it", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("rule-set-overview");

    // then
    for (const elsewhere of ["club-name", "logo-file", "primary-color-value", "time-zone", "slot-minutes",
      "new-account-credential-hours", "booking-reminder-hours", "save-club-config"]) {
      expect(screen.queryByTestId(elsewhere), `${elsewhere} belongs to another surface`).not.toBeInTheDocument();
    }
  });

  it("given a fallback rule set is chosen, when saving it, then the request carries every other setting as it was stored", async () => {
    // given
    const stored = {
      clubName: "Example Tennis Club", shortName: "Example", primaryColor: "#b85c38", accentColor: "#d7e24b",
      logoUrl: "/icon.svg", logoFallbackUrl: "/icon.svg", imprintUrl: "/imprint", privacyUrl: "/privacy",
      documentationUrl: "/documentation", defaultLocale: "en" as const, supportedLocales: ["de", "en"], slotMinutes: 15,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 72, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 3, logoUploaded: false
    };
    vi.spyOn(api, "adminConfig").mockResolvedValue(stored);
    const changing = vi.spyOn(api, "changeAdminConfig").mockResolvedValue({ ...stored, noMembershipTypeRuleSetId: "rule-set" });
    const configurationChanged = vi.fn();
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={configurationChanged} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("no-membership-type-rule-set");

    // when
    await userEvent.selectOptions(screen.getByTestId("no-membership-type-rule-set"), "rule-set");
    await userEvent.click(screen.getByTestId("save-no-membership-type-rule-set"));

    // then
    await waitFor(() => expect(configurationChanged).toHaveBeenCalled());
    expect(changing).toHaveBeenCalledWith({
      clubName: "Example Tennis Club", shortName: "Example", primaryColor: "#b85c38", accentColor: "#d7e24b",
      logoUrl: "/icon.svg", imprintUrl: "/imprint", privacyUrl: "/privacy", documentationUrl: "/documentation",
      defaultLocale: "en", slotMinutes: 15, timeZone: "Europe/Berlin",
      newAccountCredentialHours: 72, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 3, noMembershipTypeRuleSetId: "rule-set"
    });
    expect(screen.getByTestId("rule-set-applies-rule-set")).toHaveTextContent("People without a membership type");
  });

  it("given every rule type, when the rule sets load, then each rule is shown with its range and the club-wide ones point to where they are set", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("rule-OPENING_HOURS-title")).toHaveRole("heading");
    expect(screen.getByTestId("rule-OPENING_HOURS-title")).toHaveTextContent("Opening hours");
    expect(screen.getByTestId("rule-OPENING_HOURS-global")).toHaveAttribute("href", "/admin/facility/opening-hours");
    expect(screen.getByTestId("rule-SLOT_GRID-global")).toHaveAttribute("href", "/admin/configuration#slot-minutes");
    await waitFor(() => expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays")).toHaveValue(7));
    expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays-range")).toHaveTextContent("Allowed: 1 to 365");
    expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays")).toHaveAccessibleDescription("Allowed: 1 to 365");
    expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays"), "the browser knows the range too").toHaveAttribute("min", "1");
    expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays")).toHaveAttribute("max", "365");
  });

  it("given the rules page, when it is laid out at desktop width, then the overview and the selected set stand side by side", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("rule-ADVANCE_WINDOW-maxDays");

    // then
    expect(screen.getByTestId("booking-rules")).toHaveClass("xl:grid-cols-[minmax(0,4fr)_minmax(0,6fr)]");
    expect(screen.getByTestId("rule-set-editor"), "the rules sit beside the overview, not below it")
      .toContainElement(screen.getByTestId("rule-set-rules"));
    expect(screen.getByTestId("rule-set-editor")).not.toContainElement(screen.getByTestId("rule-set-overview"));
    expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays"), "a number of days needs no full-width input").toHaveClass("w-24");
  });

  it("given a changed rule, when saving it, then the selected set is written once its rules have arrived", async () => {
    // given
    const setRule = vi.spyOn(api, "setRule").mockResolvedValue({
      ruleType: "ADVANCE_WINDOW", params: { maxDays: 14 }
    });
    const loadedRules = deferred<Awaited<ReturnType<typeof api.rules>>>();
    vi.mocked(api.rules).mockReturnValueOnce(loadedRules.promise);
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    const saveRuleButton = await screen.findByTestId("save-rule-ADVANCE_WINDOW");
    expect(saveRuleButton).toBeDisabled();
    loadedRules.resolve([{ ruleType: "ADVANCE_WINDOW", params: { maxDays: 7 } }]);
    await waitFor(() => expect(saveRuleButton).toBeEnabled());

    // when
    fireEvent.change(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays"), { target: { value: "14" } });
    fireEvent.click(saveRuleButton);

    // then
    await waitFor(() => expect(setRule).toHaveBeenCalledWith("rule-set", "ADVANCE_WINDOW", { maxDays: 14 }));
    expect(await screen.findByTestId("admin-save-success")).toHaveTextContent("The rule was saved.");
  });

  // A rule editor that reads its values from a prop through an effect claims unsaved work for the
  // tick in between, which blocks a navigation and then withdraws the question that would explain it.
  it("given a rule that is already configured, when it arrives, then nothing ever claims unsaved work", async () => {
    // given
    const seen: number[] = [];

    // when
    render(<MemoryRouter><UnsavedChangesProvider><UnsavedCounts seen={seen} /><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays")).toHaveValue(7));

    // then
    expect(Math.max(...seen)).toBe(0);
  });

  it("when the rule sets are loaded, then the rule set for people without a membership type is offered", async () => {
    // given
    vi.spyOn(api, "ruleSets").mockResolvedValue([
      { id: "rule-set", name: "Standard", active: true },
      { id: "retired", name: "Retired", active: false }
    ]);
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

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
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, logoUploaded: false,
      noMembershipTypeRuleSetId: "rule-set"
    });
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("no-membership-type-rule-set");

    // when
    fireEvent.change(screen.getByTestId("no-membership-type-rule-set"), { target: { value: "rule-set" } });
    await userEvent.click(screen.getByTestId("save-no-membership-type-rule-set"));

    // then
    await waitFor(() => expect(changing).toHaveBeenCalledWith(
      expect.objectContaining({ noMembershipTypeRuleSetId: "rule-set" })));
  });

  it("given an assigned rule set that has since been deactivated, when the rule sets are loaded, then it is still the selected one", async () => {
    // given
    vi.spyOn(api, "ruleSets").mockResolvedValue([
      { id: "rule-set", name: "Standard", active: true },
      { id: "retired", name: "Retired", active: false }
    ]);
    vi.spyOn(api, "adminConfig").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Europe/Berlin", newAccountCredentialHours: 168, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, logoUploaded: false,
      noMembershipTypeRuleSetId: "retired"
    });
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    // when
    const select = await screen.findByTestId("no-membership-type-rule-set");

    // then — dropping it from the list would clear the club's choice on the next save
    expect((select as HTMLSelectElement).value).toEqual("retired");
    expect(within(select).getAllByRole("option").map((option) => option.getAttribute("value")))
      .toContain("retired");
  });

  it("given a rule set named in the address, when the rule sets open, then that rule set is chosen and in focus", async () => {
    // given
    vi.spyOn(api, "ruleSets").mockResolvedValue([
      { id: "rule-set", name: "Standard", active: true },
      { id: "summer", name: "Summer rules", active: true }
    ]);
    const rules = vi.spyOn(api, "rules").mockResolvedValue([]);

    // when
    render(<MemoryRouter initialEntries={["/admin/rule-sets?ruleSetId=summer#rule-set"]}><UnsavedChangesProvider>
      <AdminRuleSetsView configurationChanged={() => undefined} />
    </UnsavedChangesProvider></MemoryRouter>);

    // then
    await waitFor(() => expect(screen.getByTestId("rule-set-name")).toHaveValue("Summer rules"));
    expect(screen.getByTestId("rule-set-choose-summer")).toHaveAttribute("aria-pressed", "true");
    expect(rules, "only the named rule set's rules are read").not.toHaveBeenCalledWith("rule-set");
    await waitFor(() => expect(screen.getByTestId("rule-set-editor")).toHaveFocus());
  });

  it("given a rule set the address names but the club does not have, when the rule sets open, then the first one is chosen", async () => {
    // given
    vi.spyOn(api, "ruleSets").mockResolvedValue([
      { id: "rule-set", name: "Standard", active: true },
      { id: "summer", name: "Summer rules", active: true }
    ]);
    const rules = vi.spyOn(api, "rules").mockResolvedValue([]);

    // when
    render(<MemoryRouter initialEntries={["/admin/rule-sets?ruleSetId=missing"]}><UnsavedChangesProvider>
      <AdminRuleSetsView configurationChanged={() => undefined} />
    </UnsavedChangesProvider></MemoryRouter>);

    // then
    await waitFor(() => expect(rules, "the first rule set's rules are read").toHaveBeenCalledWith("rule-set"));
    expect(rules, "the unknown id is never asked for").not.toHaveBeenCalledWith("missing");
    expect(screen.getByTestId("rule-set-name")).toHaveValue("Standard");
  });

  it("given a mistyped rule set name, when it is corrected, then the correction is written", async () => {
    // given
    const changing = vi.spyOn(api, "changeRuleSet")
      .mockResolvedValue({ id: "rule-set", name: "Standard rules", active: true });
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
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
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("new-rule-set-name");

    // when
    await userEvent.type(screen.getByTestId("new-rule-set-name"), "Juniors");
    await userEvent.click(screen.getByTestId("create-rule-set"));

    // then
    expect(creating).toHaveBeenCalledWith({ name: "Juniors" });
    await waitFor(() => expect(screen.getByTestId("rule-set-choose-rule-set-2")).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByTestId("rule-set-name")).toHaveValue("Juniors");
  });

  it("given a typed rule set name, when the set is taken out of service, then the typing is still there", async () => {
    // given — the answer speaks for `active` and carries the name the club still has stored
    vi.spyOn(api, "setRuleSetActive")
      .mockResolvedValueOnce({ id: "rule-set", name: "Standard", active: false })
      .mockResolvedValueOnce({ id: "rule-set", name: "Standard", active: true });
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("rule-set-name");
    fireEvent.change(screen.getByTestId("rule-set-name"), { target: { value: "Standard plus" } });

    // when
    await userEvent.click(screen.getByTestId("toggle-rule-set"));

    // then
    await waitFor(() => expect(screen.getByTestId("toggle-rule-set")).toHaveTextContent("Activate"));
    expect(screen.getByTestId("rule-set-name")).toHaveValue("Standard plus");
    expect(screen.getByTestId("unsaved-mark-rule-set:rule-set")).toBeInTheDocument();

    // when — the way back is the same change
    await userEvent.click(screen.getByTestId("toggle-rule-set"));

    // then
    await waitFor(() => expect(screen.getByTestId("toggle-rule-set")).toHaveTextContent("Deactivate"));
    expect(screen.getByTestId("rule-set-name")).toHaveValue("Standard plus");
    expect(screen.getByTestId("unsaved-mark-rule-set:rule-set")).toBeInTheDocument();
  });

  it("given a refused rule set creation, when the answer arrives, then the form still holds what was typed", async () => {
    // given
    vi.spyOn(api, "createRuleSet").mockRejectedValue(new ApiError(409));
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("new-rule-set-name");

    // when
    await userEvent.type(screen.getByTestId("new-rule-set-name"), "Juniors");
    await userEvent.click(screen.getByTestId("create-rule-set"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.getByTestId("new-rule-set-name")).toHaveValue("Juniors");
  });

  it("given membership types pointing at a rule set, when it is read, then retiring it says what that does not change", async () => {
    // given / when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

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
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("rule-set-retire-note")).toBeInTheDocument();
  });

  it("given a rule set in use, when it is retired, then no dialog stands in the way", async () => {
    // given
    const toggling = vi.spyOn(api, "setRuleSetActive")
      .mockResolvedValue({ id: "rule-set", name: "Standard", active: false });
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("toggle-rule-set");

    // when — activating it again restores it, so by this project's rule it is not confirmed
    await userEvent.click(screen.getByTestId("toggle-rule-set"));

    // then
    expect(toggling).toHaveBeenCalledWith("rule-set", false);
  });

  it("given a rule the club no longer wants, when it is removed, then the set stops carrying it", async () => {
    // given
    const removing = vi.spyOn(api, "removeRule").mockResolvedValue(undefined);
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
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
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("rule-ADVANCE_WINDOW-maxDays");

    // then
    expect(screen.queryByTestId("remove-rule-ADVANCE_WINDOW")).not.toBeInTheDocument();
  });

  it("given rules no rule set can change, when the rule sets load, then they stand apart from the ones it can", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    const clubWide = await screen.findByTestId("club-wide-rules");

    // then
    expect(clubWide).toContainElement(screen.getByTestId("rule-OPENING_HOURS-title"));
    expect(clubWide).toContainElement(screen.getByTestId("rule-SLOT_GRID-title"));
    expect(clubWide).not.toContainElement(screen.getByTestId("rule-ADVANCE_WINDOW-title"));
    expect(screen.getByTestId("rule-set-rules")).not.toContainElement(screen.getByTestId("rule-OPENING_HOURS-title"));
    expect(screen.getByTestId("club-wide-rules-note")).toHaveTextContent(
      "These apply to every rule set. The selected rule set does not change them.");
  });

  it("given both groups of rules, when the rule sets load, then each is named and outranks the rules it holds", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("rule-set-rules-heading")).toHaveTextContent("Rules of this rule set");
    expect(screen.getByTestId("rule-set-rules-heading").tagName).toBe("H3");
    expect(screen.getByTestId("club-wide-rules-heading").tagName).toBe("H3");
    expect(screen.getByTestId("rule-ADVANCE_WINDOW-title").tagName).toBe("H4");
    expect(screen.getByTestId("rule-OPENING_HOURS-title").tagName).toBe("H4");
  });

  it("given a chosen rule set and a typed name, when the language changes, then nothing is fetched again", async () => {
    // given
    vi.mocked(api.ruleSets).mockResolvedValue([
      { id: "rule-set", name: "Standard", active: true },
      { id: "rule-set-2", name: "Juniors", active: true }
    ]);
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("rule-set-name");
    await userEvent.click(screen.getByTestId("rule-set-choose-rule-set-2"));
    await waitFor(() => expect(screen.getByTestId("rule-set-name")).toHaveValue("Juniors"));
    fireEvent.change(screen.getByTestId("rule-set-name"), { target: { value: "Juniors plus" } });
    const reads = [api.adminConfig, api.ruleSets, api.ruleTypes, api.membershipTypes, api.rules]
      .map((read) => vi.mocked(read).mock.calls.length);

    // when
    await act(() => i18n.changeLanguage("de"));

    // then — the text is translated and no load runs again
    expect(screen.getByTestId("save-rule-set")).toHaveTextContent("Speichern");
    expect([api.adminConfig, api.ruleSets, api.ruleTypes, api.membershipTypes, api.rules]
      .map((read) => vi.mocked(read).mock.calls.length)).toEqual(reads);

    // then — and the selection and both typed names are still there
    expect(screen.getByTestId("rule-set-choose-rule-set-2")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("rule-set-name")).toHaveValue("Juniors plus");
  });

  it("given a rule set the instance refuses, when saving, then the board is told why in its own language", async () => {
    // given
    vi.spyOn(api, "changeAdminConfig").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:no-membership-type-rule-set-inactive",
      title: "Rule set inactive",
      status: 400,
      violations: [{ code: "config.noMembershipTypeRuleSet.inactive", params: { field: "noMembershipTypeRuleSetId" } }]
    }));
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("no-membership-type-rule-set");

    // when
    await userEvent.click(screen.getByTestId("save-no-membership-type-rule-set"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("The chosen rule set is not active.");
  });

  it("given a rule with no parameters, when it is offered, then it says what switching it on does", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    // when
    const description = await screen.findByTestId("rule-NO_COURT_BOOKING-description");

    // then — a Save button beside no field says nothing on its own
    expect(description).toHaveTextContent("nobody measured by that set may book a court or move a booking");
    expect(screen.getByTestId("save-rule-NO_COURT_BOOKING")).toBeInTheDocument();
  });

  it("given a cancellation deadline is offered, when editing rules, then its unit and range are clear", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);

    // when
    const deadline = await screen.findByTestId("rule-CANCELLATION_DEADLINE-minMinutes");

    // then
    expect(screen.getByTestId("rule-CANCELLATION_DEADLINE-title")).toHaveTextContent("Cancellation deadline");
    expect(deadline).toHaveAccessibleName("Minimum minutes before the booking starts");
    expect(screen.getByTestId("rule-CANCELLATION_DEADLINE-minMinutes-range"))
      .toHaveTextContent("Allowed: 0 to 525600");
  });

  it("given a rule with no parameters, when it is saved, then it is written without any parameter", async () => {
    // given
    const saving = vi.spyOn(api, "setRule")
      .mockResolvedValue({ ruleType: "NO_COURT_BOOKING", params: {} });
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("save-rule-NO_COURT_BOOKING");

    // when
    await userEvent.click(screen.getByTestId("save-rule-NO_COURT_BOOKING"));

    // then
    expect(saving).toHaveBeenCalledWith("rule-set", "NO_COURT_BOOKING", {});
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
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("rule-set-choose-second");

    // when
    const ruleSet = screen.getByTestId("rule-set-choose-second");
    expect(ruleSet).toHaveRole("button");
    expect(ruleSet).toHaveAccessibleName("Second");
    await userEvent.click(ruleSet);
    second.resolve([{ ruleType: "ADVANCE_WINDOW", params: { maxDays: 14 } }]);
    await waitFor(() => expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays")).toHaveValue(14));
    first.resolve([{ ruleType: "ADVANCE_WINDOW", params: { maxDays: 7 } }]);

    // then
    expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays")).not.toHaveValue(7);
    await userEvent.click(screen.getByTestId("save-rule-ADVANCE_WINDOW"));
    expect(setRule).toHaveBeenCalledWith("second", "ADVANCE_WINDOW", { maxDays: 14 });
  });

  it("given the rule set name is edited, when another rule set is chosen, then the edit is not dropped silently", async () => {
    // given
    vi.spyOn(api, "ruleSets").mockResolvedValue([
      { id: "rule-set", name: "Standard", active: true },
      { id: "rule-set-2", name: "Juniors", active: true }
    ]);
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    const name = await screen.findByTestId("rule-set-name");
    await userEvent.type(name, " plus");

    // when
    await userEvent.click(screen.getByTestId("rule-set-choose-rule-set-2"));

    // then
    expect(await screen.findByTestId("unsaved-changes")).toBeInTheDocument();
    expect(screen.getByTestId("rule-set-name")).toHaveValue("Standard plus");
    expect(screen.getByTestId("rule-set-choose-rule-set")).toHaveAttribute("aria-pressed", "true");

    // when
    await userEvent.click(screen.getByTestId("unsaved-changes-stay"));

    // then
    expect(screen.queryByTestId("unsaved-changes")).not.toBeInTheDocument();
    expect(screen.getByTestId("rule-set-name")).toHaveValue("Standard plus");
  });

  it("given the question about the rule set name stands, when it is discarded, then the other rule set opens", async () => {
    // given
    vi.spyOn(api, "ruleSets").mockResolvedValue([
      { id: "rule-set", name: "Standard", active: true },
      { id: "rule-set-2", name: "Juniors", active: true }
    ]);
    render(<MemoryRouter><UnsavedChangesProvider><AdminRuleSetsView configurationChanged={() => undefined} /></UnsavedChangesProvider></MemoryRouter>);
    await userEvent.type(await screen.findByTestId("rule-set-name"), " plus");
    await userEvent.click(screen.getByTestId("rule-set-choose-rule-set-2"));
    await screen.findByTestId("unsaved-changes");

    // when
    await userEvent.click(screen.getByTestId("unsaved-changes-discard"));

    // then
    await waitFor(() => expect(screen.getByTestId("rule-set-choose-rule-set-2")).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByTestId("rule-set-name")).toHaveValue("Juniors");
    expect(screen.queryByTestId("unsaved-changes")).not.toBeInTheDocument();
  });

  it("given a rule parameter is edited, when the rule is read, then it says the change is not saved", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider>
      <UnsavedCount />
      <AdminRuleSetsView configurationChanged={() => undefined} />
    </UnsavedChangesProvider></MemoryRouter>);
    const parameter = await screen.findByTestId("rule-ADVANCE_WINDOW-maxDays");
    await waitFor(() => expect(parameter).toHaveValue(7));

    // when
    await userEvent.type(parameter, "5");

    // then
    expect(await screen.findByTestId("unsaved-mark-rule:ADVANCE_WINDOW")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));
  });

  it("given the rule set form is filled in, when it is read, then it holds work", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider>
      <UnsavedCount />
      <AdminRuleSetsView configurationChanged={() => undefined} />
    </UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("new-rule-set-name");

    // when
    await userEvent.type(screen.getByTestId("new-rule-set-name"), "Juniors");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
