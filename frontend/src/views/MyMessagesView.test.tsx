import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, type MessageChoice, type Notification } from "../api/client";
import i18n from "../i18n";
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

function show() {
  render(<MemoryRouter><WithClubConfiguration><MyMessagesView /></WithClubConfiguration></MemoryRouter>);
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
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [confirmed, reminderRead], nextCursor: null, unread: 1 });
  });

  it("given notifications addressed to the member, when the centre opens, then each shows its time, read state, content and link", async () => {
    // when
    show();

    // then
    const unread = await screen.findByTestId(`notification-${confirmed.id}`);
    expect(unread).toHaveAttribute("data-read", "false");
    expect(within(unread).getByTestId("notification-state")).toHaveTextContent("New");
    expect(within(unread).getByTestId("notification-summary")).toHaveTextContent("Your booking is confirmed.");
    expect(within(unread).getByTestId("notification-booking")).toHaveTextContent("Centre Court");
    expect(within(unread).getByTestId("notification-time")).toHaveAttribute("dateTime", confirmed.createdAt);
    expect(within(unread).getByRole("link")).toHaveAttribute("href", `/my-bookings#booking-${confirmed.link.bookingId}`);
    expect(entry(reminderRead.id)).toHaveAttribute("data-read", "true");
    expect(within(entry(reminderRead.id)).getByTestId("notification-state")).toHaveTextContent("Read");
    expect(within(entry(reminderRead.id)).queryByTestId("notification-mark-read")).toBeNull();
  });

  it("given sign-in help in the centre, when it is shown, then it links to the account page and names no booking", async () => {
    // given
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [usernameReminder], nextCursor: null, unread: 1 });

    // when
    show();

    // then
    const help = await screen.findByTestId(`notification-${usernameReminder.id}`);
    expect(within(help).getByRole("link")).toHaveAttribute("href", "/account/security");
    expect(within(help).queryByTestId("notification-booking")).toBeNull();
  });

  it("given a closure under a booking, when it is shown, then it says why the booking no longer fits", async () => {
    // given
    vi.spyOn(api, "ownNotifications").mockResolvedValue({ items: [displaced], nextCursor: null, unread: 1 });

    // when
    show();

    // then
    const closure = await screen.findByTestId(`notification-${displaced.id}`);
    expect(within(closure).getByTestId("notification-summary")).toHaveTextContent("The club is now closed on that day.");
    expect(within(closure).getByTestId("notification-booking")).toHaveTextContent("Court 2");
  });

  it("given an unread notification, when the member marks it read, then the instance is told and it shows as read", async () => {
    // given
    const marked = vi.spyOn(api, "markNotificationRead").mockResolvedValue(undefined);
    show();
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
    show();
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
    show();
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

  it("given an unread notification, when it is marked read, then the navigation is told to count again", async () => {
    // given
    vi.spyOn(api, "markNotificationRead").mockResolvedValue(undefined);
    const told = vi.fn();
    window.addEventListener("courtside:notifications-read", told);
    show();
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
    show();
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
    show();
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
    show();

    // then
    expect(await screen.findByTestId("notifications-empty")).toHaveTextContent("Nothing has been sent to you yet.");
  });

  it("given more entries than one page, when the member asks for more, then the next page follows the first", async () => {
    // given
    const pages = vi.spyOn(api, "ownNotifications")
      .mockResolvedValueOnce({ items: [confirmed], nextCursor: confirmed.id, unread: 1 })
      .mockResolvedValueOnce({ items: [reminderRead], nextCursor: null, unread: 1 });
    show();
    await screen.findByTestId(`notification-${confirmed.id}`);

    // when
    await userEvent.click(screen.getByTestId("notifications-load-more"));

    // then
    expect(await screen.findByTestId(`notification-${reminderRead.id}`)).toBeInTheDocument();
    expect(pages).toHaveBeenLastCalledWith(confirmed.id);
    expect(screen.queryByTestId("notifications-load-more")).toBeNull();
  });

  it("given German, when the centre opens, then the entry and its state speak German", async () => {
    // given
    await i18n.changeLanguage("de");

    // when
    show();

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
