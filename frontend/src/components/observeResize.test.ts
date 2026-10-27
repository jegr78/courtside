import { afterEach, expect, it, vi } from "vitest";
import { observeResize } from "./observeResize";

function delivery() {
  let deliver = () => {};
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { deliver = callback; }
    observe() {}
    disconnect() {}
  });
  return () => deliver();
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("given observed content, when several sizes arrive together, then layout changes wait for one animation frame", () => {
  // given
  vi.useFakeTimers();
  const deliver = delivery();
  const element = document.createElement("div");
  const layout = vi.fn(() => { element.style.height = "100px"; });
  const disconnect = observeResize(layout, [element]);
  // when
  deliver();
  deliver();
  // then
  expect(element.style.height, "observer delivery must not resize an observed element").toBe("");
  expect(layout).not.toHaveBeenCalled();
  // when
  vi.advanceTimersToNextFrame();
  // then
  expect(element.style.height).toBe("100px");
  expect(layout).toHaveBeenCalledTimes(1);
  // when
  deliver();
  vi.advanceTimersToNextFrame();
  // then
  expect(layout).toHaveBeenCalledTimes(2);
  disconnect();
});

it("given a queued resize, when the component disconnects, then its detached elements stay untouched", () => {
  // given
  vi.useFakeTimers();
  const deliver = delivery();
  const element = document.createElement("div");
  const disconnect = observeResize(() => { element.style.height = "100px"; }, [element]);
  deliver();
  // when
  disconnect();
  deliver();
  vi.advanceTimersToNextFrame();
  // then
  expect(element.style.height).toBe("");
});

it("given a browser without resize observation, when a component subscribes, then it can still disconnect", () => {
  // given
  vi.stubGlobal("ResizeObserver", undefined);
  const layout = vi.fn();
  // when
  observeResize(layout, [null, document.createElement("div")])();
  // then
  expect(layout).not.toHaveBeenCalled();
});
