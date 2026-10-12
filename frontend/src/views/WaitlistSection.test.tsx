import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError, api, type WaitlistEntry } from "../api/client";
import i18n from "../i18n";
import { WaitlistSection } from "./WaitlistSection";

const courtNames = new Map([["11111111-1111-1111-1111-111111111111", "Centre Court"]]);

const offered: WaitlistEntry = {
  id: "aaaaaaaa-0000-0000-0000-000000000001", courtId: "11111111-1111-1111-1111-111111111111",
  startsAt: "2026-08-10T16:00:00Z", endsAt: "2026-08-10T17:00:00Z", cardLabel: "Member booking",
  state: "OFFERED", offerExpiresAt: "2026-08-10T10:15:00Z", bookingId: null
};

const waiting: WaitlistEntry = {
  ...offered, id: "aaaaaaaa-0000-0000-0000-000000000002", startsAt: "2026-08-11T16:00:00Z",
  endsAt: "2026-08-11T17:00:00Z", state: "WAITING", offerExpiresAt: null
};

function show(booked = vi.fn(() => Promise.resolve()), left = vi.fn()) {
  render(<WaitlistSection courtNames={courtNames} locale="en" timeZone="Europe/Berlin" booked={booked} left={left} />);
  return { booked, left };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
  vi.spyOn(api, "waitlistEntries").mockResolvedValue([offered, waiting]);
});

it("given an open offer and a waiting entry, when the section shows, then each names its own state and no position", async () => {
  // when
  show();

  // then
  const offer = await screen.findByTestId(`waitlist-entry-${offered.id}`);
  expect(within(offer).getByTestId("waitlist-entry-state")).toHaveTextContent("reserved for you until");
  expect(within(offer).getByTestId("waitlist-accept")).toHaveAccessibleName("Book Aug 10, 2026, 6:00 PM – 7:00 PM on Centre Court");
  expect(within(offer).getByTestId("waitlist-leave")).toHaveTextContent("Decline");
  const queued = screen.getByTestId(`waitlist-entry-${waiting.id}`);
  expect(within(queued).queryByTestId("waitlist-accept"), "a waiting entry has nothing to accept yet").toBeNull();
  expect(within(queued).getByTestId("waitlist-leave")).toHaveTextContent("Leave the waitlist");
  expect(screen.getByTestId("waitlist-entries").textContent, "no response or label names a position")
    .not.toMatch(/position|place \d|#\d/i);
});

it("given an open offer, when the member books it, then the acceptance is sent and the bookings reload", async () => {
  // given
  const accepting = vi.spyOn(api, "acceptWaitlistOffer").mockResolvedValue({ id: "bbbbbbbb-0000-0000-0000-000000000001" });
  const { booked } = show();

  // when
  await userEvent.click(await screen.findByTestId("waitlist-accept"));

  // then
  expect(accepting).toHaveBeenCalledWith(offered.id);
  await waitFor(() => expect(booked).toHaveBeenCalled());
});

it("given an offer that ran out meanwhile, when the member books it, then the reason is shown and the list read again", async () => {
  // given
  vi.spyOn(api, "acceptWaitlistOffer").mockRejectedValue(new ApiError(409, {
    type: "urn:courtside:error:waitlist-no-offer", title: "No open offer", status: 409,
    violations: [{ code: "waitlist.offer.none", params: {} }]
  }));
  const { booked } = show();

  // when
  await userEvent.click(await screen.findByTestId("waitlist-accept"));

  // then
  expect(await screen.findByRole("alert")).toHaveTextContent("This entry holds no open offer any more.");
  expect(booked).not.toHaveBeenCalled();
  await waitFor(() => expect(api.waitlistEntries).toHaveBeenCalledTimes(2));
});

it("given an open offer, when the member declines it, then the entry is left and the decline is reported", async () => {
  // given
  const leaving = vi.spyOn(api, "leaveWaitlist").mockResolvedValue(undefined);
  const { left } = show();

  // when
  await userEvent.click(within(await screen.findByTestId(`waitlist-entry-${offered.id}`)).getByTestId("waitlist-leave"));

  // then
  expect(leaving).toHaveBeenCalledWith(offered.id);
  await waitFor(() => expect(left).toHaveBeenCalledWith(true));
});

it("given no entries, when the section loads, then it adds nothing to the page", async () => {
  // given
  vi.mocked(api.waitlistEntries).mockResolvedValue([]);

  // when
  show();

  // then
  await waitFor(() => expect(api.waitlistEntries).toHaveBeenCalled());
  expect(screen.queryByTestId("waitlist-title")).toBeNull();
});
