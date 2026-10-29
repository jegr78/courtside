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

const northGate: AccessPoint = { id: "gate-1", name: "North gate", courtIds: ["court-1"], staticCode: "123456", active: true };

function show() {
  render(<MemoryRouter><UnsavedChangesProvider>
    <UnsavedCount />
    <AdminAccessPointsView />
  </UnsavedChangesProvider></MemoryRouter>);
}

describe("AdminAccessPointsView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminCourts").mockResolvedValue(courts);
    vi.spyOn(api, "adminConfig").mockResolvedValue({ accessCodeLength: 6 } as AdminClubConfig);
    vi.spyOn(api, "adminAccessPoints").mockResolvedValue([northGate]);
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
    const created = { id: "gate-2", name: "South gate", courtIds: ["court-1", "court-2"], staticCode: "654321", active: true };
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
      { name: "South gate", courtIds: ["court-1", "court-2"], staticCode: "654321" }));
    expect(await screen.findByTestId("access-point-gate-2")).toBeInTheDocument();
    expect(screen.getByTestId("new-access-point-name")).toHaveValue("");
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
      { name: "Main gate", courtIds: ["court-2"], staticCode: null }));
    expect(await screen.findByTestId("access-point-code-gate-1")).toHaveTextContent("No code");
  });

  it("given a stored code longer than today's length, when only the name changes, then the stored code is kept", async () => {
    // given
    vi.spyOn(api, "adminConfig").mockResolvedValue({ accessCodeLength: 4 } as AdminClubConfig);
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
