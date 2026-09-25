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

const twoCourts = [
  { id: "court-1", number: 3, name: "Centre Court", active: true },
  { id: "court-2", number: 4, name: "Garden Court", active: true }
];

describe("AdminCourtsView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminCourts").mockResolvedValue([
      { id: "court-1", number: 3, name: "Centre Court", active: true }
    ]);
  });

  it("given court data, when the view loads, then every court is one row of one list with its values in place", async () => {
    // when
    show();

    // then
    const row = await screen.findByTestId("court-row-court-1");
    expect(row.tagName).toBe("TR");
    expect(screen.getByTestId("edit-court-number-court-1")).toHaveValue(3);
    expect(screen.getByTestId("edit-court-name-court-1")).toHaveValue("Centre Court");
    expect(screen.getByTestId("court-status-court-1")).toHaveTextContent("Active");
    expect(screen.getByTestId("edit-court-name-court-1")).toHaveAccessibleName(/Change the name/);
  });

  it("when the view loads, then no court carries a save of its own and the page offers none yet", async () => {
    // when
    show();

    // then
    await screen.findByTestId("court-row-court-1");
    expect(screen.queryAllByTestId(/^save-court-/)).toHaveLength(0);
    expect(screen.queryByTestId("save-courts"), "a clean list has nothing to save").not.toBeInTheDocument();
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

  it("given two edited courts, when the page is saved once, then each is written with the value it keeps", async () => {
    // given
    vi.spyOn(api, "adminCourts").mockResolvedValue(twoCourts);
    const change = vi.spyOn(api, "changeAdminCourt").mockImplementation((id, request) =>
      Promise.resolve({ id, number: request.number, name: request.name ?? null, active: true }));
    show(true);
    await screen.findByTestId("court-row-court-2");
    await userEvent.type(screen.getByTestId("edit-court-name-court-1"), "!");
    fireEvent.change(screen.getByTestId("edit-court-number-court-2"), { target: { value: "9" } });
    await waitFor(() => expect(screen.getByTestId("unsaved-count"), "one page save is one change to lose").toHaveTextContent("1"));

    // when
    await userEvent.click(screen.getByTestId("save-courts"));

    // then
    expect(await screen.findByTestId("admin-save-success")).toBeVisible();
    expect(change).toHaveBeenCalledTimes(2);
    expect(change).toHaveBeenCalledWith("court-1", { number: 3, name: "Centre Court!" });
    expect(change).toHaveBeenCalledWith("court-2", { number: 9, name: "Garden Court" });
    expect(screen.getAllByTestId(/^court-row-/).map((row) => row.getAttribute("data-testid")), "a new number does not move the row")
      .toEqual(["court-row-court-1", "court-row-court-2"]);
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given an edited name, when Enter is pressed in it, then the page is saved", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminCourt")
      .mockResolvedValue({ id: "court-1", number: 3, name: "Centre Court!", active: true });
    show();

    // when
    await userEvent.type(await screen.findByTestId("edit-court-name-court-1"), "!{Enter}");

    // then
    await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith("court-1", { number: 3, name: "Centre Court!" }));
  });

  it("given non-integer or out-of-range court numbers, when the page is saved, then nothing is written and the court is marked", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminCourt");
    show();
    const number = await screen.findByTestId("edit-court-number-court-1");

    for (const entry of ["", "0", "1000", "1e3", "3.9", "-2"]) {
      // when
      fireEvent.change(number, { target: { value: entry } });
      expect(number, "a changed entry drops the earlier mark").not.toHaveAttribute("aria-invalid");
      await userEvent.click(screen.getByTestId("save-courts"));

      // then
      expect(await screen.findByRole("alert"), `${entry} is refused`).toHaveTextContent("whole number from 1 to 999");
      expect(number, `${entry} is marked`).toHaveAttribute("aria-invalid", "true");
    }
    expect(change).not.toHaveBeenCalled();
  });

  it("given a number in range, when the page is saved, then it is written", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminCourt")
      .mockResolvedValue({ id: "court-1", number: 999, name: "Centre Court", active: true });
    show();
    fireEvent.change(await screen.findByTestId("edit-court-number-court-1"), { target: { value: "999" } });

    // when
    await userEvent.click(screen.getByTestId("save-courts"));

    // then
    await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith("court-1", { number: 999, name: "Centre Court" }));
    expect(screen.getByTestId("edit-court-number-court-1")).not.toHaveAttribute("aria-invalid");
  });

  it("given a number another court already carries, when the page is saved, then the entry is still there to correct and the court is named", async () => {
    // given
    vi.spyOn(api, "changeAdminCourt").mockRejectedValue(new ApiError(409, {
      type: "urn:courtside:error:court-number-taken", status: 409,
      title: "Court number taken", detail: "This court number is already in use"
    }));
    show();
    fireEvent.change(await screen.findByTestId("edit-court-number-court-1"), { target: { value: "2" } });

    // when
    await userEvent.click(screen.getByTestId("save-courts"));

    // then
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Court 3 was not saved.");
    expect(alert).toHaveTextContent("That court number is already taken.");
    expect(screen.getByTestId("edit-court-number-court-1")).toHaveValue(2);
    expect(screen.getByTestId("save-courts")).toBeEnabled();
  });

  it("given a first court the instance refuses, when the page is saved, then the courts after it are not sent and stay unsaved", async () => {
    // given
    vi.spyOn(api, "adminCourts").mockResolvedValue(twoCourts);
    const change = vi.spyOn(api, "changeAdminCourt").mockRejectedValue(new ApiError(409));
    show();
    await screen.findByTestId("court-row-court-2");
    await userEvent.type(screen.getByTestId("edit-court-name-court-1"), "!");
    await userEvent.type(screen.getByTestId("edit-court-name-court-2"), "?");

    // when
    await userEvent.click(screen.getByTestId("save-courts"));

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("Court 3 was not saved.");
    expect(change, "nothing is sent after the first refusal").toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("edit-court-name-court-2")).toHaveValue("Garden Court?");
    expect(screen.queryByTestId("admin-save-success")).not.toBeInTheDocument();
  });

  it("given an edited name, when the old one is typed back, then nothing is left to lose", async () => {
    // given
    show(true);
    const name = await screen.findByTestId("edit-court-name-court-1");
    await userEvent.type(name, "!");
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));

    // when
    await userEvent.type(name, "{Backspace}");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
    expect(screen.queryByTestId("save-bar")).not.toBeInTheDocument();
  });

  it("given edited courts, when the edits are discarded, then every row shows what is stored", async () => {
    // given
    show(true);
    const name = await screen.findByTestId("edit-court-name-court-1");
    await userEvent.type(name, "!");
    fireEvent.change(screen.getByTestId("edit-court-number-court-1"), { target: { value: "0" } });

    // when
    await userEvent.click(screen.getByTestId("discard-courts"));

    // then
    expect(name).toHaveValue("Centre Court");
    expect(screen.getByTestId("edit-court-number-court-1")).toHaveValue(3);
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given an edited name, when a screen reader reaches the save, then the bar says what it saves", async () => {
    // given
    show();

    // when
    await userEvent.type(await screen.findByTestId("edit-court-name-court-1"), "!");

    // then
    expect(screen.getByTestId("save-courts")).toHaveAccessibleDescription("Not saved yet: Courts");
  });

  it("given an unsaved name, when the court is deactivated, then what was entered is still there", async () => {
    // given
    vi.spyOn(api, "setAdminCourtActive")
      .mockResolvedValue({ id: "court-1", number: 3, name: "Centre Court", active: false });
    show();
    await userEvent.type(await screen.findByTestId("edit-court-name-court-1"), "!");

    // when
    await userEvent.click(screen.getByTestId("toggle-court-court-1"));

    // then
    expect(await screen.findByTestId("court-status-court-1")).toHaveTextContent("Deactivated");
    expect(screen.getByTestId("edit-court-name-court-1")).toHaveValue("Centre Court!");
    expect(screen.getByTestId("save-courts")).toBeInTheDocument();
  });

  it("given a court nobody named, when the list is read, then the empty field says so", async () => {
    // given
    vi.spyOn(api, "adminCourts").mockResolvedValue([
      { id: "court-1", number: 3, name: null, active: true },
      { id: "court-2", number: 5, name: "", active: true }
    ]);

    // when
    show();

    // then
    expect(await screen.findByTestId("edit-court-name-court-1")).toHaveValue("");
    expect(screen.getByTestId("edit-court-name-court-1")).toHaveAttribute("placeholder", "No name");
    expect(screen.getByTestId("edit-court-name-court-2")).toHaveAttribute("placeholder", "No name");
  });

  it("given a court nobody named, when a name is saved, then it is written", async () => {
    // given
    vi.spyOn(api, "adminCourts").mockResolvedValue([
      { id: "court-1", number: 3, name: null, active: true }
    ]);
    const change = vi.spyOn(api, "changeAdminCourt")
      .mockResolvedValue({ id: "court-1", number: 3, name: "Garden Court", active: true });
    show();
    await userEvent.type(await screen.findByTestId("edit-court-name-court-1"), "Garden Court");

    // when
    await userEvent.click(screen.getByTestId("save-courts"));

    // then
    await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith("court-1", { number: 3, name: "Garden Court" }));
  });

  it("given a name cleared away, when the page is saved, then the court is left without one", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminCourt")
      .mockResolvedValue({ id: "court-1", number: 3, name: null, active: true });
    show();
    await userEvent.clear(await screen.findByTestId("edit-court-name-court-1"));

    // when
    await userEvent.click(screen.getByTestId("save-courts"));

    // then
    await waitFor(() => expect(change).toHaveBeenCalledExactlyOnceWith("court-1", { number: 3, name: undefined }));
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
    expect(screen.queryByTestId("save-courts"), "creating a court is its own action").not.toBeInTheDocument();
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
    expect(screen.getByTestId("edit-court-name-court-1")).toHaveValue("Centre Court");
    expect(screen.getByTestId("edit-court-number-court-1")).toHaveValue(3);
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

  it("given a page save is pending, when it is asked for again, then each court is written once and nothing can be edited", async () => {
    // given
    const response = deferred<Awaited<ReturnType<typeof api.changeAdminCourt>>>();
    const change = vi.spyOn(api, "changeAdminCourt").mockReturnValue(response.promise);
    show();
    const user = userEvent.setup();
    await user.type(await screen.findByTestId("edit-court-name-court-1"), "!");

    // when
    await user.click(screen.getByTestId("save-courts"));

    // then
    expect(screen.getByTestId("save-courts")).toBeDisabled();
    expect(screen.getByTestId("discard-courts")).toBeDisabled();
    expect(screen.getByTestId("edit-court-name-court-1")).toBeDisabled();
    await user.click(screen.getByTestId("save-courts"));
    expect(change).toHaveBeenCalledTimes(1);

    // when
    response.resolve({ id: "court-1", number: 3, name: "Centre Court!", active: true });

    // then
    await waitFor(() => expect(screen.queryByTestId("save-courts")).not.toBeInTheDocument());
    expect(screen.getByTestId("edit-court-name-court-1")).toHaveValue("Centre Court!");
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
