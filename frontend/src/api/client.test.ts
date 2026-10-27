import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { listenForOtherClientSessionChanges } from "../offlineBookings";
import { api } from "./client";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  server.resetHandlers();
  document.cookie = "XSRF-TOKEN=; Max-Age=0";
  document.cookie = "__Host-XSRF-TOKEN=; Max-Age=0";
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

it("when account-security operations are requested, then their exact contracts are used", async () => {
  // given
  const calls: string[] = [];
  server.use(
    http.get("/api/account/sessions", () => HttpResponse.json([])),
    http.delete("/api/account/sessions/:handle", ({ params }) => {
      calls.push(`one:${String(params.handle)}`);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete("/api/account/sessions", () => {
      calls.push("all");
      return new HttpResponse(null, { status: 204 });
    }),
    http.post("/api/session/reauthentication", async ({ request }) => {
      calls.push(`prove:${JSON.stringify(await request.json())}`);
      return new HttpResponse(null, { status: 204 });
    }),
    http.put("/api/account/password", async ({ request }) => {
      calls.push(`password:${JSON.stringify(await request.json())}`);
      return new HttpResponse(null, { status: 204 });
    })
  );

  // when / then
  await expect(api.accountSessions()).resolves.toEqual([]);
  await api.endAccountSession("session handle");
  await api.endOwnSessions();
  await api.reauthenticate("current-secret");
  await api.changeOwnPassword("current-secret", "replacement-secret");
  expect(calls).toEqual([
    "one:session handle",
    "all",
    'prove:{"password":"current-secret"}',
    'password:{"currentPassword":"current-secret","newPassword":"replacement-secret"}'
  ]);
});

it("when an administrator ends sessions, then the target and global routes stay distinct", async () => {
  // given
  const calls: string[] = [];
  server.use(
    http.delete("/api/admin/roster/:personId/account/sessions", ({ params }) => {
      calls.push(`person:${String(params.personId)}`);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete("/api/admin/sessions", () => {
      calls.push("global");
      return new HttpResponse(null, { status: 204 });
    })
  );

  // when
  await api.endAccountSessions("person-1");
  await api.endAllSessions();

  // then
  expect(calls).toEqual(["person:person-1", "global"]);
});

it("given an administrator, when the operator health is read, then the overview answers as the server sent it", async () => {
  // given
  const overview = {
    checkedAt: "2026-10-17T08:00:00Z",
    version: { state: "OK", version: "0.4.0", revision: null, builtAt: null },
    migrations: { state: "OK", reason: null, pending: 0, currentVersion: "63", expectedVersion: "63", location: null },
    mail: { state: "UNAVAILABLE", reason: "NOT_YET_OBSERVED", lastHandedOverAt: null, location: null },
    publicOrigin: { state: "OK", reason: null, origin: "https://courts.example.org" },
    backup: { state: "UNAVAILABLE", reason: "NOT_CONFIGURED", completedAt: null, ageSeconds: null, location: null }
  };
  server.use(http.get("/api/admin/operator-health", () => HttpResponse.json(overview)));

  // when
  const result = await api.operatorHealth();

  // then
  expect(result).toEqual(overview);
});

it("given private operational-log filters, when searching, then they stay in the protected request body", async () => {
  // given
  document.cookie = "XSRF-TOKEN=test-token";
  server.use(http.post("/api/admin/operational-logs/search", async ({ request }) => {
    expect(new URL(request.url).search).toBe("");
    expect(request.headers.get("X-XSRF-TOKEN")).toBe("test-token");
    expect(await request.json()).toEqual({
      source: "APPLICATION",
      text: "member@example.org",
      traceId: "0123456789abcdef0123456789abcdef",
      limit: 50
    });
    return HttpResponse.json({
      entries: [],
      nextCursor: null,
      availability: "AVAILABLE",
      retentionTruncated: false,
      searchIncomplete: false,
      droppedRecords: 0,
      oldestAvailableAt: null
    });
  }));

  // when
  const result = await api.operationalLogs({
    source: "APPLICATION",
    text: "member@example.org",
    traceId: "0123456789abcdef0123456789abcdef",
    limit: 50
  });

  // then
  expect(result.entries).toEqual([]);
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

it("given an HTTPS host-bound CSRF cookie and a legacy collision, when logging out, then only the host-bound token is used", async () => {
  // given
  vi.stubGlobal("location", new URL("https://courtside.test/login"));
  vi.spyOn(document, "cookie", "get")
    .mockReturnValue("XSRF-TOKEN=legacy-token; __Host-XSRF-TOKEN=host-token");
  server.use(http.post("/api/session/logout", ({ request }) => {
    expect(request.headers.get("X-XSRF-TOKEN")).toBe("host-token");
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

it("given server admission pressure, when login is refused, then preserve the typed problem and valid retry advice", async () => {
  // given
  server.use(http.post("/api/session", () => HttpResponse.json({
    type: "urn:courtside:error:login-rate-limited", title: "Busy", status: 429
  }, { status: 429, headers: { "Content-Type": "application/problem+json", "Retry-After": "1" } })));
  // when / then
  await expect(api.login("doe.jane", "secret")).rejects.toMatchObject({
    status: 429, problem: { type: "urn:courtside:error:login-rate-limited" }, retryAfterSeconds: 1
  });
});

it("given malformed retry advice, when login is refused, then never interpret it as a safe delay", async () => {
  // given
  for (const advice of ["1.5", "-1", "1junk", "Infinity", "99999999999999999999999"]) {
    server.use(http.post("/api/session", () => HttpResponse.json({
      type: "urn:courtside:error:login-rate-limited", title: "Busy", status: 429
    }, { status: 429, headers: { "Content-Type": "application/problem+json", "Retry-After": advice } })));
    // when / then
    await expect(api.login("doe.jane", "secret")).rejects.toMatchObject({ status: 429, retryAfterSeconds: undefined });
  }
});

it("given only one credential request remains, when CSRF rotates during login, then never exceed that request budget", async () => {
  // given
  document.cookie = "XSRF-TOKEN=first-token";
  let attempts = 0;
  server.use(http.post("/api/session", () => {
    attempts++;
    document.cookie = `XSRF-TOKEN=rotated-${attempts}`;
    return refusal();
  }));
  // when / then
  await expect(api.login("doe.jane", "secret", undefined, 1)).rejects.toMatchObject({
    status: 403, problem: { type: "urn:courtside:error:access-denied" }, requestAttempts: 1
  });
  expect(attempts).toBe(1);
});

it("given login waiting for a shared CSRF bootstrap, when cancelled before the bootstrap completes, then never send the credentials", async () => {
  // given
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const submitted = vi.fn();
  server.use(
    http.get("/api/session", async () => { entered(); await pending; return HttpResponse.json({ authenticated: false }); }),
    http.post("/api/session", () => { submitted(); return new HttpResponse(null, { status: 200 }); })
  );
  const controller = new AbortController();
  const result = api.login("doe.jane", "secret", controller.signal);
  const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
  await started;
  // when
  controller.abort();
  // then
  try {
    const outcome = await Promise.race([
      result.then(() => "completed", (failure: unknown) => failure instanceof Error ? failure.name : "unknown"),
      new Promise<string>((resolve) => setTimeout(() => resolve("still waiting for CSRF"), 25))
    ]);
    expect(outcome).toBe("AbortError");
  } finally {
    release();
    await assertion;
  }
  expect(submitted).not.toHaveBeenCalled();
});

it("given a successful login, when the account boundary changes, then other tabs are notified", async () => {
  const postMessage = vi.fn();
  const close = vi.fn();
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  class TestBroadcastChannel {
    postMessage = postMessage;
    close = close;
    addEventListener = addEventListener;
    removeEventListener = removeEventListener;
  }
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
  const localListener = vi.fn();
  const stopListening = listenForOtherClientSessionChanges(localListener);
  server.use(
    http.get("/api/session", () => HttpResponse.json({ authenticated: false, roles: [] })),
    http.post("/api/session", () => new HttpResponse(null, { status: 200 }))
  );

  await api.login("doe.jane", "secret");

  expect(postMessage).toHaveBeenCalledWith("changed");
  expect(localListener).not.toHaveBeenCalled();
  stopListening();
  expect(close).toHaveBeenCalledOnce();
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

it("given a personal-booking cursor, when loading the next page, then the view, cursor and bound are sent", async () => {
  // given
  server.use(http.get("/api/my/bookings", ({ request }) => {
    const query = new URL(request.url).searchParams;
    expect(query.get("view")).toBe("HISTORY");
    expect(query.get("cursor")).toBe("11111111-1111-1111-1111-111111111111");
    expect(query.get("limit")).toBe("25");
    return HttpResponse.json({ items: [], nextCursor: null });
  }));

  // when
  const page = await api.personalBookings({ view: "HISTORY", cursor: "11111111-1111-1111-1111-111111111111", limit: 25 });

  // then
  expect(page.items).toEqual([]);
});

it("when loading the first upcoming page, then the request is the one the offline cache keeps", async () => {
  // given
  let requested: string | undefined;
  server.use(http.get("/api/my/bookings", ({ request }) => {
    requested = new URL(request.url).search;
    return HttpResponse.json({ items: [], nextCursor: null });
  }));

  // when
  await api.personalBookings();

  // then
  expect(requested, "the service worker keys its offline copy to this exact query").toBe("?limit=50");
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
  const remove = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("caches", {
    open: vi.fn().mockResolvedValue({
      delete: vi.fn().mockResolvedValue(true), put: vi.fn().mockResolvedValue(undefined)
    }),
    delete: remove
  });
  server.use(http.delete("/api/bookings/33333333-3333-3333-3333-333333333333", () =>
    new HttpResponse(null, { status: 204 })));

  // when
  await expect(api.cancelBooking("33333333-3333-3333-3333-333333333333")).resolves.toBeUndefined();

  // then
  expect(remove).toHaveBeenCalledWith("courtside-personal-bookings");
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

it("given a reason, when cancelling a booking and a series, then the code travels as a query parameter", async () => {
  // given
  const reasons: (string | null)[] = [];
  server.use(
    http.delete("/api/bookings/33333333-3333-3333-3333-333333333333", ({ request }) => {
      reasons.push(new URL(request.url).searchParams.get("reason"));
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete("/api/booking-series/11111111-1111-1111-1111-111111111111", ({ request }) => {
      reasons.push(new URL(request.url).searchParams.get("reason"));
      return new HttpResponse(null, { status: 204 });
    }));

  // when
  await api.cancelBooking("33333333-3333-3333-3333-333333333333", "MAINTENANCE");
  await api.cancelSeries("11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "THIS", "WEATHER");
  await api.cancelBooking("33333333-3333-3333-3333-333333333333");

  // then
  expect(reasons).toEqual(["MAINTENANCE", "WEATHER", null]);
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

it("given a name fragment, when searching participant members, then the url carries no part of it", async () => {
  // given
  let requested: URL | undefined;
  server.use(http.post("/api/public/participant-members", async ({ request }) => {
    requested = new URL(request.url);
    expect(await request.json()).toEqual({ query: "Jane D" });
    return HttpResponse.json([{
      personId: "11111111-1111-1111-1111-111111111111", displayName: "Jane Doe"
    }]);
  }));

  // when
  const members = await api.participantMembers("Jane D");

  // then
  expect(members[0].displayName).toBe("Jane Doe");
  expect(requested?.search).toBe("");
  expect(requested?.pathname).toBe("/api/public/participant-members");
});

it("given a snapshot file, when creating a preview, then multipart fields are sent without overriding the browser boundary", async () => {
  // given
  document.cookie = "XSRF-TOKEN=csrf-token; Path=/";
  const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(HttpResponse.json(
    { previewId: "p1" }, { status: 201 }
  ));
  const file = new File(["externalId,firstName\n4711,Jane\n"], "roster.csv", { type: "text/csv" });

  // when
  const preview = await api.createImportPreview("s1", file, "UPDATE_ONLY", "WINDOWS_1252");

  // then
  expect(preview.previewId).toBe("p1");
  expect(send).toHaveBeenCalledOnce();
  const [path, init] = send.mock.calls[0];
  expect(path).toBe("/api/admin/import/sources/s1/previews");
  expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  expect(new Headers(init?.headers).get("X-XSRF-TOKEN")).toBe("csrf-token");
  const form = init?.body as FormData;
  expect(form.get("file")).toBe(file);
  expect(form.get("mode")).toBe("UPDATE_ONLY");
  expect(form.get("encoding")).toBe("WINDOWS_1252");
});

it("given a name fragment, when searching the roster, then the criteria are the body and the url is bare", async () => {
  // given
  let requested: URL | undefined;
  let sent: unknown;
  server.use(http.post("/api/admin/roster-search", async ({ request }) => {
    requested = new URL(request.url);
    sent = await request.json();
    return HttpResponse.json({ entries: [], matching: 0 });
  }));

  // when
  await api.roster({ query: "Jane D", limit: 50, membershipTypeId: "type-1", role: "TRAINER",
    credentialStates: ["AWAITING_CREDENTIAL"], sortBy: "USERNAME", sortDirection: "DESC" });

  // then
  expect(sent).toEqual({
    limit: 50, query: "Jane D", membershipTypeId: "type-1", role: "TRAINER",
    credentialStates: ["AWAITING_CREDENTIAL"], sortBy: "USERNAME", sortDirection: "DESC"
  });
  expect(requested?.search).toBe("");
  expect(requested?.pathname).toBe("/api/admin/roster-search");
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

it("given a link to undo, when it is unlinked, then the url names the reference and not the member number", async () => {
  // given
  let path: string | undefined;
  server.use(http.delete("/api/admin/import/sources/s1/references/*", ({ request }) => {
    path = new URL(request.url).pathname;
    return new HttpResponse(null, { status: 204 });
  }));

  // when
  await api.unlinkExternalReference("s1", "22222222-2222-2222-2222-222222222222");

  // then
  expect(path).toBe("/api/admin/import/sources/s1/references/22222222-2222-2222-2222-222222222222");
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

it("given the token cannot be reissued, when writing, then the failure is named in the console", async () => {
  // given
  document.cookie = "XSRF-TOKEN=; Max-Age=0";
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  server.use(
    http.get("/api/session", () => HttpResponse.error()),
    http.post("/api/session", () => new HttpResponse(null, { status: 403 }))
  );

  // when
  await api.login("doe.jane", "temporary-password").catch(() => undefined);

  // then
  expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^CSRF token reissue failed: TypeError/));
  warn.mockRestore();
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

it("given a period, when reading each statistics section, then the section is asked for exactly that period", async () => {
  // given
  const asked: string[] = [];
  server.use(http.get("/api/admin/statistics/:section", ({ request }) => {
    asked.push(new URL(request.url).pathname + new URL(request.url).search);
    return HttpResponse.json({});
  }));
  const period = { from: "2026-05-04", to: "2026-05-10" };

  // when
  await api.utilisationStatistics(period);
  await api.bookingStatistics(period);
  await api.memberStatistics(period);
  await api.messageStatistics();
  await api.statisticsRange();

  // then
  expect(asked).toEqual([
    "/api/admin/statistics/utilisation?from=2026-05-04&to=2026-05-10",
    "/api/admin/statistics/bookings?from=2026-05-04&to=2026-05-10",
    "/api/admin/statistics/members?from=2026-05-04&to=2026-05-10",
    "/api/admin/statistics/messages",
    "/api/admin/statistics/range"
  ]);
});

it("given the statistics range, when it is read, then the client asks the range read and returns its answer", async () => {
  // given
  server.use(http.get("/api/admin/statistics/range", () =>
    HttpResponse.json({ firstBookingOn: "2024-04-12", today: "2026-09-26" })));

  // when
  const range = await api.statisticsRange();

  // then
  expect(range).toEqual({ firstBookingOn: "2024-04-12", today: "2026-09-26" });
});

function budgetRefusal(retryAfter: string, type = "urn:courtside:error:request-rate-limited") {
  return HttpResponse.json({ type, title: "Too many requests", status: 429 },
    { status: 429, headers: { "Content-Type": "application/problem+json", "Retry-After": retryAfter } });
}

const session = { authenticated: false, roles: [], passwordChangeRequired: false };

it("given a read refused for the request budget, when loading, then the client waits as directed and asks once more", async () => {
  // given
  let requests = 0;
  server.use(http.get("/api/session", () => ++requests === 1 ? budgetRefusal("1") : HttpResponse.json(session)));

  // when
  const answer = await api.session();

  // then
  expect(answer.authenticated).toBe(false);
  expect(requests).toBe(2);
});

it("given a read refused again after waiting, when loading, then the second refusal reaches the caller", async () => {
  // given
  let requests = 0;
  server.use(http.get("/api/session", () => {
    requests++;
    return budgetRefusal("1", "urn:courtside:error:operation-capacity-exhausted");
  }));

  // when
  const failure = await api.session().catch((error: unknown) => error);

  // then
  expect(failure).toMatchObject({ status: 429, retryAfterSeconds: 1 });
  expect(requests).toBe(2);
});

it("given a read told to wait longer than a member would, when loading, then the refusal reaches the caller at once", async () => {
  // given
  let requests = 0;
  server.use(http.get("/api/session", () => {
    requests++;
    return budgetRefusal("30");
  }));

  // when
  const failure = await api.session().catch((error: unknown) => error);

  // then
  expect(failure).toMatchObject({ status: 429, retryAfterSeconds: 30 });
  expect(requests).toBe(1);
});

it("given a write refused for the request budget, when submitting, then it is not sent again", async () => {
  // given
  document.cookie = "XSRF-TOKEN=token";
  let requests = 0;
  server.use(http.post("/api/bookings", () => {
    requests++;
    return budgetRefusal("1");
  }));

  // when
  const failure = await booking().catch((error: unknown) => error);

  // then
  expect(failure).toMatchObject({ status: 429 });
  expect(requests).toBe(1);
});

it("given a read waiting on its request budget, when the page cancels it, then it stops without asking again", async () => {
  // given
  let requests = 0;
  server.use(http.get("/api/session", () => {
    requests++;
    return budgetRefusal("5");
  }));
  const leaving = new AbortController();

  // when
  const pending = api.session(leaving.signal).catch((error: unknown) => error);
  await vi.waitFor(() => expect(requests).toBe(1));
  leaving.abort(new DOMException("Left the page", "AbortError"));
  const failure = await pending;

  // then
  expect(failure).toMatchObject({ name: "AbortError" });
  expect(requests).toBe(1);
});

it("given the token reissue is refused for the request budget, when signing in, then it waits once and signs in with the reissued token", async () => {
  // given
  document.cookie = "XSRF-TOKEN=; Max-Age=0";
  let reissues = 0;
  let sent: string | null = "absent";
  server.use(
    http.get("/api/session", () => {
      if (++reissues === 1) return budgetRefusal("1");
      document.cookie = "XSRF-TOKEN=reissued-token";
      return HttpResponse.json(session);
    }),
    http.post("/api/session", ({ request }) => {
      sent = request.headers.get("X-XSRF-TOKEN");
      return new HttpResponse(null, { status: 204 });
    })
  );

  // when
  await api.login("doe.jane", "temporary-password");

  // then
  expect(reissues).toBe(2);
  expect(sent).toBe("reissued-token");
});

it("given no period, when the message log is exported, then only the format reaches the query string", async () => {
  // given
  document.cookie = "XSRF-TOKEN=csrf-token; Path=/";
  const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("queuedAt", {
    status: 200,
    headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=\"message-log-2026-05-12.csv\"" }
  }));

  // when
  const offered = await api.exportMessageLog({ from: "", to: "", separator: ";", encoding: "UTF-8" });

  // then
  const [path, init] = send.mock.calls[0];
  expect(path).toBe("/api/admin/export/messages?separator=%3B&encoding=UTF-8");
  expect(init?.method).toBe("POST");
  expect(offered.fileName).toBe("message-log-2026-05-12.csv");
});


it("given an MFA proof and enrollment, when invoking holder operations, then use the generated JSON contracts without storing secrets", async () => {
  // given
  const calls: unknown[] = [];
  document.cookie = "XSRF-TOKEN=csrf";
  server.use(
    http.post("/api/session", () => new HttpResponse(null, { status: 202 })),
    http.post("/api/session/mfa", async ({ request }) => { calls.push(await request.json()); return new HttpResponse(null, { status: 200 }); }),
    http.post("/api/session/reauthentication", async ({ request }) => { calls.push(await request.json()); return new HttpResponse(null, { status: 204 }); }),
    http.get("/api/account/mfa", () => HttpResponse.json({ enabled: false, totpEnabled: false, recoveryCodesRemaining: 0 })),
    http.post("/api/account/mfa/totp", () => HttpResponse.json({ secret: "EXAMPLEKEY", uri: "otpauth://totp/Example" })),
    http.post("/api/account/mfa/totp/confirmation", async ({ request }) => { calls.push(await request.json()); return HttpResponse.json({ codes: ["EXAMPLE-CODE"] }); }),
    http.post("/api/account/mfa/recovery-codes", () => HttpResponse.json({ codes: ["NEW-CODE"] })),
    http.delete("/api/account/mfa/totp", () => new HttpResponse(null, { status: 204 })),
    http.delete("/api/account/mfa", () => new HttpResponse(null, { status: 204 }))
  );
  const stored = vi.spyOn(Storage.prototype, "setItem");
  // when / then
  await expect(api.login("doe.jane", "secret")).resolves.toBe("mfa-required");
  await api.completeMfaLogin("123456");
  await api.reauthenticate("secret", "RECOVERY-CODE");
  await expect(api.ownMfa()).resolves.toMatchObject({ enabled: false });
  await expect(api.beginTotpEnrollment()).resolves.toMatchObject({ secret: "EXAMPLEKEY" });
  await expect(api.confirmTotpEnrollment("654321")).resolves.toEqual({ codes: ["EXAMPLE-CODE"] });
  await expect(api.replaceRecoveryCodes()).resolves.toEqual({ codes: ["NEW-CODE"] });
  await api.removeTotp();
  await api.disableMfa();
  expect(calls).toEqual([{ code: "123456" }, { password: "secret", code: "RECOVERY-CODE" }, { code: "654321" }]);
  expect(JSON.stringify(stored.mock.calls)).not.toMatch(/EXAMPLEKEY|EXAMPLE-CODE|NEW-CODE|RECOVERY-CODE/);
});

it("given WebAuthn credentials, when invoking key management and login, then preserve structured payloads and private device identifiers", async () => {
  // given
  document.cookie = "XSRF-TOKEN=csrf";
  const calls: { path: string; body: unknown }[] = [];
  const assertion = { id: "AQ", rawId: "AQ", type: "public-key" as const, response: { authenticatorData: "Ag", clientDataJSON: "Aw", signature: "BA", userHandle: null } };
  const registration = { id: "AQ", rawId: "AQ", type: "public-key" as const, response: { attestationObject: "Ag", clientDataJSON: "Aw", transports: ["usb" as const] } };
  server.use(
    http.post("/api/account/mfa/webauthn/registration-options", () => HttpResponse.json({ challenge: "AQ" })),
    http.post("/api/account/mfa/webauthn", async ({ request }) => { calls.push({ path: new URL(request.url).pathname, body: await request.json() }); return HttpResponse.json({ codes: [] }); }),
    http.patch("/api/account/mfa/webauthn/credentials/:id", async ({ request }) => { calls.push({ path: new URL(request.url).pathname, body: await request.json() }); return new HttpResponse(null, { status: 204 }); }),
    http.delete("/api/account/mfa/webauthn/credentials/:id", ({ request }) => { calls.push({ path: new URL(request.url).pathname, body: null }); return new HttpResponse(null, { status: 204 }); }),
    http.post("/api/account/mfa/webauthn/authentication-options", () => HttpResponse.json({ challenge: "Ag" })),
    http.post("/api/session/mfa/webauthn/options", () => HttpResponse.json({ challenge: "Aw" })),
    http.post("/api/session/mfa/webauthn", async ({ request }) => { calls.push({ path: new URL(request.url).pathname, body: await request.json() }); return new HttpResponse(null, { status: 200 }); }),
    http.post("/api/session/reauthentication", async ({ request }) => { calls.push({ path: new URL(request.url).pathname, body: await request.json() }); return new HttpResponse(null, { status: 204 }); })
  );
  // when
  await expect(api.webauthnRegistrationOptions()).resolves.toMatchObject({ challenge: "AQ" });
  await api.registerWebauthn("Travel key", registration);
  await api.renameWebauthn("AQ", "Spare key");
  await api.removeWebauthn("AQ");
  await expect(api.webauthnProofOptions()).resolves.toMatchObject({ challenge: "Ag" });
  await expect(api.webauthnLoginOptions()).resolves.toMatchObject({ challenge: "Aw" });
  await api.completeWebauthnLogin(assertion);
  await api.reauthenticate("current-password", undefined, assertion);
  // then
  expect(calls).toEqual([
    { path: "/api/account/mfa/webauthn", body: { label: "Travel key", credential: registration } },
    { path: "/api/account/mfa/webauthn/credentials/AQ", body: { label: "Spare key" } },
    { path: "/api/account/mfa/webauthn/credentials/AQ", body: null },
    { path: "/api/session/mfa/webauthn", body: assertion },
    { path: "/api/session/reauthentication", body: { password: "current-password", credential: assertion } }
  ]);
});

it("given controlled account recovery, when starting and redeeming it, then distinguish the administrative and public contracts", async () => {
  // given
  document.cookie = "XSRF-TOKEN=csrf";
  const calls: unknown[] = [];
  server.use(
    http.get("/api/admin/accounts/:id/mfa", () => HttpResponse.json({ enabled: true, recoveryPending: false })),
    http.post("/api/admin/accounts/:id/mfa-recovery", async ({ request }) => { calls.push(await request.json()); return new HttpResponse(null, { status: 202 }); }),
    http.post("/api/account-recovery/mfa/redemption", async ({ request }) => { calls.push(await request.json()); return new HttpResponse(null, { status: 204 }); })
  );
  // when
  await expect(api.accountMfa("account-1")).resolves.toEqual({ enabled: true, recoveryPending: false });
  await api.recoverAccountMfa("account-1");
  await api.redeemMfaRecovery("doe.jane", "ABCD-EFGH", "clay-court-evening");
  // then
  expect(calls).toEqual([{ identityChecked: true }, { username: "doe.jane", code: "ABCD-EFGH", password: "clay-court-evening" }]);
});
