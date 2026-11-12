import { type ReactNode, useEffect, useRef, useState } from "react";

/** Mounts its content once it comes within a screen of the viewport, so the content's reads wait until then. */
export function WhenNear({ testId, children }: { testId: string; children: ReactNode }) {
  const placeholder = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (near || !placeholder.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true);
    }, { rootMargin: "100% 0px" });
    observer.observe(placeholder.current);
    return () => observer.disconnect();
  }, [near]);

  return near ? children : <div ref={placeholder} data-testid={`${testId}-pending`} className="min-h-48" />;
}
