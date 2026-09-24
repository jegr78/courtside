import type { ReactNode } from "react";

export type AlertTone = "error" | "warning" | "info" | "success";

export function Alert({ children, tone = "error", testId }: {
  children: ReactNode;
  tone?: AlertTone;
  testId?: string;
}) {
  return <div data-testid={testId} role={tone === "error" ? "alert" : "status"} className={`rounded-lg border p-3 ${noticeColours[tone]}`}>
    {children}
  </div>;
}

const noticeColours: Record<AlertTone, string> = {
  error: "border-(--cs-notice-error-border) bg-(--cs-notice-error-surface) text-(--cs-notice-error-text)",
  warning: "border-(--cs-notice-warning-border) bg-(--cs-notice-warning-surface) text-(--cs-notice-warning-text)",
  info: "border-(--cs-notice-info-border) bg-(--cs-notice-info-surface) text-(--cs-notice-info-text)",
  success: "border-(--cs-notice-success-border) bg-(--cs-notice-success-surface) text-(--cs-notice-success-text)"
};
