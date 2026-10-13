import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api, type OpenPlace } from "../api/client";
import i18n from "../i18n";
import { OpenPlacesSection } from "./OpenPlacesSection";

const courtNames = new Map([["11111111-1111-1111-1111-111111111111", "Centre Court"]]);

const place: OpenPlace = {
  invitationId: "bbbbbbbb-0000-0000-0000-000000000001", courtIds: ["11111111-1111-1111-1111-111111111111"],
  startsAt: "2026-08-10T16:00:00Z", endsAt: "2026-08-10T17:00:00Z", cardLabel: "Member booking"
};

function show(taken = vi.fn(() => Promise.resolve())) {
  render(<OpenPlacesSection courtNames={courtNames} locale="en" timeZone="Europe/Berlin" taken={taken} />);
  return { taken };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
  vi.spyOn(api, "openPlaces").mockResolvedValue([place]);
});

it("given an open place, when the section shows, then it names the slot, the court and the card and nobody", async () => {
  // when
  show();

  // then
  const entry = await screen.findByTestId(`open-place-${place.invitationId}`);
  expect(within(entry).getByTestId("open-place-title")).toHaveTextContent("Centre Court");
  expect(within(entry).getByTestId("open-place-card")).toHaveTextContent("Member booking");
  expect(within(entry).getByTestId("take-open-place"))
    .toHaveAccessibleName("Take the open place on Aug 10, 2026, 6:00 PM – 7:00 PM on Centre Court");
});

it("given an open place, when the member takes it, then the place is accepted and the bookings reload", async () => {
  // given
  const accept = vi.spyOn(api, "acceptOpenPlace").mockResolvedValue(undefined);
  const { taken } = show();
  const entry = await screen.findByTestId(`open-place-${place.invitationId}`);
  vi.mocked(api.openPlaces).mockResolvedValue([]);

  // when
  await userEvent.click(within(entry).getByTestId("take-open-place"));

  // then
  expect(accept).toHaveBeenCalledWith(place.invitationId);
  await waitFor(() => expect(taken).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByTestId(`open-place-${place.invitationId}`)).toBeNull());
});

it("given no open place, when the section shows, then it renders nothing", async () => {
  // given
  vi.mocked(api.openPlaces).mockResolvedValue([]);

  // when
  const { container } = render(<OpenPlacesSection courtNames={courtNames} locale="en" timeZone="Europe/Berlin"
    taken={vi.fn(() => Promise.resolve())} />);

  // then
  await waitFor(() => expect(api.openPlaces).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
