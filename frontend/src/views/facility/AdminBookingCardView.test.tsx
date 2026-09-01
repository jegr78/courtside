import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api, type BookingCard } from "../../api/client";
import i18n from "../../i18n";
import { UnsavedChangesProvider } from "../../unsaved/UnsavedChangesProvider";
import { UnsavedCount } from "../../test/UnsavedCount";
import { WithClubConfiguration } from "../../test/ClubConfiguration";
import { AdminBookingCardView } from "./AdminBookingCardView";

const memberCard: BookingCard = {
  id: "card-1", label: "Member booking", color: "#b85c38", allowedRoles: ["MEMBER"],
  managingRoles: [], allowedPlayerCounts: [2, 4], tracksPlayers: true, countsAgainstLimits: true,
  guestAllowed: true, showGenericOccupancy: false, active: true
};

function show(cardId = "card-1", counted = false) {
  render(<MemoryRouter initialEntries={[`/admin/facility/booking-cards/${cardId}`]}>
    <WithClubConfiguration><UnsavedChangesProvider>
      {counted && <UnsavedCount />}
      <Routes>
        <Route path="/admin/facility/booking-cards/:cardId" element={<AdminBookingCardView />} />
      </Routes>
    </UnsavedChangesProvider></WithClubConfiguration>
  </MemoryRouter>);
}

describe("AdminBookingCardView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminBookingCards").mockResolvedValue([memberCard]);
  });

  it("given a card id in the route, when the page loads, then that card is the one being edited", async () => {
    // when
    show();

    // then
    expect(await screen.findByTestId("card-label")).toHaveValue("Member booking");
  });

  it("given a card with counts, when one is added and another removed, then the request carries the numbers", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminBookingCard").mockResolvedValue(memberCard);
    show();
    await screen.findByTestId("card-label");

    // when
    await userEvent.click(screen.getByTestId("card-counts-remove-4"));
    await userEvent.type(screen.getByTestId("card-counts-entry"), "3");
    await userEvent.click(screen.getByTestId("card-counts-add"));
    await userEvent.click(screen.getByTestId("save-card"));

    // then
    await waitFor(() => expect(change).toHaveBeenCalledWith("card-1",
      expect.objectContaining({ allowedPlayerCounts: [2, 3] })));
  });

  // The free-text field this replaced turned "drei" into NaN, which JSON.stringify sent as null.
  it("given the player counts, when something that is not a number is entered, then it cannot be added", async () => {
    // given
    show();
    await screen.findByTestId("card-label");

    // when
    await userEvent.type(screen.getByTestId("card-counts-entry"), "drei");
    await userEvent.click(screen.getByTestId("card-counts-add"));

    // then
    expect(screen.getByTestId("card-counts-add")).toBeDisabled();
    expect(screen.getByTestId("card-counts-list")).toHaveTextContent(/^2 ×4 ×$/);
  });

  it.each([["0", "below the range"], ["21", "above the range"], ["2", "already chosen"]])(
    "given the player counts, when %s is entered, then it cannot be added because it is %s",
    async (entry) => {
      // given
      show();
      await screen.findByTestId("card-label");

      // when
      await userEvent.type(screen.getByTestId("card-counts-entry"), entry);

      // then
      expect(screen.getByTestId("card-counts-add")).toBeDisabled();
    });

  it("given a card, when its colour changes, then the preview shows the new colour before any save", async () => {
    // given
    show();
    await screen.findByTestId("card-label");
    expect(screen.getByTestId("card-preview")).toHaveAttribute("data-card-color", "#b85c38");

    // when
    await userEvent.clear(screen.getByTestId("card-label"));
    await userEvent.type(screen.getByTestId("card-label"), "Training");

    // then
    expect(screen.getByTestId("card-preview")).toHaveTextContent("Training");
  });

  // The plan hides the label behind a neutral word when the card asks for it, and so must the preview.
  it("given a card shown neutrally, when the preview renders, then it hides the label the plan would hide", async () => {
    // given
    show();
    await screen.findByTestId("card-label");

    // when
    await userEvent.click(screen.getByTestId("card-generic-occupancy"));

    // then
    const preview = screen.getByTestId("card-preview");
    expect(preview).toHaveAttribute("data-state", "occupied");
    expect(preview).toHaveTextContent("Booked");
    expect(preview).not.toHaveTextContent("Member booking");
  });

  it("given every field is changed, when the card is saved, then one request carries all of them", async () => {
    // given
    const change = vi.spyOn(api, "changeAdminBookingCard").mockResolvedValue(memberCard);
    show();
    await screen.findByTestId("card-label");

    // when
    await userEvent.clear(screen.getByTestId("card-label"));
    await userEvent.type(screen.getByTestId("card-label"), "Training");
    await userEvent.click(screen.getByTestId("card-allowed-roles-TRAINER"));
    await userEvent.click(screen.getByTestId("card-managing-roles-SPORT_DIRECTOR"));
    await userEvent.click(screen.getByTestId("card-guest-allowed"));
    await userEvent.click(screen.getByTestId("save-card"));

    // then
    await waitFor(() => expect(change).toHaveBeenCalledTimes(1));
    expect(change).toHaveBeenCalledWith("card-1", {
      label: "Training", color: "#b85c38", allowedRoles: ["MEMBER", "TRAINER"],
      managingRoles: ["SPORT_DIRECTOR"], allowedPlayerCounts: [2, 4],
      countsAgainstLimits: true, guestAllowed: false, showGenericOccupancy: false
    });
  });

  // A refused save that reset the form would throw away what the board had just typed.
  it("given a save is refused, when the failure is shown, then the entered values are still there", async () => {
    // given
    vi.spyOn(api, "changeAdminBookingCard").mockRejectedValue(new Error("nope"));
    show();
    await screen.findByTestId("card-label");
    await userEvent.clear(screen.getByTestId("card-label"));
    await userEvent.type(screen.getByTestId("card-label"), "Training");

    // when
    await userEvent.click(screen.getByTestId("save-card"));

    // then
    await screen.findByRole("alert");
    expect(screen.getByTestId("card-label")).toHaveValue("Training");
  });

  it("given a card id that names nothing, when the page loads, then it says so instead of offering an empty form", async () => {
    // when
    show("card-does-not-exist");

    // then
    expect(await screen.findByRole("alert")).toHaveTextContent("There is no such booking card.");
    expect(screen.queryByTestId("card-label")).toBeNull();
  });

  // The server strips MEMBER before matching a managing role, so offering it would be a lie.
  it("given the managing roles, when choosing who may open the bookings, then member is not among them", async () => {
    // when
    show();

    // then
    await screen.findByTestId("card-label");
    expect(screen.getByTestId("card-allowed-roles-MEMBER")).toBeVisible();
    expect(screen.queryByTestId("card-managing-roles-MEMBER")).toBeNull();
  });

  it("given a card in use, when its impact is asked for, then the bookings it would displace are named", async () => {
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

  it("given an edited card, when it is counted, then what is unsaved is the card being edited", async () => {
    // given
    show("card-1", true);
    await screen.findByTestId("card-label");
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");

    // when
    await userEvent.type(screen.getByTestId("card-label"), "!");

    // then
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1");
  });
});
