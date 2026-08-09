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
