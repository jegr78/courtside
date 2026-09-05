import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { type SessionStatus } from "../api/client";
import { PrimaryNavigation } from "./PrimaryNavigation";

const anonymous: SessionStatus = { authenticated: false, roles: [], passwordChangeRequired: false };
const member: SessionStatus = { authenticated: true, roles: ["MEMBER"], passwordChangeRequired: false };
const administrator: SessionStatus = { authenticated: true, roles: ["ADMIN"], passwordChangeRequired: false };

const adminDestinations = [
  "admin-configuration-link", "admin-courts-link", "admin-opening-hours-link",
  "admin-booking-cards-link", "admin-slot-fillers-link", "admin-roster-link",
  "admin-membership-types-link", "admin-import-link", "admin-audit-link",
  "admin-messages-link"
];

function show(session: SessionStatus, at = "/") {
  render(<MemoryRouter initialEntries={[at]}>
    <PrimaryNavigation session={session} />
  </MemoryRouter>);
}

describe("PrimaryNavigation", () => {
  it("given an anonymous visitor, when rendered, then only the court plan and signing in are offered", () => {
    show(anonymous);
    expect(screen.getByTestId("court-plan-link")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-link")).toHaveAttribute("href", "/login");
    expect(screen.queryByTestId("my-bookings-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("administration-link")).not.toBeInTheDocument();
  });

  it("given more than one destination, when rendered on a phone, then the bar sits where a thumb reaches", () => {
    // when
    show(member);

    // then
    const bar = screen.getByTestId("primary-navigation-bar");
    expect(bar).toHaveClass("fixed", "inset-x-0", "bottom-0");
    // then — under the modal overlay at z-20, so a dialog's own buttons stay tappable
    expect(bar).toHaveClass("z-10");
    expect(bar).toHaveClass("sm:static");
  });

  it("given a visitor with one destination, when rendered, then no bar takes a phone's bottom edge", () => {
    // when
    show(anonymous);

    // then — a bar holding the page you are already on is a strip of screen for nothing
    expect(screen.getByTestId("court-plan-link")).toBeInTheDocument();
    expect(screen.queryByTestId("primary-navigation-bar")).not.toBeInTheDocument();
  });

  it("given an administrator, when rendered on a phone, then the bar holds at most four destinations", () => {
    // when
    show(administrator);

    // then
    expect(screen.getByTestId("primary-navigation-bar").querySelectorAll("a").length)
      .toBeLessThanOrEqual(4);
  });

  it("given a member, when rendered, then nothing offers administration", () => {
    show(member);
    expect(screen.getByTestId("my-bookings-link")).toBeInTheDocument();
    expect(screen.queryByTestId("administration-link")).not.toBeInTheDocument();
  });

  // The destinations themselves live in the administration's own navigation, not in this bar.
  it("given an administrator, when rendered, then administration is offered as one destination", () => {
    show(administrator);
    expect(screen.getByTestId("administration-link")).toHaveAttribute("href", "/admin/configuration");
    for (const destination of adminDestinations) {
      expect(screen.queryByTestId(destination)).not.toBeInTheDocument();
    }
  });

  it("given the court plan is open under its other address, when rendered, then it is still the current page", () => {
    show(anonymous, "/courts");
    expect(screen.getByTestId("court-plan-link")).toHaveAttribute("aria-current", "page");
  });

  // Signing out belongs to the account and is offered there, never as the loudest control on a page.
  it("when rendered, then signing out is not one of the destinations", () => {
    show(administrator);
    expect(screen.queryByTestId("logout")).not.toBeInTheDocument();
  });

  it("given the sign in page is open, when rendered, then nothing offers to sign in a second time", () => {
    show(anonymous, "/login");
    expect(screen.getByTestId("court-plan-link")).toBeInTheDocument();
    expect(screen.queryByTestId("sign-in-link")).not.toBeInTheDocument();
  });
});
