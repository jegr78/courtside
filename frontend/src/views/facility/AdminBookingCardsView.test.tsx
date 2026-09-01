import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { api, type BookingCard } from "../../api/client";
import i18n from "../../i18n";
import { UnsavedChangesProvider } from "../../unsaved/UnsavedChangesProvider";
import { UnsavedCount } from "../../test/UnsavedCount";
import { WithClubConfiguration } from "../../test/ClubConfiguration";
import { AdminBookingCardsView } from "./AdminBookingCardsView";

const memberCard: BookingCard = {
  id: "card-1", label: "Member booking", color: "#b85c38", allowedRoles: ["MEMBER"],
  managingRoles: [], allowedPlayerCounts: [2, 4], tracksPlayers: true, countsAgainstLimits: true,
  guestAllowed: true, showGenericOccupancy: true, active: true
};

function ArrivedAtCard() {
  const { cardId } = useParams();
  return <p data-testid={`arrived-at-${cardId}`}>{cardId}</p>;
}

function show(counted = false) {
  render(<MemoryRouter initialEntries={["/admin/facility/booking-cards"]}>
    <WithClubConfiguration><UnsavedChangesProvider>
      {counted && <UnsavedCount />}
      <Routes>
        <Route path="/admin/facility/booking-cards" element={<AdminBookingCardsView />} />
        <Route path="/admin/facility/booking-cards/:cardId" element={<ArrivedAtCard />} />
      </Routes>
    </UnsavedChangesProvider></WithClubConfiguration>
  </MemoryRouter>);
}

describe("AdminBookingCardsView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "adminBookingCards").mockResolvedValue([memberCard]);
  });

  it("given booking cards, when the view loads, then each card links to the page that edits it", async () => {
    // when
    show();

    // then
    const link = await screen.findByTestId("card-link-card-1");
    expect(link).toHaveRole("link");
    expect(link).toHaveAttribute("href", "/admin/facility/booking-cards/card-1");
    expect(screen.getByTestId("card-status-card-1")).toHaveTextContent("Active");
  });

  // The page's one primary action opens it, so a board never scrolls past the list to add a card.
  it("when the view loads, then creating a card comes before the cards it would join", async () => {
    // when
    show();

    // then
    const create = await screen.findByTestId("create-card");
    const first = screen.getByTestId("card-link-card-1");
    expect(create.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("given a create form is filled in, when the entry is cleared again, then nothing is left to lose", async () => {
    // given
    show(true);
    const label = await screen.findByTestId("new-card-label");
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");

    // when
    await userEvent.type(label, "Training");
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1");
    await userEvent.clear(label);

    // then
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");
  });

  it("given a new card, when it is created, then the page that edits it opens", async () => {
    // given
    const createCard = vi.spyOn(api, "createAdminBookingCard").mockResolvedValue({
      ...memberCard, id: "card-2", label: "Training", allowedRoles: ["TRAINER"],
      managingRoles: ["TRAINER"], allowedPlayerCounts: [], tracksPlayers: false
    });
    show();
    await screen.findByTestId("new-card-label");

    // when
    await userEvent.type(screen.getByTestId("new-card-label"), "Training");
    await userEvent.click(screen.getByTestId("new-card-role-TRAINER"));
    await userEvent.click(screen.getByTestId("new-card-managing-roles-TRAINER"));
    await userEvent.type(screen.getByTestId("new-card-counts-entry"), "2");
    await userEvent.click(screen.getByTestId("new-card-counts-add"));
    await userEvent.click(screen.getByTestId("create-card"));

    // then
    expect(createCard).toHaveBeenCalledWith(expect.objectContaining({
      label: "Training", allowedRoles: ["TRAINER"], managingRoles: ["TRAINER"],
      allowedPlayerCounts: [2]
    }));
    expect(await screen.findByTestId("arrived-at-card-2")).toBeVisible();
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

  it("given a player count was added, when nothing else is filled in, then the form still has something to lose", async () => {
    // given
    show(true);
    await screen.findByTestId("new-card-counts-entry");

    // when
    await userEvent.type(screen.getByTestId("new-card-counts-entry"), "2");
    await userEvent.click(screen.getByTestId("new-card-counts-add"));

    // then
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1");

    // when
    await userEvent.click(screen.getByTestId("new-card-counts-remove-2"));

    // then
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");
  });

  it("given a card was created, when its page opens, then the create form leaves nothing behind to lose", async () => {
    // given
    vi.spyOn(api, "createAdminBookingCard").mockResolvedValue({ ...memberCard, id: "card-2" });
    show(true);
    await userEvent.type(await screen.findByTestId("new-card-label"), "Training");
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("1");

    // when
    await userEvent.click(screen.getByTestId("create-card"));

    // then
    expect(await screen.findByTestId("arrived-at-card-2")).toBeVisible();
    expect(screen.getByTestId("unsaved-count")).toHaveTextContent("0");
  });
});
