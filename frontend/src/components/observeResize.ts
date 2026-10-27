export function observeResize(layout: () => void, elements: (Element | null)[]) {
  let frame: number | undefined;
  let disconnected = false;
  const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
    if (disconnected || frame !== undefined) return;
    // Layout writes must run outside ResizeObserver delivery to avoid resizing its observed ancestors.
    frame = requestAnimationFrame(() => {
      frame = undefined;
      layout();
    });
  });
  elements.forEach((element) => { if (element) observer?.observe(element); });
  return () => {
    disconnected = true;
    observer?.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
