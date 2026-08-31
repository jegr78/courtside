import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api } from "../../api/client";
import i18n from "../../i18n";
import { UnsavedChangesProvider } from "../../unsaved/UnsavedChangesProvider";
import { UnsavedCount } from "../../test/UnsavedCount";
import { AdminBookingCardsView } from "./AdminBookingCardsView";

function show(counted = false) {
  render(<MemoryRouter><UnsavedChangesProvider>
    {counted && <UnsavedCount />}
    <AdminBookingCardsView />
  </UnsavedChangesProvider></MemoryRouter>);
}

describe("AdminBookingCardsView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminBookingCards").mockResolvedValue([
      {
        id: "card-1", label: "Member booking", color: "#b85c38", allowedRoles: ["MEMBER"],
        managingRoles: [], allowedPlayerCounts: [2, 4], tracksPlayers: true, countsAgainstLimits: true,
        guestAllowed: true, showGenericOccupancy: true, active: true
      }
    ]);
    vi.spyOn(api, "config").mockResolvedValue({
      clubName: "Example Tennis Club", primaryColor: "#b85c38", accentColor: "#d7e24b",
      defaultLocale: "en", supportedLocales: ["de", "en"], slotMinutes: 30,
      timeZone: "Pacific/Auckland"
    });
  });

  it("given booking cards, when the view loads, then each card and who may use it is shown", async () => {
    // when
    show();

    // then
    expect(await screen.findByTestId("card-label-card-1")).toHaveValue("Member booking");
    const memberRole = screen.getByTestId("card-allowed-roles-card-1-MEMBER");
    expect(memberRole).toHaveRole("checkbox");
    expect(memberRole).toHaveAccessibleName("Member");
    expect(memberRole).toBeChecked();
    expect(screen.getAllByTestId("allowed-roles-hint")).toHaveLength(2);
  });

  // The page's one primary action opens it, so a board never scrolls past the list to add a card.
  it("when the view loads, then creating a card comes before the cards it would join", async () => {
    // when
    show();

    // then
    const create = await screen.findByTestId("create-card");
    const first = screen.getByTestId("card-label-card-1");
    expect(create.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("given a create form is filled in, when the entry is cleared again, then nothing is left to lose", async () => {
    // given
    show(true);
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

  it("given an edited card, when it is counted, then it is asked about on its own", async () => {
    // given
    show(true);
    await screen.findByTestId("card-label-card-1");

    // when
    await userEvent.type(screen.getByTestId("card-label-card-1"), "!");

    // then
    await waitFor(() => expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1"));
  });

  it("given changed card access, when saving, then the admin API receives the values", async () => {
    // given
    const changeCard = vi.spyOn(api, "changeAdminBookingCard").mockResolvedValue({
      id: "card-1", label: "Training", color: "#34584a", allowedRoles: ["TRAINER", "SPORT_DIRECTOR"],
      managingRoles: ["SPORT_DIRECTOR"], allowedPlayerCounts: [], tracksPlayers: false, countsAgainstLimits: false,
      guestAllowed: false, showGenericOccupancy: false, active: true
    });
    show();
    const user = userEvent.setup();
    await screen.findByTestId("card-label-card-1");

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

    // then
    expect(changeCard).toHaveBeenCalledWith("card-1", expect.objectContaining({
      label: "Training", allowedRoles: ["TRAINER", "SPORT_DIRECTOR"],
      managingRoles: [], allowedPlayerCounts: [1, 3], showGenericOccupancy: false
    }));
  });

  it("given a card, when choosing who manages its bookings, then member is not offered and the choice is saved", async () => {
    // given
    const changeCard = vi.spyOn(api, "changeAdminBookingCard").mockResolvedValue({
      id: "card-1", label: "Member booking", color: "#b85c38", allowedRoles: ["MEMBER"],
      managingRoles: ["TRAINER"], allowedPlayerCounts: [2, 4], tracksPlayers: true,
      countsAgainstLimits: true, guestAllowed: true, showGenericOccupancy: true, active: true
    });
    show();
    const user = userEvent.setup();
    await screen.findByTestId("card-label-card-1");

    // when
    await user.click(screen.getByTestId("card-managing-roles-card-1-TRAINER"));
    await user.click(screen.getByTestId("save-card-card-1"));

    // then
    expect(screen.queryByTestId("card-managing-roles-card-1-MEMBER")).not.toBeInTheDocument();
    expect(changeCard).toHaveBeenCalledWith("card-1", expect.objectContaining({
      allowedRoles: ["MEMBER"], managingRoles: ["TRAINER"]
    }));
  });

  it("given a new card, when creating it, then it is added through the admin API and the form is cleared", async () => {
    // given
    const cardResponse = deferred<Awaited<ReturnType<typeof api.createAdminBookingCard>>>();
    const createCard = vi.spyOn(api, "createAdminBookingCard").mockReturnValue(cardResponse.promise);
    const createdCard: Awaited<ReturnType<typeof api.createAdminBookingCard>> = {
      id: "card-2", label: "Training", color: "#b85c38", allowedRoles: ["TRAINER"],
      managingRoles: ["TRAINER"], allowedPlayerCounts: [], tracksPlayers: false, countsAgainstLimits: false,
      guestAllowed: false, showGenericOccupancy: false, active: true
    };
    show();
    const user = userEvent.setup();
    await screen.findByTestId("card-label-card-1");

    // when
    await user.type(screen.getByTestId("new-card-label"), "Training");
    await user.click(screen.getByTestId("new-card-role-TRAINER"));
    await user.click(screen.getByTestId("new-card-managing-roles-TRAINER"));
    await user.click(screen.getByTestId("create-card"));
    cardResponse.resolve(createdCard);

    // then
    expect(createCard).toHaveBeenCalledWith(expect.objectContaining({
      label: "Training", allowedRoles: ["TRAINER"], managingRoles: ["TRAINER"]
    }));
    expect(await screen.findByRole("status")).toBeVisible();
    expect(screen.getByTestId("new-card-label")).toHaveValue("");
  });

  it("given a booking card in use, when its impact is asked for, then the bookings it would displace are named", async () => {
    // given
    vi.spyOn(api, "bookingCardImpact").mockResolvedValue({
      affectedCount: 1, truncated: false, nextCursor: null,
      bookings: [{ bookingId: "booking-9", courtIds: ["court-1"], startsAt: "2026-09-01T08:00:00Z", endsAt: "2026-09-01T09:00:00Z" }]
    });
    show();

    // when
    await userEvent.click(await screen.findByTestId("booking-card-impact-card-1"));

    // then
    expect(await screen.findByTestId("impact-card-1")).toHaveTextContent("1");
  });

  it("given booking cards cannot load, when opening the view, then the failure replaces the loading state", async () => {
    // given
    vi.spyOn(api, "adminBookingCards").mockRejectedValue(new Error("unavailable"));

    // when
    show();

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work. Please try again.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
