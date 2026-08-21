import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { api, type SessionStatus } from "../api/client";
import { PrimaryNavigation } from "./PrimaryNavigation";

const anonymous: SessionStatus = { authenticated: false, roles: [], passwordChangeRequired: false };
const member: SessionStatus = { authenticated: true, roles: ["MEMBER"], passwordChangeRequired: false };
const administrator: SessionStatus = { authenticated: true, roles: ["ADMIN"], passwordChangeRequired: false };

const adminDestinations = [
  "admin-configuration-link", "admin-facility-link", "admin-roster-link", "admin-audit-link"
];

function show(session: SessionStatus, at = "/", signedOut = () => undefined) {
  render(<MemoryRouter initialEntries={[at]}>
    <PrimaryNavigation session={session} signedOut={signedOut} />
  </MemoryRouter>);
}

describe("PrimaryNavigation", () => {
  it("givenAnAnonymousVisitor_whenRendered_thenOnlyTheCourtPlanAndSigningInAreOffered", () => {
    show(anonymous);
    expect(screen.getByTestId("court-plan-link")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-link")).toHaveAttribute("href", "/login");
    expect(screen.queryByTestId("my-bookings-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("logout")).not.toBeInTheDocument();
  });

  it("givenAMember_whenRendered_thenNoAdministrativeDestinationIsOffered", () => {
    show(member);
    expect(screen.getByTestId("my-bookings-link")).toBeInTheDocument();
    for (const destination of adminDestinations) {
      expect(screen.queryByTestId(destination)).not.toBeInTheDocument();
    }
  });

  it("givenAnAdministrator_whenRendered_thenEveryAdministrativeDestinationIsOffered", () => {
    show(administrator);
    for (const destination of adminDestinations) {
      expect(screen.getByTestId(destination)).toBeInTheDocument();
    }
  });

  it("givenTheRosterIsOpen_whenRendered_thenItsLinkIsTheCurrentPageAndItsSiblingsAreNot", () => {
    show(administrator, "/admin/roster");
    expect(screen.getByTestId("admin-roster-link")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("admin-facility-link")).not.toHaveAttribute("aria-current");
  });

  it("givenAPersonBelowTheRosterIsOpen_whenRendered_thenTheRosterStaysTheCurrentPage", () => {
    show(administrator, "/admin/roster/a3f1e2d4-0000-0000-0000-000000000001");
    expect(screen.getByTestId("admin-roster-link")).toHaveAttribute("aria-current", "page");
  });

  it("givenTheCourtPlanIsOpenUnderItsOtherAddress_whenRendered_thenItIsStillTheCurrentPage", () => {
    show(anonymous, "/courts");
    expect(screen.getByTestId("court-plan-link")).toHaveAttribute("aria-current", "page");
  });

  it("givenAnAdministratorDeepInAnAdminView_whenSigningOut_thenTheyNeedNoDetourOverTheCourtPlan", async () => {
    const signedOut = vi.fn();
    vi.spyOn(api, "logout").mockResolvedValue();
    show(administrator, "/admin/roster", signedOut);

    await userEvent.click(screen.getByTestId("logout"));

    expect(api.logout).toHaveBeenCalled();
    expect(signedOut).toHaveBeenCalled();
  });

  it("givenSigningOutFails_whenItIsAttempted_thenTheFailureIsShownAndTheSessionIsKept", async () => {
    const signedOut = vi.fn();
    vi.spyOn(api, "logout").mockRejectedValue(new Error("network"));
    show(administrator, "/admin/roster", signedOut);

    await userEvent.click(screen.getByTestId("logout"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(signedOut).not.toHaveBeenCalled();
  });
});
