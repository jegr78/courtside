import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AdminShell } from "./AdminShell";

function show(at: string) {
  render(<MemoryRouter initialEntries={[at]}>
    <Routes>
      <Route path="/admin" element={<AdminShell />}>
        <Route path="facility" element={<p data-testid="a-page">facility</p>} />
      </Route>
    </Routes>
  </MemoryRouter>);
}

describe("AdminShell", () => {
  it("given an administrative page, when it is shown, then the navigation sits beside it", () => {
    // when
    show("/admin/facility");

    // then
    expect(screen.getByTestId("admin-menu")).toBeInTheDocument();
    expect(screen.getByTestId("a-page")).toBeInTheDocument();
  });

  // The width belongs to the frame, so a page cannot forget to carry it and none can disagree.
  it("when an administrative page is shown, then the frame carries the one width", () => {
    // when
    show("/admin/facility");

    // then
    expect(screen.getByTestId("admin-shell")).toHaveClass("max-w-7xl");
  });
});

it("given a desktop navigation with an active entry below its frame, when the window resizes, then only its scroll position reveals the entry", async () => {
  // given
  window.innerWidth = 1280;
  show("/admin/facility");
  const body = screen.getByTestId("admin-navigation-scroll");
  const active = screen.getByTestId("admin-courts-link");
  active.setAttribute("aria-current", "page");
  vi.spyOn(body, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 300 } as DOMRect);
  vi.spyOn(active, "getBoundingClientRect").mockReturnValue({ top: 350, bottom: 380 } as DOMRect);
  Object.defineProperties(body, {
    scrollHeight: { configurable: true, value: 800 },
    clientHeight: { configurable: true, value: 200 },
    scrollTop: { configurable: true, writable: true, value: 0 }
  });
  // when
  await act(() => window.dispatchEvent(new Event("resize")));
  // then
  expect(body.scrollTop).toBe(80);
  expect(screen.getByTestId("admin-sidebar-continues")).toBeInTheDocument();
  // when
  body.scrollTop = 600;
  fireEvent.scroll(body);
  // then
  expect(screen.queryByTestId("admin-sidebar-continues")).not.toBeInTheDocument();
});

it.each([
  [50, 80, 50],
  [150, 180, 100]
])("given an active entry at %s pixels, when navigation resizes, then the frame scrolls only as far as needed", async (top, bottom, expected) => {
  // given
  show("/admin/facility");
  const body = screen.getByTestId("admin-navigation-scroll");
  const active = screen.getByTestId("admin-courts-link");
  active.setAttribute("aria-current", "page");
  vi.spyOn(body, "getBoundingClientRect").mockReturnValue({ top: 100, bottom: 300 } as DOMRect);
  vi.spyOn(active, "getBoundingClientRect").mockReturnValue({ top, bottom } as DOMRect);
  body.scrollTop = 100;
  // when
  await act(() => window.dispatchEvent(new Event("resize")));
  // then
  expect(body.scrollTop).toBe(expected);
});
