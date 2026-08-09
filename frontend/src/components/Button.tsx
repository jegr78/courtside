import type { ButtonHTMLAttributes } from "react";

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button
    className={`rounded-lg bg-(--club-primary) px-4 py-3 font-semibold text-white shadow-sm transition hover:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--club-primary) disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    {...props}
  />;
}
