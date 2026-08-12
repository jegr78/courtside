import { render, screen, waitFor, within } from "@testing-library/react";
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
      slotMinutes: 30,
      timeZone: "Europe/Berlin"
    });
    vi.spyOn(api, "ruleSets").mockResolvedValue([{ id: "rule-set", name: "Standard", active: true }]);
    vi.spyOn(api, "ruleTypes").mockResolvedValue([
      { ruleType: "OPENING_HOURS", configurable: false, parameters: [] },
      { ruleType: "ADVANCE_WINDOW", configurable: true, parameters: [{ name: "maxDays", minimum: 1, maximum: 365 }] }
    ]);
    vi.spyOn(api, "rules").mockResolvedValue([
      { ruleType: "ADVANCE_WINDOW", params: { maxDays: 7 } }
    ]);
  });

  it("given an admin, when configuration loads, then club settings and every rule type are visible", async () => {
    // when
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("club-name")).toHaveValue("Example Tennis Club");
    expect(screen.getByTestId("slot-minutes")).toHaveValue(30);
    expect(screen.getByTestId("time-zone")).toHaveValue("Europe/Berlin");
    expect(screen.getByRole("heading", { name: "Opening hours" })).toBeInTheDocument();
    expect(screen.getByTestId("rule-OPENING_HOURS-global")).toHaveTextContent("Configured globally for the whole facility");
    await waitFor(() => expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays")).toHaveValue(7));
    expect(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays-range")).toHaveTextContent("Allowed range: 1 to 365");
  });

  it("given changed settings, when saving, then both writes use the admin API", async () => {
    // given
    const changeConfig = vi.spyOn(api, "changeAdminConfig").mockResolvedValue({
      clubName: "Example Racquet Club",
      primaryColor: "#b85c38",
      accentColor: "#d7e24b",
      defaultLocale: "en",
      slotMinutes: 15,
      timeZone: "Pacific/Auckland"
    });
    const setRule = vi.spyOn(api, "setRule").mockResolvedValue({
      ruleType: "ADVANCE_WINDOW", params: { maxDays: 14 }
    });
    const configurationChanged = vi.fn();
    render(<MemoryRouter><AdminConfigurationView configurationChanged={configurationChanged} /></MemoryRouter>);
    const user = userEvent.setup();
    await screen.findByTestId("club-name");

    // when
    await user.clear(screen.getByTestId("club-name"));
    await user.type(screen.getByTestId("club-name"), "Example Racquet Club");
    await user.clear(screen.getByTestId("slot-minutes"));
    await user.type(screen.getByTestId("slot-minutes"), "15");
    await user.selectOptions(screen.getByTestId("time-zone"), "Pacific/Auckland");
    await user.click(screen.getByTestId("save-club-config"));
    await user.clear(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays"));
    await user.type(screen.getByTestId("rule-ADVANCE_WINDOW-maxDays"), "14");
    await user.click(screen.getByTestId("save-rule-ADVANCE_WINDOW"));

    // then
    expect(changeConfig).toHaveBeenCalledWith(expect.objectContaining({
      clubName: "Example Racquet Club", slotMinutes: 15, timeZone: "Pacific/Auckland"
    }));
    expect(configurationChanged).toHaveBeenCalled();
    expect(setRule).toHaveBeenCalledWith("rule-set", "ADVANCE_WINDOW", { maxDays: 14 });
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

  it("offers the club time zone as a list of known zones", async () => {
    render(<MemoryRouter><AdminConfigurationView configurationChanged={() => undefined} /></MemoryRouter>);

    const field = await screen.findByTestId("time-zone");

    expect(field.tagName).toBe("SELECT");
    expect(within(field).getByRole("option", { name: "Europe/Berlin" })).toBeInTheDocument();
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
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Rule set" }), "second");
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
