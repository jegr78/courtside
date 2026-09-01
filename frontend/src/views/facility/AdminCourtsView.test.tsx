import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ApiError, api } from "../../api/client";
import i18n from "../../i18n";
import { UnsavedChangesProvider } from "../../unsaved/UnsavedChangesProvider";
import { UnsavedCount } from "../../test/UnsavedCount";
import { WithClubConfiguration } from "../../test/ClubConfiguration";
import { AdminCourtsView } from "./AdminCourtsView";

function show(counted = false) {
  render(<MemoryRouter><WithClubConfiguration><UnsavedChangesProvider>
    {counted && <UnsavedCount />}
    <AdminCourtsView />
  </UnsavedChangesProvider></WithClubConfiguration></MemoryRouter>);
}

async function openName(courtId: string) {
  await userEvent.click(await screen.findByTestId(`edit-court-name-${courtId}`));
  return screen.getByTestId("court-editor");
}

describe("AdminCourtsView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminCourts").mockResolvedValue([
      { id: "court-1", number: 3, name: "Centre Court", active: true }
    ]);
  });

  it("given court data, when the view loads, then every court is one row of one list", async () => {
    // when
    show();

    // then
    const row = await screen.findByTestId("court-row-court-1");
    expect(row.tagName).toBe("TR");
    expect(screen.getByTestId("edit-court-number-court-1")).toHaveTextContent("3");
    expect(screen.getByTestId("edit-court-name-court-1")).toHaveTextContent("Centre Court");
    expect(screen.getByTestId("court-status-court-1")).toHaveTextContent("Active");
    expect(screen.getByTestId("edit-court-name-court-1")).toHaveAccessibleName(/Change the name/);
  });

  // The five forms the list replaces each carried a save of their own, and that is what #415 is.
  it("when the view loads, then no court carries a save of its own", async () => {
    // when
    show();

    // then
    await screen.findByTestId("court-row-court-1");
    expect(screen.queryAllByTestId(/^save-court-/)).toHaveLength(0);
    expect(screen.queryByTestId("court-editor")).not.toBeInTheDocument();
  });

  // The page's one primary action opens it, so a board never scrolls past the list to add a court.
  it("when the view loads, then creating a court comes before the courts it would join", async () => {
    // when
    show();

    // then
    const create = await screen.findByTestId("create-court");
    const first = screen.getByTestId("court-row-court-1");
    expect(create.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("given a court, when its name is chosen, then the cell becomes an input with confirm and dismiss beside it", async () => {
    // given
    show();

    // when
    const editor = await openName("court-1");

    // then
    expect(editor).toHaveValue("Centre Court");
    expect(screen.getByTestId("confirm-court-edit")).toBeEnabled();
    expect(screen.getByTestId("dismiss-court-edit")).toBeEnabled();
    expect(screen.queryByTestId("edit-court-name-court-1")).not.toBeInTheDocument();
  });

  it("given a court, when its number is chosen, then the editor carries the number", async () => {
    // given
    show();

    // when
    await userEvent.click(await screen.findByTestId("edit-court-number-court-1"));

    // then
    expect(screen.getByTestId("court-editor")).toHaveValue(3);
  });

  it("given an open editor, when it is dismissed, then the cell reads as it did and nothing was written", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminCourt");
    show();
    const editor = await openName("court-1");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Garden Court");

    // when
    await userEvent.click(screen.getByTestId("dismiss-court-edit"));

    // then
    expect(await screen.findByTestId("edit-court-name-court-1")).toHaveTextContent("Centre Court");
    expect(screen.queryByTestId("court-editor")).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });

  // A name is confirmed on its own, but CourtRequest requires the number, so the row supplies it.
  it("given a renamed court, when the edit is confirmed, then that one court is written with its number", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminCourt")
      .mockResolvedValue({ id: "court-1", number: 3, name: "Garden Court", active: true });
    show(true);
    const editor = await openName("court-1");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Garden Court");
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));

    // when
    await userEvent.click(screen.getByTestId("confirm-court-edit"));

    // then
    expect(change).toHaveBeenCalledExactlyOnceWith("court-1", { number: 3, name: "Garden Court" });
    expect(await screen.findByTestId("edit-court-name-court-1")).toHaveTextContent("Garden Court");
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given a changed number, when the edit is confirmed, then the name it already carries goes with it", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminCourt")
      .mockResolvedValue({ id: "court-1", number: 4, name: "Centre Court", active: true });
    show();
    await userEvent.click(await screen.findByTestId("edit-court-number-court-1"));
    fireEvent.change(screen.getByTestId("court-editor"), { target: { value: "4" } });

    // when
    await userEvent.click(screen.getByTestId("confirm-court-edit"));

    // then
    expect(change).toHaveBeenCalledExactlyOnceWith("court-1", { number: 4, name: "Centre Court" });
  });

  // A number field takes "1e3" and "3.9" without complaint, and parseInt would read them as 1 and 3.
  it.each(["", "0", "1000", "1e3", "3.9", "-2"])(
    "given %s entered as a court number, when the editor is read, then it cannot be confirmed", async (entry) => {
      // given
      show();
      await userEvent.click(await screen.findByTestId("edit-court-number-court-1"));

      // when
      fireEvent.change(screen.getByTestId("court-editor"), { target: { value: entry } });

      // then
      expect(screen.getByTestId("confirm-court-edit")).toBeDisabled();
    });

  it("given a number in range, when the editor is read, then it can be confirmed", async () => {
    // given
    show();
    await userEvent.click(await screen.findByTestId("edit-court-number-court-1"));

    // when
    fireEvent.change(screen.getByTestId("court-editor"), { target: { value: "999" } });

    // then
    expect(screen.getByTestId("confirm-court-edit")).toBeEnabled();
  });

  it("given a number another court already carries, when the edit is confirmed, then the entry is still there to correct", async () => {
    // given
    vi.spyOn(api, "changeAdminCourt").mockRejectedValue(new ApiError(409, {
      type: "urn:courtside:error:court-number-taken", status: 409,
      title: "Court number taken", detail: "This court number is already in use"
    }));
    show();
    await userEvent.click(await screen.findByTestId("edit-court-number-court-1"));
    fireEvent.change(screen.getByTestId("court-editor"), { target: { value: "2" } });

    // when
    await userEvent.click(screen.getByTestId("confirm-court-edit"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That court number is already taken.");
    expect(screen.getByTestId("court-editor")).toHaveValue(2);
  });

  it("given an open editor, when a different value is typed, then the row says it has something to lose", async () => {
    // given
    show(true);
    const editor = await openName("court-1");
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");

    // when
    await userEvent.type(editor, "!");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));
    expect(screen.getByTestId("unsaved-mark-court:court-1")).toHaveTextContent("Not saved yet");
  });

  it("given an edited name, when the old one is typed back, then nothing is left to lose", async () => {
    // given
    show(true);
    const editor = await openName("court-1");
    await userEvent.type(editor, "!");
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));

    // when
    await userEvent.clear(editor);
    await userEvent.type(editor, "Centre Court");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given an edited name, when the editor is dismissed, then nothing is left to lose", async () => {
    // given
    show(true);
    const editor = await openName("court-1");
    await userEvent.type(editor, "!");
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));

    // when
    await userEvent.click(screen.getByTestId("dismiss-court-edit"));

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  // Closing the editor takes the focused input off the page, and without this somebody on a
  // keyboard lands back at the top of the document instead of at the value they were editing.
  it("given an open editor, when it is dismissed, then the value it belonged to takes the focus back", async () => {
    // given
    show();
    await openName("court-1");

    // when
    await userEvent.click(screen.getByTestId("dismiss-court-edit"));

    // then
    expect(await screen.findByTestId("edit-court-name-court-1")).toHaveFocus();
  });

  it("given an open editor, when the edit is confirmed, then the value it belonged to takes the focus back", async () => {
    // given
    vi.spyOn(api, "changeAdminCourt")
      .mockResolvedValue({ id: "court-1", number: 3, name: "Garden Court", active: true });
    show();
    const editor = await openName("court-1");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Garden Court");

    // when
    await userEvent.click(screen.getByTestId("confirm-court-edit"));

    // then
    expect(await screen.findByTestId("edit-court-name-court-1")).toHaveFocus();
  });

  it("given an edited name, when a screen reader reaches the confirm, then the mark explains it", async () => {
    // given
    show();
    const editor = await openName("court-1");
    expect(screen.getByTestId("confirm-court-edit")).not.toHaveAttribute("aria-describedby");

    // when
    await userEvent.type(editor, "!");

    // then
    const mark = await screen.findByTestId("unsaved-mark-court:court-1");
    expect(screen.getByTestId("confirm-court-edit"))
      .toHaveAttribute("aria-describedby", mark.getAttribute("id"));
  });

  // Taking a court out of service is not a save, so it must not answer for the name being edited.
  it("given an unsaved name, when the court is deactivated, then what was entered is still there", async () => {
    // given
    vi.spyOn(api, "setAdminCourtActive")
      .mockResolvedValue({ id: "court-1", number: 3, name: "Centre Court", active: false });
    show();
    const editor = await openName("court-1");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Garden Court");

    // when
    await userEvent.click(screen.getByTestId("toggle-court-court-1"));

    // then
    expect(await screen.findByTestId("court-status-court-1")).toHaveTextContent("Deactivated");
    expect(screen.getByTestId("court-editor")).toHaveValue("Garden Court");
  });

  // The write echoes the whole court, so a second open cell would be overwritten by the answer to
  // the first. One editor at a time is what makes that impossible rather than merely unlikely.
  it("given an open editor, when another cell is chosen, then only the new one is open", async () => {
    // given
    show();
    const editor = await openName("court-1");
    await userEvent.type(editor, "!");

    // when
    await userEvent.click(screen.getByTestId("edit-court-number-court-1"));

    // then
    expect(screen.getAllByTestId("court-editor")).toHaveLength(1);
    expect(screen.getByTestId("court-editor")).toHaveValue(3);
    expect(screen.getByTestId("edit-court-name-court-1")).toHaveTextContent("Centre Court");
  });

  it("given an edited name, when Enter is pressed in the editor, then the court is written", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminCourt")
      .mockResolvedValue({ id: "court-1", number: 3, name: "Centre Court!", active: true });
    show();
    const editor = await openName("court-1");

    // when
    await userEvent.type(editor, "!{Enter}");

    // then
    expect(change).toHaveBeenCalledExactlyOnceWith("court-1", { number: 3, name: "Centre Court!" });
  });

  it("given an edited name, when Escape is pressed in the editor, then nothing is written and the cell reads as it did", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminCourt");
    show();
    const editor = await openName("court-1");

    // when
    await userEvent.type(editor, "!{Escape}");

    // then
    expect(await screen.findByTestId("edit-court-name-court-1")).toHaveTextContent("Centre Court");
    expect(change).not.toHaveBeenCalled();
  });

  it("given a court number nobody may confirm, when Enter is pressed, then nothing is written", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminCourt");
    show();
    await userEvent.click(await screen.findByTestId("edit-court-number-court-1"));
    const editor = screen.getByTestId("court-editor");

    // when
    fireEvent.change(editor, { target: { value: "1000" } });
    fireEvent.keyDown(editor, { key: "Enter" });

    // then
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByTestId("court-editor")).toBeInTheDocument();
  });

  it("given a confirmed number, when the list is read again, then the row is where it was", async () => {
    // given
    vi.spyOn(api, "adminCourts").mockResolvedValue([
      { id: "court-1", number: 3, name: "Centre Court", active: true },
      { id: "court-2", number: 4, name: "Garden Court", active: true }
    ]);
    vi.spyOn(api, "changeAdminCourt")
      .mockResolvedValue({ id: "court-1", number: 9, name: "Centre Court", active: true });
    show();
    await userEvent.click(await screen.findByTestId("edit-court-number-court-1"));
    fireEvent.change(screen.getByTestId("court-editor"), { target: { value: "9" } });

    // when
    await userEvent.click(screen.getByTestId("confirm-court-edit"));

    // then
    await waitFor(() => expect(screen.getByTestId("edit-court-number-court-1")).toHaveTextContent("9"));
    expect(screen.getAllByTestId(/^court-row-/).map((row) => row.getAttribute("data-testid")))
      .toEqual(["court-row-court-1", "court-row-court-2"]);
  });

  it("given a court nobody named, when the list is read, then the cell says so and still opens", async () => {
    // given
    vi.spyOn(api, "adminCourts").mockResolvedValue([
      { id: "court-1", number: 3, name: null, active: true }
    ]);
    show();

    // when
    const editor = await openName("court-1");

    // then
    expect(editor).toHaveValue("");
  });

  it("given a court nobody named, when a name is confirmed, then it is written", async () => {
    // given
    vi.spyOn(api, "adminCourts").mockResolvedValue([
      { id: "court-1", number: 3, name: null, active: true }
    ]);
    const change = vi.spyOn(api, "changeAdminCourt")
      .mockResolvedValue({ id: "court-1", number: 3, name: "Garden Court", active: true });
    show();
    const editor = await openName("court-1");

    // when
    await userEvent.type(editor, "Garden Court{Enter}");

    // then
    expect(change).toHaveBeenCalledExactlyOnceWith("court-1", { number: 3, name: "Garden Court" });
  });

  it("given a name cleared away, when the edit is confirmed, then the court is left without one", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminCourt")
      .mockResolvedValue({ id: "court-1", number: 3, name: null, active: true });
    show();
    const editor = await openName("court-1");

    // when
    await userEvent.clear(editor);
    await userEvent.click(screen.getByTestId("confirm-court-edit"));

    // then
    expect(change).toHaveBeenCalledExactlyOnceWith("court-1", { number: 3, name: undefined });
  });

  it("given a filled create form, when the court is created, then it joins the list and nothing is left to lose", async () => {
    // given
    const createCourt = vi.spyOn(api, "createAdminCourt")
      .mockResolvedValue({ id: "court-2", number: 2, name: "Garden Court", active: true });
    show(true);
    await userEvent.type(await screen.findByTestId("new-court-number"), "2");
    await userEvent.type(screen.getByTestId("new-court-name"), "Garden Court");
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));

    // when
    await userEvent.click(screen.getByTestId("create-court"));

    // then
    expect(createCourt).toHaveBeenCalledWith({ number: 2, name: "Garden Court" });
    expect(await screen.findByTestId("court-row-court-2")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  // The write behind the toggle answers with the whole court, and a record another board member
  // has since changed would otherwise land in the row nobody asked it to.
  it("given a court changed elsewhere, when it is deactivated here, then only its state follows the answer", async () => {
    // given
    vi.spyOn(api, "setAdminCourtActive")
      .mockResolvedValue({ id: "court-1", number: 7, name: "Somewhere else", active: false });
    show();
    await screen.findByTestId("court-row-court-1");

    // when
    await userEvent.click(screen.getByTestId("toggle-court-court-1"));

    // then
    expect(await screen.findByTestId("court-status-court-1")).toHaveTextContent("Deactivated");
    expect(screen.getByTestId("edit-court-name-court-1")).toHaveTextContent("Centre Court");
    expect(screen.getByTestId("edit-court-number-court-1")).toHaveTextContent("3");
  });

  it("given an active court, when toggling it twice, then it disappears and can be restored", async () => {
    // given
    const setCourtActive = vi.spyOn(api, "setAdminCourtActive")
      .mockResolvedValueOnce({ id: "court-1", number: 3, name: "Centre Court", active: false })
      .mockResolvedValueOnce({ id: "court-1", number: 3, name: "Centre Court", active: true });
    show();
    const user = userEvent.setup();

    // when
    await user.click(await screen.findByTestId("toggle-court-court-1"));
    await user.click(screen.getByTestId("toggle-court-court-1"));

    // then
    expect(setCourtActive).toHaveBeenNthCalledWith(1, "court-1", false);
    expect(setCourtActive).toHaveBeenNthCalledWith(2, "court-1", true);
  });

  it("given a court mutation is pending, when interacting again, then the stale state cannot be submitted", async () => {
    // given
    const response = deferred<Awaited<ReturnType<typeof api.setAdminCourtActive>>>();
    const setCourtActive = vi.spyOn(api, "setAdminCourtActive").mockReturnValue(response.promise);
    show();
    const user = userEvent.setup();
    const toggle = await screen.findByTestId("toggle-court-court-1");

    // when
    await user.click(toggle);

    // then
    expect(toggle).toBeDisabled();
    expect(screen.getByTestId("edit-court-name-court-1")).toBeDisabled();
    expect(screen.getByTestId("edit-court-number-court-1")).toBeDisabled();
    await user.click(toggle);
    expect(setCourtActive).toHaveBeenCalledTimes(1);

    // when
    response.resolve({ id: "court-1", number: 3, name: "Centre Court", active: false });

    // then
    expect(await screen.findByTestId("toggle-court-court-1")).toBeEnabled();
  });

  it("given a confirmed edit is pending, when it is confirmed again, then the court is written once", async () => {
    // given
    const response = deferred<Awaited<ReturnType<typeof api.changeAdminCourt>>>();
    const change = vi.spyOn(api, "changeAdminCourt").mockReturnValue(response.promise);
    show();
    const user = userEvent.setup();
    const editor = await openName("court-1");
    await user.type(editor, "!");

    // when
    await user.click(screen.getByTestId("confirm-court-edit"));

    // then
    expect(screen.getByTestId("confirm-court-edit")).toBeDisabled();
    expect(screen.getByTestId("court-editor")).toBeDisabled();
    await user.click(screen.getByTestId("confirm-court-edit"));
    expect(change).toHaveBeenCalledTimes(1);

    // when
    response.resolve({ id: "court-1", number: 3, name: "Centre Court!", active: true });

    // then
    expect(await screen.findByTestId("edit-court-name-court-1")).toHaveTextContent("Centre Court!");
  });

  it("given court data cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "adminCourts").mockRejectedValue(new Error("unavailable"));

    // when
    show();

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("when impact is available, then it is offered as a disclosure", async () => {
    // when
    show();

    // then
    const control = await screen.findByTestId("court-impact-court-1");
    expect(control.tagName).toBe("SUMMARY");
    expect(control.closest("details")).toBeInTheDocument();
    expect(control.closest("tr")).toBe(screen.getByTestId("court-row-court-1"));
  });

  it("given the court changed since the impact was read, when the disclosure is opened again, then it is asked again", async () => {
    // given
    const ask = vi.spyOn(api, "courtImpact")
      .mockResolvedValue({ affectedCount: 2, truncated: false, bookings: [] });
    show();
    const control = await screen.findByTestId("court-impact-court-1");
    await userEvent.click(control);
    await screen.findByTestId("impact-court-1");

    // when
    await userEvent.click(control);
    await userEvent.click(control);

    // then
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it("given a court in use, when its impact is asked for, then the bookings it would displace are named", async () => {
    // given
    vi.spyOn(api, "courtImpact").mockResolvedValue({
      affectedCount: 2, truncated: false, nextCursor: null,
      bookings: [
        { bookingId: "booking-1", courtIds: ["court-1"], startsAt: "2026-09-01T08:00:00Z", endsAt: "2026-09-01T09:00:00Z" },
        { bookingId: "booking-2", courtIds: ["court-1"], startsAt: "2026-09-02T10:00:00Z", endsAt: "2026-09-02T11:00:00Z" }
      ]
    });
    show();

    // when
    await userEvent.click(await screen.findByTestId("court-impact-court-1"));

    // then
    const impact = await screen.findByTestId("impact-court-1");
    expect(impact).toHaveTextContent("2");
    expect(screen.getAllByTestId(/^impact-booking-/)).toHaveLength(2);
    expect(screen.getByTestId("impact-booking-booking-1"))
      .toHaveTextContent("Sep 1, 2026, 8:00 PM – 9:00 PM");
  });

  it("given a court nothing is booked on, when its impact is asked for, then it says so plainly", async () => {
    // given
    vi.spyOn(api, "courtImpact")
      .mockResolvedValue({ affectedCount: 0, truncated: false, nextCursor: null, bookings: [] });
    show();

    // when
    await userEvent.click(await screen.findByTestId("court-impact-court-1"));

    // then
    expect(await screen.findByTestId("impact-court-1")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^impact-booking-/)).toHaveLength(0);
  });

  it("given an impact still loading, when a board wants to act anyway, then nothing is disabled", async () => {
    // given — the panel informs, it does not gate; a slow answer must not stop a decision
    let answer: (impact: { affectedCount: number; truncated: boolean; nextCursor: null; bookings: [] }) => void = () => undefined;
    vi.spyOn(api, "courtImpact").mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    vi.spyOn(api, "setAdminCourtActive")
      .mockResolvedValue({ id: "court-1", number: 3, name: "Centre Court", active: false });
    show();
    await userEvent.click(await screen.findByTestId("court-impact-court-1"));

    // when / then
    expect(screen.getByTestId("toggle-court-court-1")).toBeEnabled();
    expect(screen.getByTestId("edit-court-name-court-1")).toBeEnabled();
    answer({ affectedCount: 0, truncated: false, nextCursor: null, bookings: [] });
  });

  it("given more affected bookings than one page holds, when the impact is read, then it says it is not the whole list", async () => {
    // given
    vi.spyOn(api, "courtImpact").mockResolvedValue({
      affectedCount: 120, truncated: true, nextCursor: "booking-50",
      bookings: [{ bookingId: "booking-1", courtIds: ["court-1"], startsAt: "2026-09-01T08:00:00Z", endsAt: "2026-09-01T09:00:00Z" }]
    });
    show();

    // when
    await userEvent.click(await screen.findByTestId("court-impact-court-1"));

    // then — a list that shows one of a hundred and twenty without saying so is what this refuses
    expect(await screen.findByTestId("impact-truncated-court-1")).toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
