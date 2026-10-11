import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type SessionStatus } from "../api/client";
import { PrimaryNavigation } from "../components/PrimaryNavigation";
import i18n from "../i18n";
import { announceNotificationsRead } from "./unreadNotifications";

const member: SessionStatus = { authenticated: true, roles: ["MEMBER"], passwordChangeRequired: false };
const anonymous: SessionStatus = { authenticated: false, roles: [], passwordChangeRequired: false };

function show(session: SessionStatus) {
  render(<MemoryRouter initialEntries={["/"]}><PrimaryNavigation session={session} /></MemoryRouter>);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});

describe("unread notifications in the primary navigation", () => {
  it("given unread notifications, when a member's navigation renders, then the messages link shows and names the count", async () => {
    // given
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [], nextCursor: null, unread: 3 });

    // when
    show(member);

    // then
    expect(await screen.findByTestId("my-messages-unread")).toHaveTextContent("3");
    expect(screen.getByTestId("my-messages-link")).toHaveAccessibleName("Notifications, 3 unread");
    expect(api.ownNotifications).toHaveBeenCalledWith(undefined, 1);
  });

  it("given one unread notification, when the navigation renders in German, then the name uses the singular", async () => {
    // given
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [], nextCursor: null, unread: 1 });
    await i18n.changeLanguage("de");

    // when
    show(member);

    // then
    expect(await screen.findByTestId("my-messages-unread")).toHaveTextContent("1");
    expect(screen.getByTestId("my-messages-link")).toHaveAccessibleName("Benachrichtigungen, 1 ungelesen");
  });

  it("given nothing unread, when a member's navigation renders, then no badge is shown and the name carries no count", async () => {
    // given
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [], nextCursor: null, unread: 0 });

    // when
    show(member);

    // then
    await waitFor(() => expect(api.ownNotifications).toHaveBeenCalled());
    expect(screen.queryByTestId("my-messages-unread")).not.toBeInTheDocument();
    expect(screen.getByTestId("my-messages-link")).toHaveAccessibleName("Notifications");
  });

  it("given the count on screen, when the member moves to another page, then the count is read again", async () => {
    // given
    vi.spyOn(api, "ownNotifications")
      .mockResolvedValueOnce({ items: [], nextCursor: null, unread: 3 })
      .mockResolvedValue({ items: [], nextCursor: null, unread: 1 });
    show(member);
    await screen.findByTestId("my-messages-unread");

    // when
    await userEvent.click(screen.getByTestId("my-bookings-link"));

    // then
    await waitFor(() => expect(screen.getByTestId("my-messages-unread")).toHaveTextContent("1"));
    expect(api.ownNotifications).toHaveBeenCalledTimes(2);
  });

  it("given the count on screen, when an entry is marked read, then the count is read again", async () => {
    // given
    vi.spyOn(api, "ownNotifications")
      .mockResolvedValueOnce({ items: [], nextCursor: null, unread: 1 })
      .mockResolvedValue({ items: [], nextCursor: null, unread: 0 });
    show(member);
    await screen.findByTestId("my-messages-unread");

    // when
    act(() => announceNotificationsRead());

    // then
    await waitFor(() => expect(screen.queryByTestId("my-messages-unread")).not.toBeInTheDocument());
    expect(screen.getByTestId("my-messages-link")).toHaveAccessibleName("Notifications");
  });

  it("given the count cannot be read, when the navigation renders, then it shows no badge and stays usable", async () => {
    // given
    vi.spyOn(api, "ownNotifications").mockRejectedValue(new Error("offline"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // when
    show(member);

    // then
    await waitFor(() => expect(warning).toHaveBeenCalled());
    expect(screen.queryByTestId("my-messages-unread")).not.toBeInTheDocument();
    expect(screen.getByTestId("my-messages-link")).toHaveAccessibleName("Notifications");
  });

  it("given a count on screen, when the member signs out and another signs in, then the old count never shows for the new account", async () => {
    // given
    let answerNext: (unread: number) => void = () => undefined;
    vi.spyOn(api, "ownNotifications")
      .mockResolvedValueOnce({ items: [], nextCursor: null, unread: 3 })
      .mockImplementationOnce(() => new Promise((resolve) => {
        answerNext = (unread) => resolve({ items: [], nextCursor: null, unread });
      }));
    const view = render(<MemoryRouter initialEntries={["/"]}><PrimaryNavigation session={member} /></MemoryRouter>);
    expect(await screen.findByTestId("my-messages-unread")).toHaveTextContent("3");
    view.rerender(<MemoryRouter initialEntries={["/"]}><PrimaryNavigation session={anonymous} /></MemoryRouter>);

    // when
    view.rerender(<MemoryRouter initialEntries={["/"]}><PrimaryNavigation session={{ ...member }} /></MemoryRouter>);

    // then
    expect(screen.queryByTestId("my-messages-unread"), "the previous account's count is gone").not.toBeInTheDocument();
    act(() => answerNext(1));
    expect(await screen.findByTestId("my-messages-unread")).toHaveTextContent("1");
  });

  it("given an anonymous visitor, when the navigation renders, then no count is asked for", () => {
    // given
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [], nextCursor: null, unread: 2 });

    // when
    show(anonymous);

    // then
    expect(api.ownNotifications).not.toHaveBeenCalled();
    expect(screen.queryByTestId("my-messages-unread")).not.toBeInTheDocument();
  });
});
