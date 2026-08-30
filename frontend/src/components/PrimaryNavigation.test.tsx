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
  "admin-configuration-link", "admin-facility-link", "admin-roster-link",
  "admin-membership-types-link", "admin-import-link", "admin-audit-link",
  "admin-messages-link"
];

function show(session: SessionStatus, at = "/", signedOut = () => undefined) {
  render(<MemoryRouter initialEntries={[at]}>
    <PrimaryNavigation session={session} signedOut={signedOut} />
  </MemoryRouter>);
}

describe("PrimaryNavigation", () => {
  it("given an anonymous visitor, when rendered, then only the court plan and signing in are offered", () => {
    show(anonymous);
    expect(screen.getByTestId("court-plan-link")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-link")).toHaveAttribute("href", "/login");
    expect(screen.queryByTestId("my-bookings-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("logout")).not.toBeInTheDocument();
  });

  it("given a member, when rendered, then no administrative destination is offered", () => {
    show(member);
    expect(screen.getByTestId("my-bookings-link")).toBeInTheDocument();
    for (const destination of adminDestinations) {
      expect(screen.queryByTestId(destination)).not.toBeInTheDocument();
    }
  });

  it("given an administrator, when rendered, then every administrative destination is offered", () => {
    show(administrator);
    for (const destination of adminDestinations) {
      expect(screen.getByTestId(destination)).toBeInTheDocument();
    }
  });

  it("given the roster is open, when rendered, then its link is the current page and its siblings are not", () => {
    show(administrator, "/admin/roster");
    expect(screen.getByTestId("admin-roster-link")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("admin-facility-link")).not.toHaveAttribute("aria-current");
  });

  it("given a person below the roster is open, when rendered, then the roster stays the current page", () => {
    show(administrator, "/admin/roster/a3f1e2d4-0000-0000-0000-000000000001");
    expect(screen.getByTestId("admin-roster-link")).toHaveAttribute("aria-current", "page");
  });

  it("given the court plan is open under its other address, when rendered, then it is still the current page", () => {
    show(anonymous, "/courts");
    expect(screen.getByTestId("court-plan-link")).toHaveAttribute("aria-current", "page");
  });

  it("given an administrator deep in an admin view, when signing out, then they need no detour over the court plan", async () => {
    const signedOut = vi.fn();
    vi.spyOn(api, "logout").mockResolvedValue();
    show(administrator, "/admin/roster", signedOut);

    await userEvent.click(screen.getByTestId("logout"));

    expect(api.logout).toHaveBeenCalled();
    expect(signedOut).toHaveBeenCalled();
  });

  it("given signing out fails, when it is attempted, then the failure is shown and the session is kept", async () => {
    const signedOut = vi.fn();
    vi.spyOn(api, "logout").mockRejectedValue(new Error("network"));
    show(administrator, "/admin/roster", signedOut);

    await userEvent.click(screen.getByTestId("logout"));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(signedOut).not.toHaveBeenCalled();
  });

  it("given the sign in page is open, when rendered, then nothing offers to sign in a second time", () => {
    show(anonymous, "/login");
    expect(screen.getByTestId("court-plan-link")).toBeInTheDocument();
    expect(screen.queryByTestId("sign-in-link")).not.toBeInTheDocument();
  });
});
