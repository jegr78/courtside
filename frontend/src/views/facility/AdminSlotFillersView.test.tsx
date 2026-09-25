import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "../../api/client";
import i18n from "../../i18n";
import { UnsavedChangesProvider } from "../../unsaved/UnsavedChangesProvider";
import { UnsavedCount } from "../../test/UnsavedCount";
import { AdminSlotFillersView } from "./AdminSlotFillersView";

function show(counted = false) {
  render(<MemoryRouter><UnsavedChangesProvider>
    {counted && <UnsavedCount />}
    <AdminSlotFillersView />
  </UnsavedChangesProvider></MemoryRouter>);
}

describe("AdminSlotFillersView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminParticipantCards").mockResolvedValue([
      { id: "filler-1", label: "Ball machine", capacity: 1, active: true }
    ]);
  });

  it("given the club's slot fillers, when the view loads, then each is listed with how many it owns", async () => {
    // when
    show();

    // then
    expect(await screen.findByTestId("edit-participant-card-label-filler-1")).toHaveValue("Ball machine");
    expect(screen.getByTestId("edit-participant-card-capacity-filler-1")).toHaveValue(1);
    expect(screen.getByTestId("participant-card-row-filler-1")).toHaveTextContent("Active");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByTestId("save-slot-fillers"), "a clean list has nothing to save").not.toBeInTheDocument();
  });

  it("given two edited fillers, when the page is saved once, then each is written", async () => {
    // given
    vi.spyOn(api, "adminParticipantCards").mockResolvedValue([
      { id: "filler-1", label: "Ball machine", capacity: 1, active: true },
      { id: "filler-2", label: "Partner wanted", capacity: null, active: true }
    ]);
    const changing = vi.spyOn(api, "changeParticipantCard").mockImplementation((id, request) =>
      Promise.resolve({ id, label: request.label, capacity: request.capacity ?? null, active: true }));
    show(true);
    await userEvent.type(await screen.findByTestId("edit-participant-card-label-filler-1"), "!");
    await userEvent.type(screen.getByTestId("edit-participant-card-capacity-filler-2"), "3");
    await waitFor(() => expect(screen.getByTestId("unsaved-count"), "one page save is one change to lose").toHaveTextContent("1"));

    // when
    await userEvent.click(screen.getByTestId("save-slot-fillers"));

    // then
    expect(await screen.findByTestId("admin-save-success")).toBeVisible();
    expect(changing).toHaveBeenCalledWith("filler-1", { label: "Ball machine!", capacity: 1 });
    expect(changing).toHaveBeenCalledWith("filler-2", { label: "Partner wanted", capacity: 3 });
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given an edited label, when the edit is discarded, then the stored value returns", async () => {
    // given
    show(true);
    const label = await screen.findByTestId("edit-participant-card-label-filler-1");
    await userEvent.type(label, " changed");

    // when
    await userEvent.click(screen.getByTestId("discard-slot-fillers"));

    // then
    expect(label).toHaveValue("Ball machine");
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given a blank label or a fractional count, when the page is saved, then nothing is written and the field is marked", async () => {
    // given
    const changing = vi.spyOn(api, "changeParticipantCard");
    show();
    const label = await screen.findByTestId("edit-participant-card-label-filler-1");
    const capacity = screen.getByTestId("edit-participant-card-capacity-filler-1");
    await userEvent.clear(label);
    await userEvent.type(label, "   ");

    // when
    await userEvent.click(screen.getByTestId("save-slot-fillers"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("Correct the marked slot filler before saving.");
    expect(label).toHaveAttribute("aria-invalid", "true");
    expect(capacity).not.toHaveAttribute("aria-invalid");

    // when
    await userEvent.type(label, "Ball machine");
    await userEvent.clear(capacity);
    await userEvent.type(capacity, "1.5");
    await userEvent.click(screen.getByTestId("save-slot-fillers"));

    // then
    expect(capacity).toHaveAttribute("aria-invalid", "true");
    expect(label).not.toHaveAttribute("aria-invalid");
    expect(changing).not.toHaveBeenCalled();
  });

  it("given a first filler the instance refuses, when the page is saved, then the fillers after it are not sent and it is named", async () => {
    // given
    vi.spyOn(api, "adminParticipantCards").mockResolvedValue([
      { id: "filler-1", label: "Ball machine", capacity: 1, active: true },
      { id: "filler-2", label: "Partner wanted", capacity: null, active: true }
    ]);
    const changing = vi.spyOn(api, "changeParticipantCard").mockRejectedValue(new Error("unavailable"));
    show();
    await userEvent.type(await screen.findByTestId("edit-participant-card-label-filler-1"), "!");
    await userEvent.type(screen.getByTestId("edit-participant-card-label-filler-2"), "?");

    // when
    await userEvent.click(screen.getByTestId("save-slot-fillers"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("Ball machine was not saved.");
    expect(changing, "nothing is sent after the first refusal").toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("edit-participant-card-label-filler-2")).toHaveValue("Partner wanted?");
  });

  // The page's one primary action opens it, so a board never scrolls past the list to add a filler.
  it("when the view loads, then creating a filler comes before the fillers it would join", async () => {
    // when
    show();

    // then
    const create = await screen.findByTestId("create-participant-card");
    const first = screen.getByTestId("edit-participant-card-label-filler-1");
    expect(create.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("given the create form is filled in, when it is read, then it holds work", async () => {
    // given
    show(true);

    // when
    await userEvent.type(await screen.findByTestId("new-participant-card-label"), "Ball machine");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));
  });

  it("given a club that bought a second ball machine, when the count is corrected, then it is written", async () => {
    // given
    const changing = vi.spyOn(api, "changeParticipantCard")
      .mockResolvedValue({ id: "filler-1", label: "Ball machine", capacity: 2, active: true });
    show();
    const capacity = await screen.findByTestId("edit-participant-card-capacity-filler-1");

    // when
    await userEvent.clear(capacity);
    await userEvent.type(capacity, "2{Enter}");

    // then
    await waitFor(() => expect(changing).toHaveBeenCalledWith("filler-1", { label: "Ball machine", capacity: 2 }));
  });

  it("given a card the club owns any number of, when the count is cleared, then it is sent as unlimited", async () => {
    // given
    const changing = vi.spyOn(api, "changeParticipantCard")
      .mockResolvedValue({ id: "filler-1", label: "Looking for a partner", capacity: null, active: true });
    show();

    // when
    await userEvent.clear(await screen.findByTestId("edit-participant-card-capacity-filler-1"));
    await userEvent.click(screen.getByTestId("save-slot-fillers"));

    // then — absent means unlimited, and an empty field is how a board says that
    await waitFor(() => expect(changing).toHaveBeenCalledWith("filler-1", { label: "Ball machine", capacity: null }));
  });

  it("when a slot filler is added, then it is created and joins the list", async () => {
    // given
    const creating = vi.spyOn(api, "createParticipantCard")
      .mockResolvedValue({ id: "filler-2", label: "Looking for a partner", capacity: null, active: true });
    show();
    await screen.findByTestId("new-participant-card-label");

    // when
    await userEvent.type(screen.getByTestId("new-participant-card-label"), "Looking for a partner");
    await userEvent.click(screen.getByTestId("create-participant-card"));

    // then
    expect(creating).toHaveBeenCalledWith({ label: "Looking for a partner", capacity: null });
    expect(await screen.findByTestId("edit-participant-card-label-filler-2")).toHaveValue("Looking for a partner");
  });

  it("given a card taken out of service, when it is toggled, then no dialog stands in the way", async () => {
    // given
    const toggling = vi.spyOn(api, "setParticipantCardActive")
      .mockResolvedValue({ id: "filler-1", label: "Ball machine", capacity: 1, active: false });
    show();
    await screen.findByTestId("toggle-participant-card-filler-1");

    // when — clicking again restores it, so by this project's rule it is not confirmed
    await userEvent.click(screen.getByTestId("toggle-participant-card-filler-1"));

    // then
    expect(toggling).toHaveBeenCalledWith("filler-1", false);
  });

  it("given a typed label, when the filler is taken out of service, then the typing is still there", async () => {
    // given — the answer speaks for `active` and carries the label the club still has stored
    vi.spyOn(api, "setParticipantCardActive")
      .mockResolvedValueOnce({ id: "filler-1", label: "Ball machine", capacity: 1, active: false })
      .mockResolvedValueOnce({ id: "filler-1", label: "Ball machine", capacity: 1, active: true });
    show();
    await userEvent.type(await screen.findByTestId("edit-participant-card-label-filler-1"), " two");

    // when
    await userEvent.click(screen.getByTestId("toggle-participant-card-filler-1"));

    // then
    await waitFor(() => expect(screen.getByTestId("toggle-participant-card-filler-1")).toHaveTextContent("Activate"));
    expect(screen.getByTestId("edit-participant-card-label-filler-1")).toHaveValue("Ball machine two");
    expect(screen.getByTestId("unsaved-mark-slot-fillers")).toBeInTheDocument();

    // when — the way back is the same change
    await userEvent.click(screen.getByTestId("toggle-participant-card-filler-1"));

    // then
    await waitFor(() => expect(screen.getByTestId("toggle-participant-card-filler-1")).toHaveTextContent("Deactivate"));
    expect(screen.getByTestId("edit-participant-card-label-filler-1")).toHaveValue("Ball machine two");
    expect(screen.getByTestId("unsaved-mark-slot-fillers")).toBeInTheDocument();
  });

  it("given slot fillers cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "adminParticipantCards").mockRejectedValue(new Error("unavailable"));

    // when
    show();

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});
