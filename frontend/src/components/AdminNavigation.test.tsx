import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import i18n from "../i18n";
import { AdminNavigation } from "./AdminNavigation";

function show(at: string) {
  render(<MemoryRouter initialEntries={[at]}><AdminNavigation /></MemoryRouter>);
}

function resizeTo(width: number) {
  window.innerWidth = width;
  window.dispatchEvent(new Event("resize"));
}

describe("AdminNavigation", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    resizeTo(1280);
  });

  it("given the administration, when the navigation is read, then its destinations sit in named groups", () => {
    // when
    show("/admin/configuration");

    // then
    const club = screen.getByTestId("admin-group-club");
    expect(within(club).getByTestId("admin-configuration-link")).toBeInTheDocument();
    const facility = screen.getByTestId("admin-group-facility");
    expect(within(facility).getByTestId("admin-courts-link")).toBeInTheDocument();
    expect(within(facility).getByTestId("admin-opening-hours-link")).toBeInTheDocument();
    expect(within(facility).getByTestId("admin-booking-cards-link")).toBeInTheDocument();
    expect(within(facility).getByTestId("admin-slot-fillers-link")).toBeInTheDocument();
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
    show("/admin/facility/opening-hours");

    // then
    expect(screen.getByTestId("admin-opening-hours-link")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("admin-courts-link")).not.toHaveAttribute("aria-current");
    expect(screen.getByTestId("admin-configuration-link")).not.toHaveAttribute("aria-current");
  });

  // The four subjects are pages of their own, so a board reaches Sunday without passing the courts.
  it("given the facility group, when its destinations are read, then each subject has an address", () => {
    // when
    show("/admin/facility/courts");

    // then
    expect(screen.getByTestId("admin-courts-link")).toHaveAttribute("href", "/admin/facility/courts");
    expect(screen.getByTestId("admin-opening-hours-link")).toHaveAttribute("href", "/admin/facility/opening-hours");
    expect(screen.getByTestId("admin-booking-cards-link")).toHaveAttribute("href", "/admin/facility/booking-cards");
    expect(screen.getByTestId("admin-slot-fillers-link")).toHaveAttribute("href", "/admin/facility/slot-fillers");
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

  // Above the breakpoint the panel is laid open by the element's own state: a stylesheet cannot
  // reveal it, because the browser hides a closed disclosure's content whatever its display says.
  it("given a window wider than the breakpoint, when the navigation is shown, then it is laid open", () => {
    // when
    show("/admin/facility/courts");

    // then
    expect(screen.getByTestId("admin-navigation")).toHaveAttribute("open");
  });

  it("given a window narrower than the breakpoint, when the navigation is shown, then it stays folded", () => {
    // given
    resizeTo(375);

    // when
    show("/admin/facility/courts");

    // then
    expect(screen.getByTestId("admin-navigation")).not.toHaveAttribute("open");
  });

  it("given a folded navigation, when the window grows past the breakpoint, then it lays itself open", () => {
    // given
    resizeTo(375);
    show("/admin/facility/courts");

    // when
    act(() => resizeTo(1280));

    // then
    expect(screen.getByTestId("admin-navigation")).toHaveAttribute("open");
  });
});
