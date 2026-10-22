import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { DialogBody } from "./DialogBody";

const widths = { md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl" } as const;

export function Modal({ labelledBy, closed, width = "md", composed = false, testId, children }: {
  labelledBy: string;
  closed: () => void;
  width?: keyof typeof widths;
  composed?: boolean;
  testId?: string;
  children: ReactNode;
}) {
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
      event.stopPropagation();
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

  // The body hosts every modal in the order it opened, so a later one always lies above an earlier one.
  return createPortal(<div
    role="presentation"
    data-testid="modal-overlay"
    className="fixed inset-0 z-20 flex items-center justify-center bg-(--cs-overlay) p-4"
    onMouseDown={(event) => { if (event.target === event.currentTarget) closed(); }}
  >
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onKeyDown={handleKeyDown} data-testid={testId}
         className={`surface-panel flex max-h-full w-full ${widths[width]} flex-col overflow-hidden rounded-2xl border shadow-2xl`}>
      {composed ? children : <DialogBody>{children}</DialogBody>}
    </div>
  </div>, document.body);
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
  const following = controls.findIndex((control) => active.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING);
  const next = following === -1 ? controls.length : following;
  const from = controls.includes(active) ? controls.indexOf(active) : (step === 1 ? next - 1 : next);
  for (let moved = 1; moved <= controls.length; moved += 1) {
    const candidate = controls[(from + step * moved + controls.length * moved) % controls.length];
    candidate.focus();
    if (document.activeElement === candidate) return;
  }
}

function focusableSelector(): string {
  return "button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])";
}
