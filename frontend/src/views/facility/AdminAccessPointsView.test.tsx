import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, api, type AccessPoint, type AdminClubConfig } from "../../api/client";
import i18n from "../../i18n";
import { UnsavedCount } from "../../test/UnsavedCount";
import { UnsavedChangesProvider } from "../../unsaved/UnsavedChangesProvider";
import { AdminAccessPointsView } from "./AdminAccessPointsView";

const courts = [
  { id: "court-1", number: 1, name: "Centre Court", active: true },
  { id: "court-2", number: 2, name: null, active: true }
];

const stored: AdminClubConfig = {
  clubName: "Example Tennis Club",
  shortName: "Example",
  primaryColor: "#b85c38",
  accentColor: "#d7e24b",
  logoUrl: "/icon.svg",
  logoFallbackUrl: "/icon.svg",
  imprintUrl: "/imprint",
  privacyUrl: "/privacy",
  defaultLocale: "en",
  supportedLocales: ["de", "en"],
  slotMinutes: 30,
  timeZone: "Europe/Berlin",
  newAccountCredentialHours: 168,
  passwordResetCredentialHours: 24,
  passwordResetTokenMinutes: 60,
  bookingReminderHours: 24, waitlistOfferMinutes: 15, accessLeadMinutes: 15, accessLagMinutes: 15, accessCodeLength: 6,
  noMembershipTypeRuleSetId: "rule-set",
  logoUploaded: false
};

const northGate: AccessPoint = { id: "gate-1", name: "North gate", courtIds: ["court-1"], staticCode: "123456", emergencyCode: null, openToMembers: false, loxoneGroup: null, active: true };

function show(configurationChanged = () => undefined) {
  render(<MemoryRouter><UnsavedChangesProvider>
    <UnsavedCount />
    <AdminAccessPointsView configurationChanged={configurationChanged} />
  </UnsavedChangesProvider></MemoryRouter>);
}

describe("AdminAccessPointsView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminCourts").mockResolvedValue(courts);
    vi.spyOn(api, "adminConfig").mockResolvedValue(stored);
    vi.spyOn(api, "adminAccessPoints").mockResolvedValue([northGate]);
    vi.spyOn(api, "occupancyKeyStatus").mockResolvedValue({ configured: false });
    vi.spyOn(api, "adminAccessControlGroups").mockResolvedValue({ listsGroups: false, groups: [], readAt: null });
  });

  it("given a stored access point, when the view loads, then it shows its name, its courts and its code", async () => {
    // when
    show();

    // then
    expect(await screen.findByTestId("access-point-name-gate-1")).toHaveTextContent("North gate");
    expect(screen.getByTestId("access-point-courts-gate-1")).toHaveTextContent("Court 1 · Centre Court");
    expect(screen.getByTestId("access-point-code-gate-1")).toHaveTextContent("123456");
    expect(screen.getByTestId("access-point-status-gate-1")).toHaveTextContent("Active");
  });

  it("given the create form, when the board names a gate with two courts and a code, then the request carries all of it", async () => {
    // given
    const created = { id: "gate-2", name: "South gate", courtIds: ["court-1", "court-2"], staticCode: "654321", emergencyCode: null, openToMembers: false, loxoneGroup: null, active: true };
    const create = vi.spyOn(api, "createAdminAccessPoint").mockResolvedValue(created);
    show();
    await screen.findByTestId("new-access-point-form");

    // when
    await userEvent.type(screen.getByTestId("new-access-point-name"), "South gate");
    await userEvent.click(screen.getByTestId("new-access-point-court-court-1"));
    await userEvent.click(screen.getByTestId("new-access-point-court-court-2"));
    await userEvent.type(screen.getByTestId("new-access-point-code"), "654321");
    await userEvent.click(screen.getByTestId("create-access-point"));

    // then
    await waitFor(() => expect(create).toHaveBeenCalledWith(
      { name: "South gate", courtIds: ["court-1", "court-2"], staticCode: "654321", emergencyCode: null, openToMembers: false, loxoneGroup: null }));
    expect(await screen.findByTestId("access-point-gate-2")).toBeInTheDocument();
    expect(screen.getByTestId("new-access-point-name")).toHaveValue("");
  });

  it("given the create form, when the board keeps an emergency code for a gate without a code, then the request and the summary carry it", async () => {
    // given
    const created = { id: "gate-3", name: "West gate", courtIds: ["court-1"], staticCode: null, emergencyCode: "975310", openToMembers: false, loxoneGroup: null, active: true };
    const create = vi.spyOn(api, "createAdminAccessPoint").mockResolvedValue(created);
    show();
    await screen.findByTestId("new-access-point-form");

    // when
    await userEvent.type(screen.getByTestId("new-access-point-name"), "West gate");
    await userEvent.click(screen.getByTestId("new-access-point-court-court-1"));
    await userEvent.type(screen.getByTestId("new-access-point-emergency"), "975310");
    await userEvent.click(screen.getByTestId("create-access-point"));

    // then
    await waitFor(() => expect(create).toHaveBeenCalledWith(
      { name: "West gate", courtIds: ["court-1"], staticCode: null, emergencyCode: "975310", openToMembers: false, loxoneGroup: null }));
    expect(await screen.findByTestId("access-point-emergency-code-gate-3")).toHaveTextContent("975310");
  });

  it("given the create form, when the board opens a door with a code to every member, then the request and the summary carry the mark", async () => {
    // given
    const created = { id: "door-1", name: "Clubhouse door", courtIds: [], staticCode: "135790", emergencyCode: null, openToMembers: true, loxoneGroup: null, active: true };
    const create = vi.spyOn(api, "createAdminAccessPoint").mockResolvedValue(created);
    show();
    await screen.findByTestId("new-access-point-form");

    // when
    await userEvent.type(screen.getByTestId("new-access-point-name"), "Clubhouse door");
    await userEvent.type(screen.getByTestId("new-access-point-code"), "135790");
    await userEvent.click(screen.getByTestId("new-access-point-open-to-members"));
    await userEvent.click(screen.getByTestId("create-access-point"));

    // then
    await waitFor(() => expect(create).toHaveBeenCalledWith(
      { name: "Clubhouse door", courtIds: [], staticCode: "135790", emergencyCode: null, openToMembers: true, loxoneGroup: null }));
    expect(await screen.findByTestId("access-point-open-to-members-door-1")).toHaveTextContent("every member");
    expect(screen.queryByTestId("access-point-open-to-members-gate-1"), "a gate kept to bookings says nothing").not.toBeInTheDocument();
  });

  it("given a code of the wrong length, when creating, then the form refuses it without asking the server", async () => {
    // given
    const create = vi.spyOn(api, "createAdminAccessPoint");
    show();
    await screen.findByTestId("new-access-point-form");

    // when
    await userEvent.type(screen.getByTestId("new-access-point-name"), "South gate");
    await userEvent.type(screen.getByTestId("new-access-point-code"), "1234");
    await userEvent.click(screen.getByTestId("create-access-point"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("exactly 6 digits");
    expect(create).not.toHaveBeenCalled();
  });

  it("given a stored access point, when the board removes its code and a court, then the change replaces both", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminAccessPoint")
      .mockResolvedValue({ ...northGate, name: "Main gate", courtIds: ["court-2"], staticCode: null });
    show();
    await userEvent.click(await screen.findByTestId("edit-access-point-gate-1"));

    // when
    const name = screen.getByTestId("access-point-gate-1-name");
    await userEvent.clear(name);
    await userEvent.type(name, "Main gate");
    await userEvent.click(screen.getByTestId("access-point-gate-1-court-court-1"));
    await userEvent.click(screen.getByTestId("access-point-gate-1-court-court-2"));
    await userEvent.clear(screen.getByTestId("access-point-gate-1-code"));
    await userEvent.click(screen.getByTestId("save-access-point-gate-1"));

    // then
    await waitFor(() => expect(change).toHaveBeenCalledWith("gate-1",
      { name: "Main gate", courtIds: ["court-2"], staticCode: null, emergencyCode: null, openToMembers: false, loxoneGroup: null }));
    expect(await screen.findByTestId("access-point-code-gate-1")).toHaveTextContent("No code");
  });

  it("given a stored code longer than today's length, when only the name changes, then the stored code is kept", async () => {
    // given
    vi.spyOn(api, "adminConfig").mockResolvedValue({ ...stored, accessCodeLength: 4 });
    const change = vi.spyOn(api, "changeAdminAccessPoint").mockResolvedValue({ ...northGate, name: "Main gate" });
    show();
    await userEvent.click(await screen.findByTestId("edit-access-point-gate-1"));

    // when
    await userEvent.clear(screen.getByTestId("access-point-gate-1-name"));
    await userEvent.type(screen.getByTestId("access-point-gate-1-name"), "Main gate");
    await userEvent.click(screen.getByTestId("save-access-point-gate-1"));

    // then
    await waitFor(() => expect(change).toHaveBeenCalledWith("gate-1", expect.objectContaining({ staticCode: "123456" })));
  });

  it("given an active access point, when the board deactivates it, then its status follows the answer", async () => {
    // given
    vi.spyOn(api, "setAdminAccessPointActive").mockResolvedValue({ ...northGate, active: false });
    show();

    // when
    await userEvent.click(await screen.findByTestId("toggle-access-point-gate-1"));

    // then
    await waitFor(() => expect(screen.getByTestId("access-point-status-gate-1")).toHaveTextContent("Deactivated"));
  });

  it("given a refused name, when the server answers with a conflict, then the board reads why", async () => {
    // given
    vi.spyOn(api, "createAdminAccessPoint").mockRejectedValue(new ApiError(409, {
      type: "urn:courtside:error:access-point-name-taken", title: "Access point name taken", status: 409
    }));
    show();
    await screen.findByTestId("new-access-point-form");

    // when
    await userEvent.type(screen.getByTestId("new-access-point-name"), "North gate");
    await userEvent.click(screen.getByTestId("create-access-point"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("Another access point already carries that name.");
  });
});

describe("AdminAccessPointsView access settings", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminCourts").mockResolvedValue(courts);
    vi.spyOn(api, "adminConfig").mockResolvedValue(stored);
    vi.spyOn(api, "adminAccessPoints").mockResolvedValue([northGate]);
    vi.spyOn(api, "occupancyKeyStatus").mockResolvedValue({ configured: false });
    vi.spyOn(api, "adminAccessControlGroups").mockResolvedValue({ listsGroups: false, groups: [], readAt: null });
  });

  it("given stored access settings, when the view loads, then each is shown with its limits", async () => {
    // when
    show();

    // then
    const lead = await screen.findByTestId("access-lead-minutes");
    expect(lead).toHaveValue(15);
    expect(lead).toHaveAttribute("max", "240");
    expect(screen.getByTestId("access-lag-minutes")).toHaveValue(15);
    expect(screen.getByTestId("access-code-length")).toHaveValue(6);
    expect(screen.getByTestId("access-code-length")).toHaveAttribute("min", "4");
    expect(screen.getByTestId("access-code-length")).toHaveAttribute("max", "8");
    expect(screen.queryByTestId("save-access-settings"), "untouched settings offer no save").not.toBeInTheDocument();
  });

  it("given the board changes all three, when saving, then the request carries them and every other setting as stored", async () => {
    // given
    const changing = vi.spyOn(api, "changeAdminConfig")
      .mockResolvedValue({ ...stored, accessLeadMinutes: 30, accessLagMinutes: 0, accessCodeLength: 4 });
    const configurationChanged = vi.fn();
    show(configurationChanged);
    const lead = await screen.findByTestId("access-lead-minutes");

    // when
    await userEvent.clear(lead);
    await userEvent.type(lead, "30");
    await userEvent.clear(screen.getByTestId("access-lag-minutes"));
    await userEvent.type(screen.getByTestId("access-lag-minutes"), "0");
    await userEvent.clear(screen.getByTestId("access-code-length"));
    await userEvent.type(screen.getByTestId("access-code-length"), "4");
    await userEvent.click(screen.getByTestId("save-access-settings"));

    // then
    expect(await screen.findByTestId("admin-save-success")).toHaveTextContent("The change was saved.");
    expect(changing).toHaveBeenCalledWith({
      clubName: "Example Tennis Club", shortName: "Example", primaryColor: "#b85c38", accentColor: "#d7e24b",
      logoUrl: "/icon.svg", imprintUrl: "/imprint", privacyUrl: "/privacy", documentationUrl: undefined,
      defaultLocale: "en", slotMinutes: 30, timeZone: "Europe/Berlin",
      newAccountCredentialHours: 168, passwordResetCredentialHours: 24, passwordResetTokenMinutes: 60,
      bookingReminderHours: 24, waitlistOfferMinutes: 15, accessLeadMinutes: 30, accessLagMinutes: 0, accessCodeLength: 4,
      noMembershipTypeRuleSetId: "rule-set"
    });
    expect(configurationChanged).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given another page saved a deadline after this one loaded, when the access settings are saved, then the newer deadline survives", async () => {
    // given
    vi.mocked(api.adminConfig)
      .mockResolvedValueOnce(stored)
      .mockResolvedValue({ ...stored, bookingReminderHours: 3 });
    const changing = vi.spyOn(api, "changeAdminConfig").mockResolvedValue({ ...stored, bookingReminderHours: 3, accessLeadMinutes: 30 });
    show();
    const lead = await screen.findByTestId("access-lead-minutes");

    // when
    await userEvent.clear(lead);
    await userEvent.type(lead, "30");
    await userEvent.click(screen.getByTestId("save-access-settings"));

    // then
    await waitFor(() => expect(changing).toHaveBeenCalledTimes(1));
    expect(changing.mock.calls[0][0], "fields the page does not own are read again just before the write")
      .toMatchObject({ bookingReminderHours: 3, accessLeadMinutes: 30 });
  });

  it("given a new code length is saved, when a code is entered, then the hint and the check follow the saved length", async () => {
    // given
    vi.spyOn(api, "changeAdminConfig").mockResolvedValue({ ...stored, accessCodeLength: 4 });
    const create = vi.spyOn(api, "createAdminAccessPoint")
      .mockResolvedValue({ id: "gate-2", name: "South gate", courtIds: [], staticCode: "2468", emergencyCode: null, openToMembers: false, loxoneGroup: null, active: true });
    show();
    const length = await screen.findByTestId("access-code-length");
    await userEvent.clear(length);
    await userEvent.type(length, "4");
    expect(screen.getByTestId("new-access-point-code-hint"), "an unsaved length does not govern codes yet").toHaveTextContent("exactly 6 of them");
    await userEvent.click(screen.getByTestId("save-access-settings"));
    await screen.findByTestId("admin-save-success");

    // when
    await userEvent.type(screen.getByTestId("new-access-point-name"), "South gate");
    await userEvent.type(screen.getByTestId("new-access-point-code"), "2468");
    await userEvent.click(screen.getByTestId("create-access-point"));

    // then
    expect(screen.getByTestId("new-access-point-code-hint")).toHaveTextContent("exactly 4 of them");
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "South gate", courtIds: [], staticCode: "2468", emergencyCode: null, openToMembers: false, loxoneGroup: null }));
  });

  it("given the API rejects a code length, when saving, then its validation code is reported and the change stays unsaved", async () => {
    // given
    vi.spyOn(api, "changeAdminConfig").mockRejectedValue(new ApiError(400, {
      type: "urn:courtside:error:validation",
      title: "Validation failed",
      status: 400,
      fieldErrors: [{ field: "accessCodeLength", code: "validation.Max", params: { value: 8 } }]
    }));
    show();
    const length = await screen.findByTestId("access-code-length");
    await userEvent.clear(length);
    await userEvent.type(length, "9");

    // when
    await userEvent.click(screen.getByTestId("save-access-settings"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("8");
    expect(screen.getByTestId("unsaved-mark-access-settings"), "a refused save leaves the work unsaved").toBeVisible();
    expect(screen.getByTestId("new-access-point-code-hint")).toHaveTextContent("exactly 6 of them");
  });
});

describe("AdminAccessPointsView building automation", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminCourts").mockResolvedValue(courts);
    vi.spyOn(api, "adminConfig").mockResolvedValue(stored);
    vi.spyOn(api, "adminAccessPoints").mockResolvedValue([northGate]);
    vi.spyOn(api, "occupancyKeyStatus").mockResolvedValue({ configured: false });
    vi.spyOn(api, "adminAccessControlGroups").mockResolvedValue({ listsGroups: false, groups: [], readAt: null });
  });

  it("given no occupancy key, when the board creates one, then the key and the ready URL are shown once", async () => {
    // given
    const key = "Ab3_dE-fGhIjKlMnOpQrStUvWxYz0123456789abcde";
    const create = vi.spyOn(api, "createOccupancyKey").mockResolvedValue({ key, createdAt: "2026-05-12T10:00:00Z" });
    show();
    expect(await screen.findByTestId("occupancy-key-status")).toHaveTextContent("No key");
    expect(screen.queryByTestId("revoke-occupancy-key")).not.toBeInTheDocument();

    // when
    await userEvent.click(screen.getByTestId("create-occupancy-key"));

    // then
    expect(create).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("occupancy-key-value")).toHaveValue(key);
    expect(screen.getByTestId("occupancy-key-url")).toHaveValue(`${window.location.origin}/api/public/occupancy?key=${key}`);
    expect(screen.getByTestId("occupancy-key-status")).toHaveTextContent("May 12, 2026, 12:00 PM");
    expect(screen.getByTestId("revoke-occupancy-key")).toBeVisible();
  });

  it("given an occupancy key, when the board revokes it, then the status says none and no key is shown", async () => {
    // given
    vi.spyOn(api, "occupancyKeyStatus").mockResolvedValue({ configured: true, createdAt: "2026-05-01T08:00:00Z" });
    const revoke = vi.spyOn(api, "revokeOccupancyKey").mockResolvedValue(undefined);
    show();
    expect(await screen.findByTestId("occupancy-key-status")).toHaveTextContent("May 1, 2026, 10:00 AM");
    expect(screen.queryByTestId("occupancy-key-value")).not.toBeInTheDocument();

    // when
    await userEvent.click(screen.getByTestId("revoke-occupancy-key"));

    // then
    expect(revoke).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("occupancy-key-status")).toHaveTextContent("No key"));
    expect(screen.queryByTestId("revoke-occupancy-key")).not.toBeInTheDocument();
  });
});

describe("AdminAccessPointsView Loxone group", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminCourts").mockResolvedValue(courts);
    vi.spyOn(api, "adminConfig").mockResolvedValue(stored);
    vi.spyOn(api, "adminAccessPoints").mockResolvedValue([northGate]);
    vi.spyOn(api, "occupancyKeyStatus").mockResolvedValue({ configured: false });
    vi.spyOn(api, "adminAccessControlGroups").mockResolvedValue({ listsGroups: false, groups: [], readAt: null });
  });

  it("given the groups of the access-control system, when the board picks one for a gate, then the change carries its uuid", async () => {
    // given
    vi.spyOn(api, "adminAccessControlGroups").mockResolvedValue({ listsGroups: true, groups: [
      { id: "0f1e2d3c-4b5a-6978-8796a5b4c3d2e1f0", name: "Court 1" },
      { id: "1a2b3c4d-5e6f-7081-92a3b4c5d6e7f809", name: "Court 2" }
    ], readAt: "2026-05-12T10:01:00Z" });
    const change = vi.spyOn(api, "changeAdminAccessPoint")
      .mockResolvedValue({ ...northGate, loxoneGroup: "1a2b3c4d-5e6f-7081-92a3b4c5d6e7f809" });
    show();
    await userEvent.click(await screen.findByTestId("edit-access-point-gate-1"));

    // when
    const hint = screen.queryByTestId("access-point-gate-1-loxone-group-hint");
    await userEvent.selectOptions(screen.getByTestId("access-point-gate-1-loxone-group"), "1a2b3c4d-5e6f-7081-92a3b4c5d6e7f809");
    await userEvent.click(screen.getByTestId("save-access-point-gate-1"));

    // then
    expect(hint, "a listed group needs no hint").toBeNull();
    await waitFor(() => expect(change).toHaveBeenCalledWith("gate-1",
      expect.objectContaining({ loxoneGroup: "1a2b3c4d-5e6f-7081-92a3b4c5d6e7f809" })));
  });

  it("given a stored group the list no longer holds, when the board edits the gate, then it shows as unknown and can be removed", async () => {
    // given
    vi.spyOn(api, "adminAccessPoints").mockResolvedValue([{ ...northGate, loxoneGroup: "9f8e7d6c-5b4a-3928-1706f5e4d3c2b1a0" }]);
    vi.spyOn(api, "adminAccessControlGroups").mockResolvedValue({ listsGroups: true, groups: [
      { id: "0f1e2d3c-4b5a-6978-8796a5b4c3d2e1f0", name: "Court 1" }
    ], readAt: "2026-05-12T10:01:00Z" });
    const change = vi.spyOn(api, "changeAdminAccessPoint").mockResolvedValue(northGate);
    show();
    await userEvent.click(await screen.findByTestId("edit-access-point-gate-1"));
    const select = screen.getByTestId("access-point-gate-1-loxone-group");

    // when
    const unknown = screen.getByTestId("access-point-gate-1-loxone-group-unknown");
    await userEvent.selectOptions(select, "");
    await userEvent.click(screen.getByTestId("save-access-point-gate-1"));

    // then
    expect(unknown).toHaveTextContent("Unknown group");
    await waitFor(() => expect(change).toHaveBeenCalledWith("gate-1", expect.objectContaining({ loxoneGroup: null })));
  });

  it("given no groups to list and a stored group, when the board only renames the gate, then the field is hidden and the stored group is sent unchanged", async () => {
    // given
    vi.spyOn(api, "adminAccessControlGroups").mockResolvedValue({ listsGroups: true, groups: [], readAt: null });
    vi.spyOn(api, "adminAccessPoints").mockResolvedValue([{ ...northGate, loxoneGroup: "9f8e7d6c-5b4a-3928-1706f5e4d3c2b1a0" }]);
    const change = vi.spyOn(api, "changeAdminAccessPoint").mockResolvedValue({ ...northGate, name: "Main gate" });
    show();
    await userEvent.click(await screen.findByTestId("edit-access-point-gate-1"));

    // when
    const field = screen.queryByTestId("access-point-gate-1-loxone-group");
    const hint = screen.getByTestId("access-point-gate-1-loxone-group-hint");
    await userEvent.clear(screen.getByTestId("access-point-gate-1-name"));
    await userEvent.type(screen.getByTestId("access-point-gate-1-name"), "Main gate");
    await userEvent.click(screen.getByTestId("save-access-point-gate-1"));

    // then
    expect(field, "without groups the field is hidden").toBeNull();
    expect(hint).toHaveTextContent("Access grants");
    await waitFor(() => expect(change).toHaveBeenCalledWith("gate-1",
      { name: "Main gate", courtIds: ["court-1"], staticCode: "123456", emergencyCode: null, openToMembers: false,
        loxoneGroup: "9f8e7d6c-5b4a-3928-1706f5e4d3c2b1a0" }));
  });

  it("given a system without groups and a stored group, when the board only renames the gate, then neither field nor hint shows and the stored group is sent unchanged", async () => {
    // given
    vi.spyOn(api, "adminAccessPoints").mockResolvedValue([{ ...northGate, loxoneGroup: "9f8e7d6c-5b4a-3928-1706f5e4d3c2b1a0" }]);
    const change = vi.spyOn(api, "changeAdminAccessPoint").mockResolvedValue({ ...northGate, name: "Main gate" });
    show();
    await userEvent.click(await screen.findByTestId("edit-access-point-gate-1"));

    // when
    const field = screen.queryByTestId("access-point-gate-1-loxone-group");
    const hint = screen.queryByTestId("access-point-gate-1-loxone-group-hint");
    await userEvent.clear(screen.getByTestId("access-point-gate-1-name"));
    await userEvent.type(screen.getByTestId("access-point-gate-1-name"), "Main gate");
    await userEvent.click(screen.getByTestId("save-access-point-gate-1"));

    // then
    expect(field, "a system without groups shows no field").toBeNull();
    expect(hint, "a system without groups needs no hint about them").toBeNull();
    await waitFor(() => expect(change).toHaveBeenCalledWith("gate-1",
      expect.objectContaining({ name: "Main gate", loxoneGroup: "9f8e7d6c-5b4a-3928-1706f5e4d3c2b1a0" })));
  });
});
