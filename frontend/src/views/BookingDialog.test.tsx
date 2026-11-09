import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { ApiError, api } from "../api/client";
import i18n from "../i18n";
import { withFinePointer } from "../test/pointer";
import { BookingDialog, type WaitlistSelection } from "./BookingDialog";

const court = { id: "11111111-1111-1111-1111-111111111111", number: 1, name: "Centre Court" };
const grid = {
  timeZone: "Europe/Berlin", slotMinutes: 30, openingWeeks: [], openingPeriods: [], courtClosures: [],
  openingHours: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
    .map((dayOfWeek) => ({ dayOfWeek, opensAt: "08:00:00", closesAt: "22:00:00" }))
};

function show(currency?: string, waitlist?: WaitlistSelection) {
  render(<BookingDialog selection={{ date: "2026-08-10", slot: "10:00", courtId: court.id }} grid={grid as never}
    courts={[court]} allocations={[]} canChooseSeveralCourts={false} currency={currency} waitlist={waitlist}
    closed={() => undefined} created={() => Promise.resolve()} conflicted={() => Promise.resolve()} />);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("de");
  vi.spyOn(api, "bookingCards").mockResolvedValue([]);
  vi.spyOn(api, "participantCards").mockResolvedValue([]);
  vi.spyOn(api, "participantMembers").mockResolvedValue([]);
  vi.spyOn(api, "ownCredit").mockResolvedValue(creditOf(0));
  vi.spyOn(api, "payPalAvailability").mockResolvedValue({ available: false });
});

it("given a mouse, when the dialog opens, then it says the plan can be dragged across", async () => {
  // given
  withFinePointer(true);

  // when
  show();

  // then
  expect(await screen.findByTestId("booking-duration-hint")).toHaveTextContent(i18n.t("booking.durationHint"));
  expect(screen.getByTestId("booking-duration").getAttribute("aria-describedby")?.split(" "))
    .toContain("booking-duration-hint");
});

it("given only touch, when the dialog opens, then it says nothing about dragging", async () => {
  // given
  withFinePointer(false);

  // when
  show();

  // then
  await screen.findByTestId("booking-duration");
  expect(screen.queryByTestId("booking-duration-hint"), "a device without a mouse cannot drag across slots").not.toBeInTheDocument();
  expect(screen.getByTestId("booking-duration").getAttribute("aria-describedby") ?? "").not.toContain("booking-duration-hint");
});

it("given a mouse is plugged in, when the dialog is open, then the drag hint appears", async () => {
  // given
  withFinePointer(false);
  show();
  await screen.findByTestId("booking-duration");
  await act(() => new Promise((settled) => setTimeout(settled, 50)));
  expect(screen.queryByTestId("booking-duration-hint")).not.toBeInTheDocument();

  // when
  act(() => withFinePointer(true));

  // then
  expect(screen.getByTestId("booking-duration-hint"), "the dialog follows the pointer change itself").toBeInTheDocument();
});

it("given the German copy, when the duration is bounded, then it speaks of the club as Verein", () => {
  // when
  const bound = i18n.t("booking.durationBound", { duration: "1 Stunde" });

  // then
  expect(bound).toMatch(/^Der Verein /);
});

it("given a booking the club refuses, when the refusal arrives, then the duration comes back into view beside it", async () => {
  // given
  vi.spyOn(api, "bookingCards").mockResolvedValue([{
    id: "55555555-5555-5555-5555-555555555555", label: "Member booking", color: "#b85c38", allowedPlayerCounts: [1, 2, 4], guestAllowed: true, guestFeeMinor: 0, externalPriceMinor: 0
  }]);
  vi.spyOn(api, "createBooking").mockRejectedValue(new ApiError(409, {
    type: "urn:courtside:error:court-unavailable", title: "Court unavailable", status: 409
  }));
  const scrolled = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrolled });
  onTestFinished(() => { delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; });
  show();
  const duration = await screen.findByTestId("booking-duration");
  await act(() => new Promise((settled) => setTimeout(settled, 50)));

  // when
  fireEvent.click(screen.getByTestId("booking-submit"));

  // then
  await screen.findByTestId("booking-refusal");
  await waitFor(() => expect(scrolled.mock.contexts, "the duration is the element brought into view").toContain(duration));
  expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
});

it("given the booking form, when the member opens more details, then the first guest field comes into view", async () => {
  // given
  const scrolled = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrolled });
  onTestFinished(() => { delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; });
  show();
  const more = await screen.findByTestId<HTMLDetailsElement>("booking-more");

  // when
  fireEvent.click(screen.getByTestId("booking-more-summary"), { detail: 1 });
  act(() => {
    more.open = true;
    more.dispatchEvent(new Event("toggle"));
  });

  // then
  expect(scrolled.mock.contexts, "the first guest field is brought into view").toContain(screen.getAllByTestId("guest-name")[0]);
  expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
});

it("given a refusal about a note, when it opens more details, then the first guest field is not scrolled to", async () => {
  // given
  vi.spyOn(api, "bookingCards").mockResolvedValue([{
    id: "55555555-5555-5555-5555-555555555555", label: "Member booking", color: "#b85c38", allowedPlayerCounts: [1, 2, 4], guestAllowed: true, guestFeeMinor: 0, externalPriceMinor: 0
  }]);
  vi.spyOn(api, "createBooking").mockRejectedValue(new ApiError(400, {
    type: "urn:courtside:error:validation", title: "Invalid", status: 400,
    fieldErrors: [{ field: "note", code: "validation.Size", params: {} }]
  }));
  const scrolled = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrolled });
  onTestFinished(() => { delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; });
  show();
  const more = await screen.findByTestId<HTMLDetailsElement>("booking-more");
  fireEvent.click(screen.getByTestId("booking-more-summary"), { detail: 1 });
  act(() => {
    more.open = false;
    more.dispatchEvent(new Event("toggle"));
  });
  await act(() => new Promise((settled) => setTimeout(settled, 50)));
  scrolled.mockClear();

  // when
  fireEvent.click(screen.getByTestId("booking-submit"));
  await vi.waitFor(() => expect(more.open, "the refusal opens the details").toBe(true));
  act(() => { more.dispatchEvent(new Event("toggle")); });

  // then
  expect(scrolled.mock.contexts, "the refusal does not jump to the guest field").not.toContain(screen.getAllByTestId("guest-name")[0]);
});

it("given a booking form, when a member is added, then their complete row is brought into view without scrolling on removal", async () => {
  // given
  vi.spyOn(api, "participantMembers").mockResolvedValue([
    { personId: "00000000-0000-0000-0000-000000000103", displayName: "Mary Major" }
  ]);
  const scrolled = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrolled });
  onTestFinished(() => { delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; });
  show();

  // when
  fireEvent.change(await screen.findByTestId("member-search"), { target: { value: "Mary" } });
  fireEvent.click(await screen.findByTestId("member-match"));

  // then
  await waitFor(() => expect(scrolled.mock.contexts, "the added row is brought into view").toContain(screen.getByTestId("selected-member")));
  expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
  scrolled.mockClear();

  // when
  fireEvent.click(screen.getByTestId("remove-member"));

  // then
  expect(screen.queryByTestId("selected-member")).toBeNull();
  expect(scrolled, "removal leaves the form where the member was reading").not.toHaveBeenCalled();
});

it("given a keyboard user, when more details open, then the focused summary is not scrolled away", async () => {
  // given
  const scrolled = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrolled });
  onTestFinished(() => { delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; });
  show();
  const more = await screen.findByTestId<HTMLDetailsElement>("booking-more");
  const summary = screen.getByTestId("booking-more-summary");
  summary.focus();

  // when
  fireEvent.click(summary, { detail: 0 });
  act(() => {
    more.open = true;
    more.dispatchEvent(new Event("toggle"));
  });

  // then
  expect(summary).toHaveFocus();
  expect(scrolled.mock.contexts, "keyboard activation keeps the focused summary in view").toContain(summary);
  expect(scrolled.mock.contexts, "keyboard activation does not jump to the guest field").not.toContain(screen.getAllByTestId("guest-name")[0]);
});

for (const [height, searchFits] of [[168, true], [160, true], [144, false], [100, false]] as const) {
  it(`given a dialog body ${height} pixels high, when a player is added, then the search field is also revealed only if both fit`, async () => {
    // given
    vi.spyOn(api, "participantMembers").mockResolvedValue([
      { personId: "00000000-0000-0000-0000-000000000103", displayName: "Mary Major" }
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === "member-search") return new DOMRect(0, 0, 100, 50);
      if (this.dataset.testid === "selected-member") return new DOMRect(0, 62, 100, 66);
      return new DOMRect();
    });
    const scrolled = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrolled });
    onTestFinished(() => { delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; });
    show();
    const body = await screen.findByTestId("dialog-body");
    Object.defineProperty(body, "clientHeight", { configurable: true, value: height });
    body.style.scrollPaddingTop = "16px";
    body.style.scrollPaddingBottom = "16px";

    // when
    fireEvent.change(screen.getByTestId("member-search"), { target: { value: "Mary" } });
    fireEvent.click(await screen.findByTestId("member-match"));

    // then
    await waitFor(() => expect(scrolled.mock.contexts, "the added row is always revealed").toContain(screen.getByTestId("selected-member")));
    expect(scrolled.mock.contexts.includes(screen.getByTestId("member-search")), "the search field is revealed only when the row remains visible").toBe(searchFits);
  });
}

it("given a guardian without a member card, when they book for a member dependant, then the dependant's cards are offered", async () => {
  // given
  const memberCard = {
    id: "55555555-5555-5555-5555-555555555555", label: "Member booking", color: "#b85c38", allowedPlayerCounts: [2, 4], guestAllowed: true, guestFeeMinor: 0, externalPriceMinor: 0
  };
  vi.spyOn(api, "bookingCards").mockResolvedValue([]);
  const dependantCards = vi.spyOn(api, "dependantBookingCards").mockResolvedValue([memberCard]);
  render(<BookingDialog selection={{ date: "2026-08-10", slot: "10:00", courtId: court.id }} grid={grid as never}
    courts={[court]} allocations={[]} canChooseSeveralCourts={false} selfBookable={false}
    dependants={[{ personId: "person-2", firstName: "John", lastName: "Roe", grants: ["BOOK"], endedOn: null }]}
    closed={() => undefined} created={() => Promise.resolve()} conflicted={() => Promise.resolve()} />);

  // when
  const card = await screen.findByTestId<HTMLSelectElement>("booking-card");

  // then
  await waitFor(() => expect(card.value, "the dependant's card is chosen").toBe(memberCard.id));
  expect(dependantCards).toHaveBeenCalledWith("person-2");
});

function cardWithGuestFee(guestFeeMinor: number) {
  return { id: "55555555-5555-5555-5555-555555555555", label: "Member booking", color: "#b85c38", allowedPlayerCounts: [1, 2, 4], guestAllowed: true, guestFeeMinor, externalPriceMinor: 0 };
}

async function enterGuests(...names: string[]) {
  await screen.findByTestId("booking-card");
  await act(() => new Promise((settled) => setTimeout(settled, 0)));
  names.slice(1).forEach(() => fireEvent.click(screen.getByTestId("add-guest")));
  screen.getAllByTestId("guest-name").forEach((field, index) => fireEvent.change(field, { target: { value: names[index] } }));
}

it("given a card that charges 5 euros per guest place, when two guests are entered, then the dialog states what they cost before booking", async () => {
  // given
  vi.spyOn(api, "bookingCards").mockResolvedValue([cardWithGuestFee(500)]);
  show("EUR");

  // when
  await enterGuests("Jane Doe", "John Roe");

  // then
  expect(screen.getByTestId("booking-guest-fee")).toHaveTextContent("2 Gäste × 5,00 € = 10,00 €");
});

it("given a card that charges 5 euros per guest place, when one guest is entered in English, then the line speaks of one guest", async () => {
  // given
  await i18n.changeLanguage("en");
  vi.spyOn(api, "bookingCards").mockResolvedValue([cardWithGuestFee(500)]);
  show("EUR");

  // when
  await enterGuests("Jane Doe");

  // then
  expect(screen.getByTestId("booking-guest-fee")).toHaveTextContent("1 guest × €5.00 = €5.00");
});

it("given a card without a guest fee, when two guests are entered, then no amount is stated", async () => {
  // given
  vi.spyOn(api, "bookingCards").mockResolvedValue([cardWithGuestFee(0)]);
  show("EUR");

  // when
  await enterGuests("Jane Doe", "John Roe");

  // then
  expect(screen.queryByTestId("booking-guest-fee"), "a free guest place costs nothing to state").not.toBeInTheDocument();
});

it("given a card that charges per guest place, when no guest is entered, then no amount is stated", async () => {
  // given
  vi.spyOn(api, "bookingCards").mockResolvedValue([cardWithGuestFee(500)]);
  show("EUR");

  // when
  await enterGuests("  ");

  // then
  expect(screen.queryByTestId("booking-guest-fee"), "a blank guest field is no guest").not.toBeInTheDocument();
});

it("given a card that charges per guest place, when a guest joins the waitlist, then no amount is stated before the offer is accepted", async () => {
  // given
  vi.spyOn(api, "bookingCards").mockResolvedValue([cardWithGuestFee(500)]);
  show("EUR", { startsAt: "2026-08-10T08:00:00Z", endsAt: "2026-08-10T09:00:00Z" });

  // when
  await enterGuests("Jane Doe");

  // then
  expect(screen.queryByTestId("booking-guest-fee"), "the fee applies only once the offer is accepted").not.toBeInTheDocument();
});

it("given an account without member features, when the dialog opens, then only guests can be added and no member or card is asked for", async () => {
  // given
  const cards = vi.spyOn(api, "participantCards");

  // when
  render(<BookingDialog selection={{ date: "2026-08-10", slot: "10:00", courtId: court.id }} grid={grid as never}
    courts={[court]} allocations={[]} canChooseSeveralCourts={false} memberFeatures={false}
    closed={() => undefined} created={() => Promise.resolve()} conflicted={() => Promise.resolve()} />);
  await screen.findByTestId("guest-participants");

  // then
  expect(screen.queryByTestId("member-participants")).toBeNull();
  expect(screen.queryByTestId("member-search")).toBeNull();
  expect(screen.queryByTestId("card-participants")).toBeNull();
  expect(cards).not.toHaveBeenCalled();
});

it("given an account with member features, when the dialog opens, then members and participant cards are offered", async () => {
  // when
  show();

  // then
  expect(await screen.findByTestId("member-participants")).toBeInTheDocument();
  expect(screen.getByTestId("card-participants")).toBeInTheDocument();
});

it("given a card priced at 12.99 per hour for external players, when an external player picks 90 minutes, then the dialog states the amount before booking", async () => {
  // given
  vi.spyOn(api, "bookingCards").mockResolvedValue([{ ...cardWithGuestFee(0), externalPriceMinor: 1299 }]);
  render(<BookingDialog selection={{ date: "2026-08-10", slot: "10:00", courtId: court.id }} grid={grid as never}
    courts={[court]} allocations={[]} canChooseSeveralCourts={false} memberFeatures={false} currency="EUR"
    closed={() => undefined} created={() => Promise.resolve()} conflicted={() => Promise.resolve()} />);
  await screen.findByTestId("booking-card");
  await act(() => new Promise((settled) => setTimeout(settled, 0)));

  // when
  fireEvent.change(screen.getByTestId("booking-duration"), { target: { value: "90" } });

  // then
  expect(screen.getByTestId("booking-amount")).toHaveTextContent("Betrag: 19,49 €");
});

it("given a card priced for external players, when a member opens the dialog, then no amount is shown", async () => {
  // given
  vi.spyOn(api, "bookingCards").mockResolvedValue([{ ...cardWithGuestFee(0), externalPriceMinor: 1299 }]);
  show("EUR");
  await screen.findByTestId("booking-card");
  await act(() => new Promise((settled) => setTimeout(settled, 0)));

  // then
  expect(screen.queryByTestId("booking-amount"), "a member owes nothing for a court").toBeNull();
});

function creditOf(balanceMinor: number) {
  return { balanceMinor, currency: "EUR", items: [], nextCursor: null };
}

async function showExternal(externalPriceMinor: number, created: () => Promise<void> = () => Promise.resolve()) {
  vi.spyOn(api, "bookingCards").mockResolvedValue([{ ...cardWithGuestFee(0), externalPriceMinor }]);
  render(<BookingDialog selection={{ date: "2026-08-10", slot: "10:00", courtId: court.id }} grid={grid as never}
    courts={[court]} allocations={[]} canChooseSeveralCourts={false} memberFeatures={false} currency="EUR"
    closed={() => undefined} created={created} conflicted={() => Promise.resolve()} />);
  await screen.findByTestId("booking-card");
  await act(() => new Promise((settled) => setTimeout(settled, 0)));
}

it("given an external player whose credit falls short of the amount, when the dialog opens, then it shows the balance and says the treasurer can top it up", async () => {
  // given
  const read = vi.spyOn(api, "ownCredit").mockResolvedValue(creditOf(1000));

  // when
  await showExternal(1299);
  fireEvent.change(screen.getByTestId("booking-duration"), { target: { value: "90" } });

  // then
  expect(await screen.findByTestId("booking-balance")).toHaveTextContent("Dein Guthaben: 10,00 €");
  expect(screen.getByTestId("booking-credit-short")).toHaveTextContent("Dein Guthaben reicht für diese Buchung nicht. Der Kassenwart kann es aufladen.");
  expect(screen.getByTestId("booking-submit"), "the server decides whether the booking is paid").toBeEnabled();
  expect(read).toHaveBeenCalledTimes(1);
});

it("given an external player whose credit covers the amount, when the dialog opens, then it shows the balance without a hint", async () => {
  // given
  vi.spyOn(api, "ownCredit").mockResolvedValue(creditOf(1949));

  // when
  await showExternal(1299);
  fireEvent.change(screen.getByTestId("booking-duration"), { target: { value: "90" } });

  // then
  expect(await screen.findByTestId("booking-balance")).toHaveTextContent("Dein Guthaben: 19,49 €");
  expect(screen.queryByTestId("booking-credit-short"), "a balance equal to the amount covers it").toBeNull();
});

it("given credit in another currency than the club's, when the dialog opens, then it does not count as covering the amount", async () => {
  // given
  vi.spyOn(api, "ownCredit").mockResolvedValue({ ...creditOf(5000), currency: "CHF" });

  // when
  await showExternal(1299);

  // then
  expect(await screen.findByTestId("booking-credit-short"), "francs never pay a booking in euros").toBeInTheDocument();
});

it("given a free card, when an external player opens the dialog, then no balance is read", async () => {
  // given
  const read = vi.spyOn(api, "ownCredit");

  // when
  await showExternal(0);

  // then
  expect(read, "nothing is owed for a free card").not.toHaveBeenCalled();
  expect(screen.queryByTestId("booking-balance")).toBeNull();
});

it("given a card priced for external players, when a member opens the dialog, then no balance is read", async () => {
  // given
  vi.spyOn(api, "bookingCards").mockResolvedValue([{ ...cardWithGuestFee(0), externalPriceMinor: 1299 }]);
  const read = vi.spyOn(api, "ownCredit");

  // when
  show("EUR");
  await screen.findByTestId("booking-card");
  await act(() => new Promise((settled) => setTimeout(settled, 0)));

  // then
  expect(read, "a member owes nothing for a court").not.toHaveBeenCalled();
  expect(screen.queryByTestId("booking-balance")).toBeNull();
});

it("given credit short of the amount, when the club refuses the booking, then the refusal names balance and amount as money", async () => {
  // given
  vi.spyOn(api, "createBooking").mockRejectedValue(new ApiError(422, {
    type: "urn:courtside:error:booking-rules-violated", title: "Booking rules violated", status: 422,
    violations: [{ code: "booking.payment.creditInsufficient", params: { amountMinor: 1949, balanceMinor: 1000, currency: "EUR" } }]
  }));
  await showExternal(1299);

  // when
  fireEvent.click(screen.getByTestId("booking-submit"));

  // then
  expect(await screen.findByTestId("booking-outcome"))
    .toHaveTextContent("Dein Guthaben von 10,00 € reicht für diese Buchung über 19,49 € nicht.");
  expect(document.getElementById("booking-startsAt-errors"), "short credit is no fault of the chosen time").toBeNull();
  expect(screen.queryByTestId("booking-refusal"), "the refusal is stated once").toBeNull();
});

function stubbedAssign() {
  const assign = vi.fn();
  const realLocation = window.location;
  Object.defineProperty(window, "location", { configurable: true, value: Object.assign(new URL(realLocation.href), { assign }) });
  onTestFinished(() => { Object.defineProperty(window, "location", { configurable: true, value: realLocation }); });
  return assign;
}

it("given credit short of the amount and PayPal available, when the dialog opens, then the booking is offered as a PayPal payment in place of the shortfall hint", async () => {
  // given
  vi.spyOn(api, "ownCredit").mockResolvedValue(creditOf(100));
  vi.spyOn(api, "payPalAvailability").mockResolvedValue({ available: true });

  // when
  await showExternal(1299);

  // then
  await waitFor(() => expect(screen.getByTestId("booking-submit")).toHaveTextContent("Mit PayPal bezahlen"));
  expect(screen.getByTestId("booking-submit")).toHaveAttribute("data-payment", "PAYPAL");
  expect(screen.queryByTestId("booking-credit-short"), "PayPal answers the shortfall").toBeNull();
  expect(screen.getByTestId("booking-paypal-hint")).toHaveTextContent(i18n.t("booking.payPalHint"));
});

it("given credit short of the amount and PayPal unavailable, when the dialog opens, then the booking keeps its ordinary action and the shortfall hint", async () => {
  // given
  vi.spyOn(api, "ownCredit").mockResolvedValue(creditOf(100));

  // when
  await showExternal(1299);

  // then
  expect(await screen.findByTestId("booking-credit-short")).toBeInTheDocument();
  expect(screen.getByTestId("booking-submit")).toHaveTextContent(i18n.t("booking.submit"));
  expect(screen.queryByTestId("booking-paypal-hint")).toBeNull();
});

it("given credit that covers the amount, when the dialog opens, then PayPal is not offered even though it is available", async () => {
  // given
  vi.spyOn(api, "ownCredit").mockResolvedValue(creditOf(5000));
  vi.spyOn(api, "payPalAvailability").mockResolvedValue({ available: true });

  // when
  await showExternal(1299);

  // then
  expect(await screen.findByTestId("booking-balance")).toBeInTheDocument();
  expect(screen.getByTestId("booking-submit"), "credit pays the booking").toHaveTextContent(i18n.t("booking.submit"));
});

it("given a card priced for external players, when a member opens the dialog, then PayPal availability is not read", async () => {
  // given
  vi.spyOn(api, "bookingCards").mockResolvedValue([{ ...cardWithGuestFee(0), externalPriceMinor: 1299 }]);

  // when
  show("EUR");
  await screen.findByTestId("booking-card");
  await act(() => new Promise((settled) => setTimeout(settled, 0)));

  // then
  expect(api.payPalAvailability, "members never pay by PayPal").not.toHaveBeenCalled();
});

it("given a booking the server holds for a PayPal payment, when it is created, then the order is created and the browser goes to PayPal", async () => {
  // given
  vi.spyOn(api, "ownCredit").mockResolvedValue(creditOf(100));
  vi.spyOn(api, "payPalAvailability").mockResolvedValue({ available: true });
  vi.spyOn(api, "createBooking").mockResolvedValue({ id: "55555555-5555-5555-5555-555555555555", status: "PENDING_PAYMENT",
    paymentExpiresAt: "2026-08-10T08:15:00Z" });
  const order = vi.spyOn(api, "createPayPalOrder").mockResolvedValue({ orderId: "ORDER-1", approveUrl: "https://paypal.example.org/approve/ORDER-1" });
  const assign = stubbedAssign();
  const created = vi.fn(() => Promise.resolve());
  await showExternal(1299, created);

  // when
  fireEvent.click(screen.getByTestId("booking-submit"));

  // then
  await waitFor(() => expect(assign).toHaveBeenCalledWith("https://paypal.example.org/approve/ORDER-1"));
  expect(order).toHaveBeenCalledWith("55555555-5555-5555-5555-555555555555");
  expect(created, "the page leaves for PayPal instead of reporting a confirmed booking").not.toHaveBeenCalled();
  expect(screen.queryByTestId("booking-paypal-failed"), "a page leaving for PayPal reports no failure").toBeNull();
});

it("given a booking held for PayPal, when the order cannot be created, then the dialog says the court is held and the payment continues from my bookings", async () => {
  // given
  vi.spyOn(api, "ownCredit").mockResolvedValue(creditOf(100));
  vi.spyOn(api, "payPalAvailability").mockResolvedValue({ available: true });
  vi.spyOn(api, "createBooking").mockResolvedValue({ id: "55555555-5555-5555-5555-555555555555", status: "PENDING_PAYMENT",
    paymentExpiresAt: "2026-08-10T08:15:00Z" });
  vi.spyOn(api, "createPayPalOrder").mockRejectedValue(new ApiError(503, {
    type: "urn:courtside:error:paypal-public-url-missing", title: "Unavailable", status: 503
  }));
  const assign = stubbedAssign();
  await showExternal(1299);

  // when
  fireEvent.click(screen.getByTestId("booking-submit"));

  // then
  const held = await screen.findByTestId("booking-paypal-failed");
  expect(held).toHaveTextContent(i18n.t("booking.payPalOrderFailed"));
  expect(screen.getByTestId("booking-refusal")).toHaveTextContent(i18n.t("error.type.paypal-public-url-missing"));
  expect(screen.getByTestId("booking-submit"), "a second submit would only meet the pending booking").toBeDisabled();
  expect(assign).not.toHaveBeenCalled();
});

it("given a pending PayPal booking elsewhere, when another booking is refused for it, then the refusal stands beside the button and not at the time", async () => {
  // given
  vi.spyOn(api, "createBooking").mockRejectedValue(new ApiError(422, {
    type: "urn:courtside:error:booking-rules-violated", title: "Booking rules violated", status: 422,
    violations: [{ code: "booking.payment.pendingExists", params: { expiresAt: "2999-01-01T10:15:00Z" } }]
  }));
  await showExternal(1299);

  // when
  fireEvent.click(screen.getByTestId("booking-submit"));

  // then
  expect(await screen.findByTestId("booking-outcome")).toHaveTextContent(/PayPal/);
  expect(document.getElementById("booking-startsAt-errors"), "a pending payment is no fault of the chosen time").toBeNull();
});
