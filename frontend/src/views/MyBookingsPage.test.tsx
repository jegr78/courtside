import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type SessionStatus } from "../api/client";
import i18n from "../i18n";
import { MyBookingsPage } from "./MyBookingsPage";

vi.mock("./MyBookingsView", () => ({ MyBookingsView: () => null }));

const member: SessionStatus = { authenticated: true, roles: ["MEMBER"], passwordChangeRequired: false, displayName: "Jane Doe" };

function show() {
  render(<MemoryRouter initialEntries={["/my-bookings"]}><MyBookingsPage session={member} /></MemoryRouter>);
}

describe("MyBookingsPage", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  it("given a member who acts for somebody, when the bookings page is shown, then it links the dependants", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValue([
      { personId: "person-2", firstName: "John", lastName: "Roe", grants: ["BOOK"], endedOn: null }
    ]);

    // when
    show();

    // then
    expect(await screen.findByTestId("my-dependants-shortcut")).toHaveAttribute("href", "/my-dependants");
  });

  it("given a member who acts for nobody, when the bookings page is shown, then nothing links dependants", async () => {
    // given
    const read = vi.spyOn(api, "dependants").mockResolvedValue([]);

    // when
    show();

    // then
    await waitFor(() => expect(read).toHaveBeenCalled());
    expect(screen.queryByTestId("my-dependants-shortcut")).toBeNull();
  });
});
