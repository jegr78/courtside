import { useCallback, useLayoutEffect, useRef, useState } from "react";

export function useScrollContinuation(active = true, destination?: string) {
  const body = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [continues, setContinues] = useState(false);
  const measure = useCallback(() => {
    const element = body.current;
    const padding = element ? (parseFloat(getComputedStyle(element).paddingBottom) || 0)
      + (content.current ? parseFloat(getComputedStyle(content.current).paddingBottom) || 0 : 0) : 0;
    setContinues(Boolean(active && element && element.scrollHeight - element.clientHeight - element.scrollTop - padding >= 1));
  }, [active]);

  useLayoutEffect(() => {
    if (!active) return;
    const layout = () => {
      const element = body.current;
      const current = destination === undefined ? undefined : element?.querySelector<HTMLElement>('[aria-current="page"]');
      if (element && current) {
        const frame = element.getBoundingClientRect();
        const item = current.getBoundingClientRect();
        if (item.top < frame.top) element.scrollTop += item.top - frame.top;
        else if (item.bottom > frame.bottom) element.scrollTop += item.bottom - frame.bottom;
      }
      measure();
    };
    layout();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(layout);
    if (body.current) observer?.observe(body.current);
    if (content.current) observer?.observe(content.current);
    window.addEventListener("resize", layout);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", layout);
    };
  }, [active, destination, measure]);

  return { body, content, continues, measure };
}
