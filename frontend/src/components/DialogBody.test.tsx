import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DialogBody } from "./DialogBody";

let resized: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  resized = undefined;
});

function laidOut(body: HTMLElement, { scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(body, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(body, "clientHeight", { configurable: true, value: clientHeight });
  Object.defineProperty(body, "scrollTop", { configurable: true, value: scrollTop });
}

it("given a form taller than its dialog, when the body is laid out, then a signal marks that it continues below", () => {
  // given
  render(<DialogBody><input /></DialogBody>);
  laidOut(screen.getByTestId("dialog-body"), { scrollHeight: 564, clientHeight: 276, scrollTop: 0 });

  // when
  act(() => resized?.());

  // then
  expect(screen.getByTestId("dialog-continues"), "a body with content below shows the signal").toHaveAttribute("aria-hidden", "true");
});

it("given a form taller than its dialog, when the member scrolls to its end, then the signal goes", () => {
  // given
  render(<DialogBody><input /></DialogBody>);
  const body = screen.getByTestId("dialog-body");
  laidOut(body, { scrollHeight: 564, clientHeight: 276, scrollTop: 0 });
  act(() => resized?.());

  // when
  laidOut(body, { scrollHeight: 564, clientHeight: 276, scrollTop: 288 });
  fireEvent.scroll(body);

  // then
  expect(screen.queryByTestId("dialog-continues"), "nothing lies below the end of the form").toBeNull();
});

it("given a form that fits its dialog, when the body is laid out, then no signal is shown", () => {
  // given
  render(<DialogBody><input /></DialogBody>);
  laidOut(screen.getByTestId("dialog-body"), { scrollHeight: 276, clientHeight: 276, scrollTop: 0 });

  // when
  act(() => resized?.());

  // then
  expect(screen.queryByTestId("dialog-continues"), "a form that fits needs no signal").toBeNull();
});

it("given a form scrolled to within a fraction of a pixel of its end, when it scrolls, then the rounding leaves no signal", () => {
  // given
  render(<DialogBody><input /></DialogBody>);
  const body = screen.getByTestId("dialog-body");
  laidOut(body, { scrollHeight: 564, clientHeight: 276, scrollTop: 0 });
  act(() => resized?.());

  // when
  laidOut(body, { scrollHeight: 564, clientHeight: 276, scrollTop: 287.5 });
  fireEvent.scroll(body);

  // then
  expect(screen.queryByTestId("dialog-continues"), "a sub-pixel remainder is the end of the form").toBeNull();
});
