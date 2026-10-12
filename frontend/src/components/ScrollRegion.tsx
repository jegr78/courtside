import type { ReactNode } from "react";

export function ScrollRegion({ labelledBy, testId, className = "", children }: {
  labelledBy: string;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return <div role="region" tabIndex={0} aria-labelledby={labelledBy} data-testid={testId}
    className={`focus-ring max-w-full overflow-x-auto ${className}`}>
    {children}
  </div>;
}
