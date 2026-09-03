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
    expect(await screen.findByTestId("participant-card-label-filler-1")).toHaveValue("Ball machine");
    expect(screen.getByTestId("participant-card-capacity-filler-1")).toHaveValue(1);
  });

  // The page's one primary action opens it, so a board never scrolls past the list to add a filler.
  it("when the view loads, then creating a filler comes before the fillers it would join", async () => {
    // when
    show();

    // then
    const create = await screen.findByTestId("create-participant-card");
    const first = screen.getByTestId("participant-card-label-filler-1");
    expect(create.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("given an edited filler, when it is counted, then it is asked about on its own", async () => {
    // given
    show(true);
    await screen.findByTestId("participant-card-label-filler-1");

    // when
    await userEvent.type(screen.getByTestId("participant-card-label-filler-1"), "!");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));
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
    await screen.findByTestId("participant-card-capacity-filler-1");

    // when
    await userEvent.clear(screen.getByTestId("participant-card-capacity-filler-1"));
    await userEvent.type(screen.getByTestId("participant-card-capacity-filler-1"), "2");
    await userEvent.click(screen.getByTestId("save-participant-card-filler-1"));

    // then
    expect(changing).toHaveBeenCalledWith("filler-1", { label: "Ball machine", capacity: 2 });
  });

  it("given a card the club owns any number of, when the count is cleared, then it is sent as unlimited", async () => {
    // given
    const changing = vi.spyOn(api, "changeParticipantCard")
      .mockResolvedValue({ id: "filler-1", label: "Looking for a partner", capacity: null, active: true });
    show();
    await screen.findByTestId("participant-card-capacity-filler-1");

    // when
    await userEvent.clear(screen.getByTestId("participant-card-capacity-filler-1"));
    await userEvent.click(screen.getByTestId("save-participant-card-filler-1"));

    // then — absent means unlimited, and an empty field is how a board says that
    expect(changing).toHaveBeenCalledWith("filler-1", { label: "Ball machine", capacity: null });
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
    expect(await screen.findByTestId("participant-card-label-filler-2")).toBeInTheDocument();
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
      .mockResolvedValue({ id: "filler-1", label: "Ball machine", capacity: 1, active: false });
    show();
    await screen.findByTestId("participant-card-label-filler-1");
    await userEvent.type(screen.getByTestId("participant-card-label-filler-1"), " two");

    // when
    await userEvent.click(screen.getByTestId("toggle-participant-card-filler-1"));

    // then
    await waitFor(() => expect(screen.getByTestId("toggle-participant-card-filler-1")).toHaveTextContent("Activate"));
    expect(screen.getByTestId("participant-card-label-filler-1")).toHaveValue("Ball machine two");
    expect(screen.getByTestId("unsaved-mark-participant-card:filler-1")).toBeInTheDocument();
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
