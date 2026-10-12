import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function ScrollRegion({ subject, testId, className = "", children }: {
  subject: string;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return <div role="region" tabIndex={0} aria-label={t("table.scrollRegion", { name: subject })} data-testid={testId}
    className={`focus-ring max-w-full overflow-x-auto ${className}`}>
    {children}
  </div>;
}
