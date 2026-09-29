import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { appRoute, createAppRouter } from "./router";

vi.mock("./App", () => ({ App: () => <main data-testid="application" /> }));
vi.mock("./club/ClubConfigurationProvider", () => ({
  ClubConfigurationProvider: ({ children }: { children: ReactNode }) => children
}));

function Faulty(): never {
  throw new Error("a fault carrying an internal detail");
}

it("given something blocks navigation, when it is attempted, then the location does not change", async () => {
  // given
  const router = createAppRouter();
  router.getBlocker("unsaved-work", () => true);

  // when
  await router.navigate("/login");

  // then
  expect(router.state.blockers.get("unsaved-work")?.state).toBe("blocked");
  expect(router.state.location.pathname).toBe("/");
});

// React Router's own error element prints the message and the stack, in the production bundle too.
it("given a view faults, when the router catches it, then no internal detail is shown", () => {
  // given
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  // when
  render(<RouterProvider router={createMemoryRouter([{ ...appRoute, element: <Faulty /> }])} />);

  // then
  expect(screen.getByTestId("application-error")).toBeVisible();
  expect(document.body.textContent).not.toContain("internal detail");
  expect(document.body.textContent).not.toContain("Unexpected Application Error");
});

it("given the application's route, when another destination opens, then the page is scrolled to its top", async () => {
  // given
  const scrolled = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  const router = createMemoryRouter([appRoute], { initialEntries: ["/"] });
  render(<RouterProvider router={router} />);
  scrolled.mockClear();

  // when
  await act(() => router.navigate("/my-bookings"));

  // then
  expect(scrolled).toHaveBeenCalledWith(0, 0);
  window.dispatchEvent(new Event("pagehide"));
  expect(Object.keys(sessionStorage), "scroll positions stay out of browser storage").toEqual([]);
  expect(Object.keys(localStorage)).toEqual([]);
});

it("given a destination opened after another, when the reader goes back, then the browser keeps its own position", async () => {
  // given
  const scrolled = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  const router = createMemoryRouter([appRoute], { initialEntries: ["/"] });
  render(<RouterProvider router={router} />);
  await act(() => router.navigate("/my-bookings"));
  scrolled.mockClear();

  // when
  await act(() => router.navigate(-1));

  // then
  expect(router.state.location.pathname).toBe("/");
  expect(scrolled).not.toHaveBeenCalled();
});
