import type { ReactNode } from "react";

export function Alert({ children, tone = "error" }: { children: ReactNode; tone?: "error" | "success" }) {
  const colors = tone === "success"
    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
    : "border-red-300 bg-red-50 text-red-900";
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border p-3 ${colors}`}>
    {children}
  </div>;
}
