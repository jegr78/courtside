import type { ButtonHTMLAttributes } from "react";

export function Button({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button
    className={`rounded-lg bg-(--club-primary) px-4 py-3 font-semibold text-(--club-primary-text) shadow-sm transition hover:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--club-primary) disabled:cursor-not-allowed disabled:border disabled:border-(--cs-border) disabled:bg-(--cs-raised) disabled:text-(--cs-muted) ${className}`}
    {...props}
  />;
}
