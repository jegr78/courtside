import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "../../api/client";
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

describe("AdminCourtsView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminCourts").mockResolvedValue([
      { id: "court-1", number: 1, name: "Centre Court", active: true }
    ]);
  });

  it("given court data, when the view loads, then the courts are listed", async () => {
    // when
    show();

    // then
    expect(await screen.findByTestId("court-name-court-1")).toHaveValue("Centre Court");
  });

  // The page's one primary action opens it, so a board never scrolls past the list to add a court.
  it("when the view loads, then creating a court comes before the courts it would join", async () => {
    // when
    show();

    // then
    const create = await screen.findByTestId("create-court");
    const first = screen.getByTestId("court-name-court-1");
    expect(create.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("given a renamed court, when the change is saved, then the row stops saying it is unsaved", async () => {
    // given
    vi.spyOn(api, "changeAdminCourt").mockImplementation((id, court) =>
      Promise.resolve({ id, number: court.number, name: court.name ?? null, active: true }));
    show(true);
    await userEvent.type(await screen.findByTestId("court-name-court-1"), "!");
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));

    // when
    await userEvent.click(screen.getByTestId("save-court-court-1"));

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
    expect(screen.queryByTestId("unsaved-mark-court:court-1")).not.toBeInTheDocument();
  });

  it("given a court is renamed, when a screen reader reaches its save, then the mark explains it", async () => {
    // given
    show();
    const name = await screen.findByTestId("court-name-court-1");
    expect(screen.getByTestId("save-court-court-1")).not.toHaveAttribute("aria-describedby");

    // when
    await userEvent.type(name, "!");

    // then
    const mark = await screen.findByTestId("unsaved-mark-court:court-1");
    expect(screen.getByTestId("save-court-court-1"))
      .toHaveAttribute("aria-describedby", mark.getAttribute("id"));
  });

  it("given a court is renamed, when the row is read, then it says so beside a save that stays usable", async () => {
    // given
    show();
    const name = await screen.findByTestId("court-name-court-1");
    expect(screen.queryByTestId("unsaved-mark-court:court-1")).not.toBeInTheDocument();

    // when
    await userEvent.type(name, "!");

    // then
    expect(await screen.findByTestId("unsaved-mark-court:court-1")).toHaveTextContent("Not saved yet");
    expect(screen.getByTestId("save-court-court-1")).toBeEnabled();
  });

  it("given a court is renamed, when the name is typed back, then nothing is left to lose", async () => {
    // given
    show(true);
    const name = await screen.findByTestId("court-name-court-1");
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");

    // when
    await userEvent.type(name, "!");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));

    // when
    await userEvent.clear(name);
    await userEvent.type(name, "Centre Court");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
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
    expect(await screen.findByTestId("court-name-court-2")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given an active court, when toggling it twice, then it disappears and can be restored", async () => {
    // given
    const setCourtActive = vi.spyOn(api, "setAdminCourtActive")
      .mockResolvedValueOnce({ id: "court-1", number: 1, name: "Centre Court", active: false })
      .mockResolvedValueOnce({ id: "court-1", number: 1, name: "Centre Court", active: true });
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
    expect(screen.getByTestId("court-name-court-1")).toBeDisabled();
    await user.click(toggle);
    expect(setCourtActive).toHaveBeenCalledTimes(1);

    // when
    response.resolve({ id: "court-1", number: 1, name: "Centre Court", active: false });

    // then
    expect(await screen.findByTestId("toggle-court-court-1")).toBeEnabled();
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
    expect(control).not.toHaveClass("bg-(--club-primary)");
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
      .mockResolvedValue({ id: "court-1", number: 1, name: "Centre Court", active: false });
    show();
    await userEvent.click(await screen.findByTestId("court-impact-court-1"));

    // when / then
    expect(screen.getByTestId("toggle-court-court-1")).toBeEnabled();
    expect(screen.getByTestId("court-impact-court-1")).toBeEnabled();
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
