import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: "primary" | "secondary" | "destructive" | "destructive-confirm";
};

const variantClasses: Record<ButtonProps["variant"], string> = {
  primary: "button-primary",
  secondary: "button-secondary",
  destructive: "button-destructive",
  "destructive-confirm": "button-destructive-confirm",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className = "", variant, ...props }, ref) {
  return <button
    ref={ref}
    className={`focus-ring rounded-lg px-4 py-3 font-semibold shadow-sm transition hover:brightness-90 disabled:cursor-not-allowed disabled:border disabled:border-(--cs-border) disabled:bg-(--cs-raised) disabled:text-(--cs-muted) ${variantClasses[variant]} ${className}`}
    {...props}
  />;
});
