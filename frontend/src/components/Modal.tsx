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
    // The trap drives every step rather than deferring to the browser for the ordinary ones:
    // sharing the job is what let a control the browser skips become a dead end.
    event.preventDefault();
    focusOnward(focusable, document.activeElement as HTMLElement, event.shiftKey ? -1 : 1);
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

function reachableControls(dialog: HTMLElement | null): HTMLElement[] {
  return Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector()) ?? [])
    .filter(isReachable);
}

// A control inside a collapsed disclosure refuses focus, and a closed one nested in another closed
// one hides its own summary too, so every ancestor is asked rather than only the nearest.
function isReachable(control: HTMLElement): boolean {
  for (let node = control.parentElement; node; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement && !node.open
        && control !== node.querySelector(":scope > summary")) {
      return false;
    }
  }
  return true;
}

// A target may still refuse the focus - hidden by something this filter does not know about - and
// repeating that jump is exactly the dead end the filter exists to prevent.
function focusOnward(controls: HTMLElement[], active: HTMLElement, step: number): void {
  const from = controls.indexOf(active) === -1 ? (step === 1 ? -1 : 0) : controls.indexOf(active);
  for (let moved = 1; moved <= controls.length; moved += 1) {
    const candidate = controls[(from + step * moved + controls.length * moved) % controls.length];
    candidate.focus();
    if (document.activeElement === candidate) return;
  }
}

function focusableSelector(): string {
  return "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])";
}
