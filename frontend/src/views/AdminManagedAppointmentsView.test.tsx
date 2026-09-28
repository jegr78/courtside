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
  cardColor: "#34584a", status: "CONFIRMED", participantCount: 8, seriesId: "series-1"
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
    vi.spyOn(api, "bookingGrid").mockResolvedValue({ timeZone: "Europe/Berlin", slotMinutes: 30, openingHours: [] });
    vi.spyOn(api, "bookingEligibility").mockResolvedValue({ violations: [] });
  });

  function show() {
    render(<MemoryRouter><AdminManagedAppointmentsView /></MemoryRouter>);
  }

  it("given recurring work, when upcoming appointments load, then the bounded page is grouped and collapsed", async () => {
    // given / when
    show();

    // then
    const series = await screen.findByTestId("managed-series-series-1");
    expect(api.managedAppointments).toHaveBeenCalledWith({
      view: "UPCOMING", courtId: undefined, cardId: undefined, limit: 20
    });
    expect(series).not.toHaveAttribute("open");
    expect(within(series).getByTestId("managed-series-summary")).toHaveTextContent("Training · 2 loaded appointments");
    expect(screen.getByTestId("new-series"), "creating work starts above the list").toBeInTheDocument();
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
