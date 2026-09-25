import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router-dom";
import { api, type AdminClubConfig, type ImportSource, type MembershipType, type RosterEntry } from "../api/client";
import i18n from "../i18n";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { UnsavedChangesGuard } from "../unsaved/UnsavedChangesGuard";
import { UnsavedChangesProvider } from "../unsaved/UnsavedChangesProvider";
import { AdminConfigurationView } from "./AdminConfigurationView";
import { AdminImportView } from "./AdminImportView";
import { AdminMembershipTypesView } from "./AdminMembershipTypesView";
import { AdminPersonView } from "./AdminPersonView";
import { AdminDeadlinesView } from "./configuration/AdminDeadlinesView";
import { AdminRuleSetsView } from "./configuration/AdminRuleSetsView";
import { AdminBookingCardView } from "./facility/AdminBookingCardView";
import { AdminCourtsView } from "./facility/AdminCourtsView";
import { AdminOpeningHoursView } from "./facility/AdminOpeningHoursView";
import { AdminSlotFillersView } from "./facility/AdminSlotFillersView";

const config: AdminClubConfig = {
  clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
  defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30, timeZone: "Europe/Berlin",
  newAccountCredentialHours: 168, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
  bookingReminderHours: 24, logoUploaded: false
};
const adults: MembershipType = { id: "type-1", name: "Adults", ruleSetId: "rule-set", active: true, grantsAccount: false };
const jane: RosterEntry = {
  personId: "person-1", firstName: "Jane", lastName: "Doe", email: "jane.doe@example.org",
  accountId: "account-1", username: "doe.jane", locale: "en", enabled: true, roles: ["MEMBER"],
  credentialState: "CREDENTIAL_ISSUED", addressSharedBy: 1,
  membershipTypeId: "type-1", membershipStartedOn: "2026-01-01", membershipEndedOn: null
};
const source: ImportSource = {
  id: "source-1", sourceKey: "roster-system", displayName: "Membership system", separator: ";", encoding: "UTF-8",
  columns: { "Member number": "EXTERNAL_ID" }, membershipTypes: {}, defaultMembershipTypeId: "type-1",
  ownedFields: [], removalWarningPercent: 10
};

type Surface = {
  name: string;
  mark: string;
  path: string;
  route: string;
  page: ReactNode;
  edit: () => Promise<void>;
};

const typeInto = async (testId: string, text: string) => userEvent.type(await screen.findByTestId(testId), text);

const surfaces: Surface[] = [
  { name: "club profile", mark: "club-configuration", path: "/admin/configuration", route: "/admin/configuration",
    page: <AdminConfigurationView configurationChanged={() => undefined} />, edit: () => typeInto("club-name", "!") },
  { name: "deadlines", mark: "deadlines", path: "/admin/deadlines", route: "/admin/deadlines",
    page: <AdminDeadlinesView configurationChanged={() => undefined} />, edit: () => typeInto("booking-reminder-hours", "0") },
  { name: "booking rules", mark: "booking-rules", path: "/admin/rule-sets", route: "/admin/rule-sets",
    page: <AdminRuleSetsView configurationChanged={() => undefined} />,
    edit: async () => {
      const parameter = await screen.findByTestId("rule-ADVANCE_WINDOW-maxDays");
      await waitFor(() => expect(parameter).toBeEnabled());
      fireEvent.change(parameter, { target: { value: "9" } });
    } },
  { name: "opening hours", mark: "opening-hours", path: "/admin/facility/opening-hours", route: "/admin/facility/opening-hours",
    page: <AdminOpeningHoursView />, edit: async () => userEvent.click(await screen.findByTestId("hours-closed-MONDAY")) },
  { name: "courts", mark: "courts", path: "/admin/facility/courts", route: "/admin/facility/courts",
    page: <AdminCourtsView />, edit: () => typeInto("edit-court-name-court-1", "!") },
  { name: "booking card", mark: "booking-card", path: "/admin/facility/booking-cards/card-1", route: "/admin/facility/booking-cards/:cardId",
    page: <AdminBookingCardView />, edit: () => typeInto("card-label", "!") },
  { name: "slot fillers", mark: "slot-fillers", path: "/admin/facility/slot-fillers", route: "/admin/facility/slot-fillers",
    page: <AdminSlotFillersView />, edit: () => typeInto("edit-participant-card-label-filler-1", "!") },
  { name: "membership types", mark: "membership-types", path: "/admin/membership-types", route: "/admin/membership-types",
    page: <AdminMembershipTypesView />, edit: () => typeInto("membership-type-name-type-1", "!") },
  { name: "person", mark: "person", path: "/admin/roster/person-1", route: "/admin/roster/:personId",
    page: <AdminPersonView />, edit: () => typeInto("person-first-name", "!") },
  { name: "import source", mark: "import-source:source-1", path: "/admin/import", route: "/admin/import",
    page: <AdminImportView />,
    edit: async () => {
      await userEvent.click(await screen.findByTestId("source-choice-source-1"));
      await typeInto("source-name", "!");
    } }
];

function Shell() {
  return <>
    <UnsavedChangesGuard />
    <Link data-testid="leave" to="/elsewhere">leave</Link>
    <Outlet />
  </>;
}

function open(surface: Surface) {
  const router = createMemoryRouter([{
    element: <WithClubConfiguration><UnsavedChangesProvider><Shell /></UnsavedChangesProvider></WithClubConfiguration>,
    children: [
      { path: surface.route, element: surface.page },
      { path: "/elsewhere", element: <p data-testid="elsewhere">elsewhere</p> }
    ]
  }], { initialEntries: [surface.path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("leaving an administrative page with unsaved work", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminConfig").mockResolvedValue(config);
    vi.spyOn(api, "ruleSets").mockResolvedValue([{ id: "rule-set", name: "Standard", active: true }]);
    vi.spyOn(api, "ruleTypes").mockResolvedValue([
      { ruleType: "ADVANCE_WINDOW", configurable: true, parameters: [{ name: "maxDays", minimum: 1, maximum: 365 }] }
    ]);
    vi.spyOn(api, "rules").mockResolvedValue([{ ruleType: "ADVANCE_WINDOW", params: { maxDays: 7 } }]);
    vi.spyOn(api, "membershipTypes").mockResolvedValue([adults]);
    vi.spyOn(api, "roster").mockResolvedValue({ entries: [], nextCursor: null, matching: 0 });
    vi.spyOn(api, "adminOpeningHours").mockResolvedValue([{ dayOfWeek: "MONDAY", opensAt: "08:00:00", closesAt: "22:00:00" }]);
    vi.spyOn(api, "adminCourts").mockResolvedValue([{ id: "court-1", number: 1, name: "Centre Court", active: true }]);
    vi.spyOn(api, "adminBookingCards").mockResolvedValue([{
      id: "card-1", label: "Member booking", color: "#b85c38", allowedRoles: ["MEMBER"], managingRoles: [],
      allowedPlayerCounts: [2], tracksPlayers: true, countsAgainstLimits: true, guestAllowed: false,
      showGenericOccupancy: false, active: true
    }]);
    vi.spyOn(api, "adminParticipantCards").mockResolvedValue([{ id: "filler-1", label: "Ball machine", capacity: 1, active: true }]);
    vi.spyOn(api, "person").mockResolvedValue(jane);
    vi.spyOn(api, "messages").mockResolvedValue({ entries: [], nextCursor: null });
    vi.spyOn(api, "importSources").mockResolvedValue([source]);
    vi.spyOn(api, "supportedEncodings").mockResolvedValue(["UTF-8"]);
    vi.spyOn(api, "externalReferences").mockResolvedValue({ references: [], nextCursor: null });
  });

  it.each(surfaces)("given an edit on the $name page, when another page is opened, then the page asks first", async (surface) => {
    // given
    const router = open(surface);
    await surface.edit();
    expect(screen.getByTestId("save-bar"), `the ${surface.name} page marks its work`).toBeVisible();

    // when
    await userEvent.click(screen.getByTestId("leave"));

    // then
    expect(await screen.findByTestId("unsaved-changes"), `leaving the ${surface.name} page asks`).toBeVisible();
    expect(router.state.location.pathname).toBe(surface.path);
  });

  it.each(surfaces)("given an edit on the $name page, when the browser is asked to leave, then the ask is held", async (surface) => {
    // given
    open(surface);
    await surface.edit();
    await screen.findByTestId("save-bar");

    // when
    const asked = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(asked);

    // then
    expect(asked.defaultPrevented, `reloading the ${surface.name} page asks`).toBe(true);
  });

  it.each(surfaces)("given an edit on the $name page is discarded, when another page is opened, then nothing asks", async (surface) => {
    // given
    const router = open(surface);
    await surface.edit();
    await userEvent.click(screen.getByTestId(`discard-${surface.mark}`));

    // when
    await userEvent.click(screen.getByTestId("leave"));

    // then
    expect(await screen.findByTestId("elsewhere")).toBeVisible();
    expect(router.state.location.pathname).toBe("/elsewhere");
  });
});
