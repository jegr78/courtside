import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api, type ManagedAppointment } from "../api/client";
import i18n from "../i18n";
import { AdminManagedAppointmentsView } from "./AdminManagedAppointmentsView";

const first: ManagedAppointment = {
  id: "11111111-1111-1111-1111-111111111111", cardId: "card-training", courtIds: ["court-1"],
  startsAt: "2026-10-01T16:00:00Z", endsAt: "2026-10-01T17:00:00Z", cardLabel: "Training",
  cardColor: "#34584a", status: "CONFIRMED", participantCount: 8, seriesId: "series-1", ownBooking: true
};
const second: ManagedAppointment = {
  ...first, id: "22222222-2222-2222-2222-222222222222", startsAt: "2026-10-08T16:00:00Z",
  endsAt: "2026-10-08T17:00:00Z"
};

describe("AdminManagedAppointmentsView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "managedAppointments").mockResolvedValue({ items: [first, second] });
    vi.spyOn(api, "courts").mockResolvedValue([{ id: "court-1", number: 1, name: "Centre Court" }]);
    vi.spyOn(api, "bookingCards").mockResolvedValue([{
      id: "card-training", label: "Training", color: "#34584a", allowedPlayerCounts: [8], guestAllowed: false
    }]);
    vi.spyOn(api, "bookingGrid").mockResolvedValue({ timeZone: "Europe/Berlin", slotMinutes: 30, openingWeeks: [], openingPeriods: [], courtClosures: [], openingHours: [] });
    vi.spyOn(api, "bookingEligibility").mockResolvedValue({ violations: [] });
  });

  function show(access = { managesAppointments: true, createsSeries: true }) {
    render(<MemoryRouter><AdminManagedAppointmentsView {...access} /></MemoryRouter>);
  }

  it("given an account that manages appointments but may create no series, when the page loads, then the list is offered without the series form", async () => {
    // when
    show({ managesAppointments: true, createsSeries: false });

    // then
    expect(await screen.findByTestId("managed-series-series-1")).toBeInTheDocument();
    expect(screen.queryByTestId("new-series"), "no card lets this role create a series").not.toBeInTheDocument();
  });

  it("given an account that manages appointments but may create no series, when nothing is scheduled, then the empty list does not point at a series form", async () => {
    // given
    vi.mocked(api.managedAppointments).mockResolvedValue({ items: [] });

    // when
    show({ managesAppointments: true, createsSeries: false });

    // then
    expect(await screen.findByTestId("managed-empty")).toHaveTextContent(i18n.t("managedAppointments.emptyWithoutSeries"));
  });

  it("given an account that may create series but manages no card, when the page loads, then the form is offered without the list", async () => {
    // when
    show({ managesAppointments: false, createsSeries: true });

    // then
    expect(await screen.findByTestId("new-series")).toBeInTheDocument();
    expect(screen.queryByTestId("managed-court-filter"), "no card lets this role manage appointments").not.toBeInTheDocument();
    expect(api.managedAppointments).not.toHaveBeenCalled();
  });

  it("given an account that may create series but manages no card, when the page loads, then its heading speaks of series rather than a list", async () => {
    // when
    show({ managesAppointments: false, createsSeries: true });

    // then
    expect(await screen.findByTestId("managed-appointments-title")).toHaveTextContent(i18n.t("managedAppointments.seriesOnlyTitle"));
    expect(screen.getByTestId("managed-appointments-description")).toHaveTextContent(i18n.t("managedAppointments.seriesOnlyDescription"));
  });

  it("given an account that may create series but manages no card, when a failure is retried, then the managed list is still not read", async () => {
    // given
    vi.spyOn(api, "previewSeries").mockRejectedValue(new Error("unavailable"));
    show({ managesAppointments: false, createsSeries: true });
    await userEvent.click(await screen.findByTestId("new-series"));
    await userEvent.selectOptions(await screen.findByTestId("series-courts"), ["court-1"]);
    await userEvent.selectOptions(await screen.findByTestId("series-card"), ["card-training"]);
    await userEvent.type(screen.getByTestId("series-starts-on"), "2026-09-07");
    await userEvent.type(screen.getByTestId("series-start-time"), "18:00");
    await userEvent.click(screen.getByTestId("series-weekday-MONDAY"));
    await userEvent.click(screen.getByTestId("preview-series"));
    const failure = await screen.findByTestId("load-failure");

    // when
    await userEvent.click(within(failure).getByTestId("retry-load"));

    // then
    await waitFor(() => expect(screen.queryByTestId("load-failure")).not.toBeInTheDocument());
    expect(api.managedAppointments, "a retry reads only what this role may see").not.toHaveBeenCalled();
  });

  it("given recurring work, when upcoming appointments load, then the bounded page is grouped and collapsed", async () => {
    // given / when
    show();

    // then
    const series = await screen.findByTestId("managed-series-series-1");
    expect(api.managedAppointments).toHaveBeenCalledWith({
      view: "UPCOMING", courtId: undefined, cardId: undefined, limit: 20
    });
    expect(series).not.toHaveAttribute("open");
    expect(within(series).getByTestId("managed-series-summary")).toHaveTextContent(/^Training · .* · 2 loaded appointments$/);
    expect(screen.getByTestId("new-series"), "creating work starts above the list").toBeInTheDocument();
  });

  it("given two series of the same card, when the list loads, then each heading names its own weekday, time, court and dates", async () => {
    // given
    const monday: ManagedAppointment = {
      ...first, id: "33333333-3333-3333-3333-333333333333", seriesId: "series-2", courtIds: ["court-2"],
      startsAt: "2026-10-05T18:00:00Z", endsAt: "2026-10-05T19:00:00Z"
    };
    vi.mocked(api.managedAppointments).mockResolvedValue({ items: [first, monday, second] });
    vi.mocked(api.courts).mockResolvedValue([
      { id: "court-1", number: 1, name: "Centre Court" }, { id: "court-2", number: 2, name: "Court 2" }
    ]);

    // when
    show();

    // then
    const thursdays = within(await screen.findByTestId("managed-series-series-1")).getByTestId("managed-series-summary");
    const mondays = within(screen.getByTestId("managed-series-series-2")).getByTestId("managed-series-summary");
    await waitFor(() => expect(thursdays).toHaveTextContent(/^Training · Thu 6:00\s?PM – 7:00\s?PM · Centre Court/));
    expect(thursdays, "the loaded dates bound the series").toHaveTextContent(/Oct 1 – 8, 2026 · 2 loaded appointments$/);
    expect(mondays).toHaveTextContent(/^Training · Mon 8:00\s?PM – 9:00\s?PM · Court 2 · Oct 5, 2026 · one loaded appointment$/);
  });

  it("given a series on two weekdays, when the list loads, then its heading names both weekdays from Monday on", async () => {
    // given
    const monday: ManagedAppointment = {
      ...first, id: "66666666-6666-6666-6666-666666666666", startsAt: "2026-10-05T16:00:00Z", endsAt: "2026-10-05T17:00:00Z"
    };
    vi.mocked(api.managedAppointments).mockResolvedValue({ items: [first, monday] });

    // when
    show();

    // then
    const summary = within(await screen.findByTestId("managed-series-series-1")).getByTestId("managed-series-summary");
    await waitFor(() => expect(summary, "each loaded weekday appears once, in week order").toHaveTextContent(/^Training · Mon, Thu 6:00/));
  });

  it("given a single appointment between two series, when the list loads, then it stands in its own list outside every series", async () => {
    // given
    const single: ManagedAppointment = {
      ...first, id: "44444444-4444-4444-4444-444444444444", seriesId: null, startsAt: "2026-10-02T16:00:00Z", endsAt: "2026-10-02T17:00:00Z"
    };
    const other: ManagedAppointment = { ...second, id: "55555555-5555-5555-5555-555555555555", seriesId: "series-2" };
    vi.mocked(api.managedAppointments).mockResolvedValue({ items: [first, single, other] });

    // when
    show();

    // then
    const series = await screen.findByTestId("managed-series-series-1");
    const singles = screen.getByTestId("managed-single-appointments");
    expect(within(singles).getByTestId(`booking-${single.id}`), "a single appointment sits in its own list").toBeInTheDocument();
    expect(within(series).queryByTestId(`booking-${single.id}`), "a single appointment is no part of the series before it").not.toBeInTheDocument();
    expect(singles.compareDocumentPosition(screen.getByTestId("managed-series-series-2")) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the list keeps the loaded order").toBeTruthy();
  });

  it("given single appointments between and after two series, when the list loads, then no region and no heading repeats", async () => {
    // given
    const between: ManagedAppointment = {
      ...first, id: "44444444-4444-4444-4444-444444444444", seriesId: null, startsAt: "2026-10-02T16:00:00Z", endsAt: "2026-10-02T17:00:00Z"
    };
    const other: ManagedAppointment = { ...second, id: "55555555-5555-5555-5555-555555555555", seriesId: "series-2" };
    const after: ManagedAppointment = {
      ...first, id: "66666666-6666-6666-6666-666666666666", seriesId: null, startsAt: "2026-10-09T16:00:00Z", endsAt: "2026-10-09T17:00:00Z"
    };
    vi.mocked(api.managedAppointments).mockResolvedValue({ items: [first, between, other, after] });

    // when
    show();

    // then
    await screen.findByTestId("managed-series-series-2");
    expect(screen.getAllByTestId("managed-single-appointments"), "each run of single appointments keeps its place").toHaveLength(2);
    const names = screen.queryAllByRole("region").map((region) => region.getAttribute("aria-label")
      ?? document.getElementById(region.getAttribute("aria-labelledby") ?? "")?.textContent);
    expect(new Set(names).size, `every region has its own name: ${names.join(", ")}`).toBe(names.length);
    expect(within(screen.getByTestId("managed-bookings")).queryAllByRole("heading"), "no heading repeats between the series").toHaveLength(0);
  });

  it("given the upcoming view, when history and filters are chosen, then each criterion reaches the server", async () => {
    // given
    show();
    await screen.findByTestId("managed-series-series-1");

    // when
    await userEvent.click(screen.getByTestId("managed-view-HISTORY"));
    await userEvent.selectOptions(screen.getByTestId("managed-court-filter"), "court-1");
    await userEvent.selectOptions(screen.getByTestId("managed-card-filter"), "card-training");

    // then
    await waitFor(() => expect(api.managedAppointments).toHaveBeenLastCalledWith({
      view: "HISTORY", courtId: "court-1", cardId: "card-training", limit: 20
    }));
    expect(api.courts).toHaveBeenCalledOnce();
    expect(api.bookingCards).toHaveBeenCalledOnce();
    expect(api.bookingGrid).toHaveBeenCalledOnce();
  });

  it("given reference data cannot be read, when appointments load, then the list remains available with a separate retry", async () => {
    // given
    vi.mocked(api.bookingGrid).mockRejectedValue(new Error("grid unavailable"));

    // when
    show();

    // then
    const series = await screen.findByTestId("managed-series-series-1");
    expect(screen.getByTestId("load-failure")).toBeInTheDocument();
    expect(api.managedAppointments).toHaveBeenCalledOnce();
    expect(within(series).getAllByTestId("managed-details")[0]).toBeDisabled();
    expect(within(series).queryByTestId("managed-actions")).not.toBeInTheDocument();
  });

  it("given a confirmed occurrence, when its row is opened, then details are direct and cancellation stays secondary", async () => {
    // given
    show();
    const series = await screen.findByTestId("managed-series-series-1");

    // when
    await userEvent.click(within(series).getByTestId("managed-series-summary"));

    // then
    const row = screen.getByTestId(`booking-${first.id}`);
    expect(within(row).getByTestId("managed-details")).toBeVisible();
    const actions = within(row).getByTestId("managed-actions").closest("details");
    expect(actions).not.toHaveAttribute("open");
    expect(within(actions!).getByTestId("managed-cancel")).toBeInTheDocument();
  });

  it("given several action menus, when another menu or Escape is used, then only the active menu stays open and focus returns", async () => {
    // given
    show();
    const series = await screen.findByTestId("managed-series-series-1");
    await userEvent.click(within(series).getByTestId("managed-series-summary"));
    const summaries = within(series).getAllByTestId("managed-actions");
    const menus = summaries.map((summary) => summary.closest("details")!);

    // when
    await userEvent.click(summaries[0]);
    summaries[1].focus();
    await userEvent.keyboard("{Enter}");

    // then
    await waitFor(() => {
      expect(menus[0]).not.toHaveAttribute("open");
      expect(menus[1]).toHaveAttribute("open");
    });

    // when
    await userEvent.keyboard("{Escape}");

    // then
    expect(menus[1]).not.toHaveAttribute("open");
    expect(summaries[1]).toHaveFocus();
  });

  it("given a managed appointment, when details open, then internal data is loaded on demand", async () => {
    // given
    vi.spyOn(api, "managedAppointment").mockResolvedValue({
      ...first,
      note: "Prepare score sheets",
      participants: [{ kind: "MEMBER", displayName: "Jane Doe" }]
    });
    show();
    const series = await screen.findByTestId("managed-series-series-1");
    await userEvent.click(within(series).getByTestId("managed-series-summary"));

    // when
    await userEvent.click(within(series).getAllByTestId("managed-details")[0]);

    // then
    expect(await screen.findByTestId("managed-note")).toHaveTextContent("Prepare score sheets");
    expect(screen.getByTestId("managed-participants")).toHaveTextContent("Jane Doe · Member");
    expect(api.managedAppointment).toHaveBeenCalledWith(first.id);
  });

  it("given a past appointment whose guest names were pseudonymised, when details open, then the guest carries a neutral label", async () => {
    // given
    vi.spyOn(api, "managedAppointment").mockResolvedValue({
      ...first, note: null, participants: [{ kind: "GUEST", displayName: "" }]
    });
    show();
    const series = await screen.findByTestId("managed-series-series-1");
    await userEvent.click(within(series).getByTestId("managed-series-summary"));

    // when
    await userEvent.click(within(series).getAllByTestId("managed-details")[0]);

    // then
    const guest = await screen.findByTestId("appointment-participant");
    expect(guest, "an empty name reads as a neutral label").toHaveTextContent(`${i18n.t("managedAppointments.unnamedGuest")} · Guest`);
  });

  it("given a managed appointment, when details open, then they scroll while the close button stays below the body", async () => {
    // given
    vi.spyOn(api, "managedAppointment").mockResolvedValue({ ...first, note: "Prepare score sheets", participants: [] });
    show();
    const series = await screen.findByTestId("managed-series-series-1");
    await userEvent.click(within(series).getByTestId("managed-series-summary"));

    // when
    await userEvent.click(within(series).getAllByTestId("managed-details")[0]);

    // then
    const body = within(screen.getByRole("dialog")).getByTestId("dialog-body");
    expect(body, "the details scroll inside the body").toContainElement(await screen.findByTestId("managed-note"));
    expect(body, "the close button stays outside the scrolling body").not.toContainElement(screen.getByTestId("close-managed-appointment"));
  });

  it("given another upcoming page is in flight, when history opens, then the stale page is discarded", async () => {
    // given
    let resolveMore!: (page: { items: ManagedAppointment[] }) => void;
    vi.mocked(api.managedAppointments).mockImplementation((options) => {
      if (options?.cursor) return new Promise((resolve) => { resolveMore = resolve; });
      return Promise.resolve(options?.view === "HISTORY" ? { items: [] } : { items: [first], nextCursor: first.id });
    });
    show();
    await screen.findByTestId("managed-load-more");
    await userEvent.click(screen.getByTestId("managed-load-more"));

    // when
    await userEvent.click(screen.getByTestId("managed-view-HISTORY"));
    await waitFor(() => expect(api.managedAppointments).toHaveBeenLastCalledWith({
      view: "HISTORY", courtId: undefined, cardId: undefined, limit: 20
    }));
    await act(() => {
      resolveMore({ items: [second] });
      return Promise.resolve();
    });

    // then
    expect(screen.queryByTestId(`booking-${second.id}`)).not.toBeInTheDocument();
  });

  it("given another page is in flight, when a filter reloads before that page fails, then its failure is discarded", async () => {
    // given
    let rejectMore!: (failure: Error) => void;
    vi.mocked(api.managedAppointments).mockImplementation((options) => {
      if (options?.cursor) return new Promise((_, reject) => { rejectMore = reject; });
      return Promise.resolve({ items: [first], nextCursor: first.id });
    });
    show();
    await screen.findByTestId("managed-load-more");
    await userEvent.click(screen.getByTestId("managed-load-more"));

    // when
    await userEvent.selectOptions(screen.getByTestId("managed-court-filter"), "court-1");
    await waitFor(() => expect(api.managedAppointments).toHaveBeenLastCalledWith({
      view: "UPCOMING", courtId: "court-1", cardId: undefined, limit: 20
    }));
    await act(() => {
      rejectMore(new Error("stale page failed"));
      return Promise.resolve();
    });

    // then
    expect(screen.queryByTestId("load-failure")).not.toBeInTheDocument();
    expect(screen.getByTestId("managed-load-more")).not.toBeDisabled();
  });

  it("given somebody else's series, when the board cancels it naming a reason, then the reason travels with the cancellation", async () => {
    // given
    const cancel = vi.spyOn(api, "cancelSeries").mockResolvedValue(undefined);
    vi.mocked(api.managedAppointments).mockResolvedValue({
      items: [{ ...first, ownBooking: false }, { ...second, ownBooking: false }]
    });
    show();
    await userEvent.click(within(await screen.findByTestId("managed-series-series-1")).getByTestId("managed-series-summary"));
    await userEvent.click(within(screen.getByTestId(`booking-${first.id}`)).getByTestId("managed-cancel"));

    // when
    await userEvent.selectOptions(screen.getByTestId("cancellation-reason"), "WEATHER");
    await userEvent.click(screen.getByTestId("confirm-cancellation"));

    // then
    await waitFor(() => expect(cancel).toHaveBeenCalledWith("series-1", first.id, "THIS", "WEATHER"));
  });

  it("given somebody else's single appointment, when the board cancels it naming a reason, then the booking is cancelled with it", async () => {
    // given
    const cancel = vi.spyOn(api, "cancelBooking").mockResolvedValue(undefined);
    const single = { ...first, id: "33333333-3333-3333-3333-333333333333", seriesId: null, ownBooking: false };
    vi.mocked(api.managedAppointments).mockResolvedValue({ items: [single] });
    show();
    await userEvent.click(within(await screen.findByTestId(`booking-${single.id}`)).getByTestId("managed-cancel"));

    // when
    await userEvent.selectOptions(screen.getByTestId("cancellation-reason"), "MAINTENANCE");
    await userEvent.click(screen.getByTestId("confirm-cancellation"));

    // then
    await waitFor(() => expect(cancel).toHaveBeenCalledWith(single.id, "MAINTENANCE"), { timeout: 10_000 });
  });

  it("given the board's own series, when cancelling it, then no reason is offered", async () => {
    // given
    const cancel = vi.spyOn(api, "cancelSeries").mockResolvedValue(undefined);
    show();
    await userEvent.click(within(await screen.findByTestId("managed-series-series-1")).getByTestId("managed-series-summary"));

    // when
    await userEvent.click(within(screen.getByTestId(`booking-${first.id}`)).getByTestId("managed-cancel"));

    // then
    expect(screen.queryByTestId("cancellation-reason")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("confirm-cancellation"));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith("series-1", first.id, "THIS", undefined));
  });

  it("given a confirmed cancellation, when the next action starts, then the earlier confirmation leaves", async () => {
    // given
    vi.spyOn(api, "cancelSeries").mockResolvedValue(undefined);
    let reads = 0;
    vi.mocked(api.managedAppointments).mockImplementation(() => {
      reads += 1;
      return reads <= 2 ? Promise.resolve({ items: [first, second] }) : new Promise(() => undefined);
    });
    show();
    await userEvent.click(within(await screen.findByTestId("managed-series-series-1")).getByTestId("managed-series-summary"));
    await userEvent.click(within(screen.getByTestId(`booking-${first.id}`)).getByTestId("managed-cancel"));
    await userEvent.click(screen.getByTestId("confirm-cancellation"));
    expect(await screen.findByTestId("managed-success")).toHaveTextContent(i18n.t("booking.cancelledSuccess"));
    await userEvent.click(within(await screen.findByTestId("managed-series-series-1")).getByTestId("managed-series-summary"));

    // when
    await userEvent.click(within(screen.getByTestId(`booking-${second.id}`)).getByTestId("managed-cancel"));

    // then
    expect(screen.queryByTestId("managed-success"), "a confirmation belongs to the action that produced it").not.toBeInTheDocument();

    // when
    await userEvent.click(screen.getByTestId("confirm-cancellation"));

    // then
    await waitFor(() => expect(reads).toBe(3));
    expect(screen.queryByTestId("managed-success"), "nothing is confirmed while the list is still reloading").not.toBeInTheDocument();
  });

  it("given a confirmed cancellation, when a move starts next, then the earlier confirmation leaves", async () => {
    // given
    vi.spyOn(api, "cancelSeries").mockResolvedValue(undefined);
    show();
    await userEvent.click(within(await screen.findByTestId("managed-series-series-1")).getByTestId("managed-series-summary"));
    await userEvent.click(within(screen.getByTestId(`booking-${first.id}`)).getByTestId("managed-cancel"));
    await userEvent.click(screen.getByTestId("confirm-cancellation"));
    await screen.findByTestId("managed-success");
    await userEvent.click(within(await screen.findByTestId("managed-series-series-1")).getByTestId("managed-series-summary"));

    // when
    await userEvent.click(within(screen.getByTestId(`booking-${second.id}`)).getByTestId("move-booking"));

    // then
    expect(screen.queryByTestId("managed-success"), "a confirmation belongs to the action that produced it").not.toBeInTheDocument();
  });

  it("given a confirmed cancellation, when a series is created next, then the earlier confirmation leaves before the reload", async () => {
    // given
    vi.spyOn(api, "cancelSeries").mockResolvedValue(undefined);
    vi.spyOn(api, "previewSeries").mockResolvedValue({
      creatableCount: 1, truncatedByHorizon: false, horizonLimit: null,
      occurrences: [{ startsAt: "2026-09-07T16:00:00Z", endsAt: "2026-09-07T17:00:00Z", blockedCourtIds: [], violations: [], creatable: true }]
    });
    vi.spyOn(api, "createSeries").mockResolvedValue({ seriesId: "series-2", bookingIds: ["booking-9"], skipped: [] });
    let reads = 0;
    vi.mocked(api.managedAppointments).mockImplementation(() => {
      reads += 1;
      return reads <= 2 ? Promise.resolve({ items: [first, second] }) : new Promise(() => undefined);
    });
    show();
    await userEvent.click(within(await screen.findByTestId("managed-series-series-1")).getByTestId("managed-series-summary"));
    await userEvent.click(within(screen.getByTestId(`booking-${first.id}`)).getByTestId("managed-cancel"));
    await userEvent.click(screen.getByTestId("confirm-cancellation"));
    await screen.findByTestId("managed-success");
    await userEvent.click(screen.getByTestId("new-series"));
    await userEvent.selectOptions(await screen.findByTestId("series-courts"), ["court-1"]);
    await userEvent.selectOptions(await screen.findByTestId("series-card"), ["card-training"]);
    await userEvent.type(screen.getByTestId("series-starts-on"), "2026-09-07");
    await userEvent.type(screen.getByTestId("series-start-time"), "18:00");
    await userEvent.click(screen.getByTestId("series-weekday-MONDAY"));
    await userEvent.click(screen.getByTestId("preview-series"));

    // when
    await userEvent.click(await screen.findByTestId("confirm-series"));

    // then
    await waitFor(() => expect(reads).toBe(3));
    expect(screen.queryByTestId("managed-success"), "nothing is confirmed while the list is still reloading").not.toBeInTheDocument();
  });

  it("given the list reloads, when it shows its loading state, then load more is not offered", async () => {
    // given
    vi.mocked(api.managedAppointments).mockImplementation((options) => options?.courtId
      ? new Promise(() => undefined)
      : Promise.resolve({ items: [first], nextCursor: first.id }));
    show();
    await screen.findByTestId("managed-load-more");

    // when
    await userEvent.selectOptions(screen.getByTestId("managed-court-filter"), "court-1");

    // then
    await waitFor(() => expect(api.managedAppointments).toHaveBeenLastCalledWith({
      view: "UPCOMING", courtId: "court-1", cardId: undefined, limit: 20
    }));
    expect(screen.queryByTestId("managed-load-more"), "the cursor belongs to the list before the reload").not.toBeInTheDocument();
  });

  it("given the first page is loading, when the active view is chosen again, then that load still completes", async () => {
    // given
    let resolveInitial!: (page: { items: ManagedAppointment[] }) => void;
    vi.mocked(api.managedAppointments).mockReturnValue(new Promise((resolve) => { resolveInitial = resolve; }));
    show();

    // when
    await userEvent.click(screen.getByTestId("managed-view-UPCOMING"));
    await act(() => {
      resolveInitial({ items: [first] });
      return Promise.resolve();
    });

    // then
    expect(await screen.findByTestId("managed-series-series-1")).toBeInTheDocument();
  });
});
