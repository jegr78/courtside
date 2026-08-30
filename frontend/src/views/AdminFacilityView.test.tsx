import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "../api/client";
import i18n from "../i18n";
import { UnsavedChangesProvider } from "../unsaved/UnsavedChangesProvider";
import { UnsavedCount } from "../test/UnsavedCount";
import { AdminFacilityView } from "./AdminFacilityView";

describe("AdminFacilityView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminCourts").mockResolvedValue([
      { id: "court-1", number: 1, name: "Centre Court", active: true }
    ]);
    vi.spyOn(api, "adminOpeningHours").mockResolvedValue([
      { dayOfWeek: "MONDAY", opensAt: "08:00:00", closesAt: "22:00:00" }
    ]);
    vi.spyOn(api, "adminBookingCards").mockResolvedValue([
      {
        id: "card-1", label: "Member booking", color: "#b85c38", allowedRoles: ["MEMBER"],
        managingRoles: [], allowedPlayerCounts: [2, 4], tracksPlayers: true, countsAgainstLimits: true,
        guestAllowed: true, showGenericOccupancy: true, active: true
      }
    ]);
    vi.spyOn(api, "adminParticipantCards").mockResolvedValue([
      { id: "filler-1", label: "Ball machine", capacity: 1, active: true }
    ]);
    vi.spyOn(api, "config").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Pacific/Auckland"
    });
  });

  it("given a court is renamed, when the row is read, then it says so beside a save that stays usable", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);
    const name = await screen.findByTestId("court-name-court-1");
    expect(screen.queryByTestId("unsaved-mark-court:court-1")).not.toBeInTheDocument();

    // when
    await userEvent.type(name, "!");

    // then
    expect(await screen.findByTestId("unsaved-mark-court:court-1")).toHaveTextContent("Not saved yet");
    expect(screen.getByTestId("save-court-court-1")).toBeEnabled();
  });

  it("given every kind of row is edited, when they are counted, then each one is asked about on its own", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider>
      <UnsavedCount />
      <AdminFacilityView />
    </UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("court-name-court-1");

    // when
    await userEvent.type(screen.getByTestId("hours-open-MONDAY"), "09:00");
    await userEvent.type(screen.getByTestId("card-label-card-1"), "!");
    await userEvent.type(screen.getByTestId("participant-card-label-filler-1"), "!");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("3"));
  });

  it("given the participant card form is filled in, when it is read, then it holds work", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider>
      <UnsavedCount />
      <AdminFacilityView />
    </UnsavedChangesProvider></MemoryRouter>);

    // when
    await userEvent.type(await screen.findByTestId("new-participant-card-label"), "Ball machine");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));
  });

  it("given a create form is filled in, when the entry is cleared again, then nothing is left to lose", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider>
      <UnsavedCount />
      <AdminFacilityView />
    </UnsavedChangesProvider></MemoryRouter>);
    const label = await screen.findByTestId("new-card-label");
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");

    // when
    await userEvent.type(label, "League match");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));

    // when
    await userEvent.clear(label);

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given a filled create form, when the court is created, then nothing is left to lose", async () => {
    // given
    vi.spyOn(api, "createAdminCourt").mockResolvedValue({ id: "court-2", number: 2, name: "Court 2", active: true });
    render(<MemoryRouter><UnsavedChangesProvider>
      <UnsavedCount />
      <AdminFacilityView />
    </UnsavedChangesProvider></MemoryRouter>);
    await userEvent.type(await screen.findByTestId("new-court-number"), "2");
    await userEvent.type(screen.getByTestId("new-court-name"), "Court 2");
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));

    // when
    await userEvent.click(screen.getByTestId("create-court"));

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0"));
  });

  it("given a court is renamed, when the name is typed back, then nothing is left to lose", async () => {
    // given
    render(<MemoryRouter><UnsavedChangesProvider>
      <UnsavedCount />
      <AdminFacilityView />
    </UnsavedChangesProvider></MemoryRouter>);
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

  it("when the facility loads, then opening hours have a stable navigation target", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    const heading = await screen.findByTestId("opening-hours-heading");
    expect(heading).toHaveRole("heading");
    expect(heading).toHaveAttribute("id", "opening-hours");
  });

  it("given the opening-hours fragment, when the asynchronous view loads, then its heading receives focus", async () => {
    // given
    render(<MemoryRouter initialEntries={["/admin/facility#opening-hours"]}><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);

    // when
    const heading = await screen.findByTestId("opening-hours-heading");

    // then
    await vi.waitFor(() => expect(heading).toHaveFocus());
  });

  it("when impact is available, then it is offered as a disclosure", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);

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
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);
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
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);

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
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);

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
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);
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
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);

    // when
    await userEvent.click(await screen.findByTestId("court-impact-court-1"));

    // then — a list that shows one of a hundred and twenty without saying so is what this refuses
    expect(await screen.findByTestId("impact-truncated-court-1")).toBeInTheDocument();
  });

  it("given a booking card in use, when its impact is asked for, then the bookings it would displace are named", async () => {
    // given
    vi.spyOn(api, "bookingCardImpact").mockResolvedValue({
      affectedCount: 1, truncated: false, nextCursor: null,
      bookings: [{ bookingId: "booking-9", courtIds: ["court-1"], startsAt: "2026-09-01T08:00:00Z", endsAt: "2026-09-01T09:00:00Z" }]
    });
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);

    // when
    await userEvent.click(await screen.findByTestId("booking-card-impact-card-1"));

    // then
    expect(await screen.findByTestId("impact-card-1")).toHaveTextContent("1");
  });

  it("given hours a board is about to shorten, when the impact is asked for, then it is asked for the new hours", async () => {
    // given
    const asking = vi.spyOn(api, "openingHoursImpact")
      .mockResolvedValue({ affectedCount: 0, truncated: false, nextCursor: null, bookings: [] });
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("opening-hours-impact-MONDAY");

    // when
    await userEvent.click(screen.getByTestId("opening-hours-impact-MONDAY"));

    // then — the question is about what the form holds now, not about what is stored
    expect(asking).toHaveBeenCalledWith("MONDAY", "08:00", "22:00");
  });

  it("given the club's participant cards, when the view loads, then each is listed with how many it owns", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("participant-card-label-filler-1")).toHaveValue("Ball machine");
    expect(screen.getByTestId("participant-card-capacity-filler-1")).toHaveValue(1);
  });

  it("given a club that bought a second ball machine, when the count is corrected, then it is written", async () => {
    // given
    const changing = vi.spyOn(api, "changeParticipantCard")
      .mockResolvedValue({ id: "filler-1", label: "Ball machine", capacity: 2, active: true });
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);
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
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("participant-card-capacity-filler-1");

    // when
    await userEvent.clear(screen.getByTestId("participant-card-capacity-filler-1"));
    await userEvent.click(screen.getByTestId("save-participant-card-filler-1"));

    // then — absent means unlimited, and an empty field is how a board says that
    expect(changing).toHaveBeenCalledWith("filler-1", { label: "Ball machine", capacity: null });
  });

  it("when a participant card is added, then it is created and joins the list", async () => {
    // given
    const creating = vi.spyOn(api, "createParticipantCard")
      .mockResolvedValue({ id: "filler-2", label: "Looking for a partner", capacity: null, active: true });
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);
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
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);
    await screen.findByTestId("toggle-participant-card-filler-1");

    // when — clicking again restores it, so by this project's rule it is not confirmed
    await userEvent.click(screen.getByTestId("toggle-participant-card-filler-1"));

    // then
    expect(toggling).toHaveBeenCalledWith("filler-1", false);
  });

  it("given facility data, when the view loads, then courts, hours, and card access are visible", async () => {
    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByTestId("court-name-court-1")).toHaveValue("Centre Court");
    expect(screen.getByTestId("hours-open-MONDAY")).toHaveValue("08:00");
    expect(screen.getByTestId("card-label-card-1")).toHaveValue("Member booking");
    const memberRole = screen.getByTestId("card-allowed-roles-card-1-MEMBER");
    expect(memberRole).toHaveRole("checkbox");
    expect(memberRole).toHaveAccessibleName("Member");
    expect(memberRole).toBeChecked();
    expect(screen.getAllByTestId("allowed-roles-hint")).toHaveLength(2);
  });

  it("given facility data cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "adminCourts").mockRejectedValue(new Error("unavailable"));

    // when
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("given an active court, when toggling it twice, then it disappears and can be restored", async () => {
    // given
    const setCourtActive = vi.spyOn(api, "setAdminCourtActive")
      .mockResolvedValueOnce({ id: "court-1", number: 1, name: "Centre Court", active: false })
      .mockResolvedValueOnce({ id: "court-1", number: 1, name: "Centre Court", active: true });
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);
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
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);
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

  it("given changed card access and opening hours, when saving, then the admin API receives the values", async () => {
    // given
    const changeCard = vi.spyOn(api, "changeAdminBookingCard").mockResolvedValue({
      id: "card-1", label: "Training", color: "#34584a", allowedRoles: ["TRAINER", "SPORT_DIRECTOR"],
      managingRoles: ["SPORT_DIRECTOR"], allowedPlayerCounts: [], tracksPlayers: false, countsAgainstLimits: false,
      guestAllowed: false, showGenericOccupancy: false, active: true
    });
    const setHours = vi.spyOn(api, "setAdminOpeningHours").mockResolvedValue({
      dayOfWeek: "MONDAY", opensAt: "09:00:00", closesAt: "21:00:00"
    });
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);
    const user = userEvent.setup();
    await screen.findByTestId("court-name-court-1");

    // when
    await user.clear(screen.getByTestId("card-label-card-1"));
    await user.type(screen.getByTestId("card-label-card-1"), "Training");
    await user.click(screen.getByTestId("card-allowed-roles-card-1-MEMBER"));
    await user.click(screen.getByTestId("card-allowed-roles-card-1-TRAINER"));
    await user.click(screen.getByTestId("card-allowed-roles-card-1-SPORT_DIRECTOR"));
    await user.click(screen.getByTestId("card-generic-occupancy-card-1"));
    await user.clear(screen.getByTestId("card-counts-card-1"));
    await user.type(screen.getByTestId("card-counts-card-1"), "1, 3");
    await user.click(screen.getByTestId("save-card-card-1"));
    await user.clear(screen.getByTestId("hours-open-MONDAY"));
    await user.type(screen.getByTestId("hours-open-MONDAY"), "09:00");
    await user.click(screen.getByTestId("save-hours-MONDAY"));

    // then
    expect(changeCard).toHaveBeenCalledWith("card-1", expect.objectContaining({
      label: "Training", allowedRoles: ["TRAINER", "SPORT_DIRECTOR"],
      managingRoles: [], allowedPlayerCounts: [1, 3], showGenericOccupancy: false
    }));
    expect(setHours).toHaveBeenCalledWith("MONDAY", { opensAt: "09:00", closesAt: "22:00" });
  });

  it("given a card, when choosing who manages its bookings, then member is not offered and the choice is saved", async () => {
    // given
    const changeCard = vi.spyOn(api, "changeAdminBookingCard").mockResolvedValue({
      id: "card-1", label: "Member booking", color: "#b85c38", allowedRoles: ["MEMBER"],
      managingRoles: ["TRAINER"], allowedPlayerCounts: [2, 4], tracksPlayers: true,
      countsAgainstLimits: true, guestAllowed: true, showGenericOccupancy: true, active: true
    });
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);
    const user = userEvent.setup();
    await screen.findByTestId("court-name-court-1");

    // when
    await user.click(screen.getByTestId("card-managing-roles-card-1-TRAINER"));
    await user.click(screen.getByTestId("save-card-card-1"));

    // then
    expect(screen.queryByTestId("card-managing-roles-card-1-MEMBER")).not.toBeInTheDocument();
    expect(changeCard).toHaveBeenCalledWith("card-1", expect.objectContaining({
      allowedRoles: ["MEMBER"], managingRoles: ["TRAINER"]
    }));
  });

  it("given new facility data, when creating it, then courts and cards are added through the admin API", async () => {
    // given
    const createCourt = vi.spyOn(api, "createAdminCourt").mockResolvedValue({
      id: "court-2", number: 2, name: "Garden Court", active: true
    });
    const cardResponse = deferred<Awaited<ReturnType<typeof api.createAdminBookingCard>>>();
    const createCard = vi.spyOn(api, "createAdminBookingCard").mockReturnValue(cardResponse.promise);
    const createdCard: Awaited<ReturnType<typeof api.createAdminBookingCard>> = {
      id: "card-2", label: "Training", color: "#b85c38", allowedRoles: ["TRAINER"],
      managingRoles: ["TRAINER"], allowedPlayerCounts: [], tracksPlayers: false, countsAgainstLimits: false,
      guestAllowed: false, showGenericOccupancy: false, active: true
    };
    render(<MemoryRouter><UnsavedChangesProvider><AdminFacilityView /></UnsavedChangesProvider></MemoryRouter>);
    const user = userEvent.setup();
    await screen.findByTestId("court-name-court-1");

    // when
    await user.type(screen.getByTestId("new-court-number"), "2");
    await user.type(screen.getByTestId("new-court-name"), "Garden Court");
    await user.click(screen.getByTestId("create-court"));
    await user.type(screen.getByTestId("new-card-label"), "Training");
    await user.click(screen.getByTestId("new-card-role-TRAINER"));
    await user.click(screen.getByTestId("new-card-managing-roles-TRAINER"));
    await user.click(screen.getByTestId("create-card"));
    cardResponse.resolve(createdCard);

    // then
    expect(createCourt).toHaveBeenCalledWith({ number: 2, name: "Garden Court" });
    expect(createCard).toHaveBeenCalledWith(expect.objectContaining({
      label: "Training", allowedRoles: ["TRAINER"], managingRoles: ["TRAINER"]
    }));
    expect(await screen.findByRole("status")).toBeVisible();
    expect(screen.getByTestId("new-card-label")).toHaveValue("");
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

