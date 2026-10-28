import type { ComponentType, ReactNode } from "react";
import { SecurityKeyFailure } from "../security/webauthn";
import { proofOwnerHarness } from "../test/ProofOwner";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, type Dependant, type GuardianGrant, type Notification, type PersonalBooking } from "../api/client";
import i18n from "../i18n";
import { WithClubConfiguration } from "../test/ClubConfiguration";
import { DependantsView } from "./DependantsView";

const john = (grants: GuardianGrant[], endedOn: string | null = null): Dependant =>
  ({ personId: "person-2", firstName: "John", lastName: "Roe", grants, endedOn });
const mary: Dependant = { personId: "person-3", firstName: "Mary", lastName: "Major", grants: ["VIEW_BOOKINGS"], endedOn: null };

const court = "33333333-3333-3333-3333-333333333333";
const lesson: PersonalBooking = {
  id: "55555555-5555-5555-5555-555555555555", seriesId: "66666666-6666-6666-6666-666666666666", courtIds: [court],
  startsAt: "2999-08-12T16:00:00Z", endsAt: "2999-08-12T17:00:00Z",
  cardLabel: "Member booking", cardColor: "#176b55", status: "CONFIRMED", partnerSearch: "AVAILABLE"
};

const unread: Notification = {
  id: "11111111-1111-1111-1111-111111111111", kind: "BOOKING_CONFIRMED", createdAt: "2026-05-12T08:00:00Z", readAt: null,
  booking: {
    startsAt: "2026-05-12T16:00:00Z", endsAt: "2026-05-12T17:00:00Z",
    courts: [{ number: 1, name: "Centre Court" }], cardLabel: "Member booking", cancelled: false
  },
  link: { target: "BOOKINGS", bookingId: lesson.id }
};

const refused = (type: string, status: number) => new ApiError(status, {
  type: `urn:courtside:error:${type}`, title: type, status,
  ...(type === "guardian-action-not-granted" ? { violations: [{ code: "guardianship.actionNotGranted", params: { action: "VIEW_BOOKINGS" } }] } : {})
});

function show(wrapper?: ComponentType<{ children: ReactNode }>) {
  return render(<MemoryRouter><WithClubConfiguration><DependantsView /></WithClubConfiguration></MemoryRouter>, { wrapper });
}

describe("DependantsView", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage("en");
    vi.spyOn(api, "courts").mockResolvedValue([{ id: court, number: 1, name: "Centre Court" }] as never);
    vi.spyOn(api, "dependantBookings").mockResolvedValue({ items: [lesson] });
    vi.spyOn(api, "dependantNotifications").mockResolvedValue({ items: [unread], unread: 1 });
  });

  it("given a relationship granting only to view bookings, when the page is shown, then the bookings are listed and nothing else is offered", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValue([john(["VIEW_BOOKINGS"], "2030-09-01")]);

    // when
    show();

    // then
    expect(await screen.findByTestId("dependant-name")).toHaveTextContent("John Roe");
    expect(screen.getByTestId("dependant-grants")).toHaveTextContent("You may: View bookings");
    expect(screen.getByTestId("dependant-ends-on")).toHaveTextContent("Sep 1, 2030");
    const entry = await screen.findByTestId(`booking-${lesson.id}`);
    expect(entry).toHaveTextContent("Centre Court");
    expect(within(entry).queryByTestId("personal-cancel"), "cancelling is not granted").toBeNull();
    expect(within(entry).queryByTestId("publish-open-place"), "a guardian does not search partners for the dependant").toBeNull();
    expect(screen.queryByTestId("dependant-book")).toBeNull();
    expect(screen.queryByTestId("dependant-messages")).toBeNull();
    expect(screen.queryByTestId("dependant-credentials")).toBeNull();
    expect(api.dependantNotifications, "an ungranted action is not even asked for").not.toHaveBeenCalled();
  });

  it("given cancelling is granted, when a booking of a series is cancelled, then only that booking goes without a reason and the list is read again", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValue([john(["VIEW_BOOKINGS", "CANCEL_BOOKINGS"])]);
    const cancel = vi.spyOn(api, "cancelDependantBooking").mockResolvedValue();
    show();
    const entry = await screen.findByTestId(`booking-${lesson.id}`);
    expect(within(entry).queryByTestId("move-booking"), "moving a series is not a guardian action").toBeNull();

    // when
    await userEvent.click(within(entry).getByTestId("personal-cancel"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("radio"), "no series scope is offered").toBeNull();
    expect(within(dialog).queryByRole("combobox"), "no reason is asked for").toBeNull();
    await userEvent.click(within(dialog).getByTestId("confirm-cancellation"));

    // then
    expect(cancel).toHaveBeenCalledWith("person-2", lesson.id);
    expect(await screen.findByTestId("dependant-cancelled")).toHaveTextContent("The booking of John Roe was cancelled.");
    await waitFor(() => expect(api.dependantBookings).toHaveBeenCalledTimes(2));
    expect(api.dependantNotifications).not.toHaveBeenCalled();
  });

  it("given reading messages is granted, when the page is shown, then the messages are shown read only", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValue([john(["READ_MESSAGES"])]);
    const mark = vi.spyOn(api, "markNotificationRead");

    // when
    show();

    // then
    const entry = await screen.findByTestId(`notification-${unread.id}`);
    expect(entry).toHaveAttribute("data-read", "false");
    expect(within(entry).queryByTestId("notification-mark-read"), "the guardian marks nothing read").toBeNull();
    expect(within(entry).queryByRole("link"), "the dependant's own pages are not the guardian's").toBeNull();
    expect(mark).not.toHaveBeenCalled();
    expect(api.dependantBookings).not.toHaveBeenCalled();
  });

  it("given booking is granted, when the page is shown, then it points to the court plan", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValue([john(["BOOK"])]);

    // when
    show();

    // then
    const book = await screen.findByTestId("dependant-book");
    expect(within(book).getByRole("heading")).toHaveTextContent("Book for John Roe");
    expect(within(book).getByTestId("dependant-to-courts")).toHaveAttribute("href", "/");
  });

  it("given account tasks are granted and the sign-in is old, when new credentials are asked for, then the password is asked first and the request is sent again", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValue([john(["ACCOUNT_TASKS"])]);
    const request = vi.spyOn(api, "requestDependantCredentials")
      .mockRejectedValueOnce(refused("recent-authentication-required", 403))
      .mockResolvedValueOnce(undefined);
    const prove = vi.spyOn(api, "reauthenticate").mockResolvedValue(undefined);
    show();

    // when
    await userEvent.click(await screen.findByTestId("request-dependant-credentials"));
    const dialog = await screen.findByRole("dialog");
    const password = document.getElementById("dependant-reauthentication-password");
    if (!(password instanceof HTMLInputElement)) throw new Error("The password field is missing");
    await userEvent.type(password, "guardian-password");
    await userEvent.click(within(dialog).getByTestId("dependant-reauthentication-submit"));

    // then
    expect(prove).toHaveBeenCalledWith("guardian-password");
    expect(request).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId("dependant-credentials-sent")).toHaveTextContent("New credentials for John Roe are on their way.");
  });

  it("given a dismissed security key proof, when the guardian proves identity, then the dialog says the key request was cancelled", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValue([john(["ACCOUNT_TASKS"])]);
    vi.spyOn(api, "requestDependantCredentials").mockRejectedValue(refused("recent-authentication-required", 403));
    vi.spyOn(api, "reauthenticate").mockRejectedValue(new SecurityKeyFailure("dismissed", "NotAllowedError"));
    show();
    await userEvent.click(await screen.findByTestId("request-dependant-credentials"));
    const dialog = await screen.findByRole("dialog");

    // when
    await userEvent.type(document.getElementById("dependant-reauthentication-password")!, "guardian-password");
    await userEvent.click(within(dialog).getByTestId("dependant-reauthentication-submit"));

    // then
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(i18n.t("mfa.keyCancelled"));
  });

  it("given the board withdrew viewing meanwhile, when the bookings are read, then the refusal is named and the dependants are read again", async () => {
    // given
    const dependants = vi.spyOn(api, "dependants")
      .mockResolvedValueOnce([john(["VIEW_BOOKINGS"])])
      .mockResolvedValue([john(["BOOK"])]);
    vi.mocked(api.dependantBookings).mockRejectedValue(refused("guardian-action-not-granted", 403));

    // when
    show();

    // then
    expect(await screen.findByTestId("dependants-refusal")).toHaveTextContent("Your relationship with this person does not allow this.");
    await waitFor(() => expect(dependants).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("dependant-book"), "what the relationship grants now is shown").toBeInTheDocument();
    expect(screen.queryByTestId("dependant-bookings")).toBeNull();
  });

  it("given the relationship ended meanwhile, when the bookings are read, then the page says so and lists nobody", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValueOnce([john(["VIEW_BOOKINGS"])]).mockResolvedValue([]);
    vi.mocked(api.dependantBookings).mockRejectedValue(refused("dependant-not-found", 404));

    // when
    show();

    // then
    expect(await screen.findByTestId("dependants-refusal")).toHaveTextContent("You do not or no longer act for this person.");
    expect(await screen.findByTestId("dependants-none")).toBeInTheDocument();
  });

  it("given the relationship ended after the first page, when more bookings are read, then the page says so and lists nobody", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValueOnce([john(["VIEW_BOOKINGS"])]).mockResolvedValue([]);
    vi.mocked(api.dependantBookings)
      .mockResolvedValueOnce({ items: [lesson], nextCursor: lesson.id })
      .mockRejectedValue(refused("dependant-not-found", 404));
    show();

    // when
    await userEvent.click(await screen.findByTestId("dependant-load-more-bookings"));

    // then
    expect(await screen.findByTestId("dependants-refusal")).toHaveTextContent("You do not or no longer act for this person.");
    expect(await screen.findByTestId("dependants-none")).toBeInTheDocument();
  });

  it("given two dependants, when the other one is chosen, then the page shows that one's bookings", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValue([john(["VIEW_BOOKINGS"]), mary]);
    show();
    expect(await screen.findByTestId("dependant-name")).toHaveTextContent("John Roe");

    // when
    await userEvent.selectOptions(screen.getByTestId("dependant-choice"), "person-3");

    // then
    expect(await screen.findByTestId("dependant-name")).toHaveTextContent("Mary Major");
    await waitFor(() => expect(api.dependantBookings).toHaveBeenLastCalledWith("person-3"));
  });
  it("given messages and a pending older page, when cancellation succeeds, then fresh cancellation status replaces stale pages", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValue([john(["VIEW_BOOKINGS", "CANCEL_BOOKINGS", "READ_MESSAGES"])]);
    vi.mocked(api.dependantBookings).mockResolvedValueOnce({ items: [lesson] }).mockResolvedValue({ items: [] });
    vi.spyOn(api, "cancelDependantBooking").mockResolvedValue();
    let finishOlder!: (page: { items: Notification[]; unread: number }) => void;
    const older = new Promise<{ items: Notification[]; unread: number }>((resolve) => { finishOlder = resolve; });
    vi.mocked(api.dependantNotifications).mockReset()
      .mockResolvedValueOnce({ items: [unread], unread: 1, nextCursor: "older" })
      .mockReturnValueOnce(older)
      .mockResolvedValue({ items: [{ ...unread, booking: { ...unread.booking!, cancelled: true } }], unread: 1 });
    show();
    await screen.findByTestId(`notification-${unread.id}`);
    await userEvent.click(screen.getByTestId("dependant-load-more-messages"));

    // when
    await userEvent.click(await screen.findByTestId("personal-cancel"));
    await userEvent.click(screen.getByTestId("confirm-cancellation"));

    // then
    await waitFor(() => expect(screen.getByTestId(`notification-${unread.id}`)).toHaveTextContent("Cancelled"));
    expect(screen.getByTestId("dependant-cancelled")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("personal-cancel")).toBeNull());
    expect(api.dependantNotifications).toHaveBeenLastCalledWith("person-2", undefined);
    await act(async () => {
      finishOlder({ items: [{ ...unread, id: "late-old-page" }], unread: 1 });
      await older;
    });
    expect(screen.queryByTestId("notification-late-old-page")).toBeNull();
    expect(screen.getByTestId(`notification-${unread.id}`)).toHaveTextContent("Cancelled");
    expect(screen.queryByTestId("dependant-load-more-messages")).toBeNull();
  });

  it("given a rejected cancellation, when the guardian confirms it, then messages are not reloaded", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValue([john(["VIEW_BOOKINGS", "CANCEL_BOOKINGS", "READ_MESSAGES"])]);
    vi.spyOn(api, "cancelDependantBooking").mockRejectedValue(new Error("cancel unavailable"));
    show();
    await screen.findByTestId(`notification-${unread.id}`);

    // when
    await userEvent.click(await screen.findByTestId("personal-cancel"));
    await userEvent.click(screen.getByTestId("confirm-cancellation"));

    // then
    await within(screen.getByRole("dialog")).findByRole("alert");
    expect(api.dependantNotifications).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("dependant-cancelled")).toBeNull();
  });

  it("given a cancelled booking whose messages cannot reload, when messages are retried, then success remains and the cancellation marker recovers", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValue([john(["VIEW_BOOKINGS", "CANCEL_BOOKINGS", "READ_MESSAGES"])]);
    vi.spyOn(api, "cancelDependantBooking").mockResolvedValue();
    vi.mocked(api.dependantNotifications).mockReset()
      .mockResolvedValueOnce({ items: [unread], unread: 1 })
      .mockRejectedValueOnce(new Error("messages unavailable"))
      .mockResolvedValue({ items: [{ ...unread, booking: { ...unread.booking!, cancelled: true } }], unread: 1 });
    show();
    await screen.findByTestId(`notification-${unread.id}`);

    // when
    await userEvent.click(await screen.findByTestId("personal-cancel"));
    await userEvent.click(screen.getByTestId("confirm-cancellation"));

    // then
    const messages = screen.getByTestId("dependant-messages");
    await within(messages).findByTestId("retry-load");
    expect(screen.getByTestId("dependant-cancelled")).toBeInTheDocument();
    expect(screen.queryByTestId(`notification-${unread.id}`)).toBeNull();
    await userEvent.click(within(messages).getByTestId("retry-load"));
    await waitFor(() => expect(screen.getByTestId(`notification-${unread.id}`)).toHaveTextContent("Cancelled"));
    expect(within(messages).queryByTestId("load-failure")).toBeNull();
    expect(screen.getByTestId("dependant-cancelled")).toBeInTheDocument();
  });


  it("given a dependant ending date, when the locale changes, then its prose date changes with it", async () => {
    // given
    vi.spyOn(api, "dependants").mockResolvedValue([john([], "2030-09-01")]);
    await i18n.changeLanguage("en");
    show();
    const end = await screen.findByTestId("dependant-ends-on");
    expect(end).toHaveTextContent("Sep 1, 2030");

    // when
    await act(() => i18n.changeLanguage("de"));

    // then
    expect(end).toHaveTextContent("01.09.2030");
  });
  it.each(["escape", "unmount", "account switch"])("given a proof awaiting its response, when %s invalidates its dialog, then never send the saved mutation", async (ending) => {
    // given
    const owner = proofOwnerHarness();
    let proved!: () => void;
    vi.spyOn(api, "reauthenticate").mockReturnValue(new Promise((resolve) => { proved = resolve; }));
    vi.spyOn(api, "dependants").mockResolvedValue([john(["ACCOUNT_TASKS"])]);
    const changing = vi.spyOn(api, "requestDependantCredentials").mockRejectedValueOnce(refused("recent-authentication-required", 403)).mockResolvedValue(undefined);
    const shown = show(owner.Wrapper);
    await userEvent.click(await screen.findByTestId("request-dependant-credentials"));
    await userEvent.type(document.getElementById("dependant-reauthentication-password")!, "current-password");
    await userEvent.click(screen.getByTestId("dependant-reauthentication-submit"));
    // when
    if (ending === "escape") {
      await userEvent.click(screen.getByRole("dialog").querySelector("input")!);
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).toBeNull();
    }
    else if (ending === "unmount") shown.unmount();
    else act(owner.change);
    await act(async () => { proved(); await Promise.resolve(); });
    // then
    expect(changing).toHaveBeenCalledOnce();
  });

});
