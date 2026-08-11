import type { ReactNode } from "react";

export function Alert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "success" }) {
  const colors = tone === "success"
    ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100"
    : "border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100";
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border p-3 ${colors}`}>
    {children}
  </div>;
}
