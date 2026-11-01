import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { observeResize } from "./observeResize";

export function useScrollContinuation(active = true, destination?: string) {
  const body = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [continues, setContinues] = useState(false);
  const [precedes, setPrecedes] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const following = useRef(true);
  const placed = useRef(0);
  const laidOut = useRef<() => void>(undefined);
  const measure = useCallback(() => {
    const element = body.current;
    const padding = element ? (parseFloat(getComputedStyle(element).paddingBottom) || 0)
      + (content.current ? parseFloat(getComputedStyle(content.current).paddingBottom) || 0 : 0) : 0;
    setContinues(Boolean(active && element && element.scrollHeight - element.clientHeight - element.scrollTop - padding >= 1));
    setPrecedes(Boolean(active && element && element.scrollTop >= 1));
    setOverflows(Boolean(active && element && element.scrollHeight - element.clientHeight >= 1));
  }, [active]);

  const scrolled = useCallback(() => {
    if (body.current) {
      if (movedFrom(body.current, placed.current)) following.current = false;
      placed.current = body.current.scrollTop;
    }
    measure();
  }, [measure]);

  useLayoutEffect(() => {
    if (!active) return;
    following.current = true;
    const layout = () => {
      const element = body.current;
      if (element && destination !== undefined) {
        element.style.maxHeight = "";
        if (following.current) reveal(element);
        endOnWholeEntries(element);
        placed.current = element.scrollTop;
      }
      measure();
    };
    const resized = () => {
      if (body.current && movedFrom(body.current, placed.current)) following.current = false;
      layout();
    };
    laidOut.current = resized;
    layout();
    const disconnect = observeResize(resized, [body.current, body.current?.parentElement ?? null, content.current]);
    window.addEventListener("resize", resized);
    return () => {
      laidOut.current = undefined;
      disconnect();
      window.removeEventListener("resize", resized);
    };
  }, [active, destination, measure]);

  const relayout = useCallback(() => laidOut.current?.(), []);

  return { body, content, continues, precedes, overflows, measure: scrolled, relayout };
}

function movedFrom(element: HTMLElement, placed: number) {
  const expected = Math.min(placed, Math.max(0, element.scrollHeight - element.clientHeight));
  return Math.abs(element.scrollTop - expected) >= 1;
}

function reveal(element: HTMLElement) {
  const current = element.querySelector<HTMLElement>('[aria-current="page"]');
  if (!current) return;
  const frame = element.getBoundingClientRect();
  const item = current.getBoundingClientRect();
  if (item.top < frame.top) element.scrollTop += item.top - frame.top;
  else if (item.bottom > frame.bottom) element.scrollTop += item.bottom - frame.bottom;
}

// Starts the frame at an entry and shortens it to the last entry that fits, so neither edge cuts one.
function endOnWholeEntries(element: HTMLElement) {
  const height = element.clientHeight;
  if (element.scrollHeight - height < 1) return;
  const frame = element.getBoundingClientRect();
  const entries = [...element.querySelectorAll("a, p")]
    .map((entry) => entry.getBoundingClientRect())
    .filter((box) => box.bottom > box.top)
    .map((box) => ({ top: box.top - frame.top + element.scrollTop, bottom: box.bottom - frame.top + element.scrollTop }));
  const start = element.scrollTop < 1 ? 0 : Math.min(...entries.filter((entry) => entry.top >= element.scrollTop - 0.5).map((entry) => entry.top));
  if (!Number.isFinite(start)) return;
  const reach = start + height;
  const end = element.scrollHeight <= reach + 0.5 ? element.scrollHeight
    : Math.max(start, ...entries.filter((entry) => entry.bottom <= reach + 0.5).map((entry) => entry.bottom));
  if (end - start < height - 0.5 && end > start) element.style.maxHeight = `${end - start}px`;
  element.scrollTop = start;
}
