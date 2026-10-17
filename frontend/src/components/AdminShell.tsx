import { useLayoutEffect, useRef } from "react";
import { Outlet } from "react-router-dom";
import { AdminNavigation } from "./AdminNavigation";

export function AdminShell({ administrator = true }: { administrator?: boolean }) {
  const shell = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const measure = () => {
      if (!shell.current || !frame.current) return;
      const above = shell.current.getBoundingClientRect().top + window.scrollY;
      frame.current.style.setProperty("--admin-navigation-room", `${window.innerHeight - above - spaceAfter(shell.current)}px`);
    };
    measure();
    const resized = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    resized?.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      resized?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // A page keeps its own height rather than being stretched to the navigation's, which would spread
  // a short page's rows apart; the navigation still fills the row, because sticky needs the travel.
  return <div ref={shell} data-testid="admin-shell" className="grid w-full max-w-7xl gap-6 self-start lg:grid-cols-[15rem_1fr] lg:items-start lg:gap-8">
    <div ref={frame} data-testid="admin-navigation-frame" className="lg:sticky lg:top-8 lg:max-h-[max(12rem,min(calc(100vh-4rem),var(--admin-navigation-room,100vh)))] lg:self-stretch lg:overflow-y-auto">
      <AdminNavigation administrator={administrator} />
    </div>
    <Outlet />
  </div>;
}

// The page below the shell, its padding and the footer, which the navigation leaves room for so it alone never scrolls the page.
function spaceAfter(element: Element): number {
  let space = 0;
  for (let node: Element = element; node.parentElement && node !== document.body; node = node.parentElement) {
    const parent = getComputedStyle(node.parentElement);
    for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      const style = getComputedStyle(sibling);
      if (style.display === "none" || style.position === "absolute" || style.position === "fixed") continue;
      space += (parseFloat(parent.rowGap) || 0) + sibling.getBoundingClientRect().height
        + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    }
    space += (parseFloat(parent.paddingBottom) || 0) + (parseFloat(parent.borderBottomWidth) || 0);
  }
  return space;
}
