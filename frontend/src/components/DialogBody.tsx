import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

export function DialogBody({ children, padding = "p-6" }: { children: ReactNode; padding?: string }) {
  const body = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [continues, setContinues] = useState(false);

  const measure = useCallback(() => {
    const element = body.current;
    if (element) setContinues(element.scrollHeight - element.clientHeight - element.scrollTop >= 1);
  }, []);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (body.current) observer.observe(body.current);
    if (content.current) observer.observe(content.current);
    return () => observer.disconnect();
  }, [measure]);

  return <div className="relative flex min-h-0 flex-col">
    <div ref={body} data-testid="dialog-body" onScroll={measure} className={`dialog-body min-h-0 overflow-y-auto ${padding}`}>
      <div ref={content}>{children}</div>
    </div>
    {continues && <div data-testid="dialog-continues" aria-hidden="true" className="dialog-continues">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>}
  </div>;
}
