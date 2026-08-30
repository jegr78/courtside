import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { appRoute, createAppRouter } from "./router";

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
