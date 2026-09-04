import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { api } from "./client";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  document.cookie = "XSRF-TOKEN=; Max-Age=0";
  unauthenticatedListeners.forEach((listener) =>
    window.removeEventListener("courtside:unauthenticated", listener));
  unauthenticatedListeners.length = 0;
});

const unauthenticatedListeners: EventListener[] = [];

function notifiedOfUnauthenticated() {
  const listener = vi.fn();
  unauthenticatedListeners.push(listener);
  window.addEventListener("courtside:unauthenticated", listener);
  return listener;
}
afterAll(() => server.close());

function refusal(type = "urn:courtside:error:access-denied") {
  return HttpResponse.json({ type, title: "Refused", status: 403 },
    { status: 403, headers: { "Content-Type": "application/problem+json" } });
}

function booking() {
  return api.createBooking({
    courtIds: ["11111111-1111-1111-1111-111111111111"],
    cardId: "22222222-2222-2222-2222-222222222222",
    startsAt: "2026-08-10T18:00:00+02:00",
    endsAt: "2026-08-10T18:30:00+02:00",
    participants: [],
    note: "Bring balls"
  }, "attempt-1");
}

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
  const listener = notifiedOfUnauthenticated();
  server.use(http.get("/api/public/config", () => HttpResponse.json({
    type: "urn:courtside:error:unauthenticated",
    title: "Not authenticated",
    status: 401
  }, { status: 401, headers: { "Content-Type": "application/problem+json" } })));

  // when / then
  await expect(api.config()).rejects.toMatchObject({ status: 401 });
  expect(listener).toHaveBeenCalledOnce();
});

it("given a sign-out the instance refuses, when the refusal arrives, then the app is not notified as well", async () => {
  // given
  const listener = notifiedOfUnauthenticated();
  server.use(http.post("/api/session/logout", () => HttpResponse.json({
    type: "urn:courtside:error:unauthenticated",
    title: "Not authenticated",
    status: 401
  }, { status: 401, headers: { "Content-Type": "application/problem+json" } })));

  // when / then
  await expect(api.logout()).rejects.toMatchObject({ status: 401 });
  expect(listener).not.toHaveBeenCalled();
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
      cardLabel: "Member booking",
      cardColor: "#176b55"
    }]);
  }));

  // when
  const allocations = await api.allocations("2026-08-10");

  // then
  expect(allocations).toHaveLength(1);
  expect(allocations[0].cardLabel).toBe("Member booking");
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

it("given a snapshot file, when creating a preview, then both parts go out under a boundary the browser chose", async () => {
  // given
  let contentType: string | null = "unset";
  let body = "";
  server.use(http.post("/api/admin/import/sources/s1/previews", async ({ request }) => {
    contentType = request.headers.get("Content-Type");
    body = await request.text();
    return HttpResponse.json({ previewId: "p1" }, { status: 201 });
  }));
  const file = new File(["externalId,firstName\n4711,Jane\n"], "roster.csv", { type: "text/csv" });

  // when
  const preview = await api.createImportPreview("s1", file, "UPDATE_ONLY", "WINDOWS_1252");

  // then
  expect(preview.previewId).toBe("p1");
  expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
  expect(body).toContain('name="file"');
  expect(body).toContain('name="mode"');
  expect(body).toContain("UPDATE_ONLY");
  expect(body).toContain('name="encoding"');
  expect(body).toContain("WINDOWS_1252");
});

it("given a membership type filter, when listing the roster, then it reaches the query string", async () => {
  // given
  let seen: string | undefined;
  server.use(http.get("/api/admin/roster", ({ request }) => {
    seen = new URL(request.url).search;
    return HttpResponse.json({ entries: [] });
  }));

  // when
  await api.roster(undefined, undefined, 50, "type-1");

  // then
  expect(seen).toContain("membershipTypeId=type-1");
});

it("given a person, when reading them alone, then the entry is returned", async () => {
  // given
  server.use(http.get("/api/admin/roster/p1", () => HttpResponse.json({
    personId: "p1", firstName: "Jane", lastName: "Doe", email: "jane.doe@example.org",
    enabled: true, roles: ["MEMBER"]
  })));

  // when
  const person = await api.person("p1");

  // then
  expect(person.firstName).toBe("Jane");
});

it("given an external id with characters a path would swallow, when unlinking it, then it survives the url", async () => {
  // given
  let path: string | undefined;
  server.use(http.delete("/api/admin/import/sources/s1/references/*", ({ request }) => {
    path = new URL(request.url).pathname;
    return new HttpResponse(null, { status: 204 });
  }));

  // when
  await api.unlinkExternalReference("s1", "A/4711");

  // then
  expect(path).toBe("/api/admin/import/sources/s1/references/A%2F4711");
});

// Signing out clears the CSRF token, so the sign-in that follows carries none and is answered 403 —
// which the sign-in form can only report as a rejected credential.
it("given signing out cleared the token, when signing in again, then a fresh token is fetched first", async () => {
  // given
  document.cookie = "XSRF-TOKEN=; Max-Age=0";
  let sent: string | null = "absent";
  server.use(
    http.get("/api/session", () => {
      document.cookie = "XSRF-TOKEN=reissued-token";
      return HttpResponse.json({ authenticated: false, roles: [], passwordChangeRequired: false });
    }),
    http.post("/api/session", ({ request }) => {
      sent = request.headers.get("X-XSRF-TOKEN");
      return new HttpResponse(null, { status: 204 });
    })
  );

  // when
  await api.login("doe.jane", "temporary-password");

  // then
  expect(sent).toBe("reissued-token");
});

it("given a token cookie left empty, when writing, then a usable one is fetched first", async () => {
  // given
  document.cookie = "XSRF-TOKEN=";
  let sent: string | null = "absent";
  server.use(
    http.get("/api/session", () => {
      document.cookie = "XSRF-TOKEN=reissued-token";
      return HttpResponse.json({ authenticated: false, roles: [], passwordChangeRequired: false });
    }),
    http.post("/api/session", ({ request }) => {
      sent = request.headers.get("X-XSRF-TOKEN");
      return new HttpResponse(null, { status: 204 });
    })
  );

  // when
  await api.login("doe.jane", "temporary-password");

  // then
  expect(sent).toBe("reissued-token");
});

it("given two writes starting together without a token, when they run, then one token is fetched", async () => {
  // given
  let asked = 0;
  server.use(
    http.get("/api/session", () => {
      asked += 1;
      document.cookie = "XSRF-TOKEN=shared-token";
      return HttpResponse.json({ authenticated: false, roles: [], passwordChangeRequired: false });
    }),
    http.post("/api/session", () => new HttpResponse(null, { status: 204 }))
  );

  // when
  await Promise.all([
    api.login("doe.jane", "temporary-password"),
    api.login("roe.john", "temporary-password")
  ]);

  // then
  expect(asked).toBe(1);
});

it("given a rotated token cookie, when the write is refused, then it goes out again with the surviving token", async () => {
  // given
  document.cookie = "XSRF-TOKEN=lost-token";
  const sent: (string | null)[] = [];
  server.use(http.post("/api/session/logout", ({ request }) => {
    sent.push(request.headers.get("X-XSRF-TOKEN"));
    if (sent.length > 1) {
      return new HttpResponse(null, { status: 204 });
    }
    document.cookie = "XSRF-TOKEN=surviving-token";
    return refusal();
  }));

  // when
  await api.logout();

  // then
  expect(sent).toEqual(["lost-token", "surviving-token"]);
});

it("given a token cookie that still stands, when the write is refused, then it does not go out again", async () => {
  // given
  document.cookie = "XSRF-TOKEN=standing-token";
  let attempts = 0;
  server.use(http.post("/api/session/logout", () => {
    attempts += 1;
    return refusal();
  }));

  // when / then
  await expect(api.logout()).rejects.toMatchObject({ status: 403 });
  expect(attempts).toBe(1);
});

it("given a repeated write refused again, when that refusal arrives, then it does not go out a third time", async () => {
  // given
  document.cookie = "XSRF-TOKEN=first-token";
  let attempts = 0;
  server.use(http.post("/api/session/logout", () => {
    attempts += 1;
    document.cookie = `XSRF-TOKEN=token-${attempts}`;
    return refusal();
  }));

  // when / then
  await expect(api.logout()).rejects.toMatchObject({ status: 403 });
  expect(attempts).toBe(2);
});

it("given a read refused, when its token cookie rotates meanwhile, then it does not go out again", async () => {
  // given
  document.cookie = "XSRF-TOKEN=; Max-Age=0";
  let attempts = 0;
  server.use(http.get("/api/admin/config", () => {
    attempts += 1;
    document.cookie = "XSRF-TOKEN=minted-token";
    return refusal();
  }));

  // when / then
  await expect(api.adminConfig()).rejects.toMatchObject({ status: 403 });
  expect(attempts).toBe(1);
});

it("given a refusal the account earned, when the token cookie rotates meanwhile, then it is not repeated", async () => {
  // given
  document.cookie = "XSRF-TOKEN=first-token";
  let attempts = 0;
  server.use(http.post("/api/bookings", () => {
    attempts += 1;
    document.cookie = `XSRF-TOKEN=token-${attempts}`;
    return refusal("urn:courtside:error:card-role-required");
  }));

  // when / then
  await expect(booking()).rejects.toMatchObject({ status: 403 });
  expect(attempts).toBe(1);
});

it("given a repeated write, when it goes out again, then it carries the same body and idempotency key", async () => {
  // given
  document.cookie = "XSRF-TOKEN=lost-token";
  const seen: { key: string | null; body: unknown }[] = [];
  server.use(http.post("/api/bookings", async ({ request }) => {
    seen.push({ key: request.headers.get("Idempotency-Key"), body: await request.json() });
    if (seen.length > 1) {
      return HttpResponse.json({ id: "33333333-3333-3333-3333-333333333333" }, { status: 201 });
    }
    document.cookie = "XSRF-TOKEN=surviving-token";
    return refusal();
  }));

  // when
  await booking();

  // then
  expect(seen).toHaveLength(2);
  expect(seen[1]).toEqual(seen[0]);
  expect(seen[1].key).toBe("attempt-1");
});
