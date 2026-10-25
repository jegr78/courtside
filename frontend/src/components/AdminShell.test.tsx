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

// Each entry sits at its own height in the navigation, so moving the frame moves every entry with it.
function layOut(body: HTMLElement, frame: { top: number; height: number }, scrollHeight: number) {
  vi.spyOn(body, "getBoundingClientRect").mockImplementation(() => ({ top: frame.top, bottom: frame.top + frame.height } as DOMRect));
  Object.defineProperties(body, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, get: () => parseFloat(body.style.maxHeight) || frame.height },
    scrollTop: { configurable: true, writable: true, value: 0 }
  });
  [...body.querySelectorAll<HTMLElement>("a, p")].forEach((entry, index) => {
    vi.spyOn(entry, "getBoundingClientRect").mockImplementation(() =>
      ({ top: frame.top + index * 32 - body.scrollTop, bottom: frame.top + index * 32 + 28 - body.scrollTop } as DOMRect));
  });
}

it("given a desktop navigation with an active entry below its frame, when the window resizes, then the frame begins and ends on whole entries", async () => {
  // given
  window.innerWidth = 1280;
  show("/admin/facility");
  const body = screen.getByTestId("admin-navigation-scroll");
  const entries = [...body.querySelectorAll<HTMLElement>("a, p")];
  const active = entries[11];
  active.setAttribute("aria-current", "page");
  layOut(body, { top: 100, height: 200 }, entries.length * 32);
  // when
  await act(() => window.dispatchEvent(new Event("resize")));
  // then
  expect(body.scrollTop, "the frame begins at the first entry below the cut one").toBe(6 * 32);
  expect(body.style.maxHeight, "the frame ends with the active entry").toBe(`${11 * 32 + 28 - 6 * 32}px`);
  expect(screen.getByTestId("admin-sidebar-continues")).toBeInTheDocument();
  expect(screen.getByTestId("admin-sidebar-precedes")).toBeInTheDocument();
  // when
  body.scrollTop = entries.length * 32;
  fireEvent.scroll(body);
  // then
  expect(screen.queryByTestId("admin-sidebar-continues")).not.toBeInTheDocument();
  expect(screen.getByTestId("admin-sidebar-precedes")).toBeInTheDocument();
  // when
  body.scrollTop = 0;
  fireEvent.scroll(body);
  // then
  expect(screen.queryByTestId("admin-sidebar-precedes"), "nothing lies above the first entry").not.toBeInTheDocument();
});

it("given a navigation the member scrolled away from its active entry, when it resizes, then it keeps the member's position", async () => {
  // given
  window.innerWidth = 1280;
  show("/admin/facility");
  const body = screen.getByTestId("admin-navigation-scroll");
  const entries = [...body.querySelectorAll<HTMLElement>("a, p")];
  entries[11].setAttribute("aria-current", "page");
  layOut(body, { top: 100, height: 200 }, entries.length * 32);
  await act(() => window.dispatchEvent(new Event("resize")));
  body.scrollTop = 0;
  fireEvent.scroll(body);
  // when
  await act(() => window.dispatchEvent(new Event("resize")));
  // then
  expect(body.scrollTop, "the member's scroll position outlives a layout change").toBe(0);
});

it("given a shortened navigation, when the page gives its frame more room, then the navigation lays out into it", async () => {
  // given
  window.innerWidth = 1280;
  window.innerHeight = 800;
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  show("/admin/facility");
  const body = screen.getByTestId("admin-navigation-scroll");
  const entries = [...body.querySelectorAll<HTMLElement>("a, p")];
  entries[11].setAttribute("aria-current", "page");
  const frame = { top: 100, height: 200 };
  layOut(body, frame, entries.length * 32);
  let shellTop = 150;
  vi.spyOn(screen.getByTestId("admin-shell"), "getBoundingClientRect").mockImplementation(() => ({ top: shellTop } as DOMRect));
  await act(() => window.dispatchEvent(new Event("resize")));
  expect(body.style.maxHeight).toBe(`${11 * 32 + 28 - 6 * 32}px`);
  // when
  frame.height = 600;
  shellTop = 100;
  await act(() => window.dispatchEvent(new Event("scroll")));
  // then
  expect(body.style.maxHeight, "the navigation ends on the last whole entry of the larger frame").toBe(`${23 * 32 + 28 - 6 * 32}px`);
});

it("given an administrative page taller than the window, when the page scrolls, then the navigation reaches down the window", async () => {
  // given
  window.innerHeight = 800;
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  show("/admin/facility");
  const shell = screen.getByTestId("admin-shell");
  const frame = screen.getByTestId("admin-navigation-frame");
  const page = screen.getByTestId("a-page");
  let scrolled = 0;
  vi.spyOn(shell, "getBoundingClientRect").mockImplementation(() => ({ top: 150 - scrolled } as DOMRect));
  vi.spyOn(page, "getBoundingClientRect").mockImplementation(() => ({ bottom: 2000 - scrolled } as DOMRect));
  // when
  await act(() => window.dispatchEvent(new Event("resize")));
  // then
  expect(frame.style.getPropertyValue("--admin-navigation-room")).toBe(`${800 - 150}px`);
  // when
  scrolled = 600;
  Object.defineProperty(window, "scrollY", { configurable: true, value: scrolled });
  await act(() => window.dispatchEvent(new Event("scroll")));
  // then
  expect(frame.style.getPropertyValue("--admin-navigation-room"), "stuck, the frame spans the window less its margins").toBe(`${800 - 64}px`);
});

it("given an administrative page shorter than the window, when it is shown, then the navigation leaves the page its height", async () => {
  // given
  window.innerHeight = 800;
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  show("/admin/facility");
  const shell = screen.getByTestId("admin-shell");
  const frame = screen.getByTestId("admin-navigation-frame");
  vi.spyOn(shell, "getBoundingClientRect").mockReturnValue({ top: 150 } as DOMRect);
  vi.spyOn(screen.getByTestId("a-page"), "getBoundingClientRect").mockReturnValue({ bottom: 300 } as DOMRect);
  // when
  await act(() => window.dispatchEvent(new Event("resize")));
  // then
  expect(frame.style.getPropertyValue("--admin-navigation-room")).toBe(`${800 - 150}px`);
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
