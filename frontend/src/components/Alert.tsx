import type { ReactNode } from "react";
import { noticeColours, type AlertTone } from "./noticeTones";

export function Alert({ children, tone = "error", testId }: {
  children: ReactNode;
  tone?: AlertTone;
  testId?: string;
}) {
  return <div data-testid={testId} role={tone === "error" ? "alert" : "status"} className={`rounded-lg border p-3 ${noticeColours(tone)}`}>
    {children}
  </div>;
}
