import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, type MessageChoice, type Notification } from "../api/client";
import i18n from "../i18n";
import { ClubConfigurationContext } from "../club/registry";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { MyMessagesView } from "./MyMessagesView";

const choices: MessageChoice[] = [
  { kind: "CREDENTIALS_NEW_ACCOUNT", declinable: false, enabled: true },
  { kind: "BOOKING_CONFIRMED", declinable: true, enabled: true },
  { kind: "BOOKING_PLAYER_RECORDED", declinable: false, enabled: true },
  { kind: "BOOKING_REMINDER", declinable: true, enabled: false }
];

const confirmed: Notification = {
  id: "11111111-1111-1111-1111-111111111111",
  kind: "BOOKING_CONFIRMED",
  createdAt: "2026-05-12T08:00:00Z",
  readAt: null,
  booking: {
    startsAt: "2026-05-12T16:00:00Z", endsAt: "2026-05-12T17:00:00Z",
    courts: [{ number: 1, name: "Centre Court" }], cardLabel: "Member booking", cancelled: false
  },
  link: { target: "BOOKINGS", bookingId: "22222222-2222-2222-2222-222222222222" }
};

const reminderRead: Notification = {
  id: "33333333-3333-3333-3333-333333333333",
  kind: "BOOKING_REMINDER",
  createdAt: "2026-05-11T08:00:00Z",
  readAt: "2026-05-11T09:00:00Z",
  link: { target: "BOOKINGS" }
};

const usernameReminder: Notification = {
  id: "44444444-4444-4444-4444-444444444444",
  kind: "ACCOUNT_USERNAME_REMINDER",
  createdAt: "2026-05-10T08:00:00Z",
  readAt: null,
  link: { target: "ACCOUNT_SECURITY" }
};

const displaced: Notification = {
  id: "55555555-5555-5555-5555-555555555555",
  kind: "BOOKING_DISPLACED",
  createdAt: "2026-05-09T08:00:00Z",
  readAt: null,
  closure: "DAY_CLOSED",
  booking: {
    startsAt: "2026-05-20T16:00:00Z", endsAt: "2026-05-20T17:00:00Z",
    courts: [{ number: 2, name: null }], cardLabel: "Member booking", cancelled: false
  },
  link: { target: "BOOKINGS", bookingId: "66666666-6666-6666-6666-666666666666" }
};

const cancelledByClub: Notification = {
  id: "77777777-7777-7777-7777-777777777777",
  kind: "BOOKING_CANCELLED_BY_CLUB",
  createdAt: "2026-05-08T08:00:00Z",
  readAt: null,
  booking: {
    startsAt: "2026-05-21T16:00:00Z", endsAt: "2026-05-21T17:00:00Z",
    courts: [{ number: 3, name: null }], cardLabel: "Member booking", cancelled: true
  },
  cancellationReason: "MAINTENANCE",
  link: { target: "BOOKINGS", bookingId: "88888888-8888-8888-8888-888888888888" }
};

function show() {
  render(<MemoryRouter><WithClubConfiguration><MyMessagesView /></WithClubConfiguration></MemoryRouter>);
}

async function showList(state: "unread" | "read" = "unread") {
  show();
  await userEvent.click(await screen.findByTestId(`notifications-show-${state}`));
}

function entry(id: string) {
  return screen.getByTestId(`notification-${id}`);
}

describe("MyMessagesView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "ownMessageChoices").mockResolvedValue(choices);
    vi.spyOn(api, "ownMessageChannels").mockResolvedValue([{ channel: "EMAIL", enabled: true }]);
    vi.spyOn(api, "ownNotifications").mockImplementation((_cursor, _limit, read) => Promise.resolve(read
      ? { items: [reminderRead], nextCursor: null, unread: 1 }
      : { items: [confirmed], nextCursor: null, unread: 1 }));
  });

  it("given the club configuration failed, when the page opens, then it shows the failure and the settings instead of loading for good", async () => {
    // given
    const load = vi.fn();
    render(<MemoryRouter><ClubConfigurationContext value={{ error: "The club settings are unavailable.", changed: () => undefined, load, refresh: () => undefined }}>
      <MyMessagesView />
    </ClubConfigurationContext></MemoryRouter>);

    // when
    await userEvent.click(await screen.findByTestId("retry-load"));

    // then
    expect(load, "the failure offers to load the configuration again").toHaveBeenCalled();
    expect(screen.getByTestId("my-messages-content"), "the settings show beside the failure").not.toHaveAttribute("aria-hidden");
    expect(screen.queryByTestId("my-messages-loading"), "nothing is left loading").toBeNull();
  });

  it("given notifications addressed to the member, when the centre opens, then both lists stay closed and the unread one counts its entries", async () => {
    // when
    show();

    // then
    const unreadTab = await screen.findByTestId("notifications-show-unread");
    await waitFor(() => expect(unreadTab).toHaveTextContent("Unread (1)"));
    expect(unreadTab).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("notifications-show-read")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("notifications"), "neither list takes room before it is asked for").toBeNull();
    expect(api.ownNotifications, "the read list is only fetched when it is opened").not.toHaveBeenCalledWith(undefined, 50, true);
  });

  it("given both lists, when the member opens one and then the other, then only the opened one shows and choosing it again closes it", async () => {
    // given
    await showList("unread");
    expect(await screen.findByTestId(`notification-${confirmed.id}`)).toBeInTheDocument();

    // when
    await userEvent.click(screen.getByTestId("notifications-show-read"));

    // then
    expect(await screen.findByTestId(`notification-${reminderRead.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`notification-${confirmed.id}`), "opening one list closes the other").toBeNull();
    expect(screen.getByTestId("notifications-show-read")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("notifications-show-unread")).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByTestId("notifications-show-read"));
    expect(screen.queryByTestId("notifications")).toBeNull();
  });

  it("given notifications addressed to the member, when each list is opened, then each entry shows its time, read state, content and link", async () => {
    // when
    await showList("unread");

    // then
    const unread = await screen.findByTestId(`notification-${confirmed.id}`);
    expect(unread).toHaveAttribute("data-read", "false");
    expect(within(unread).getByTestId("notification-state")).toHaveTextContent("New");
    expect(within(unread).getByTestId("notification-summary")).toHaveTextContent("Your booking is confirmed.");
    expect(within(unread).getByTestId("notification-booking")).toHaveTextContent("Centre Court");
    expect(within(unread).getByTestId("notification-time")).toHaveAttribute("dateTime", confirmed.createdAt);
    expect(within(unread).getByRole("link")).toHaveAttribute("href", `/my-bookings#booking-${confirmed.link.bookingId}`);
    await userEvent.click(screen.getByTestId("notifications-show-read"));
    expect(await screen.findByTestId(`notification-${reminderRead.id}`)).toHaveAttribute("data-read", "true");
    expect(within(entry(reminderRead.id)).getByTestId("notification-state")).toHaveTextContent("Read");
    expect(within(entry(reminderRead.id)).queryByTestId("notification-mark-read")).toBeNull();
  });

  it("given sign-in help in the centre, when it is shown, then it links to the account page and names no booking", async () => {
    // given
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [usernameReminder], nextCursor: null, unread: 1 });

    // when
    await showList();

    // then
    const help = await screen.findByTestId(`notification-${usernameReminder.id}`);
    expect(within(help).getByRole("link")).toHaveAttribute("href", "/account/security");
    expect(within(help).queryByTestId("notification-booking")).toBeNull();
  });

  it("given a closure under a booking, when it is shown, then it says why the booking no longer fits", async () => {
    // given
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [displaced], nextCursor: null, unread: 1 });

    // when
    await showList();

    // then
    const closure = await screen.findByTestId(`notification-${displaced.id}`);
    expect(within(closure).getByTestId("notification-summary")).toHaveTextContent("The club is now closed on that day.");
    expect(within(closure).getByTestId("notification-booking")).toHaveTextContent("Court 2");
  });

  it("given a booking the club cancelled, when it is shown, then it says the club cancelled it and marks the booking cancelled", async () => {
    // given
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [cancelledByClub], nextCursor: null, unread: 1 });

    // when
    await showList();

    // then
    const cancellation = await screen.findByTestId(`notification-${cancelledByClub.id}`);
    expect(within(cancellation).getByTestId("notification-summary")).toHaveTextContent("The club cancelled a booking that concerns you.");
    expect(within(cancellation).getByTestId("notification-booking")).toHaveTextContent("Court 3");
    expect(within(cancellation).getByTestId("notification-booking")).toHaveTextContent("Cancelled");
    expect(within(cancellation).getByTestId("notification-reason")).toHaveTextContent("Reason: Maintenance work");
    expect(within(cancellation).getByRole("link")).toHaveAttribute("href", `/my-bookings#booking-${cancelledByClub.link.bookingId}`);
  });

  it("given a waitlist offer, when it is shown, then it names the slot and its deadline and leads to the offer", async () => {
    // given
    const offer: Notification = {
      id: "88888888-8888-8888-8888-888888888888", kind: "WAITLIST_OFFER", createdAt: "2026-05-12T08:00:00Z", readAt: null,
      waitlistOffer: {
        slot: { startsAt: "2026-05-12T16:00:00Z", endsAt: "2026-05-12T17:00:00Z",
          courts: [{ number: 1, name: "Centre Court" }], cardLabel: "Member booking", cancelled: false },
        expiresAt: "2026-05-12T08:15:00Z", open: true
      },
      link: { target: "WAITLIST", waitlistEntryId: "99999999-9999-9999-9999-999999999999" }
    };
    const ended: Notification = { ...offer, id: "88888888-8888-8888-8888-888888888889",
      waitlistOffer: { ...offer.waitlistOffer!, open: false }, link: { target: "WAITLIST" } };
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [offer, ended], nextCursor: null, unread: 2 });

    // when
    await showList();

    // then
    const open = await screen.findByTestId(`notification-${offer.id}`);
    expect(within(open).getByTestId("notification-summary")).toHaveTextContent("A court you are waiting for is free and reserved for you.");
    expect(within(open).getByTestId("notification-booking")).toHaveTextContent("Centre Court");
    expect(within(open).getByTestId("notification-offer")).toHaveTextContent("Reserved until");
    expect(within(open).getByRole("link")).toHaveAttribute("href", "/my-bookings#waitlist-99999999-9999-9999-9999-999999999999");
    expect(within(entry(ended.id)).getByTestId("notification-offer")).toHaveTextContent("This offer is no longer open.");
    expect(within(entry(ended.id)).getByRole("link")).toHaveAttribute("href", "/my-bookings#waitlist");
  });

  it("given an unread notification, when the member marks it read, then the instance is told and it shows as read", async () => {
    // given
    const marked = vi.spyOn(api, "markNotificationRead").mockResolvedValue(undefined);
    await showList();
    const unread = await screen.findByTestId(`notification-${confirmed.id}`);

    // when
    await userEvent.click(within(unread).getByTestId("notification-mark-read"));

    // then
    expect(marked).toHaveBeenCalledWith(confirmed.id);
    await waitFor(() => expect(entry(confirmed.id)).toHaveAttribute("data-read", "true"));
    expect(within(entry(confirmed.id)).getByTestId("notification-state")).toHaveTextContent("Read");
  });

  it("given an unread notification, when the member marks it read, then the entry keeps the focus and the change is announced", async () => {
    // given
    vi.spyOn(api, "markNotificationRead").mockResolvedValue(undefined);
    await showList();
    const unread = await screen.findByTestId(`notification-${confirmed.id}`);
    const button = within(unread).getByTestId("notification-mark-read");
    button.focus();

    // when
    await userEvent.click(button);

    // then
    await waitFor(() => expect(document.activeElement).toBe(entry(confirmed.id)));
    const status = screen.getByTestId("notifications-status");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveTextContent("Marked as read.");
  });

  it("given two unread notifications, when the member marks one and then the other, then the second is announced afresh and keeps the focus", async () => {
    // given
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [confirmed, displaced], nextCursor: null, unread: 2 });
    let answerSecond: () => void = () => undefined;
    vi.spyOn(api, "markNotificationRead")
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((resolve) => { answerSecond = resolve; }));
    await showList();
    await userEvent.click(within(await screen.findByTestId(`notification-${confirmed.id}`)).getByTestId("notification-mark-read"));
    await waitFor(() => expect(screen.getByTestId("notifications-status")).toHaveTextContent("Marked as read."));

    // when
    await userEvent.click(within(entry(displaced.id)).getByTestId("notification-mark-read"));

    // then
    expect(screen.getByTestId("notifications-status"), "the region empties so the next mark is a new announcement")
      .toBeEmptyDOMElement();
    act(() => answerSecond());
    await waitFor(() => expect(screen.getByTestId("notifications-status")).toHaveTextContent("Marked as read."));
    expect(document.activeElement).toBe(entry(displaced.id));
  });

  it("given a mark-as-read request still running, when the member presses again, then no second request leaves and the button stays focusable", async () => {
    // given
    let answer: () => void = () => undefined;
    const mark = vi.spyOn(api, "markNotificationRead")
      .mockImplementation(() => new Promise<void>((resolve) => { answer = resolve; }));
    await showList();
    const button = within(await screen.findByTestId(`notification-${confirmed.id}`)).getByTestId("notification-mark-read");
    await userEvent.click(button);

    // when
    await userEvent.click(button);

    // then
    expect(mark, "a pressed button sends its request once").toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button, "a natively disabled button drops the focus in a real browser").not.toBeDisabled();
    act(() => answer());
    await waitFor(() => expect(screen.getByTestId(`notification-${confirmed.id}`)).toHaveAttribute("data-read", "true"));
  });

  it("given an unread notification, when it is marked read, then the navigation is told to count again", async () => {
    // given
    vi.spyOn(api, "markNotificationRead").mockResolvedValue(undefined);
    const told = vi.fn();
    window.addEventListener("courtside:notifications-read", told);
    await showList();
    const unread = await screen.findByTestId(`notification-${confirmed.id}`);

    // when
    await userEvent.click(within(unread).getByTestId("notification-mark-read"));

    // then
    await waitFor(() => expect(told).toHaveBeenCalledTimes(1));
    window.removeEventListener("courtside:notifications-read", told);
  });

  it("given marking read is refused, when the member marks an entry, then the refusal is shown and the entry stays new", async () => {
    // given
    vi.spyOn(api, "markNotificationRead").mockRejectedValue(new ApiError(404, {
      type: "urn:courtside:error:notification-not-found", title: "Notification not found", status: 404,
      violations: [{ code: "notification.notFound", params: {} }]
    }));
    await showList();
    const unread = await screen.findByTestId(`notification-${confirmed.id}`);

    // when
    await userEvent.click(within(unread).getByTestId("notification-mark-read"));

    // then
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This notification is not addressed to you."));
    expect(entry(confirmed.id)).toHaveAttribute("data-read", "false");
  });

  it("given an unread notification, when the member follows its link, then it is marked read", async () => {
    // given
    const marked = vi.spyOn(api, "markNotificationRead").mockResolvedValue(undefined);
    await showList();
    const unread = await screen.findByTestId(`notification-${confirmed.id}`);

    // when
    await userEvent.click(within(unread).getByRole("link"));

    // then
    expect(marked).toHaveBeenCalledWith(confirmed.id);
  });

  it("given nothing was addressed to the member, when the centre opens, then it says so", async () => {
    // given
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [], nextCursor: null, unread: 1 });

    // when
    await showList();

    // then
    expect(await screen.findByTestId("notifications-empty")).toHaveTextContent("You have no unread messages.");
  });

  it("given more entries than one page, when the member asks for more, then the next page follows the first", async () => {
    // given
    const pages = vi.spyOn(api, "ownNotifications")
      .mockResolvedValueOnce({ items: [confirmed], nextCursor: confirmed.id, unread: 1 })
      .mockResolvedValueOnce({ items: [reminderRead], nextCursor: null, unread: 1 });
    await showList();
    await screen.findByTestId(`notification-${confirmed.id}`);

    // when
    await userEvent.click(screen.getByTestId("notifications-load-more"));

    // then
    expect(await screen.findByTestId(`notification-${reminderRead.id}`)).toBeInTheDocument();
    expect(pages).toHaveBeenLastCalledWith(confirmed.id, 50, false);
    expect(screen.queryByTestId("notifications-load-more")).toBeNull();
  });

  it("given unread notifications, when the member marks all read, then the list empties, the count is zero and the focus moves to the unread tab", async () => {
    // given
    const marked = vi.spyOn(api, "markAllNotificationsRead").mockResolvedValue(undefined);
    const told = vi.fn();
    window.addEventListener("courtside:notifications-read", told);
    await showList();
    await screen.findByTestId(`notification-${confirmed.id}`);

    // when
    await userEvent.click(screen.getByTestId("notifications-mark-all-read"));

    // then
    expect(marked).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("notifications-empty")).toHaveTextContent("You have no unread messages.");
    expect(screen.getByTestId("notifications-show-unread")).toHaveTextContent("Unread (0)");
    expect(document.activeElement, "the pressed button is gone, so its tab takes the focus").toBe(screen.getByTestId("notifications-show-unread"));
    expect(screen.getByTestId("notifications-status")).toHaveTextContent("All messages are marked as read.");
    expect(screen.queryByTestId("notifications-mark-all-read")).toBeNull();
    expect(told).toHaveBeenCalledTimes(1);
    window.removeEventListener("courtside:notifications-read", told);
  });

  it("given marking all read is refused, when the member presses it, then the refusal is shown and the entries stay unread", async () => {
    // given
    vi.spyOn(api, "markAllNotificationsRead").mockRejectedValue(new ApiError(500, {
      type: "urn:courtside:error:internal", title: "Internal error", status: 500
    }));
    await showList();
    await screen.findByTestId(`notification-${confirmed.id}`);

    // when
    await userEvent.click(screen.getByTestId("notifications-mark-all-read"));

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(entry(confirmed.id)).toHaveAttribute("data-read", "false");
    expect(screen.getByTestId("notifications-show-unread")).toHaveTextContent("Unread (1)");
  });

  it("given an entry marked read, when the unread list is opened again, then it is fetched afresh so the entry leaves it", async () => {
    // given
    vi.spyOn(api, "markNotificationRead").mockResolvedValue(undefined);
    await showList();
    await userEvent.click(within(await screen.findByTestId(`notification-${confirmed.id}`)).getByTestId("notification-mark-read"));
    await waitFor(() => expect(entry(confirmed.id)).toHaveAttribute("data-read", "true"));
    expect(screen.getByTestId("notifications-show-unread"), "the count follows at once").toHaveTextContent("Unread (0)");
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [], nextCursor: null, unread: 0 });

    // when
    await userEvent.click(screen.getByTestId("notifications-show-unread"));
    await userEvent.click(screen.getByTestId("notifications-show-unread"));

    // then
    expect(await screen.findByTestId("notifications-empty")).toHaveTextContent("You have no unread messages.");
    expect(screen.queryByTestId(`notification-${confirmed.id}`)).toBeNull();
  });

  it("given the unread list cannot be read, when the centre opens, then the tab names no count and nothing is left loading", async () => {
    // given
    vi.spyOn(api, "ownNotifications").mockRejectedValue(new ApiError(500, { type: "urn:courtside:error:internal", title: "Internal error", status: 500 }));

    // when
    show();

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByTestId("notifications-show-unread"), "an unknown count is not shown as zero").toHaveTextContent(/^Unread$/);
    expect(screen.queryByTestId("notifications-mark-all-read")).toBeNull();
  });

  it("given the read list cannot be read, when the member opens it, then the failure shows without a loading notice beside it", async () => {
    // given
    vi.spyOn(api, "ownNotifications").mockImplementation((_cursor, _limit, read) => read
      ? Promise.reject(new ApiError(500, { type: "urn:courtside:error:internal", title: "Internal error", status: 500 }))
      : Promise.resolve({ items: [confirmed], nextCursor: null, unread: 1 }));

    // when
    await showList("read");

    // then
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(within(screen.getByTestId("notifications-read")).queryByRole("status"), "a failed load is not still loading").toBeNull();
  });

  it("given a reload of the unread list still running, when the member marks all read, then the late page does not bring the entries back", async () => {
    // given
    vi.spyOn(api, "markNotificationRead").mockResolvedValue(undefined);
    vi.spyOn(api, "markAllNotificationsRead").mockResolvedValue(undefined);
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [confirmed, displaced], nextCursor: null, unread: 2 });
    await showList();
    await userEvent.click(within(await screen.findByTestId(`notification-${confirmed.id}`)).getByTestId("notification-mark-read"));
    await waitFor(() => expect(entry(confirmed.id)).toHaveAttribute("data-read", "true"));
    let answer: () => void = () => undefined;
    vi.spyOn(api, "ownNotifications").mockImplementation(() => new Promise((resolve) => {
      answer = () => resolve({ items: [{ ...displaced }], nextCursor: null, unread: 1 });
    }));
    await userEvent.click(screen.getByTestId("notifications-show-unread"));
    await userEvent.click(screen.getByTestId("notifications-show-unread"));
    await userEvent.click(screen.getByTestId("notifications-mark-all-read"));
    expect(await screen.findByTestId("notifications-empty")).toBeInTheDocument();

    // when
    act(() => answer());
    await waitFor(() => expect(screen.getByTestId("notifications-show-unread")).toHaveTextContent("Unread (0)"));

    // then
    expect(screen.queryByTestId(`notification-${displaced.id}`), "the page read before the mark is dropped").toBeNull();
    expect(screen.getByTestId("notifications-show-unread")).toHaveTextContent("Unread (0)");
  });

  it("given German, when the centre opens, then the entry and its state speak German", async () => {
    // given
    await i18n.changeLanguage("de");

    // when
    await showList();

    // then
    const unread = await screen.findByTestId(`notification-${confirmed.id}`);
    expect(within(unread).getByTestId("notification-summary")).toHaveTextContent("Deine Buchung ist bestätigt.");
    expect(within(unread).getByTestId("notification-state")).toHaveTextContent("Neu");
  });

  it("given a kind the club must send, when the choices are shown, then it is on and cannot be switched off", async () => {
    // when
    show();

    // then
    const mandatory = await screen.findByTestId("message-choice-CREDENTIALS_NEW_ACCOUNT");
    expect(mandatory).toBeChecked();
    expect(mandatory).toBeDisabled();
    expect(screen.getByTestId("message-choice-BOOKING_CONFIRMED")).toBeEnabled();
  });

  it("given the email channel, when it is shown, then it says notices that cannot be switched off then arrive only here", async () => {
    // when
    show();

    // then
    expect(await screen.findByTestId("message-channels-reason"))
      .toHaveTextContent("Switching email off also stops the mail for notices you cannot switch off");
    expect(screen.getByTestId("message-channels-reason")).toHaveTextContent("then reaches you only here");
  });

  it("given a kind already switched off, when the choices are shown, then it is unchecked", async () => {
    // when
    show();

    // then
    expect(await screen.findByTestId("message-choice-BOOKING_REMINDER")).not.toBeChecked();
  });

  it("given a kind is unchecked, when the choice is saved, then exactly the unwanted kinds are declined and email stays on", async () => {
    // given
    const chosen = vi.spyOn(api, "chooseOwnMessages").mockResolvedValue(undefined);
    const channels = vi.spyOn(api, "chooseOwnMessageChannels").mockResolvedValue(undefined);
    show();
    await screen.findByTestId("message-choice-BOOKING_CONFIRMED");

    // when
    await userEvent.click(screen.getByTestId("message-choice-BOOKING_CONFIRMED"));
    await userEvent.click(screen.getByTestId("my-messages-save"));

    // then
    expect(chosen).toHaveBeenCalledWith(["BOOKING_CONFIRMED", "BOOKING_REMINDER"]);
    expect(channels).toHaveBeenCalledWith([]);
    expect(await screen.findByTestId("my-messages-saved")).toHaveTextContent("Your choice was saved.");
  });

  it("given email is on, when it is switched off and saved, then email is declined and every kind stays as it was", async () => {
    // given
    const chosen = vi.spyOn(api, "chooseOwnMessages").mockResolvedValue(undefined);
    const channels = vi.spyOn(api, "chooseOwnMessageChannels").mockResolvedValue(undefined);
    show();
    const email = await screen.findByTestId("message-channel-EMAIL");
    expect(email).toBeChecked();

    // when
    await userEvent.click(email);
    await userEvent.click(screen.getByTestId("my-messages-save"));

    // then
    expect(channels).toHaveBeenCalledWith(["EMAIL"]);
    expect(chosen).toHaveBeenCalledWith(["BOOKING_REMINDER"]);
  });

  it("given every kind is wanted again, when the choice is saved, then nothing is declined", async () => {
    // given
    const chosen = vi.spyOn(api, "chooseOwnMessages").mockResolvedValue(undefined);
    vi.spyOn(api, "chooseOwnMessageChannels").mockResolvedValue(undefined);
    show();
    await screen.findByTestId("message-choice-BOOKING_REMINDER");

    // when
    await userEvent.click(screen.getByTestId("message-choice-BOOKING_REMINDER"));
    await userEvent.click(screen.getByTestId("my-messages-save"));

    // then
    expect(chosen).toHaveBeenCalledWith([]);
  });

  it("given a tick nobody saved yet, when the language changes, then it is still ticked", async () => {
    // given
    show();
    await screen.findByTestId("message-choice-BOOKING_CONFIRMED");
    await userEvent.click(screen.getByTestId("message-choice-BOOKING_CONFIRMED"));

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(screen.getByTestId("message-choice-BOOKING_CONFIRMED")).not.toBeChecked();
    expect(screen.getByTestId("message-choice-BOOKING_REMINDER")).not.toBeChecked();
  });

  it("given a choice is saved, when the confirmation appears, then it stands with the save button", async () => {
    // given
    vi.spyOn(api, "chooseOwnMessages").mockResolvedValue(undefined);
    vi.spyOn(api, "chooseOwnMessageChannels").mockResolvedValue(undefined);
    show();
    await screen.findByTestId("message-choice-BOOKING_CONFIRMED");

    // when
    await userEvent.click(screen.getByTestId("message-choice-BOOKING_CONFIRMED"));
    await userEvent.click(screen.getByTestId("my-messages-save"));

    // then
    const actions = screen.getByTestId("my-messages-actions");
    expect(await within(actions).findByTestId("my-messages-saved"), "a phone shows the answer where the member tapped").toBeVisible();
    expect(within(actions).getByTestId("my-messages-save")).toBeInTheDocument();
  });

  it("given the instance refuses the choice, when it is saved, then the refusal stands with the save button", async () => {
    // given
    vi.spyOn(api, "chooseOwnMessages").mockRejectedValue(new ApiError(409, {
      type: "urn:courtside:error:message-not-declinable", title: "Not declinable", status: 409,
      violations: [{ code: "notification.message.notDeclinable", params: { kind: "BOOKING_DISPLACED" } }]
    }));
    vi.spyOn(api, "chooseOwnMessageChannels").mockResolvedValue(undefined);
    show();
    await screen.findByTestId("message-choice-BOOKING_CONFIRMED");

    // when
    await userEvent.click(screen.getByTestId("message-choice-BOOKING_CONFIRMED"));
    await userEvent.click(screen.getByTestId("my-messages-save"));

    // then
    await waitFor(() => expect(within(screen.getByTestId("my-messages-actions")).getByRole("alert"))
      .toHaveTextContent('"Closure under a booking" cannot be switched off.'));
  });

  it("given the choices cannot be read, when the settings open, then the failure is shown without a save button", async () => {
    // given
    vi.spyOn(api, "ownMessageChoices").mockRejectedValue(new ApiError(503, { type: "urn:courtside:error:service-unavailable", title: "Unavailable", status: 503 }));

    // when
    show();

    // then
    expect(await screen.findByRole("alert"), "a load failure still reaches the member").toBeVisible();
    expect(screen.queryByTestId("my-messages-actions")).toBeNull();
  });

  it("given the instance refuses the choice, when it is saved, then the refusal is shown and nothing claims success", async () => {
    // given
    vi.spyOn(api, "chooseOwnMessages").mockRejectedValue(new ApiError(409, {
      type: "urn:courtside:error:message-not-declinable",
      title: "Not declinable",
      status: 409,
      violations: [{ code: "notification.message.notDeclinable", params: { kind: "BOOKING_DISPLACED" } }]
    }));
    vi.spyOn(api, "chooseOwnMessageChannels").mockResolvedValue(undefined);
    show();
    await screen.findByTestId("message-choice-BOOKING_CONFIRMED");

    // when
    await userEvent.click(screen.getByTestId("message-choice-BOOKING_CONFIRMED"));
    await userEvent.click(screen.getByTestId("my-messages-save"));

    // then
    await waitFor(() => expect(screen.getByRole("alert"))
      .toHaveTextContent('"Closure under a booking" cannot be switched off.'));
    expect(screen.queryByTestId("my-messages-saved")).toBeNull();
  });

  it("given the channel choice is refused after the kinds were saved, when saving, then the form shows what is stored and says so", async () => {
    // given
    const declinedConfirmation = choices.map((choice) =>
      choice.kind === "BOOKING_CONFIRMED" ? { ...choice, enabled: false } : choice);
    const kinds = vi.spyOn(api, "ownMessageChoices")
      .mockResolvedValueOnce(choices)
      .mockResolvedValue(declinedConfirmation);
    const ways = vi.spyOn(api, "ownMessageChannels").mockResolvedValue([{ channel: "EMAIL", enabled: true }]);
    vi.spyOn(api, "chooseOwnMessages").mockResolvedValue(undefined);
    vi.spyOn(api, "chooseOwnMessageChannels").mockRejectedValue(new ApiError(503, {
      type: "urn:courtside:error:service-unavailable", title: "Unavailable", status: 503
    }));
    show();
    await screen.findByTestId("message-choice-BOOKING_CONFIRMED");

    // when
    await userEvent.click(screen.getByTestId("message-choice-BOOKING_CONFIRMED"));
    await userEvent.click(screen.getByTestId("message-channel-EMAIL"));
    await userEvent.click(screen.getByTestId("my-messages-save"));

    // then
    await waitFor(() => expect(screen.getByRole("alert"))
      .toHaveTextContent("The settings shown are the ones saved now."));
    expect(kinds).toHaveBeenCalledTimes(2);
    expect(ways).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("message-choice-BOOKING_CONFIRMED")).not.toBeChecked();
    expect(screen.getByTestId("message-channel-EMAIL")).toBeChecked();
    expect(screen.queryByTestId("my-messages-saved")).toBeNull();
  });

  it("given the channel choice is refused and the stored choices cannot be read back, when saving, then nothing claims the form shows what is stored", async () => {
    // given
    vi.spyOn(api, "ownMessageChoices")
      .mockResolvedValueOnce(choices)
      .mockRejectedValue(new Error("offline"));
    vi.spyOn(api, "chooseOwnMessages").mockResolvedValue(undefined);
    vi.spyOn(api, "chooseOwnMessageChannels").mockRejectedValue(new ApiError(503, {
      type: "urn:courtside:error:service-unavailable", title: "Unavailable", status: 503
    }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    show();
    await screen.findByTestId("message-channel-EMAIL");

    // when
    await userEvent.click(screen.getByTestId("message-channel-EMAIL"));
    await userEvent.click(screen.getByTestId("my-messages-save"));

    // then
    await waitFor(() => expect(warning).toHaveBeenCalled());
    const alert = screen.getByRole("alert");
    expect(alert).not.toHaveTextContent("The settings shown are the ones saved now.");
    expect(alert).not.toBeEmptyDOMElement();
    expect(screen.queryByTestId("my-messages-saved")).toBeNull();
  });
});
