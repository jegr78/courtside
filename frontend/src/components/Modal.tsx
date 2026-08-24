import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";

export function Modal({ labelledBy, closed, children }: { labelledBy: string; closed: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    reachableControls(dialog.current)[0]?.focus();
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
    const focusable = reachableControls(dialog.current);
    if (focusable.length === 0) return;
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (current <= 0 ? focusable.length - 1 : current - 1)
      : (current === focusable.length - 1 ? 0 : current + 1);
    // The trap drives every step rather than deferring to the browser for the ordinary ones:
    // sharing the job is what let a control the browser skips become a dead end.
    event.preventDefault();
    focusable[next].focus();
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

// A control inside a collapsed disclosure is in the document and refuses focus, so a trap that
// counts it lands on nothing and every further Tab repeats that. Only its summary is reachable.
function reachableControls(dialog: HTMLElement | null): HTMLElement[] {
  return Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector()) ?? [])
    .filter((control) => {
      const collapsed = control.closest("details:not([open])");
      return !collapsed || control === collapsed.querySelector("summary");
    });
}

function focusableSelector(): string {
  return "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])";
}
