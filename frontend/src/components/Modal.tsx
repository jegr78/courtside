import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";

export function Modal({ labelledBy, closed, children }: { labelledBy: string; closed: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>(focusableSelector())?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      closed();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>(focusableSelector()) ?? []);
    if (focusable.length === 0) return;
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (current <= 0 ? focusable.length - 1 : current - 1)
      : (current === focusable.length - 1 ? 0 : current + 1);
    if (current === -1 || next !== current + (event.shiftKey ? -1 : 1)) {
      event.preventDefault();
      focusable[next].focus();
    }
  }

  return <div
    role="presentation"
    className="fixed inset-0 z-20 grid place-items-center bg-(--cs-overlay) p-4"
    onMouseDown={(event) => { if (event.target === event.currentTarget) closed(); }}
  >
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onKeyDown={handleKeyDown} className="grid max-h-full w-full place-items-center">
      {children}
    </div>
  </div>;
}

function focusableSelector(): string {
  return "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";
}
