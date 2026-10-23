import { type ReactNode } from "react";
import { ScrollContinuation } from "./ScrollContinuation";
import { useScrollContinuation } from "./useScrollContinuation";

export function DialogBody({ children, padding = "px-6 pt-6 pb-1" }: { children: ReactNode; padding?: string }) {
  const { body, content, continues, measure } = useScrollContinuation();
  return <div className="flex min-h-0 flex-col">
    <div ref={body} data-testid="dialog-body" data-continues={continues} onScroll={measure} className={`dialog-body min-h-0 overflow-y-auto ${padding}`}>
      <div ref={content}>{children}</div>
    </div>
    <ScrollContinuation continues={continues} testId="dialog-continues" />
  </div>;
}
