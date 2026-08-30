import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { ApplicationErrorView } from "./ApplicationErrorView";

const server = setupServer();
const assign = vi.fn();
const reload = vi.fn();
const realLocation = window.location;

// jsdom refuses to let assign and reload be replaced on the real Location, and msw resolves the
// relative request paths against it, so the stand-in has to carry the address as well.
function stubNavigation() {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: Object.assign(new URL(realLocation.href), { assign, reload })
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(async () => {
  await i18n.changeLanguage("en");
  assign.mockReset();
  reload.mockReset();
  stubNavigation();
});
afterEach(() => server.resetHandlers());
afterAll(() => {
  server.close();
  Object.defineProperty(window, "location", { configurable: true, value: realLocation });
});

it("given a view faulted, when the error page renders, then a way out is offered", () => {
  // when
  render(<ApplicationErrorView />);

  // then
  expect(screen.getByRole("alert")).toBeVisible();
  expect(screen.getByTestId("application-error-reload")).toBeVisible();
  expect(screen.getByTestId("application-error-sign-out")).toBeVisible();
});

it("given the session must not stay open, when signing out from the error page, then it is ended", async () => {
  // given
  let ended = false;
  server.use(
    http.get("/api/session", () => HttpResponse.json({
      authenticated: true, roles: [], passwordChangeRequired: false
    })),
    http.post("/api/session/logout", () => {
      ended = true;
      return new HttpResponse(null, { status: 204 });
    })
  );
  render(<ApplicationErrorView />);

  // when
  await userEvent.click(screen.getByTestId("application-error-sign-out"));

  // then
  await waitFor(() => expect(ended).toBe(true));
  await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
});

it("given the page may just be stale, when reloading from the error page, then the browser reloads", async () => {
  // given
  render(<ApplicationErrorView />);

  // when
  await userEvent.click(screen.getByTestId("application-error-reload"));

  // then
  expect(reload).toHaveBeenCalled();
});
