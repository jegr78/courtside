import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import i18n from "../i18n";
import { AdminNavigation } from "./AdminNavigation";

function show(at: string) {
  render(<MemoryRouter initialEntries={[at]}><AdminNavigation /></MemoryRouter>);
}

describe("AdminNavigation", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("given the administration, when the navigation is read, then its destinations sit in named groups", () => {
    // when
    show("/admin/configuration");

    // then
    const club = screen.getByTestId("admin-group-club");
    expect(within(club).getByTestId("admin-configuration-link")).toBeInTheDocument();
    expect(within(club).getByTestId("admin-facility-link")).toBeInTheDocument();
    const people = screen.getByTestId("admin-group-people");
    expect(within(people).getByTestId("admin-roster-link")).toBeInTheDocument();
    expect(within(people).getByTestId("admin-membership-types-link")).toBeInTheDocument();
    expect(within(people).getByTestId("admin-import-link")).toBeInTheDocument();
    const records = screen.getByTestId("admin-group-records");
    expect(within(records).getByTestId("admin-audit-link")).toBeInTheDocument();
    expect(within(records).getByTestId("admin-messages-link")).toBeInTheDocument();
  });

  it("given the administration, when the navigation is read, then the court plan is the way back", () => {
    // when
    show("/admin/configuration");

    // then
    expect(screen.getByTestId("court-plan-link")).toHaveAttribute("href", "/");
  });

  it("given a page under administration, when the navigation is read, then only that destination is current", () => {
    // when
    show("/admin/facility");

    // then
    expect(screen.getByTestId("admin-facility-link")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("admin-configuration-link")).not.toHaveAttribute("aria-current");
  });

  // One person is opened from the roster and stays part of it, so the roster is where a board is.
  it("given one person's page, when the navigation is read, then the roster is the current destination", () => {
    // when
    show("/admin/roster/person-1");

    // then
    expect(screen.getByTestId("admin-roster-link")).toHaveAttribute("aria-current", "page");
  });

  // Folded away, the current destination is invisible, so the control that opens the list says it.
  it("given the destinations are folded away, when the control is read, then it names the current one", () => {
    // when
    show("/admin/import");

    // then
    expect(screen.getByTestId("admin-menu")).toHaveTextContent("Import");
  });
});
