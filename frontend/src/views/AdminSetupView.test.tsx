import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { api, type AdminClubConfig, type RosterEntry } from "../api/client";
import i18n from "../i18n";
import { AdminSetupView } from "./AdminSetupView";

const configuration: AdminClubConfig = {
  clubName: "Example Tennis Club",
  primaryColor: "#b85c38",
  accentColor: "#d7e24b",
  logoUrl: null,
  imprintUrl: null,
  privacyUrl: null,
  documentationUrl: null,
  shortName: null,
  defaultLocale: "en",
  supportedLocales: ["de", "en"],
  slotMinutes: 30,
  timeZone: "Europe/Berlin",
  newAccountCredentialHours: 168,
  passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
  bookingReminderHours: 24,
  logoUploaded: false,
  logoFallbackUrl: null,
  noMembershipTypeRuleSetId: null
};

const factoryResponse: AdminClubConfig = {
  ...configuration,
  clubName: "Courtside",
  primaryColor: "#AF5030",
  accentColor: "#D7E24B",
  defaultLocale: "de"
};

const currentMember: RosterEntry = {
  personId: "person-1",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane.doe@example.org",
  accountId: null,
  username: null,
  enabled: false,
  roles: [],
  membershipTypeId: "type-1",
  membershipStartedOn: "2026-01-01",
  membershipEndedOn: null
};

describe("AdminSetupView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminConfig").mockResolvedValue(configuration);
    vi.spyOn(api, "adminCourts").mockResolvedValue([
      { id: "court-1", number: 1, name: "Centre Court", active: true }
    ]);
    vi.spyOn(api, "adminOpeningHours").mockResolvedValue([
      { dayOfWeek: "MONDAY", opensAt: "08:00:00", closesAt: "22:00:00" }
    ]);
    vi.spyOn(api, "membershipTypes").mockResolvedValue([
      { id: "type-1", name: "Adults", ruleSetId: null, active: true, grantsAccount: false }
    ]);
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [currentMember], nextCursor: null, matching: 0 });
    vi.spyOn(api, "importSources").mockResolvedValue([]);
  });

  it("given the first read fails, when the board tries again, then the checklist appears without a reload", async () => {
    // given
    vi.mocked(api.adminConfig).mockRejectedValueOnce(new Error("offline for a moment"));
    render(<MemoryRouter><AdminSetupView /></MemoryRouter>);
    expect(await screen.findByTestId("load-failure")).toHaveTextContent(i18n.t("error.generic"));

    // when
    await userEvent.click(screen.getByTestId("retry-load"));

    // then
    expect(await screen.findByTestId("setup-progress")).toHaveTextContent("4 of 4 required steps complete");
    expect(screen.queryByTestId("load-failure"), "the failure leaves once the read succeeds").not.toBeInTheDocument();
    expect(api.adminConfig).toHaveBeenCalledTimes(2);
  });

  it("given a configured instance, when setup is opened, then every required step is complete in order", async () => {
    // when
    render(<MemoryRouter><AdminSetupView /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("setup-progress")).toHaveTextContent("4 of 4 required steps complete");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
    expect(screen.getByTestId("setup-progress-fill")).toHaveStyle({ width: "100%" });
    const steps = screen.getAllByTestId(/^setup-step-/);
    expect(steps.map((step) => step.dataset.testid)).toEqual([
      "setup-step-configuration",
      "setup-step-facility",
      "setup-step-membership-types",
      "setup-step-roster",
      "setup-step-import"
    ]);
    for (const id of ["configuration", "facility", "membership-types", "roster"]) {
      expect(screen.getByTestId(`setup-step-${id}`)).toHaveAttribute("data-state", "complete");
    }
    expect(screen.getByTestId("setup-step-import")).toHaveAttribute("data-state", "optional");
  });

  it("given factory configuration, inactive resources and an ended membership, when setup is opened, then they remain unfinished", async () => {
    // given
    vi.mocked(api.adminConfig).mockResolvedValue(factoryResponse);
    vi.spyOn(api, "adminCourts").mockResolvedValue([
      { id: "court-1", number: 1, name: "Centre Court", active: false }
    ]);
    vi.spyOn(api, "adminOpeningHours").mockResolvedValue([
      { dayOfWeek: "MONDAY", opensAt: null, closesAt: null }
    ]);
    vi.spyOn(api, "membershipTypes").mockResolvedValue([
      { id: "type-1", name: "Adults", ruleSetId: null, active: false, grantsAccount: false }
    ]);
    vi.spyOn(api, "roster").mockResolvedValue({
      entries: [{ ...currentMember, membershipEndedOn: "2026-08-31" }],
      nextCursor: null, matching: 0
    });
    vi.spyOn(api, "importSources").mockResolvedValue([{
      id: "source-1", sourceKey: "roster-system", displayName: "Membership system",
      separator: ";", encoding: "UTF-8", columns: {}, membershipTypes: {},
      defaultMembershipTypeId: "type-1", ownedFields: [], removalWarningPercent: 10
    }]);

    // when
    render(<MemoryRouter><AdminSetupView /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("setup-progress")).toHaveTextContent("0 of 4 required steps complete");
    expect(screen.getByRole("progressbar"), "the bar reads out what the sentence says").toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByTestId("setup-progress-fill")).toHaveStyle({ width: "0%" });
    expect(screen.getByTestId("setup-step-configuration")).toHaveAttribute("data-state", "next");
    expect(screen.getByTestId("setup-step-facility")).toHaveAttribute("data-state", "next");
    expect(screen.getByTestId("setup-step-membership-types")).toHaveAttribute("data-state", "next");
    expect(screen.getByTestId("setup-step-roster")).toHaveAttribute("data-state", "next");
    expect(screen.getByTestId("setup-step-import")).toHaveAttribute("data-state", "available");
  });

  it("given a documentation target is the only change to factory configuration, when setup is opened, then the club counts as configured", async () => {
    // given
    vi.mocked(api.adminConfig).mockResolvedValue({
      ...factoryResponse,
      documentationUrl: "https://docs.example.org/courtside"
    });

    // when
    render(<MemoryRouter><AdminSetupView /></MemoryRouter>);

    // then
    expect(await screen.findByTestId("setup-progress")).toHaveTextContent("4 of 4 required steps complete");
    expect(screen.getByTestId("setup-step-configuration")).toHaveAttribute("data-state", "complete");
  });

  it.each(["court", "hours"])("given missing %s readiness, when setup is opened, then the facility remains unfinished", async (missing) => {
    // given
    if (missing === "court") vi.mocked(api.adminCourts).mockResolvedValue([]);
    else vi.mocked(api.adminOpeningHours).mockResolvedValue([]);

    // when
    render(<MemoryRouter><AdminSetupView /></MemoryRouter>);

    // then
    await screen.findByTestId("setup-progress");
    expect(screen.getByTestId("setup-step-facility")).toHaveAttribute("data-state", "next");
  });

  it("given a later roster page fails, when setup is opened, then incomplete membership evidence is not presented", async () => {
    // given
    vi.mocked(api.roster)
      .mockResolvedValueOnce({ entries: [], nextCursor: "page-2", matching: 0 })
      .mockRejectedValueOnce(new Error("unavailable"));

    // when
    render(<MemoryRouter><AdminSetupView /></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("setup-progress")).not.toBeInTheDocument();
  });

  it("given a current member on a later page, when setup is opened, then the roster step is complete", async () => {
    // given
    vi.mocked(api.roster)
      .mockResolvedValueOnce({ entries: [{ ...currentMember, membershipEndedOn: "2026-08-31" }], nextCursor: "page-2", matching: 0 })
      .mockResolvedValueOnce({ entries: [currentMember], nextCursor: "page-3", matching: 0 });

    // when
    render(<MemoryRouter><AdminSetupView /></MemoryRouter>);

    // then
    await screen.findByTestId("setup-progress");
    expect(screen.getByTestId("setup-step-roster")).toHaveAttribute("data-state", "complete");
    expect(api.roster).toHaveBeenNthCalledWith(2, { cursor: "page-2", limit: 200 });
    expect(api.roster).toHaveBeenCalledTimes(2);
  });

  it("given a complete, an open and an optional step, when setup is read, then each badge carries its state in a mark and an outline", async () => {
    // given
    vi.mocked(api.membershipTypes).mockResolvedValue([]);

    // when
    render(<MemoryRouter><AdminSetupView /></MemoryRouter>);

    // then
    await screen.findByTestId("setup-progress");
    const badge = (step: string) => within(screen.getByTestId(`setup-step-${step}`)).getByTestId("setup-state-badge");
    const mark = (step: string) => within(badge(step)).getByTestId("setup-state-mark");
    expect(badge("configuration")).toHaveAttribute("data-state", "complete");
    expect(badge("membership-types")).toHaveAttribute("data-state", "next");
    expect(badge("import")).toHaveAttribute("data-state", "optional");
    expect(new Set([mark("configuration"), mark("membership-types"), mark("import")].map((element) => element.textContent)).size,
      "every state has a symbol of its own that survives forced colours").toBe(3);
    expect(badge("membership-types"), "an open step is outlined heavier than a complete one").toHaveClass("border-2");
    expect(badge("configuration")).not.toHaveClass("border-2");
    expect(badge("import"), "an optional step is outlined dashed").toHaveClass("border-dashed");
    expect(badge("configuration").className, "a complete step is not drawn like an open one")
      .not.toEqual(badge("membership-types").className);
  });

  it("given the setup state is available, when its steps are read, then every one links to its working surface", async () => {
    // when
    render(<MemoryRouter><AdminSetupView /></MemoryRouter>);

    // then
    await screen.findByTestId("setup-progress");
    for (const [id, href] of [
      ["configuration", "/admin/configuration"],
      ["facility", "/admin/facility/courts"],
      ["membership-types", "/admin/membership-types"],
      ["roster", "/admin/roster"],
      ["import", "/admin/import"]
    ]) {
      expect(within(screen.getByTestId(`setup-step-${id}`)).getByRole("link")).toHaveAttribute("href", href);
    }
  });

  it("given one state source fails, when setup is opened, then no partial progress is presented", async () => {
    // given
    vi.spyOn(api, "adminCourts").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><AdminSetupView /></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("setup-progress")).not.toBeInTheDocument();
    expect(screen.queryByTestId("setup-step-configuration")).not.toBeInTheDocument();
  });
});
