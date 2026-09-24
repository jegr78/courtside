export type AlertTone = "error" | "warning" | "info" | "success";

const toneColours: Record<AlertTone, string> = {
  error: "border-(--cs-notice-error-border) bg-(--cs-notice-error-surface) text-(--cs-notice-error-text)",
  warning: "border-(--cs-notice-warning-border) bg-(--cs-notice-warning-surface) text-(--cs-notice-warning-text)",
  info: "border-(--cs-notice-info-border) bg-(--cs-notice-info-surface) text-(--cs-notice-info-text)",
  success: "border-(--cs-notice-success-border) bg-(--cs-notice-success-surface) text-(--cs-notice-success-text)"
};

export function noticeColours(tone: AlertTone): string {
  return toneColours[tone];
}
