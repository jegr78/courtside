import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, Route, RouterProvider, Routes } from "react-router-dom";
import { beforeEach, expect, it } from "vitest";
import i18n from "../i18n";
import { UnsavedChangesProvider } from "./UnsavedChangesProvider";
import { useUnsavedMark } from "./registry";
import { UnsavedChangesGuard } from "./UnsavedChangesGuard";

function Editor({ unsaved }: { unsaved: boolean }) {
  useUnsavedMark("club-configuration", unsaved);
  return <Link data-testid="leave" to="/elsewhere">leave</Link>;
}

function routerWith(unsaved: boolean) {
  return createMemoryRouter([
    {
      path: "*",
      element: <UnsavedChangesProvider>
        <UnsavedChangesGuard />
        <Routes>
          <Route path="/here" element={<Editor unsaved={unsaved} />} />
          <Route path="/elsewhere" element={<Link data-testid="leave-again" to="/third">on</Link>} />
          <Route path="/third" element={<p>third</p>} />
        </Routes>
      </UnsavedChangesProvider>
    }
  ], { initialEntries: ["/here"] });
}

beforeEach(async () => { await i18n.changeLanguage("en"); });

it("given an editor holds unsaved work, when leaving is attempted, then the page asks first", async () => {
  // given
  const router = routerWith(true);
  render(<RouterProvider router={router} />);

  // when
  await userEvent.click(screen.getByTestId("leave"));

  // then
  await waitFor(() => expect(screen.getByTestId("unsaved-changes")).toBeVisible());
  expect(router.state.location.pathname).toBe("/here");
});

it("given the question is answered with staying, when it closes, then the page does not move", async () => {
  // given
  const router = routerWith(true);
  render(<RouterProvider router={router} />);
  await userEvent.click(screen.getByTestId("leave"));
  await screen.findByTestId("unsaved-changes");

  // when
  await userEvent.click(screen.getByTestId("unsaved-changes-stay"));

  // then
  await waitFor(() => expect(screen.queryByTestId("unsaved-changes")).toBeNull());
  expect(router.state.location.pathname).toBe("/here");
});

it("given the question is answered with discarding, when it closes, then the page moves on", async () => {
  // given
  const router = routerWith(true);
  render(<RouterProvider router={router} />);
  await userEvent.click(screen.getByTestId("leave"));
  await screen.findByTestId("unsaved-changes");

  // when
  await userEvent.click(screen.getByTestId("unsaved-changes-discard"));

  // then
  await waitFor(() => expect(router.state.location.pathname).toBe("/elsewhere"));
});

it("given nothing is unsaved, when leaving, then nothing asks", async () => {
  // given
  const router = routerWith(false);
  render(<RouterProvider router={router} />);

  // when
  await userEvent.click(screen.getByTestId("leave"));

  // then
  await waitFor(() => expect(router.state.location.pathname).toBe("/elsewhere"));
  expect(screen.queryByTestId("unsaved-changes")).toBeNull();
});

// useBlocker states that it does not cover reloads or a closed tab, so this is the only thing
// standing between unsaved work and a refresh.
it("given an editor holds unsaved work, when the browser is asked to leave, then the ask is held", () => {
  // given
  render(<RouterProvider router={routerWith(true)} />);

  // when
  const asked = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(asked);

  // then
  expect(asked.defaultPrevented).toBe(true);
});

it("given nothing is unsaved, when the browser is asked to leave, then it is not held up", () => {
  // given
  render(<RouterProvider router={routerWith(false)} />);

  // when
  const asked = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(asked);

  // then
  expect(asked.defaultPrevented).toBe(false);
});

// Without the mark being withdrawn as the editor goes, the page it was left for would be held back
// by work that no longer exists anywhere.
it("given the editor was left behind, when leaving the next page, then nothing asks again", async () => {
  // given
  const router = routerWith(true);
  render(<RouterProvider router={router} />);
  await userEvent.click(screen.getByTestId("leave"));
  await userEvent.click(await screen.findByTestId("unsaved-changes-discard"));
  await waitFor(() => expect(router.state.location.pathname).toBe("/elsewhere"));

  // when
  await userEvent.click(screen.getByTestId("leave-again"));

  // then
  await waitFor(() => expect(router.state.location.pathname).toBe("/third"));
  expect(screen.queryByTestId("unsaved-changes")).toBeNull();
});
