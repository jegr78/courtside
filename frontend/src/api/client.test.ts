import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { api } from "./client";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it("given a session response, when loading it, then the typed session is returned", async () => {
  // given
  server.use(http.get("/api/session", () => HttpResponse.json({
    authenticated: true,
    username: "doe.jane",
    displayName: "Jane Doe",
    locale: "de",
    roles: ["MEMBER"],
    passwordChangeRequired: false
  })));

  // when
  const session = await api.session();

  // then
  expect(session.displayName).toBe("Jane Doe");
});

it("given an expired session, when an API call is rejected, then the app is notified", async () => {
  // given
  const listener = vi.fn();
  window.addEventListener("courtside:unauthenticated", listener);
  server.use(http.get("/api/public/config", () => HttpResponse.json({
    type: "urn:courtside:error:unauthenticated",
    title: "Not authenticated",
    status: 401
  }, { status: 401, headers: { "Content-Type": "application/problem+json" } })));

  // when / then
  await expect(api.config()).rejects.toMatchObject({ status: 401 });
  expect(listener).toHaveBeenCalledOnce();
});

it("given a CSRF cookie, when logging out, then the token is echoed in the header", async () => {
  // given
  document.cookie = "XSRF-TOKEN=test-token";
  server.use(http.post("/api/session/logout", ({ request }) => {
    expect(request.headers.get("X-XSRF-TOKEN")).toBe("test-token");
    return new HttpResponse(null, { status: 204 });
  }));

  // when / then
  await expect(api.logout()).resolves.toBeUndefined();
});

it("given valid credentials, when the empty login response arrives, then login succeeds", async () => {
  // given
  server.use(http.post("/api/session", async ({ request }) => {
    expect(await request.text()).toBe("username=doe.jane&password=secret");
    return new HttpResponse(null, { status: 200 });
  }));

  // when / then
  await expect(api.login("doe.jane", "secret")).resolves.toBeUndefined();
});

it("when loading courts, then the active public courts are returned", async () => {
  // given
  server.use(http.get("/api/public/courts", () => HttpResponse.json([
    { id: "11111111-1111-1111-1111-111111111111", number: 1, name: "Centre Court" }
  ])));

  // when
  const courts = await api.courts();

  // then
  expect(courts).toEqual([
    { id: "11111111-1111-1111-1111-111111111111", number: 1, name: "Centre Court" }
  ]);
});

it("given a date, when loading allocations, then that date is sent as a query parameter", async () => {
  // given
  server.use(http.get("/api/bookings", ({ request }) => {
    expect(new URL(request.url).searchParams.get("date")).toBe("2026-08-10");
    return HttpResponse.json([{
      bookingId: "22222222-2222-2222-2222-222222222222",
      courtId: "11111111-1111-1111-1111-111111111111",
      startsAt: "2026-08-10T18:00:00+02:00",
      endsAt: "2026-08-10T19:00:00+02:00",
      cardLabel: "Singles",
      cardColor: "#176b55"
    }]);
  }));

  // when
  const allocations = await api.allocations("2026-08-10");

  // then
  expect(allocations).toHaveLength(1);
  expect(allocations[0].cardLabel).toBe("Singles");
});

it("given a personal-booking cursor, when loading the next page, then the cursor and bound are sent", async () => {
  // given
  server.use(http.get("/api/my/bookings", ({ request }) => {
    const query = new URL(request.url).searchParams;
    expect(query.get("cursor")).toBe("11111111-1111-1111-1111-111111111111");
    expect(query.get("limit")).toBe("25");
    return HttpResponse.json({ items: [], nextCursor: null });
  }));

  // when
  const page = await api.personalBookings("11111111-1111-1111-1111-111111111111", 25);

  // then
  expect(page.items).toEqual([]);
});

it("when loading the booking grid, then its club clock and slot duration are returned", async () => {
  // given
  server.use(http.get("/api/public/booking-grid", () => HttpResponse.json({
    timeZone: "Europe/Berlin",
    slotMinutes: 30,
    openingHours: [{ dayOfWeek: "MONDAY", opensAt: "08:00:00", closesAt: "22:00:00" }]
  })));

  // when
  const grid = await api.bookingGrid();

  // then
  expect(grid.timeZone).toBe("Europe/Berlin");
  expect(grid.slotMinutes).toBe(30);
});

it("given a booking attempt, when creating it, then the idempotency key and body are sent", async () => {
  // given
  document.cookie = "XSRF-TOKEN=booking-token";
  const booking = {
    courtIds: ["11111111-1111-1111-1111-111111111111"],
    cardId: "22222222-2222-2222-2222-222222222222",
    startsAt: "2026-08-10T18:00:00+02:00",
    endsAt: "2026-08-10T18:30:00+02:00",
    participants: [{ guestName: "John Roe" }],
    note: "Bring balls"
  };
  server.use(http.post("/api/bookings", async ({ request }) => {
    expect(request.headers.get("Idempotency-Key")).toBe("attempt-1");
    expect(request.headers.get("X-XSRF-TOKEN")).toBe("booking-token");
    expect(await request.json()).toEqual(booking);
    return HttpResponse.json({ id: "33333333-3333-3333-3333-333333333333" }, { status: 201 });
  }));

  // when
  const created = await api.createBooking(booking, "attempt-1");

  // then
  expect(created.id).toBe("33333333-3333-3333-3333-333333333333");
});

it("given an existing booking, when cancelling it, then the booking URL is deleted", async () => {
  // given
  server.use(http.delete("/api/bookings/33333333-3333-3333-3333-333333333333", () =>
    new HttpResponse(null, { status: 204 })));

  // when / then
  await expect(api.cancelBooking("33333333-3333-3333-3333-333333333333")).resolves.toBeUndefined();
});

it("given a series occurrence, when cancelling following occurrences, then ids and scope are encoded", async () => {
  // given
  server.use(http.delete("/api/booking-series/11111111-1111-1111-1111-111111111111", ({ request }) => {
    const query = new URL(request.url).searchParams;
    expect(query.get("fromBookingId")).toBe("22222222-2222-2222-2222-222222222222");
    expect(query.get("scope")).toBe("THIS_AND_FOLLOWING");
    return new HttpResponse(null, { status: 204 });
  }));

  // when / then
  await expect(api.cancelSeries(
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "THIS_AND_FOLLOWING"
  )).resolves.toBeUndefined();
});

it("given a scoped move, when previewing it, then the language-neutral request is posted", async () => {
  // given
  const move = {
    fromBookingId: "22222222-2222-2222-2222-222222222222" as const,
    scope: "WHOLE_SERIES" as const,
    newStartTime: "19:00"
  };
  server.use(http.post("/api/booking-series/11111111-1111-1111-1111-111111111111/move/preview", async ({ request }) => {
    expect(await request.json()).toEqual(move);
    return HttpResponse.json({ moves: [], executable: true });
  }));

  // when
  const preview = await api.previewSeriesMove("11111111-1111-1111-1111-111111111111", move);

  // then
  expect(preview.executable).toBe(true);
});

it("given a name fragment, when searching participant members, then it is encoded in the query", async () => {
  // given
  server.use(http.get("/api/public/participant-members", ({ request }) => {
    expect(new URL(request.url).searchParams.get("query")).toBe("Jane D");
    return HttpResponse.json([{
      personId: "11111111-1111-1111-1111-111111111111", displayName: "Jane Doe"
    }]);
  }));

  // when
  const members = await api.participantMembers("Jane D");

  // then
  expect(members[0].displayName).toBe("Jane Doe");
});
